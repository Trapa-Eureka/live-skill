// Compile pipeline: extract → outline → distill → assemble → validate → gate (DESIGN §1, §5.1).
// Pure orchestration: the caller (an adapter) does the actual file reading/writing, passing
// SourceFile[] in and taking the return value out.
import { extractAnchors } from "./anchors.js";
import { assembleSkill, chapterFilePath, type AssembledFile } from "./assembler.js";
import type { Config } from "./config.js";
import { LlmCallCapError, trackCost } from "./costTracker.js";
import { LlmProviderError, llmErrorAdvice, type LlmErrorKind } from "./llmError.js";
import { sanitizeExternalText } from "./modelText.js";
import { estimateGateCalls, runGate, type GateChapter } from "./gate.js";
import { sha256Hex } from "./hash.js";
import { describeParseFailure, parseJsonResponse } from "./jsonResponse.js";
import { checkOutlineCoverage, formatOutlineCoverageIssues } from "./outlineCoverage.js";
import { stripControlChars } from "./modelText.js";
import { distillPrompt, outlinePrompt } from "./prompts.js";
import { err, ok, type Result } from "./result.js";
import { skillPlanSchema } from "./schemas.js";
import { normalizeSectionIdRef } from "./sectionId.js";
import { MAX_INPUT_TOKENS, estimateTokens } from "./tokenEstimate.js";
import type {
  Clock,
  DistilledChapter,
  DocumentExtractor,
  ExtractError,
  GateReport,
  GoldenQA,
  LlmProvider,
  Manifest,
  SkillPlan,
} from "./types.js";
import { buildPopulation, extractSources, type NamedSection, type SourceFile } from "./sources.js";
import { validateSkill, type ValidationReport } from "./validator.js";

export type { SourceFile } from "./sources.js";

export type PipelineError =
  | { kind: "unsupported_format"; path: string; message: string }
  | { kind: "extract_failed"; path: string; error: ExtractError; message: string }
  | { kind: "empty_input"; message: string }
  | { kind: "input_too_large"; estimatedTokens: number; limit: number; message: string }
  | { kind: "outline_invalid"; detail: string; message: string }
  | {
      kind: "call_cap_exceeded";
      /** preflight: the upfront estimate exceeds the cap (before any call). runtime: the actual
       * call count hit the cap mid-run (D1). */
      stage: "preflight" | "runtime";
      /** For preflight, the estimated upper bound; for runtime, the calls actually made before the
       * cap was hit. */
      estimated: number;
      limit: number;
      message: string;
    }
  | { kind: "assemble_failed"; detail: string; message: string }
  | {
      /** An LLM call failed (G1): at which stage, of what kind, whether it is retryable, and how
       * many calls had been made by then. */
      kind: "llm_failed";
      stage: LlmStage;
      error: { kind: LlmErrorKind; retryable: boolean; detail: string };
      /** LLM calls attempted so far, including the one that failed. */
      calls: number;
      message: string;
    }
  | {
      kind: "validation_failed";
      /** pre_gate: the first assembly failed structural validation (zero gate calls). final: the
       * final assembly after the gate failed it (E1). */
      stage: "pre_gate" | "final";
      report: ValidationReport;
      message: string;
    };

export type LlmStage = "outline" | "distill" | "gate";

export interface CompileResult {
  manifest: Manifest;
  files: AssembledFile[];
  /** Structural validation report of the final assembly. Always passed (an error ends compile with
   * validation_failed, E1); warnings are kept. */
  validation: ValidationReport;
  /** The slug produced by outline. The CLI uses it to compute the target path when only --target
   * is given without --out (DESIGN §5.1 T8 decision). */
  slug: string;
  /** LLM calls this compile actually made (D1): a measurement, not the upfront estimate. */
  llmCalls: number;
}

export interface PipelineDeps {
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  clock: Clock;
  config: Config;
  /** Defaults to "run". "skip" corresponds to `--no-gate`: manifest.gate = {skipped:true} and
   * SKILL.md carries the unverified marker. */
  gate?: "run" | "skip";
}

function normalizeSectionRefs(plan: SkillPlan): SkillPlan {
  return {
    ...plan,
    chapters: plan.chapters.map((c) => ({
      ...c,
      sectionIds: c.sectionIds.map(normalizeSectionIdRef),
    })),
  };
}

