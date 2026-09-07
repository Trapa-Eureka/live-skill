// Assembler: deterministic template assembly (DESIGN §3). Zero LLM dependency: it imports neither
// LlmProvider, ScriptedLlm nor any adapter (a completion criterion; the "zero LLM dependency" test
// in tests/assembler.test.ts scans this file itself to enforce it).
// The same input (plan + distilled) always yields the same output. File names are recomputed here
// rather than trusting the outline's suggestion (§2 T4 decision).
import { serializeFrontmatter } from "./frontmatter.js";
import { slugifyHeading } from "./sectionId.js";
import { estimateTokens } from "./tokenEstimate.js";
import type { ChapterPlan, DistilledChapter, SkillPlan } from "./types.js";

export interface AssembledFile {
  path: string;
  content: string;
  estimatedTokens: number;
}

export interface AssembleOptions {
  /** When false, SKILL.md carries the unverified marker (gate skipped or failed, DESIGN §3). */
  verified: boolean;
}

/** Computes the chapters/chNN-slug.md path deterministically. pipeline.ts reuses this very
 * function when it derives the manifest's chapterFile the same way (DESIGN §5.1), so the logic is
 * not duplicated. */
export function chapterFilePath(index: number, title: string): string {
  const n = String(index + 1).padStart(2, "0");
  return `chapters/ch${n}-${slugifyHeading(title)}.md`;
}

function file(path: string, content: string): AssembledFile {
  const withTrailingNewline = content.endsWith("\n") ? content : `${content}\n`;
  return {
    path,
    content: withTrailingNewline,
    estimatedTokens: estimateTokens(withTrailingNewline),
  };
}

interface ResolvedChapter {
  plan: ChapterPlan;
  distilled: DistilledChapter;
  path: string;
}

function resolveChapters(
  plan: SkillPlan,
  distilled: readonly DistilledChapter[],
): ResolvedChapter[] {
  const byId = new Map(distilled.map((d) => [d.id, d]));
  return plan.chapters.map((chapterPlan, i) => {
    const d = byId.get(chapterPlan.id);
    if (d === undefined) {
      throw new Error(
        `assembleSkill: no distilled chapter for id "${chapterPlan.id}" — ` +
          "Fix: rerun distill for this chapter, or check that outline and distill agree on chapter ids.",
      );
    }
    return { plan: chapterPlan, distilled: d, path: chapterFilePath(i, chapterPlan.title) };
  });
}

// --- Extraction of inline markers from chapter bodies (DESIGN §3 T4 decision) ---

const GLOSSARY_LINE = /^\*\*(.+?)\*\*\s*—\s*(.+)$/u;
const PATTERN_LINE = /^-\s*\[(PATTERN|ANTI-PATTERN|PROCEDURE)\]\s*(.+)$/iu;
const RULE_LINE = /^-\s*\[RULE\]\s*(.+)$/iu;

interface GlossaryEntry {
  term: string;
  definition: string;
  chapterFiles: string[];
}

