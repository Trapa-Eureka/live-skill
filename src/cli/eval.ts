// eval command: re-grades an existing skill (DESIGN §6). Without --source it reuses manifest.goldenQa
// (skipping qaGen); with --source it re-extracts the documents and runs runGate afresh. Neither path
// overwrites the manifest (read-only diagnostic).
// D2: both paths screen MAX_LLM_CALLS with an up-front estimate and enforce it during the run through
// the trackCost wrapper (same as compile).
import {
  LlmCallCapError,
  LlmProviderError,
  buildPopulation,
  chaptersFromManifest,
  checkOutputs,
  estimateEvalCalls,
  estimateGateCalls,
  evaluateGoldenQa,
  extractSources,
  formatChangedSections,
  formatGateReport,
  formatLlmProviderError,
  formatOutputIntegrity,
  formatSourceMismatch,
  matchManifestSections,
  missingChapterFiles,
  runGate,
  trackCost,
  type Config,
  type DocumentExtractor,
  type GateReport,
  type LlmProvider,
  type Manifest,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";
import type { SkillFile } from "../core/validator.js";
import { describeInputFailure } from "./inputFailure.js";

export interface EvalOptions {
  skillDir: string;
  source?: string[] | undefined;
}

export interface EvalDeps {
  out: (line: string) => void;
  readSkillDir: (dir: string) => Promise<SkillFile[]>;
  readManifest: (dir: string) => Promise<Manifest>;
  collectInputFiles: (paths: readonly string[]) => Promise<string[]>;
  readSourceFiles: (paths: readonly string[]) => Promise<SourceFile[]>;
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  config: Config;
}

export async function runEval(opts: EvalOptions, deps: EvalDeps): Promise<number> {
  let manifest: Manifest;
  let files: SkillFile[];
  try {
    manifest = await deps.readManifest(opts.skillDir);
    files = await deps.readSkillDir(opts.skillDir);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(
      `Cannot read "${opts.skillDir}". Fix: make sure compile has been run and the path is correct. (${detail})`,
    );
    return 1;
  }
  // E3: the manifest's QA and chapter assignment belong to the files that manifest hashed; if the
  // files changed, re-grading is meaningless.
  const integrity = checkOutputs(manifest, files);
  if (integrity.status !== "ok") {
    deps.out(formatOutputIntegrity(integrity));
    deps.out(
      "Re-grading aborted: the current files differ from the manifest. The LLM was not called.",
    );
    return 1;
  }
  const chapters = chaptersFromManifest(manifest);

  // B3: confirm deterministically, before calling the LLM, that the chapters the manifest points to
  // actually exist in this directory.
  const missing = missingChapterFiles(chapters, files);
  if (missing.length > 0) {
    deps.out(
      `Chapter files named in manifest.json are missing from "${opts.skillDir}": ${missing.join(", ")}. Fix: check that this directory's manifest is the right one, or run compile again.`,
    );
    return 1;
  }

  const limit = deps.config.maxLlmCalls;
  const preflight = (estimated: number, what: string): boolean => {
    if (estimated <= limit) return true;
    deps.out(
      `Re-grading needs up to ~${String(estimated)} LLM calls (${what}), over the MAX_LLM_CALLS limit of ${String(limit)}. Fix: raise MAX_LLM_CALLS, or split the skill into smaller units and compile them separately.`,
    );
    return false;
  };
  const tracked = trackCost(deps.llm, { maxCalls: limit });
  const finish = (report: GateReport): number => {
    deps.out(formatGateReport(report));
    deps.out(`LLM calls: ${String(tracked.summary().calls)}`);
    return report.passed ? 0 : 1;
  };
  // G1: a cap hit or a provider failure ends with a human message and the calls made so far, not a
  // stack trace. Any other exception is a bug and is rethrown.
  const capHit = (e: unknown): number | undefined => {
    if (e instanceof LlmCallCapError) {
      deps.out(
        `Re-grading aborted: after ${String(e.calls)} LLM calls, the next call would exceed the MAX_LLM_CALLS limit of ${String(e.limit)}. Fix: raise MAX_LLM_CALLS or split the skill.`,
      );
      return 1;
    }
    if (e instanceof LlmProviderError) {
      deps.out(
        `Re-grading aborted. ${formatLlmProviderError("re-grading", e, tracked.summary().calls)}`,
      );
      return 1;
    }
    return undefined;
  };

  if (opts.source === undefined || opts.source.length === 0) {
    // Reuse path: re-grades the manifest's QA as is, with no source documents and no qaGen.
    if (
      !preflight(
        estimateEvalCalls(manifest.goldenQa.length),
        `${String(manifest.goldenQa.length)} questions × 3`,
      )
    ) {
      return 1;
    }
    try {
      const report = await evaluateGoldenQa(
        manifest.goldenQa,
        { files, chapters, qaPerSection: deps.config.qaPerSection },
        tracked.llm,
        deps.config.gateThreshold,
      );
      return finish(report);
    } catch (e) {
      const code = capHit(e);
      if (code !== undefined) return code;
      throw e;
    }
  }

  // --source path: re-extracts the documents and starts over from qaGen.
  let sources: SourceFile[];
  try {
    const absolutePaths = await deps.collectInputFiles(opts.source);
    sources = await deps.readSourceFiles(absolutePaths);
  } catch (e) {
    deps.out(`--source: ${describeInputFailure(e)}`);
    return 1;
  }
  // F3: extraction, prefixing, and the population are built with the same code as compile, so the
  // manifest assignment of a multi-source skill (`a-readme/overview`) matches and qaGen has targets.
  // A differing set fails explicitly (replacing the old silent failure with zero questions).
  const extracted = await extractSources(sources, deps.extractors);
  if (!extracted.ok) {
    deps.out(`--source: ${extracted.error.message}`);
    return 1;
  }
  const sections = buildPopulation(extracted.value);
  const match = matchManifestSections(manifest, sections);
  if (match.missing.length > 0 || match.unknown.length > 0) {
    deps.out(formatSourceMismatch(match));
    return 1;
  }
  const changed = formatChangedSections(match);
  if (changed !== "") deps.out(changed);

  const k = deps.config.qaPerSection;
  if (
    !preflight(
      estimateGateCalls(sections.length, k),
      `${String(sections.length)} sections, k=${String(k)}`,
    )
  ) {
    return 1;
  }
  try {
    const outcome = await runGate(
      { files, chapters, sections },
      { llm: tracked.llm, k, threshold: deps.config.gateThreshold },
    );
    return finish(outcome.report);
  } catch (e) {
    const code = capHit(e);
    if (code !== undefined) return code;
    throw e;
  }
}
