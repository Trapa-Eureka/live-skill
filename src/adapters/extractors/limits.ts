// 추출 공통 한도 — 파싱 전 예산 초과를 걷어내고, 병리적 입력에 시간 상한을 건다(납품 수준 품질 유지).
// 이식 출처: ../msg-agent/src/adapters/extractors/limits.ts. D4(DESIGN §6): 타임아웃은 결과를 버리는 데서
// 그치지 않고 AbortSignal로 파서에 취소를 알린다 — 취소 API가 있는 파서(pdf.js)는 실제로 멈추고, 없는
// 파서(mammoth)는 검사 지점에서 협조적으로 멈춘다.
import type { ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err } from "../../core/index.js";

export const EXTRACT_TIMEOUT_MS = 60_000;

export type ExtractOutcome = Result<ExtractedDoc, ExtractError>;

export const TIMEOUT: ExtractOutcome = err({ kind: "corrupt", detail: "timeout" });

/** 추출 작업을 상한 시간과 경합시킨다. 시간이 다 되면(또는 바깥 signal이 취소되면) run에 넘긴 signal을 abort하고
 * `timeout`을 돌려준다. 그 뒤 늦게 도착하는 결과는 쓰이지 않고, 늦은 거부는 race가 구독하고 있어 unhandled가
 * 되지 않는다. */
export async function withDeadline(
  run: (signal: AbortSignal) => Promise<ExtractOutcome>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<ExtractOutcome> {
  if (outer?.aborted === true) return TIMEOUT; // 이미 취소됐다 — 파서를 시작하지도 않는다
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let resolveTimeout: ((r: ExtractOutcome) => void) | undefined;
  const timeout = new Promise<ExtractOutcome>((resolve) => {
    resolveTimeout = resolve;
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
  });
  const onOuterAbort = (): void => {
    controller.abort();
    resolveTimeout?.(TIMEOUT);
  };
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}
