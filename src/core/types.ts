// Domain types. DESIGN.md §2 is the source of truth: when code and document disagree, fix the
// document first (CLAUDE.md convention). This file holds pure type declarations only, no external
// IO (CLAUDE.md convention: core/ is pure computation and planning).
import type { Result } from "./result.js";

/** One section of an extracted document. id is a heading-path slug (core/sectionId.ts) and must be
 * stable (DESIGN §5). */
export interface Section {
  id: string;
  heading: string;
  level: number;
  text: string;
}

/** Extractor output. Same convention (section structuring) as the message repo. */
export interface ExtractedDoc {
  sections: Section[];
}

/** Why extraction failed. The CLI/pipeline turns it into a cause + fix message (CLAUDE.md
 * convention). */
export type ExtractError =
  | { kind: "empty_text" }
  | { kind: "corrupt"; detail: string }
  | { kind: "unsupported"; mime: string; name: string };

/** Per-format extractor (implemented in T2). extract() returns a Result instead of throwing
 * (DESIGN §2 T1 decision). */
export interface DocumentExtractor {
  supports(mime: string, name: string): boolean;
  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>>;
}

/** LLM adapter boundary (implemented in T3). All five roles (outline, distill, qaGen, answerer,
 * grader) use only this interface. */
export interface LlmProvider {
  complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}

/** Clock boundary for manifest timestamps and the like; tests substitute FixedClock (mocks/). */
export interface Clock {
  now(): Date;
}

/** The outline stage's plan grouping source sections into one chapter (pre-deployment, before
 * distillation). */
export interface ChapterPlan {
  id: string;
  file: string;
  title: string;
  sectionIds: string[];
}

/** Outline stage result. It is an LLM response, so it is zod-parsed at the boundary
 * (core/schemas.ts skillPlanSchema). */
export interface SkillPlan {
  slug: string;
  title: string;
  chapters: ChapterPlan[];
}

/** Distill stage result: the distilled body of one chapter. anchors are extracted
 * deterministically from the `[§sectionId]` footnotes in body. */
export interface DistilledChapter {
  id: string;
  file: string;
  body: string;
  anchors: string[];
}

/** One golden Q&A item produced by the qaGen stage. It is an LLM response, so it is zod-parsed
 * at the boundary (core/schemas.ts goldenQaSchema). */
export interface GoldenQA {
  id: string;
  sectionId: string;
  question: string;
  refAnswer: string;
  anchorQuote: string;
}

/** Gate verdict reason, GateReport.failures[].reason. */
/** qa_generation_failed (B2) is a section failure, not a question failure: qaId is
 * `<sectionId>-q0`. */
export type GateFailureReason = "wrong" | "not_found" | "anchor_missing" | "qa_generation_failed";

/** Final quality-gate report (core/gate.ts, T7). Embedded in the manifest, so zod-parsed at the
 * boundary. */
export interface GateReport {
  passRate: number;
  threshold: number;
  passed: boolean;
  perChapter: { file: string; asked: number; correct: number }[];
  failures: { qaId: string; reason: GateFailureReason }[];
  /** Answerer-isolation audit log (DESIGN §2 T7 decision). selectedFile is the raw string the LLM
   * actually answered with (kept verbatim even when it is not a valid path); loadedFiles are the
   * files actually read (empty when the selection was invalid). */
  loadHistory: { qaId: string; selectedFile: string; loadedFiles: string[] }[];
  /** B2: for every population section, the number of questions requested and the number actually
   * generated and valid. If any section has generated 0, passed is false (unverified section);
   * this is a necessary condition independent of passRate. */
  coverage: { sectionId: string; requested: number; generated: number }[];
}

/** Compile output manifest. Written into the skill directory; the key for v0.2 incremental
 * recompiles (DESIGN §5). It crosses the file-IO boundary, so it is zod-parsed. */
export interface Manifest {
  version: 1;
  createdAt: string;
  sourceFiles: { path: string; sha256: string }[];
  sections: { id: string; sha256: string; chapterFile: string }[];
  outputs: string[];
  /** sha256 of each output file's content (UTF-8). report/eval compare it against the current
   * files to catch drift (E3). The set of paths equals outputs. */
  outputHashes: { path: string; sha256: string }[];
  gate: GateReport | { skipped: true };
  /** The golden QA set eval reuses without the source (DESIGN §6 T8 decision). Empty when the gate
   * was skipped. */
  goldenQa: GoldenQA[];
}
