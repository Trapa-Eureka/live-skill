// Assembler — 결정론 템플릿 조립(DESIGN §3). LLM 의존 0: LlmProvider/ScriptedLlm/어댑터를 임포트하지
// 않는다(완료 기준, tests/assembler.test.ts의 "LLM 의존 0" 검사가 이 파일 자체를 스캔해 강제한다).
// 같은 입력(plan + distilled)은 항상 같은 산출을 낸다 — 파일명도 outline 제안을 신뢰하지 않고 여기서
// 다시 계산한다(§2 T4 결정).
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
  /** false면 SKILL.md에 unverified 표시를 남긴다(게이트 스킵/미달, DESIGN §3). */
  verified: boolean;
}

/** chapters/chNN-slug.md 경로를 결정론으로 계산한다 — pipeline.ts가 manifest의 chapterFile을 같은
 * 방식으로 다시 구할 때도 이 함수를 그대로 쓴다(DESIGN §5.1), 로직 중복 없이. */
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
          "fix: rerun distill for this chapter, or check that outline and distill agree on chapter ids.",
      );
    }
    return { plan: chapterPlan, distilled: d, path: chapterFilePath(i, chapterPlan.title) };
  });
}

// --- 챕터 본문의 인라인 표기 추출 (DESIGN §3 T4 결정) ---

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

// --- 파일 템플릿 ---

function buildSkillMd(
  plan: SkillPlan,
  chapters: readonly ResolvedChapter[],
  verified: boolean,
): string {
  const lines: string[] = [
    // E2: 값을 이어 붙이지 않고 YAML로 직렬화한다 — "Guide: Setup" 같은 제목도 소비자가 그대로 읽는다.
    serializeFrontmatter({ name: plan.slug, description: plan.title }),
    "",
    `# ${plan.title}`,
    "",
  ];
  if (!verified) {
    lines.push(
      "> ⚠️ **unverified** — 이 스킬은 품질 게이트를 거치지 않았다(`--no-gate` 또는 게이트 미달). 정확성이 검증되지 않았다.",
      "",
    );
  }
  lines.push("## 챕터 인덱스", "");
  for (const ch of chapters) {
    lines.push(`- \`${ch.path}\` — ${ch.plan.title} (원문 섹션: ${ch.plan.sectionIds.join(", ")})`);
  }
  lines.push(
    "",
    "## 참고 파일",
    "",
    "- `glossary.md` — 핵심 용어",
    "- `patterns.md` — 기법·절차·안티패턴",
    "- `cheatsheet.md` — 결정 표·즉답 규칙",
  );
  return lines.join("\n");
}

function buildGlossaryMd(entries: readonly GlossaryEntry[]): string {
  if (entries.length === 0) return "# Glossary\n\n(추출된 용어가 없습니다.)";
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
  PATTERN: "패턴",
  "ANTI-PATTERN": "안티패턴",
  PROCEDURE: "절차",
};

function buildPatternsMd(entries: readonly PatternEntry[]): string {
  if (entries.length === 0) return "# Patterns\n\n(추출된 패턴이 없습니다.)";
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
  if (entries.length === 0) return "# Cheatsheet\n\n(추출된 규칙이 없습니다.)";
  const lines = ["# Cheatsheet", ""];
  for (const e of entries) lines.push(`- ${e.text} (\`${e.chapterFile}\`)`);
  return lines.join("\n");
}

/** DESIGN §3의 5파일을 결정론으로 조립한다. 입력이 같으면 항상 같은 출력(SPEC §6 재현성). */
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
