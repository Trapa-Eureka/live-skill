// Quality gate: the heart of the product (DESIGN §4). qaGen (anchor check, one regeneration) → isolated
// answerer simulator (pick a chapter from SKILL.md alone → load only that chapter → answer) → grader
// (double check in a single call) → verdict. CLAUDE.md guardrails 1 and 2: never relax the threshold,
// never inject the source text or unselected chapters into the answerer.
import {
  answerPrompt,
  chapterSelectionPrompt,
  gradePrompt,
  parseGradeVerdict,
  qaGenPrompt,
} from "./prompts.js";
import type {
  GateFailureReason,
  GateReport,
  GoldenQA,
  LlmProvider,
  Manifest,
  Section,
} from "./types.js";
// gateVerdict.ts is the single source of the verdict rules (threshold floor, pass condition), shared
// with the manifest semantic validation in schemas.ts (B6).
import { DEFAULT_THRESHOLD, assertGateThreshold, decidePassed } from "./gateVerdict.js";
import { parseJsonResponse } from "./jsonResponse.js";
import { isChapterFilePath, qaGenResponseSchema } from "./schemas.js";
import type { SkillFile } from "./validator.js";

export const DEFAULT_K = 3;

export interface GateChapter {
  file: string;
  sectionIds: readonly string[];
}

export interface GateInput {
  /** Only {path, content} is needed: both the assembler's AssembledFile and a SkillFile read from disk
   * (eval, T8) fit as-is. The answerer reads only SKILL.md and the selected chapter file from this
   * list. */
  files: readonly SkillFile[];
  /** Chapter file order and member sections; used to pick qaGen targets and to aggregate perChapter. */
  chapters: readonly GateChapter[];
  /** Source sections qaGen refers to (the full list merged by the pipeline). */
  sections: readonly Section[];
}

export interface GateDeps {
  llm: LlmProvider;
  /** Golden Q&A items per section, default 3 (DESIGN §4). */
  k?: number;
  /** Pass threshold, default 0.9 (DESIGN §4); never relaxed (CLAUDE.md guardrail 1). */
  threshold?: number;
}

/** Groups manifest.sections by chapterFile back into GateChapter[]; used by `eval` (T8, DESIGN §6) to
 * rerun the gate from the manifest alone, without a SkillPlan. Sorted by file name for determinism. */
export function chaptersFromManifest(manifest: Manifest): GateChapter[] {
  const byFile = new Map<string, string[]>();
  for (const s of manifest.sections) {
    const ids = byFile.get(s.chapterFile) ?? [];
    ids.push(s.id);
    byFile.set(s.chapterFile, ids);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, sectionIds]) => ({ file, sectionIds }));
}

/** Chapter files the manifest points at that are absent from the actual skill directory (B3); `eval`
 * checks this before calling the LLM, so a manifest pasted in from another directory or a deleted
 * chapter does not silently turn into a not_found failure. */
export function missingChapterFiles(
  chapters: readonly GateChapter[],
  files: readonly SkillFile[],
): string[] {
  const onDisk = new Set(files.map((f) => f.path));
  return chapters.map((c) => c.file).filter((file) => !onDisk.has(file));
}

/** The true upper bound on LLM calls the gate can consume (DESIGN §4 T7, D1): per section up to 2 qaGen
 * calls (initial + one regeneration), plus 3 calls per question (select, answer, grade). Early exits
 * (not_found, anchor_missing) and skipped regenerations make the actual count lower. */
export function estimateGateCalls(sectionCount: number, k: number): number {
  return sectionCount * 2 + sectionCount * k * 3;
}

/** Upper bound for the eval reuse path, where qaGen is skipped (D2): 3 calls per question (select,
 * answer, grade). Early exits make the actual count lower. */
export function estimateEvalCalls(qaCount: number): number {
  return qaCount * 3;
}

function parseQaGenItems(
  raw: string,
): { question: string; refAnswer: string; anchorQuote: string }[] {
  try {
    // L2: tolerate a fence/prose envelope; the item schema itself stays strict.
    return qaGenResponseSchema.parse(parseJsonResponse(raw)).items;
  } catch {
    return []; // parse failure = zero items; the regeneration loop naturally retries
  }
}

/** Produces k golden Q&A items for one section. Items whose anchorQuote is not in the source are
 * discarded and regenerated exactly once (DESIGN §4-1); if the regeneration still falls short, that
 * many fewer are returned (item exclusion, TESTING §3). */
