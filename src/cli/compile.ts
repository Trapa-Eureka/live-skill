// compile command: the full pipeline (DESIGN §6). The logic lives in core/pipeline.ts and
// adapters/fsTargets.ts; this is assembly only. On a gate failure the output is kept in a temporary
// directory and the exit code is 1 (acceptance criterion).
import {
  compile,
  formatCompileFailure,
  formatGateReport,
  formatSkippedGate,
  formatValidationReport,
  type AssembledFile,
  type Clock,
  type Config,
  type DocumentExtractor,
  type LlmProvider,
  type Manifest,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";
import { describeInputFailure } from "./inputFailure.js";

export interface CompileOptions {
  paths: string[];
  out?: string | undefined;
  target: "claude" | "agents";
  noGate: boolean;
  force: boolean;
}

export interface CompileDeps {
  out: (line: string) => void;
  /** Expands the input paths and checks the size caps before reading (D3); over the cap it rejects with FsTargetError. */
  collectInputFiles: (paths: readonly string[]) => Promise<string[]>;
  /** Reads with bounded concurrency (D3), preserving input order. */
  readSourceFiles: (paths: readonly string[]) => Promise<SourceFile[]>;
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  clock: Clock;
  config: Config;
  resolveTargetDir: (target: "claude" | "agents", slug: string) => string;
  /** Returns a freshly created empty temporary directory (mkdtemp), DESIGN §6 A1. */
  tempSkillDir: (slug: string) => Promise<string>;
  writeSkill: (
    outDir: string,
    files: readonly AssembledFile[],
    manifest: Manifest,
    opts: { force?: boolean },
  ) => Promise<void>;
}

export async function runCompile(opts: CompileOptions, deps: CompileDeps): Promise<number> {
  let sources: SourceFile[];
  try {
    const absolutePaths = await deps.collectInputFiles(opts.paths);
    if (absolutePaths.length === 0) {
      deps.out(`No files found at the given paths: ${opts.paths.join(", ")}`);
      return 1;
    }
    sources = await deps.readSourceFiles(absolutePaths);
  } catch (e) {
    deps.out(describeInputFailure(e));
    return 1;
  }

  const result = await compile(sources, {
    extractors: deps.extractors,
    llm: deps.llm,
    clock: deps.clock,
    config: deps.config,
    gate: opts.noGate ? "skip" : "run",
  });

  if (!result.ok) {
    // E1: on a structural validation failure, include the report of which file failed and why.
    // The gate was called zero times and nothing was written.
    deps.out(formatCompileFailure(result.error));
    return 1;
  }

  const { manifest, files, slug, llmCalls, validation } = result.value;
  const gate = manifest.gate;
  const gateFailed = "passed" in gate && !gate.passed;

  // Path resolution can also fail on the slug check or the root boundary check (A1); report it the
  // same way as a write failure.
  let outDir: string;
  try {
    outDir = gateFailed
      ? await deps.tempSkillDir(slug)
      : (opts.out ?? deps.resolveTargetDir(opts.target, slug));
  } catch (e) {
    deps.out(e instanceof Error ? e.message : "Could not resolve the output path.");
    return 1;
  }

  try {
    // The temporary directory was just created empty by mkdtemp, so it needs no force; both paths
    // honor only the user's --force.
    await deps.writeSkill(outDir, files, manifest, { force: opts.force });
  } catch (e) {
    deps.out(e instanceof Error ? e.message : "Failed to write the skill files.");
    return 1;
  }

  if (gateFailed) {
    deps.out(`Quality gate not passed. The output was kept in a temporary directory: ${outDir}`);
    deps.out(formatGateReport(gate));
    return 1;
  }

  deps.out(`Compiled: ${outDir} (${String(llmCalls)} LLM calls)`);
  deps.out("passed" in gate ? formatGateReport(gate) : formatSkippedGate());
  // E1: errors cannot reach this point (compile ends with validation_failed); only the remaining
  // warnings (anchor ratio) are shown.
  if (validation.issues.length > 0) deps.out(formatValidationReport(validation));
  return 0;
}
