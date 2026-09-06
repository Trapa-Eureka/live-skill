// 추출 공통 한도 — 파싱 전 예산 초과를 걷어내고, 병리적 입력에 시간 상한을 건다(납품 수준 품질 유지).
// 이식 출처: ../msg-agent/src/adapters/extractors/limits.ts.
import type { ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err } from "../../core/index.js";

export const EXTRACT_TIMEOUT_MS = 60_000;

/** 추출 작업을 상한 시간과 경합시킨다. 파서 자체는 백그라운드에서 계속 돌아도 호출자는 풀려난다. */
export async function withDeadline(
  work: Promise<Result<ExtractedDoc, ExtractError>>,
  timeoutMs: number,
): Promise<Result<ExtractedDoc, ExtractError>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Result<ExtractedDoc, ExtractError>>((resolve) => {
    timer = setTimeout(() => {
      resolve(err({ kind: "corrupt", detail: "timeout" }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