export async function generateGoldenQa(
  section: Section,
  k: number,
  llm: LlmProvider,
): Promise<GoldenQA[]> {
  const valid: GoldenQA[] = [];
  for (let attempt = 0; attempt < 2 && valid.length < k; attempt++) {
    const need = k - valid.length;
    const raw = await llm.complete(qaGenPrompt(section, need));
    for (const item of parseQaGenItems(raw)) {
      if (valid.length >= k) break;
      if (!section.text.includes(item.anchorQuote)) continue; // quote not in the source; discarded this round
      valid.push({
        id: `${section.id}-q${String(valid.length + 1)}`,
        sectionId: section.id,
        question: item.question,
        refAnswer: item.refAnswer,
        anchorQuote: item.anchorQuote,
      });
    }
  }
  return valid;
}

interface QaOutcome {
  qaId: string;
  chapterFile: string;
  correct: boolean;
  failureReason?: GateFailureReason | undefined;
  selectedFile: string;
  loadedFiles: string[];
}

/** Evaluates one golden Q&A through the isolated answerer simulator. Stops at the first failure point
 * (DESIGN §4 T7 decision order). */
async function evaluateQa(
  qa: GoldenQA,
  chapterFile: string,
  chapterFiles: ReadonlySet<string>,
  filesByPath: ReadonlyMap<string, SkillFile>,
  skillMdContent: string,
  llm: LlmProvider,
): Promise<QaOutcome> {
  const selectionRaw = await llm.complete(chapterSelectionPrompt(skillMdContent, qa.question));
  const selectedFile = selectionRaw.trim();

  // A valid selection must (a) be a planned chapter path and (b) actually exist in the assembled
  // output. (b) is what the "missing chapter injection" test catches: the SKILL.md index still points
  // at the chapter, but if the file is gone from the assembly, the isolated simulator has nothing to
  // load (guardrail 2: the source text is never used as a stand-in).
  const selectedFileContent = filesByPath.get(selectedFile);
  if (!chapterFiles.has(selectedFile) || selectedFileContent === undefined) {
    return {
      qaId: qa.id,
      chapterFile,
      correct: false,
      failureReason: "not_found",
      selectedFile,
      loadedFiles: [],
    };
  }

  const selectedContent = selectedFileContent.content;
  if (!selectedContent.includes(qa.anchorQuote)) {
    return {
      qaId: qa.id,
      chapterFile,
      correct: false,
      failureReason: "anchor_missing",
      selectedFile,
      loadedFiles: [selectedFile],
    };
  }

  // Isolation (guardrail 2): the answerer gets SKILL.md plus the one selected chapter, nothing else.
  const loadedContext = `${skillMdContent}\n\n---\n\n${selectedContent}`;
  const answer = await llm.complete(answerPrompt(loadedContext, qa.question));
  const verdictRaw = await llm.complete(gradePrompt(qa, answer));
  const verdict = parseGradeVerdict(verdictRaw);

  return {
    qaId: qa.id,
    chapterFile,
    correct: verdict === "correct",
    failureReason: verdict === "correct" ? undefined : "wrong",
    selectedFile,
    loadedFiles: [selectedFile],
  };
}

export interface EvaluateInput {
  files: readonly SkillFile[];
  chapters: readonly GateChapter[];
  /** Questions requested per section (coverage.requested). Default DEFAULT_K; the eval reuse path
   * passes the config value from that run. */
  qaPerSection?: number;
}

/**
 * Grades an already-generated golden QA list, skipping qaGen (DESIGN §4/§6 decision T8). Used by the
 * `eval` command to reuse the manifest's QA without the source. threshold defaults to 0.9 (guardrail
 * 1: never relaxed).
 */
