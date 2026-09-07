// compile 명령 — 전체 파이프라인(DESIGN §6). 로직은 core/pipeline.ts·adapters/fsTargets.ts에 있다,
// 여긴 조립만. 게이트 미달 시 임시 디렉터리 보존 + 종료코드 1(완료 기준).
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
  /** 입력 경로를 펼치고 크기 상한을 읽기 전에 검사한다(D3) — 넘으면 FsTargetError로 거부. */
  collectInputFiles: (paths: readonly string[]) => Promise<string[]>;
  /** 제한된 동시성으로 읽는다(D3) — 입력 순서 보존. */
  readSourceFiles: (paths: readonly string[]) => Promise<SourceFile[]>;
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  clock: Clock;
  config: Config;
  resolveTargetDir: (target: "claude" | "agents", slug: string) => string;
  /** 새로 만든 빈 임시 디렉터리를 돌려준다(mkdtemp) — DESIGN §6 A1. */
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
      deps.out(`지정한 경로에서 파일을 찾지 못했습니다: ${opts.paths.join(", ")}`);
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
    // E1: 구조 검증 실패면 어느 파일이 왜 걸렸는지 리포트까지 — 게이트 호출 0회, 아무것도 쓰지 않았다.
    deps.out(formatCompileFailure(result.error));
    return 1;
  }

  const { manifest, files, slug, llmCalls, validation } = result.value;
  const gate = manifest.gate;
  const gateFailed = "passed" in gate && !gate.passed;

  // 경로 해석도 slug 검사·루트 경계 검사로 실패할 수 있다(A1) — 쓰기 실패와 같은 방식으로 보고한다.
  let outDir: string;
  try {
    outDir = gateFailed
      ? await deps.tempSkillDir(slug)
      : (opts.out ?? deps.resolveTargetDir(opts.target, slug));
  } catch (e) {
    deps.out(e instanceof Error ? e.message : "출력 경로를 정할 수 없습니다.");
    return 1;
  }

  try {
    // 임시 디렉터리는 mkdtemp가 방금 만든 빈 디렉터리라 force가 필요 없다 — 두 경로 모두 사용자의 --force만 존중한다.
    await deps.writeSkill(outDir, files, manifest, { force: opts.force });
  } catch (e) {
    deps.out(e instanceof Error ? e.message : "스킬 파일을 쓰는 데 실패했습니다.");
    return 1;
  }

  if (gateFailed) {
    deps.out(`품질 게이트 미달 — 산출물을 임시 디렉터리에 남겼습니다: ${outDir}`);
    deps.out(formatGateReport(gate));
    return 1;
  }

  deps.out(`컴파일 완료: ${outDir} (LLM 호출 ${String(llmCalls)}회)`);
  deps.out("passed" in gate ? formatGateReport(gate) : formatSkippedGate());
  // E1: error는 여기까지 못 온다(compile이 validation_failed로 끝난다) — 남은 warning(앵커 비율)만 보여준다.
  if (validation.issues.length > 0) deps.out(formatValidationReport(validation));
  return 0;
}
