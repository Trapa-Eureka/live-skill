// LLM 호출 수·추정 토큰 합계를 세고, 상한이 주어지면 실행 중에 강제하는 순수 래퍼(DESIGN §9 T10, §5.1 D1).
// 감싸인 LlmProvider가 실제 IO를 하고, 여기는 위임 + 카운팅 + 상한 검사만 한다(외부 IO 0 — core 컨벤션 유지).
import { estimateTokens } from "./tokenEstimate.js";
import type { LlmProvider } from "./types.js";

export interface CostSummary {
  calls: number;
  /** 실 토크나이저 값이 아니라 tokenEstimate.ts와 같은 근사치 — 대략의 규모 파악용. */
  estimatedTokens: number;
}

export interface TrackedLlm {
  llm: LlmProvider;
  summary: () => CostSummary;
}

export interface CostTrackerOptions {
  /** 이 수를 넘기는 호출은 감싸인 LlmProvider에 닿기 전에 LlmCallCapError로 막는다(D1, 가드레일 6). */
  maxCalls?: number;
}

/** 실행 중 호출 상한에 걸렸을 때 — 상한까지의 호출은 이미 일어났고, 이 호출은 일어나지 않았다. */
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

/** llm.complete() 호출마다 요청(system+prompt)과 응답 텍스트를 합쳐 추정 토큰에 더한다. maxCalls가 있으면 그
 * 수를 넘기는 호출을 **하기 전에** 막는다 — 사전 추정(§5.1)과 별개로 실제 호출 수를 세는 두 번째 방어선. */
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