/** The full pipeline of DESIGN §5.1: extract→outline→distill→assemble→validate→gate. */
export async function compile(
  sources: readonly SourceFile[],
  deps: PipelineDeps,
): Promise<Result<CompileResult, PipelineError>> {
  if (sources.length === 0) {
    return err({
      kind: "empty_input",
      message: "no source files given. Fix: pass at least one file, folder, or glob.",
    });
  }

  const extracted = await extractSources(sources, deps.extractors);
  if (!extracted.ok) return extracted;

  // Verification population (B1): every section that has body text. Body-less headings are
  // neither shown to outline nor required to be assigned.
  // F3: eval --source uses the same buildPopulation, so the prefix and filter rules never diverge.
  const sections = buildPopulation(extracted.value);
  if (sections.length === 0) {
    return err({
      kind: "empty_input",
      message:
        "every source file produced zero sections with body text. Fix: check the source content.",
    });
  }

  const totalTokens = sections.reduce((n, s) => n + estimateTokens(s.text), 0);
  if (totalTokens > MAX_INPUT_TOKENS) {
    return err({
      kind: "input_too_large",
      estimatedTokens: totalTokens,
      limit: MAX_INPUT_TOKENS,
      message: `input is ~${String(totalTokens)} tokens, over the ${String(MAX_INPUT_TOKENS)}-token single-compile limit. Fix: split the source into smaller files/folders and compile them separately.`,
    });
  }

  // D1 (guardrail 6): independently of the upfront estimate, count the actual calls and block any
  // call that would exceed the cap before it happens.
  const tracked = trackCost(deps.llm, { maxCalls: deps.config.maxLlmCalls });
  const llm = tracked.llm;
  // G1: turn cap overruns and provider failures (auth, rate limit, network, malformed response)
  // into a PipelineError carrying stage, kind, retryability and call count, so the user sees a
  // human message rather than a stack trace. Any other exception (a bug) is rethrown as is.
  async function guarded<T>(
    stage: LlmStage,
    work: () => Promise<T>,
  ): Promise<Result<T, PipelineError>> {
    try {
      return ok(await work());
    } catch (e) {
      if (e instanceof LlmCallCapError) {
        return err({
          kind: "call_cap_exceeded",
          stage: "runtime",
          estimated: e.calls,
          limit: e.limit,
          message: `stopped mid-run: ${String(e.calls)} LLM calls were made and the next one would exceed the MAX_LLM_CALLS cap of ${String(e.limit)}. Nothing was written. Fix: split the source, pass --no-gate, or raise MAX_LLM_CALLS.`,
        });
      }
      if (e instanceof LlmProviderError) {
        const calls = tracked.summary().calls;
        const detail = sanitizeExternalText(e.message);
        return err({
          kind: "llm_failed",
          stage,
          error: { kind: e.kind, retryable: e.retryable, detail },
          calls,
          message: `the ${stage} step failed: LLM error "${e.kind}" (${e.retryable ? "retryable" : "not retryable"}) after ${String(calls)} LLM call(s); nothing was written. Fix: ${llmErrorAdvice(e.kind)}${detail === "" || detail === e.kind ? "" : ` Provider said: ${detail}`}`,
        });
      }
      throw e;
    }
  }

  const outlineRes = await guarded("outline", () => llm.complete(outlinePrompt({ sections })));
  if (!outlineRes.ok) return outlineRes;
  const outlineRaw = outlineRes.value;
  let plan: SkillPlan;
  try {
    // L2: tolerate a fence/prose envelope; the schema itself stays strict.
    // L3: models copy the `[§id]` header marker into sectionIds; normalize it away before coverage.
    plan = normalizeSectionRefs(skillPlanSchema.parse(parseJsonResponse(outlineRaw)));
  } catch (e) {
    const detail = sanitizeExternalText(describeParseFailure(e));
    return err({
      kind: "outline_invalid",
      detail,
      message: `the outline step returned a response that doesn't match the expected schema (${detail}). Fix: retry, or check the outline prompt/model.`,
    });
  }

  // B1: does the plan cover the population exactly once? A dropped section used to vanish silently
  // from distill, the manifest and the gate.
  const coverage = checkOutlineCoverage(plan, sections);
  if (coverage !== undefined) {
    const detail = formatOutlineCoverageIssues(coverage);
    return err({
      kind: "outline_invalid",
      detail,
      message: `the outline does not cover the source exactly once (${detail}). Fix: retry — every section with body text must be assigned to exactly one chapter, only known section ids may be used, and chapter ids must be unique.`,
    });
  }

  const runsGate = (deps.gate ?? "run") === "run";
  const gateCallEstimate = runsGate
    ? estimateGateCalls(sections.length, deps.config.qaPerSection)
    : 0;
  const totalCalls = 1 + plan.chapters.length + gateCallEstimate;
  if (totalCalls > deps.config.maxLlmCalls) {
    return err({
      kind: "call_cap_exceeded",
      stage: "preflight",
      estimated: totalCalls,
      limit: deps.config.maxLlmCalls,
      message: `compiling would take up to ~${String(totalCalls)} LLM calls (1 outline + ${String(plan.chapters.length)} chapters + up to ${String(gateCallEstimate)} for the quality gate, counting one qaGen retry per section), over the MAX_LLM_CALLS cap of ${String(deps.config.maxLlmCalls)}. Fix: split the source, pass --no-gate, or raise MAX_LLM_CALLS.`,
    });
  }

  const byId = new Map(sections.map((s) => [s.id, s]));
  const distilled: DistilledChapter[] = [];
  const distillRes = await guarded("distill", async () => {
    for (const chapter of plan.chapters) {
      const chapterSections = chapter.sectionIds
        .map((id) => byId.get(id))
        .filter((s): s is NamedSection => s !== undefined);
      const req = distillPrompt(chapter, chapterSections, deps.config.budgets.chapter);
      // C1: the distilled body is model output written to a file verbatim, so control characters
      // other than newline/tab are stripped here.
      const body = stripControlChars(await llm.complete(req));
      distilled.push({ id: chapter.id, file: "", body, anchors: extractAnchors(body) });
    }
  });
  if (!distillRes.ok) return distillRes;

  function assemble(verified: boolean): Result<AssembledFile[], PipelineError> {
    try {
      return ok(assembleSkill(plan, distilled, { verified }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "assembly failed for an unknown reason.";
      return err({ kind: "assemble_failed", detail: message, message });
    }
  }

  const firstAssembly = assemble(false); // the assembly the gate reads; verified does not affect the verdict
  if (!firstAssembly.ok) return firstAssembly;

  // E1: structural validation blocks deployment, before the gate (LLM cost) and just the same
  // under --no-gate.
  function validated(
    assembled: AssembledFile[],
    stage: "pre_gate" | "final",
  ): Result<ValidationReport, PipelineError> {
    const report = validateSkill(assembled, deps.config.budgets);
    if (report.passed) return ok(report);
    const errors = report.issues.filter((i) => i.severity === "error");
    const codes = [...new Set(errors.map((i) => i.code))].join(", ");
    const when = stage === "pre_gate" ? "before the quality gate" : "after the quality gate";
    return err({
      kind: "validation_failed",
      stage,
      report,
      message: `the assembled skill fails structural validation (${String(errors.length)} error(s): ${codes}) — stopped ${when}, nothing was written. Fix: re-run compile (the distill model overran a budget or broke a chapter link); if it repeats, split the source into smaller skills.`,
    });
  }
  const preGate = validated(firstAssembly.value, "pre_gate");
  if (!preGate.ok) return preGate;

  let gate: GateReport | { skipped: true };
  let goldenQa: GoldenQA[];
  let files: AssembledFile[];
  let validation: ValidationReport;
  if (runsGate) {
    const gateChapters: GateChapter[] = plan.chapters.map((c, i) => ({
      file: chapterFilePath(i, c.title),
      sectionIds: c.sectionIds,
    }));
    const outcomeRes = await guarded("gate", () =>
      runGate(
        { files: firstAssembly.value, chapters: gateChapters, sections },
        { llm, k: deps.config.qaPerSection, threshold: deps.config.gateThreshold },
      ),
    );
    if (!outcomeRes.ok) return outcomeRes;
    const outcome = outcomeRes.value;
    gate = outcome.report;
    goldenQa = outcome.goldenQa;
    // Assembly is a pure function, so re-assembling once verified is known costs nothing. This
    // aligns the unverified marker in SKILL.md with the actual gate result (DESIGN §5.1).
    const finalAssembly = assemble(outcome.report.passed);
    if (!finalAssembly.ok) return finalAssembly;
    files = finalAssembly.value;
    // E1: only files that passed validation may be written, so the final assembly (re-built with
    // verified) is validated again.
    const final = validated(files, "final");
    if (!final.ok) return final;
    validation = final.value;
  } else {
    gate = { skipped: true };
    goldenQa = [];
    files = firstAssembly.value;
    validation = preGate.value;
  }

  const sourceHashes = sources.map((s) => ({ path: s.path, sha256: sha256Hex(s.bytes) }));
  const manifestSections = plan.chapters.flatMap((chapter, i) =>
    chapter.sectionIds.map((id) => ({
      id,
      sha256: sha256Hex(byId.get(id)?.text ?? ""),
      chapterFile: chapterFilePath(i, chapter.title),
    })),
  );

  const manifest: Manifest = {
    version: 1,
    createdAt: deps.clock.now().toISOString(),
    sourceFiles: sourceHashes,
    sections: manifestSections,
    outputs: files.map((f) => f.path),
    outputHashes: files.map((f) => ({ path: f.path, sha256: sha256Hex(f.content) })), // E3
    gate,
    goldenQa,
  };

  return ok({ manifest, files, validation, slug: plan.slug, llmCalls: tracked.summary().calls });
}
