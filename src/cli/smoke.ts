// smoke — 사람 전용 수동 확인(DESIGN §9, TESTING §5). 실 Claude로 표본 문서 1건을 컴파일해 게이트
// 리포트 + 비용(호출 수·추정 토큰) 요약을 출력한다. compile CLI와 달리 아무 파일도 쓰지 않는다 — 진단만
// 하고 끝난다. 로직은 여기(테스트 가능)에, 실 어댑터 조립은 scripts/smoke.ts에("cli는 조립만"과 같은 원칙
// 을 스모크 스크립트에도 적용).
import {
  compile,
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
    deps.out(`"${opts.path}"를 읽을 수 없습니다. 수정 방법: 경로를 확인하세요. (${detail})`);
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
    deps.out(`비용 요약: LLM 호출 ${String(calls)}회, 추정 토큰 ~${String(estimatedTokens)}`);
  };

  if (!result.ok) {
    deps.out(`컴파일 실패: ${result.error.message}`);
    printCostSummary();
    return 1;
  }

  const gate = result.value.manifest.gate;
  deps.out("passed" in gate ? formatGateReport(gate) : formatSkippedGate());
  printCostSummary();
  return "passed" in gate && !gate.passed ? 1 : 0;
}
