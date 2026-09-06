// compile 명령 — 전체 파이프라인(DESIGN §6). 로직은 core/pipeline.ts·adapters/fsTargets.ts에 있다,
// 여긴 조립만. 게이트 미달 시 임시 디렉터리 보존 + 종료코드 1(완료 기준).
import {
  compile,
  formatGateReport,
  formatSkippedGate,
  type AssembledFile,
  type Clock,
  type Config,
  type DocumentExtractor,
  type LlmProvider,
  type Manifest,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";

export interface CompileOptions {
  paths: string[];
  out?: string | undefined;
  target: "claude" | "agents";
  noGate: boolean;
  force: boolean;
}

export interface CompileDeps {
  out: (line: string) => void;
  collectInputFiles: (paths: readonly string[]) => Promise<string[]>;
  readSourceFile: (path: string) => Promise<SourceFile>;
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  clock: Clock;
  config: Config;
  resolveTargetDir: (target: "claude" | "agents", slug: string) => string;
  tempSkillDir: (slug: string, timestamp: string) => string;
  timestamp: () => string;
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
      deps.out(`지정한 경로에서 파일을 찾지 못했습니다: ${opts.paths.join(", ")}`);
      return 1;
    }
    sources = await Promise.all(absolutePaths.map((p) => deps.readSourceFile(p)));
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(`입력 경로를 읽을 수 없습니다. 수정 방법: 경로를 확인하세요. (${detail})`);
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
    deps.out(`컴파일 실패: ${result.error.message}`);
    return 1;
  }

  const { manifest, files, slug } = result.value;
  const gate = manifest.gate;
  const gateFailed = "passed" in gate && !gate.passed;
  const outDir = gateFailed
    ? deps.tempSkillDir(slug, deps.timestamp())
    : (opts.out ?? deps.resolveTargetDir(opts.target, slug));

  try {
    await deps.writeSkill(outDir, files, manifest, { force: gateFailed ? true : opts.force });
  } catch (e) {
    deps.out(e instanceof Error ? e.message : "스킬 파일을 쓰는 데 실패했습니다.");
    return 1;
  }

  if (gateFailed) {
    deps.out(`품질 게이트 미달 — 산출물을 임시 디렉터리에 남겼습니다: ${outDir}`);
    deps.out(formatGateReport(gate));
    return 1;
  }

  deps.out(`컴파일 완료: ${outDir}`);
  deps.out("passed" in gate ? formatGateReport(gate) : formatSkippedGate());
  return 0;
}
