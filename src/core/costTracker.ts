// Pure wrapper that counts LLM calls and the estimated token total, and enforces a cap during the run
// when one is given (DESIGN §9 T10, §5.1 D1). The wrapped LlmProvider does the real IO; this only
// delegates, counts, and checks the cap (zero external IO, keeping the core convention).
import { estimateTokens } from "./tokenEstimate.js";
import type { LlmProvider } from "./types.js";

export interface CostSummary {
  calls: number;
  /** Not a real tokenizer value but the same approximation as tokenEstimate.ts; for a rough sense of
   * scale. */
  estimatedTokens: number;
}

export interface TrackedLlm {
  llm: LlmProvider;
  summary: () => CostSummary;
}

export interface CostTrackerOptions {
  /** Calls beyond this number are blocked with LlmCallCapError before they reach the wrapped
   * LlmProvider (D1, guardrail 6). */
  maxCalls?: number;
}

/** Raised when the call cap is hit during the run: the calls up to the cap have already happened, this
 * one has not. */
export class LlmCallCapError extends Error {
  readonly calls: number;
  readonly limit: number;
  constructor(calls: number, limit: number) {
    super(
      `LLM call cap reached: ${String(calls)} calls already made, the ${String(calls + 1)}th would exceed MAX_LLM_CALLS=${String(limit)}. Fix: split the source, pass --no-gate, or raise MAX_LLM_CALLS.`,
    );
    this.name = "LlmCallCapError";
    this.calls = calls;
    this.limit = limit;
  }
}

/** On every llm.complete() call, adds the request (system + prompt) and the response text to the
 * estimated tokens. When maxCalls is set, a call that would exceed it is blocked **before** it happens:
 * a second line of defense that counts actual calls, independent of the upfront estimate (§5.1). */
export function trackCost(llm: LlmProvider, opts: CostTrackerOptions = {}): TrackedLlm {
  let calls = 0;
  let estimatedTokens = 0;
  return {
    llm: {
      complete: async (req) => {
        if (opts.maxCalls !== undefined && calls >= opts.maxCalls) {
          throw new LlmCallCapError(calls, opts.maxCalls);
        }
        calls += 1;
        estimatedTokens += estimateTokens(req.system) + estimateTokens(req.prompt);
        const text = await llm.complete(req);
        estimatedTokens += estimateTokens(text);
        return text;
      },
    },
    summary: () => ({ calls, estimatedTokens }),
  };
}
