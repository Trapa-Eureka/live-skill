// zod schemas, used only at the IO boundaries for LLM responses and the manifest file (CLAUDE.md
// convention: "LLM responses, CLI args, and the manifest are zod-parsed at the boundary").
// DistilledChapter needs no schema of its own: it is the LLM's raw markdown body plus deterministic
// anchor extraction.
import { z } from "zod";
import { GATE_THRESHOLD_FLOOR, PASS_EPSILON, decidePassed } from "./gateVerdict.js";
import { MULTI_LINE_PATTERN, SINGLE_LINE_PATTERN } from "./modelText.js";

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

// C1 (DESIGN §4): length and control-character limits on model output fields. Titles land in prompt
// data blocks and SKILL.md, ids in the manifest, and QA text in prompts and the manifest, all verbatim.
// A "single-line field" with an embedded newline, or any control character, is a channel for breaking
// the format, so it is rejected at the boundary.
export const MAX_TITLE_CHARS = 200;
export const MAX_ID_CHARS = 200;
export const MAX_QA_FIELD_CHARS = 2000;
const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(SINGLE_LINE_PATTERN, "must be a single line without control characters");
const multiLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(MULTI_LINE_PATTERN, "control characters other than newline/tab are not allowed");

/** ChapterPlan: one chapter of the outline (SkillPlan). */
export const chapterPlanSchema = z.object({
  id: singleLine(MAX_ID_CHARS),
  file: z.string().min(1),
  title: singleLine(MAX_TITLE_CHARS),
  sectionIds: z.array(singleLine(MAX_ID_CHARS)).min(1),
});

/** slug format: a single path component of lowercase letters, digits, and hyphens (DESIGN §2, A1).
 * `/`, `.`, `..`, and absolute paths are filtered here. Same as the Agent Skills standard's name rule
 * (lowercase, digits, hyphens, at most 64 chars). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SLUG_MAX_LENGTH = 64;
export const slugSchema = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .regex(SLUG_PATTERN, "slug must be lowercase letters, digits and single hyphens only");

/** SkillPlan: the outline-stage LLM response. */
export const skillPlanSchema = z.object({
  slug: slugSchema,
  title: singleLine(MAX_TITLE_CHARS),
  chapters: z.array(chapterPlanSchema).min(1),
});

/** Chapter file path format: only what the assembler's `chapterFilePath()` produces (B3, guardrail 2),
 * i.e. slug characters directly under `chapters/` plus `.md`. `manifest.json`, `SKILL.md`, parent
 * paths, and subdirectories are filtered here, so the code, not the manifest, holds the format boundary
 * of what the answerer may load. */
export const CHAPTER_FILE_PATTERN = /^chapters\/[\p{L}\p{N}-]+\.md$/u;
export const chapterFileSchema = z
  .string()
  .regex(CHAPTER_FILE_PATTERN, "chapterFile must look like chapters/<slug>.md");
export function isChapterFilePath(path: string): boolean {
  return CHAPTER_FILE_PATTERN.test(path);
}

/** One item of the qaGen-stage LLM response (no id); gate.ts parses it and assigns the id. */
export const qaGenItemSchema = z.object({
  question: multiLine(MAX_QA_FIELD_CHARS),
  refAnswer: multiLine(MAX_QA_FIELD_CHARS),
  anchorQuote: multiLine(MAX_QA_FIELD_CHARS),
});
export const qaGenResponseSchema = z.object({ items: z.array(qaGenItemSchema) });

/** GoldenQA: a verified golden Q&A (manifest.goldenQa). */
export const goldenQaSchema = qaGenItemSchema.extend({
  id: singleLine(MAX_ID_CHARS),
  sectionId: singleLine(MAX_ID_CHARS),
});

export const gateFailureReasonSchema = z.enum([
  "wrong",
  "not_found",
  "anchor_missing",
  "qa_generation_failed",
]);

/** GateReport: the quality gate's final report, embedded as manifest.gate. Semantic checks follow the
 * shape check (B6, AUD-011): the aggregates must agree with each other, `passed` must match the
 * gateVerdict rule, and the failure list must correspond to the load history and coverage, so a
 * tampered manifest cannot fool report/eval with a contradiction like `passed=true, passRate=0`. */
