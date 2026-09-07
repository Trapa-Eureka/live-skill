// smoke: a manual, human-only check (DESIGN §9, TESTING §5). Compiles one sample document with the
// real Claude and prints the gate report plus a cost summary (call count, estimated tokens). Unlike
// the compile CLI it writes no files; it only diagnoses. The logic lives here (testable) and the real
// adapter assembly is in scripts/smoke.ts (the "cli is assembly only" principle applied to the smoke
// script as well).
import {
  compile,
  formatCompileFailure,
  formatGateReport,
  formatSkippedGate,
  trackCost,
  type Clock,
  type Config,
  type DocumentExtractor,
  type LlmProvider,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";

export interface SmokeOptions {
  path: string;
}

export interface SmokeDeps {
  out: (line: string) => void;
  readSourceFile: (path: string) => Promise<SourceFile>;
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  clock: Clock;
  config: Config;
}

export async function runSmoke(opts: SmokeOptions, deps: SmokeDeps): Promise<number> {
  let source: SourceFile;
  try {
    source = await deps.readSourceFile(opts.path);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(`Cannot read "${opts.path}". Fix: check the path. (${detail})`);
    return 1;
  }

  const tracked = trackCost(deps.llm);
  const result = await compile([source], {
    extractors: deps.extractors,
    llm: tracked.llm,
    clock: deps.clock,
    config: deps.config,
    gate: "run",
  });
  const { calls, estimatedTokens } = tracked.summary();
  const printCostSummary = (): void => {
    deps.out(
      `Cost summary: ${String(calls)} LLM calls, ~${String(estimatedTokens)} estimated tokens`,
    );
  };

  if (!result.ok) {
    deps.out(formatCompileFailure(result.error)); // E1: includes the report on a structural validation failure
    printCostSummary();
    return 1;
  }

  const gate = result.value.manifest.gate;
  deps.out("passed" in gate ? formatGateReport(gate) : formatSkippedGate());
  printCostSummary();
  return "passed" in gate && !gate.passed ? 1 : 0;
}