export async function evaluateGoldenQa(
  qas: readonly GoldenQA[],
  input: EvaluateInput,
  llm: LlmProvider,
  threshold = DEFAULT_THRESHOLD,
): Promise<GateReport> {
  assertGateThreshold(threshold); // B4: even a caller that bypassed the boundary cannot go below the floor

  // B3 (guardrail 2): the answerer may load only files that are both in the chapter list and in the
  // code-defined chapter format (chapters/<slug>.md). manifest.json (which holds the answers), the
  // source, and auxiliary files are never loaded even if they sneak into the chapter list: an external
  // manifest may set the list, but the code holds the format boundary. SKILL.md is supplied separately
  // as the index.
  const chapterFileSet = new Set(input.chapters.map((c) => c.file).filter(isChapterFilePath));
  const filesByPath = new Map(
    input.files.filter((f) => chapterFileSet.has(f.path)).map((f) => [f.path, f]),
  );
  const skillMd = input.files.find((f) => f.path === "SKILL.md")?.content ?? "";
  const chapterFileBySectionId = new Map<string, string>();
  for (const chapter of input.chapters) {
    for (const sectionId of chapter.sectionIds) chapterFileBySectionId.set(sectionId, chapter.file);
  }

  const outcomes: QaOutcome[] = [];
  for (const qa of qas) {
    const chapterFile = chapterFileBySectionId.get(qa.sectionId) ?? "";
    outcomes.push(await evaluateQa(qa, chapterFile, chapterFileSet, filesByPath, skillMd, llm));
  }

  const perChapter = input.chapters.map((c) => {
    const forChapter = outcomes.filter((o) => o.chapterFile === c.file);
    return {
      file: c.file,
      asked: forChapter.length,
      correct: forChapter.filter((o) => o.correct).length,
    };
  });

  // B2 (DESIGN §4): count valid questions per section of the population (each chapter's sectionIds).
  // A section with no question at all is "unverified" and blocks passing even if everything else is
  // correct; rather than dropping it from the denominator (a guardrail 1 violation), it is a separate
  // requirement.
  const requested = input.qaPerSection ?? DEFAULT_K;
  const generatedBySection = new Map<string, number>();
  for (const qa of qas) {
    generatedBySection.set(qa.sectionId, (generatedBySection.get(qa.sectionId) ?? 0) + 1);
  }
  const coverage = input.chapters.flatMap((c) =>
    c.sectionIds.map((sectionId) => ({
      sectionId,
      requested,
      generated: generatedBySection.get(sectionId) ?? 0,
    })),
  );
  const uncovered = coverage.filter((c) => c.generated === 0);

  const failures = [
    ...outcomes
      .filter((o) => !o.correct)
      .map((o) => ({ qaId: o.qaId, reason: o.failureReason ?? ("wrong" as const) })),
    // A section-level failure, not a question-level one: written as "question 0", before q1..qk
    // (DESIGN §2).
    ...uncovered.map((c) => ({
      qaId: `${c.sectionId}-q0`,
      reason: "qa_generation_failed" as const,
    })),
  ];

  const loadHistory = outcomes.map((o) => ({
    qaId: o.qaId,
    selectedFile: o.selectedFile,
    loadedFiles: o.loadedFiles,
  }));

  const asked = outcomes.length;
  const correct = outcomes.filter((o) => o.correct).length;
  const passRate = asked === 0 ? 0 : correct / asked;

  return {
    passRate,
    threshold,
    // The pass condition (questions exist, threshold met, no unverified sections; B2, B4) lives in
    // gateVerdict.decidePassed alone. The manifest semantic validation (B6) recomputes it with the same
    // function, so the file's verdict and the code's verdict cannot diverge.
    passed: decidePassed({
      asked,
      passRate,
      threshold,
      uncoveredSections: uncovered.length,
    }),
    perChapter,
    failures,
    loadHistory,
    coverage,
  };
}

export interface GateOutcome {
  report: GateReport;
  /** The generated golden QA as-is; saved as manifest.goldenQa so eval can reuse it later (DESIGN §6
   * decision T8). */
  goldenQa: GoldenQA[];
}

/** The full DESIGN §4 gate: generates questions per section with qaGen, then delegates grading to
 * evaluateGoldenQa. */
export async function runGate(input: GateInput, deps: GateDeps): Promise<GateOutcome> {
  const k = deps.k ?? DEFAULT_K;
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));

  const goldenQa: GoldenQA[] = [];
  for (const chapter of input.chapters) {
    for (const sectionId of chapter.sectionIds) {
      const section = sectionById.get(sectionId);
      if (section === undefined) continue; // guards against a pipeline mismatch; always present in the normal flow
      goldenQa.push(...(await generateGoldenQa(section, k, deps.llm)));
    }
  }

  const report = await evaluateGoldenQa(
    goldenQa,
    { files: input.files, chapters: input.chapters, qaPerSection: k },
    deps.llm,
    deps.threshold ?? DEFAULT_THRESHOLD,
  );
  return { report, goldenQa };
}