export const gateReportSchema = z
  .object({
    passRate: z.number().min(0).max(1),
    threshold: z.number().min(GATE_THRESHOLD_FLOOR).max(1), // policy floor (B4): a report that "passed" against a threshold below it is invalid
    passed: z.boolean(),
    perChapter: z.array(
      z.object({
        file: z.string().min(1),
        asked: z.number().int().nonnegative(),
        correct: z.number().int().nonnegative(),
      }),
    ),
    failures: z.array(
      z.object({
        qaId: z.string().min(1),
        reason: gateFailureReasonSchema,
      }),
    ),
    loadHistory: z.array(
      z.object({
        qaId: z.string().min(1),
        selectedFile: z.string(),
        loadedFiles: z.array(z.string()),
      }),
    ),
    coverage: z.array(
      z.object({
        sectionId: z.string().min(1),
        requested: z.number().int().nonnegative(),
        generated: z.number().int().nonnegative(),
      }),
    ),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    r.perChapter.forEach((c, i) => {
      if (c.correct > c.asked) {
        issue(`correct (${String(c.correct)}) exceeds asked (${String(c.asked)})`, [
          "perChapter",
          i,
        ]);
      }
    });
    if (!unique(r.perChapter.map((c) => c.file)))
      issue("chapter files must be unique", ["perChapter"]);

    const asked = r.perChapter.reduce((n, c) => n + c.asked, 0);
    const correct = r.perChapter.reduce((n, c) => n + c.correct, 0);
    const loadIds = r.loadHistory.map((l) => l.qaId);
    if (!unique(loadIds)) issue("qaIds must be unique", ["loadHistory"]);
    if (asked !== r.loadHistory.length) {
      issue(
        `perChapter asked total (${String(asked)}) must equal the number of loadHistory entries (${String(r.loadHistory.length)})`,
        ["loadHistory"],
      );
    }

    const failIds = r.failures.map((f) => f.qaId);
    if (!unique(failIds)) issue("qaIds must be unique", ["failures"]);
    const graded = r.failures.filter((f) => f.reason !== "qa_generation_failed");
    const loadSet = new Set(loadIds);
    for (const f of graded) {
      if (!loadSet.has(f.qaId)) issue(`failure ${f.qaId} has no loadHistory entry`, ["failures"]);
    }
    if (correct !== asked - graded.length) {
      issue(
        `perChapter correct total (${String(correct)}) must equal asked (${String(asked)}) minus graded failures (${String(graded.length)})`,
        ["perChapter"],
      );
    }

    const expectedRate = asked === 0 ? 0 : correct / asked;
    if (Math.abs(r.passRate - expectedRate) > PASS_EPSILON) {
      issue(
        `passRate ${String(r.passRate)} does not match correct/asked = ${String(expectedRate)}`,
        ["passRate"],
      );
    }

    if (!unique(r.coverage.map((c) => c.sectionId)))
      issue("sectionIds must be unique", ["coverage"]);
    r.coverage.forEach((c, i) => {
      if (c.generated > c.requested) {
        issue(`generated (${String(c.generated)}) exceeds requested (${String(c.requested)})`, [
          "coverage",
          i,
        ]);
      }
    });
    const uncovered = r.coverage.filter((c) => c.generated === 0);
    const expectedGenFail = new Set(uncovered.map((c) => `${c.sectionId}-q0`));
    const actualGenFail = new Set(
      r.failures.filter((f) => f.reason === "qa_generation_failed").map((f) => f.qaId),
    );
    if (!sameSet(expectedGenFail, actualGenFail)) {
      issue(
        "qa_generation_failed failures must correspond exactly to coverage entries with generated 0 (qaId <sectionId>-q0)",
        ["failures"],
      );
    }

    const expectedPassed = decidePassed({
      asked,
      passRate: r.passRate,
      threshold: r.threshold,
      uncoveredSections: uncovered.length,
    });
    if (r.passed !== expectedPassed) {
      issue(
        `passed=${String(r.passed)} contradicts the verdict rule (asked ${String(asked)}, passRate ${String(r.passRate)}, threshold ${String(r.threshold)}, unverified sections ${String(uncovered.length)} → ${String(expectedPassed)})`,
        ["passed"],
      );
    }
  });

