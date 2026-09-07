// Shared extraction limits: reject inputs that exceed the budget before parsing, and put a time cap
// on pathological input (delivery-grade quality). Ported from
// ../msg-agent/src/adapters/extractors/limits.ts. D4 (DESIGN §6): a timeout does not merely discard
// the result; it also tells the parser to cancel through an AbortSignal. Parsers with a cancel API
// (pdf.js) actually stop; parsers without one (mammoth) stop cooperatively at their checkpoints.
import type { ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err } from "../../core/index.js";

export const EXTRACT_TIMEOUT_MS = 60_000;

export type ExtractOutcome = Result<ExtractedDoc, ExtractError>;

export const TIMEOUT: ExtractOutcome = err({ kind: "corrupt", detail: "timeout" });

/** Races an extraction against a time cap. When time runs out (or the outer signal is aborted), the
 * signal passed to run is aborted and `timeout` is returned. A result that arrives later is not used,
 * and a late rejection does not become unhandled because the race is still subscribed to it. */
export async function withDeadline(
  run: (signal: AbortSignal) => Promise<ExtractOutcome>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<ExtractOutcome> {
  if (outer?.aborted === true) return TIMEOUT; // already cancelled: do not even start the parser
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
