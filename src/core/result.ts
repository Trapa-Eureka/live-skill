// Pure Result<T, E> utility: failures of external IO (extraction, LLM, ...) are values, not
// exceptions. A pattern already proven in msg-agent (../msg-agent/src/adapters/extractors/*.ts),
// DESIGN.md §2.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