/** Cap on the number of manifest.goldenQa entries (D2, SEC-008): an external manifest must not inflate
 * eval cost and memory with unbounded questions. Combined with the field length cap (2,000 chars), the
 * worst case is about 6 MB. Compile output is sections × k, far below this. */
export const MAX_GOLDEN_QA_ENTRIES = 1000;

/** 64 lowercase hex characters, exactly the output format of core/hash.ts sha256Hex (B6). */
export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "must be a 64-character lowercase hex SHA-256");

/** Manifest: the compiled manifest.json, parsed at the file IO boundary. Semantic checks (B6):
 * sections, outputs, golden QA, and the gate report must point at each other exactly (chapterFile ∈
 * outputs, loadHistory ⊆ goldenQa, coverage = the section set, perChapter = the chapter file set). */
export const manifestSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    sourceFiles: z.array(z.object({ path: z.string().min(1), sha256: sha256Schema })),
    sections: z.array(
      z.object({
        id: z.string().min(1),
        sha256: sha256Schema,
        chapterFile: chapterFileSchema,
      }),
    ),
    outputs: z.array(z.string().min(1)),
    outputHashes: z.array(z.object({ path: z.string().min(1), sha256: sha256Schema })),
    gate: z.union([gateReportSchema, z.object({ skipped: z.literal(true) })]),
    goldenQa: z.array(goldenQaSchema).max(MAX_GOLDEN_QA_ENTRIES),
  })
  .superRefine((m, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    if (!unique(m.outputs)) issue("outputs must be unique", ["outputs"]);
    // E3: the hash list must cover exactly the same file set as outputs; a file missing from it is a
    // hole that passes without being compared.
    const hashPaths = m.outputHashes.map((h) => h.path);
    if (!unique(hashPaths)) issue("outputHashes paths must be unique", ["outputHashes"]);
    if (!sameSet(new Set(hashPaths), new Set(m.outputs))) {
      issue("outputHashes must cover exactly the files listed in outputs", ["outputHashes"]);
    }
    if (!unique(m.sections.map((s) => s.id))) issue("section ids must be unique", ["sections"]);
    const outputSet = new Set(m.outputs);
    m.sections.forEach((s, i) => {
      if (!outputSet.has(s.chapterFile)) {
        issue(`chapterFile "${s.chapterFile}" is not listed in outputs`, [
          "sections",
          i,
          "chapterFile",
        ]);
      }
    });

    const sectionIds = new Set(m.sections.map((s) => s.id));
    if (!unique(m.goldenQa.map((q) => q.id))) issue("qa ids must be unique", ["goldenQa"]);
    m.goldenQa.forEach((q, i) => {
      if (!sectionIds.has(q.sectionId)) {
        issue(`sectionId "${q.sectionId}" is not a manifest section`, ["goldenQa", i, "sectionId"]);
      }
    });

    if (!("passed" in m.gate)) return;
    const gate = m.gate;
    const qaIds = new Set(m.goldenQa.map((q) => q.id));
    gate.loadHistory.forEach((l, i) => {
      if (!qaIds.has(l.qaId)) {
        issue(`qaId "${l.qaId}" is not in goldenQa`, ["gate", "loadHistory", i]);
      }
    });
    if (!sameSet(sectionIds, new Set(gate.coverage.map((c) => c.sectionId)))) {
      issue("gate.coverage must have exactly one entry per manifest section", ["gate", "coverage"]);
    }
    if (
      !sameSet(
        new Set(m.sections.map((s) => s.chapterFile)),
        new Set(gate.perChapter.map((c) => c.file)),
      )
    ) {
      issue("gate.perChapter must have exactly one entry per distinct chapterFile", [
        "gate",
        "perChapter",
      ]);
    }
  });