function extractGlossary(chapters: readonly ResolvedChapter[]): GlossaryEntry[] {
  const byTerm = new Map<string, GlossaryEntry>();
  for (const ch of chapters) {
    for (const line of ch.distilled.body.split("\n")) {
      const m = GLOSSARY_LINE.exec(line.trim());
      const term = m?.[1];
      const definition = m?.[2];
      if (term === undefined || definition === undefined) continue;
      const existing = byTerm.get(term);
      if (existing === undefined) {
        byTerm.set(term, { term, definition, chapterFiles: [ch.path] });
      } else if (!existing.chapterFiles.includes(ch.path)) {
        existing.chapterFiles.push(ch.path);
      }
    }
  }
  return [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
}

type PatternKind = "PATTERN" | "ANTI-PATTERN" | "PROCEDURE";
interface PatternEntry {
  kind: PatternKind;
  text: string;
  chapterFile: string;
}

function extractPatterns(chapters: readonly ResolvedChapter[]): PatternEntry[] {
  const entries: PatternEntry[] = [];
  for (const ch of chapters) {
    for (const line of ch.distilled.body.split("\n")) {
      const m = PATTERN_LINE.exec(line.trim());
      const kind = m?.[1];
      const text = m?.[2];
      if (kind === undefined || text === undefined) continue;
      entries.push({ kind: kind.toUpperCase() as PatternKind, text, chapterFile: ch.path });
    }
  }
  return entries;
}

interface RuleEntry {
  text: string;
  chapterFile: string;
}

function extractRules(chapters: readonly ResolvedChapter[]): RuleEntry[] {
  const entries: RuleEntry[] = [];
  for (const ch of chapters) {
    for (const line of ch.distilled.body.split("\n")) {
      const m = RULE_LINE.exec(line.trim());
      const text = m?.[1];
      if (text === undefined) continue;
      entries.push({ text, chapterFile: ch.path });
    }
  }
  return entries;
}

// --- File templates ---

function buildSkillMd(
  plan: SkillPlan,
  chapters: readonly ResolvedChapter[],
  verified: boolean,
): string {
  const lines: string[] = [
    // E2: serialize as YAML instead of concatenating values, so a title like "Guide: Setup" is
    // read back verbatim by consumers.
    serializeFrontmatter({ name: plan.slug, description: plan.title }),
    "",
    `# ${plan.title}`,
    "",
  ];
  if (!verified) {
    lines.push(
      "> ⚠️ **unverified** — this skill did not go through the quality gate (`--no-gate`, or the gate did not pass). Its accuracy has not been verified.",
      "",
    );
  }
  lines.push("## Chapter index", "");
  for (const ch of chapters) {
    lines.push(
      `- \`${ch.path}\` — ${ch.plan.title} (source sections: ${ch.plan.sectionIds.join(", ")})`,
    );
  }
  lines.push(
    "",
    "## Reference files",
    "",
    "- `glossary.md` — key terms",
    "- `patterns.md` — techniques, procedures, anti-patterns",
    "- `cheatsheet.md` — decision tables and quick rules",
  );
  return lines.join("\n");
}

function buildGlossaryMd(entries: readonly GlossaryEntry[]): string {
  if (entries.length === 0) return "# Glossary\n\n(no terms extracted.)";
  const lines = ["# Glossary", ""];
  for (const e of entries) {
    lines.push(
      `**${e.term}** — ${e.definition} (${e.chapterFiles.map((f) => `\`${f}\``).join(", ")})`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

const PATTERN_KIND_LABEL: Record<PatternKind, string> = {
  PATTERN: "Patterns",
  "ANTI-PATTERN": "Anti-patterns",
  PROCEDURE: "Procedures",
};

function buildPatternsMd(entries: readonly PatternEntry[]): string {
  if (entries.length === 0) return "# Patterns\n\n(no patterns extracted.)";
  const lines = ["# Patterns", ""];
  for (const kind of ["PATTERN", "PROCEDURE", "ANTI-PATTERN"] as const) {
    const group = entries.filter((e) => e.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${PATTERN_KIND_LABEL[kind]}`, "");
    for (const e of group) lines.push(`- ${e.text} (\`${e.chapterFile}\`)`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function buildCheatsheetMd(entries: readonly RuleEntry[]): string {
  if (entries.length === 0) return "# Cheatsheet\n\n(no rules extracted.)";
  const lines = ["# Cheatsheet", ""];
  for (const e of entries) lines.push(`- ${e.text} (\`${e.chapterFile}\`)`);
  return lines.join("\n");
}

/** Deterministically assembles the 5 files of DESIGN §3. Same input, same output, always
 * (SPEC §6 reproducibility). */
export function assembleSkill(
  plan: SkillPlan,
  distilled: readonly DistilledChapter[],
  opts: AssembleOptions,
): AssembledFile[] {
  const chapters = resolveChapters(plan, distilled);
  const glossary = extractGlossary(chapters);
  const patterns = extractPatterns(chapters);
  const rules = extractRules(chapters);

  return [
    file("SKILL.md", buildSkillMd(plan, chapters, opts.verified)),
    ...chapters.map((ch) => file(ch.path, ch.distilled.body)),
    file("glossary.md", buildGlossaryMd(glossary)),
    file("patterns.md", buildPatternsMd(patterns)),
    file("cheatsheet.md", buildCheatsheetMd(rules)),
  ];
}
