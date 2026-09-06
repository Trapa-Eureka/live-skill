// 순수 Result<T, E> 유틸리티 — 외부 IO(추출·LLM 등)의 실패를 예외 대신 값으로 표현한다.
// msg-agent(../msg-agent/src/adapters/extractors/*.ts)에서 이미 검증된 패턴 (DESIGN.md §2).
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
