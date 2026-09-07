// Validator: structural validation (DESIGN §3.1), zero LLM calls. Takes a {path, content}[] that
// merely shares its shape with AssembledFile[], so it checks assembler output and an existing skill
// directory read from disk (file reading belongs to the adapter, T8) exactly the same way.
import { parseFrontmatter } from "./frontmatter.js";
import { estimateTokens } from "./tokenEstimate.js";
import type { Budgets } from "./config.js";

export interface SkillFile {
  path: string;
  content: string;
}

export type ValidationSeverity = "error" | "warning";
export type ValidationCode =
  | "budget_exceeded"
  | "missing_frontmatter"
  | "invalid_frontmatter"
  | "unknown_frontmatter_key"
  | "broken_link"
  | "low_anchor_ratio";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  file: string;
  message: string;
}

export interface ValidationReport {
  /** true only when there is no error at all; warnings do not block passing (DESIGN §3.1). */
  passed: boolean;
  issues: ValidationIssue[];
}

const DEFAULT_MIN_ANCHOR_RATIO = 0.5;

function budgetFor(path: string, budgets: Budgets): number | undefined {
  if (path === "SKILL.md") return budgets.skillMd;
  if (path.startsWith("chapters/") && path.endsWith(".md")) return budgets.chapter;
  if (path === "glossary.md") return budgets.glossary;
  if (path === "patterns.md") return budgets.patterns;
  if (path === "cheatsheet.md") return budgets.cheatsheet;
  return undefined;
}

function checkBudgets(files: readonly SkillFile[], budgets: Budgets): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const f of files) {
    const budget = budgetFor(f.path, budgets);
    if (budget === undefined) continue;
    const tokens = estimateTokens(f.content);
    if (tokens > budget) {
      issues.push({
        severity: "error",
        code: "budget_exceeded",
        file: f.path,
        message: `estimated ${String(tokens)} tokens exceeds the ${String(budget)}-token budget for this file (DESIGN §3). Fix: shorten the file; if compile generated it, re-run compile or split the source into smaller skills.`,
      });
    }
  }
  return issues;
}

/** E2 (DESIGN §3.1): the old regex check for key presence became real YAML parsing plus type,
 * value and key checks. A hand-edited SKILL.md and assembler output are both judged exactly the way
 * an Agent Skills consumer reads them. */
function checkFrontmatter(files: readonly SkillFile[]): ValidationIssue[] {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  const error = (code: ValidationCode, message: string): ValidationIssue[] => [
    { severity: "error", code, file: "SKILL.md", message },
  ];
  if (skillMd === undefined) {
    return error(
      "missing_frontmatter",
      "SKILL.md is missing entirely. Fix: run compile, or add a SKILL.md with name/description frontmatter.",
    );
  }
  const parsed = parseFrontmatter(skillMd.content);
  if (parsed.ok) {
    return parsed.value.unknownKeys.map((key) => ({
      severity: "warning",
      code: "unknown_frontmatter_key",
      file: "SKILL.md",
      message: `SKILL.md frontmatter has a key the Agent Skills standard does not define: "${key}". Fix: remove it, or keep it if your skill consumer expects it.`,
    }));
  }
  const problem = parsed.error;
  switch (problem.kind) {
    case "missing_block":
      return error(
        "missing_frontmatter",
        'SKILL.md has no "---" YAML frontmatter block at the start of the file (Agent Skills standard). Fix: add one with name/description.',
      );
    case "missing_field":
      return error(
        "missing_frontmatter",
        `SKILL.md frontmatter is missing required field(s): ${problem.fields.join(", ")}. Fix: add them between the "---" markers.`,
      );
    case "syntax":
      return error(
        "invalid_frontmatter",
        `SKILL.md frontmatter is not valid YAML (${problem.detail}). Fix: quote values that contain ": " or "#" — e.g. description: "Guide: Setup" — or re-run compile, which always quotes them.`,
      );
    case "not_a_map":
      return error(
        "invalid_frontmatter",
        'SKILL.md frontmatter must be a YAML mapping of key: value lines (it parsed as a list, a bare value, or nothing). Fix: write name: and description: lines between the "---" markers.',
      );
    case "invalid_field":
      return error(
        "invalid_frontmatter",
        `SKILL.md frontmatter field "${problem.field}" is invalid: ${problem.detail}. Fix: name must be a lowercase slug (letters, digits, single hyphens, max 64 chars) matching the skill directory; description must be non-empty text of at most 1024 characters.`,
      );
  }
}

const CHAPTER_LINK_RE = /`(chapters\/[^`\s]+\.md)`/gu;

function checkChapterLinks(files: readonly SkillFile[]): ValidationIssue[] {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (skillMd === undefined) return []; // the frontmatter check already reports this case
  const known = new Set(files.map((f) => f.path));
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const m of skillMd.content.matchAll(CHAPTER_LINK_RE)) {
    const link = m[1];
    if (link === undefined || seen.has(link)) continue;
    seen.add(link);
    if (!known.has(link)) {
      issues.push({
        severity: "error",
        code: "broken_link",
        file: "SKILL.md",
        message: `SKILL.md references "${link}", but no such file was provided. Fix: regenerate the chapter, or fix the reference.`,
      });
    }
  }
  return issues;
}

/** A blank line or a heading is not a "claim", so it is left out of the anchor-ratio math. Every
 * other line (inline term/pattern/rule markers included) counts and is expected to carry an anchor. */
function isSubstantiveLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return false;
  if (t.startsWith("#")) return false;
  return true;
}

function checkAnchorRatio(files: readonly SkillFile[], minAnchorRatio: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const f of files) {
    if (!f.path.startsWith("chapters/") || !f.path.endsWith(".md")) continue;
    const lines = f.content.split("\n").filter(isSubstantiveLine);
    if (lines.length === 0) continue;
    const anchored = lines.filter((l) => l.includes("[§")).length;
    const ratio = anchored / lines.length;
    if (ratio < minAnchorRatio) {
      issues.push({
        severity: "warning",
        code: "low_anchor_ratio",
        file: f.path,
        message: `only ${(ratio * 100).toFixed(0)}% of substantive lines carry a [§...] anchor (minimum ${(minAnchorRatio * 100).toFixed(0)}%). Fix: re-distill with stronger anchor instructions, or verify manually.`,
      });
    }
  }
  return issues;
}

export interface ValidateOptions {
  /** Defaults to 0.5 (DESIGN §3.1): the minimum share of anchored lines per chapter. Below it, a
   * warning. */
  minAnchorRatio?: number;
}

/** Runs all four checks of DESIGN §3.1 and merges them into one report. */
export function validateSkill(
  files: readonly SkillFile[],
  budgets: Budgets,
  opts: ValidateOptions = {},
): ValidationReport {
  const issues = [
    ...checkBudgets(files, budgets),
    ...checkFrontmatter(files),
    ...checkChapterLinks(files),
    ...checkAnchorRatio(files, opts.minAnchorRatio ?? DEFAULT_MIN_ANCHOR_RATIO),
  ];
  return { passed: !issues.some((i) => i.severity === "error"), issues };
}
