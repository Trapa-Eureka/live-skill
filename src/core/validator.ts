// Validator — 구조 검증(DESIGN §3.1), LLM 0회. AssembledFile[]과 형태만 같은 {path, content}[]를 받아
// assembler 산출물이든 디스크에서 읽은 기존 스킬 디렉터리(파일 읽기는 어댑터 몫, T8)든 똑같이 검사한다.
import { estimateTokens } from "./tokenEstimate.js";
import type { Budgets } from "./config.js";

export interface SkillFile {
  path: string;
  content: string;
}

export type ValidationSeverity = "error" | "warning";
export type ValidationCode =
  "budget_exceeded" | "missing_frontmatter" | "broken_link" | "low_anchor_ratio";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  file: string;
  message: string;
}

export interface ValidationReport {
  /** error가 하나도 없을 때만 true — warning은 통과를 막지 않는다(DESIGN §3.1). */
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
        message: `estimated ${String(tokens)} tokens exceeds the ${String(budget)}-token budget for this file (DESIGN §3). Fix: shorten the content or raise the budget in config.`,
      });
    }
  }
  return issues;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/u;

function checkFrontmatter(files: readonly SkillFile[]): ValidationIssue[] {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (skillMd === undefined) {
    return [
      {
        severity: "error",
        code: "missing_frontmatter",
        file: "SKILL.md",
        message:
          "SKILL.md is missing entirely. Fix: run compile, or add a SKILL.md with name/description frontmatter.",
      },
    ];
  }
  const match = FRONTMATTER_RE.exec(skillMd.content);
  if (match?.[1] === undefined) {
    return [
      {
        severity: "error",
        code: "missing_frontmatter",
        file: "SKILL.md",
        message:
          'SKILL.md has no "---" YAML frontmatter block at the start of the file (Agent Skills standard). Fix: add one with name/description.',
      },
    ];
  }
  const body = match[1];
  const missing = ["name", "description"].filter((key) => !new RegExp(`^${key}:`, "mu").test(body));
  if (missing.length === 0) return [];
  return [
    {
      severity: "error",
      code: "missing_frontmatter",
      file: "SKILL.md",
      message: `SKILL.md frontmatter is missing required field(s): ${missing.join(", ")}. Fix: add them between the "---" markers.`,
    },
  ];
}

const CHAPTER_LINK_RE = /`(chapters\/[^`\s]+\.md)`/gu;

function checkChapterLinks(files: readonly SkillFile[]): ValidationIssue[] {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (skillMd === undefined) return []; // 프런트매터 검사가 이미 이 경우를 지목한다
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

/** 헤딩·빈 줄·인라인 표기(용어/패턴/규칙)만 있는 줄은 "주장"이 아니므로 앵커 비율 계산에서 뺀다. */
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
  /** 기본 0.5(DESIGN §3.1) — 챕터당 앵커 있는 줄의 최소 비율. 미달 시 warning. */
  minAnchorRatio?: number;
}

/** DESIGN §3.1의 4가지 검사를 전부 돌려 하나의 리포트로 합친다. */
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
