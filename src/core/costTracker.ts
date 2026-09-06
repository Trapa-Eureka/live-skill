// 실 LLM 호출 수·추정 토큰 합계를 세는 순수 래퍼 — scripts/smoke.ts 전용(DESIGN §9 T10 결정). 감싸인
// LlmProvider가 실제 IO를 하고, 여기는 위임 + 카운팅만 한다(외부 IO 0 — core 컨벤션 유지).
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

/** llm.complete() 호출마다 요청(system+prompt)과 응답 텍스트를 합쳐 추정 토큰에 더한다. */
export function trackCost(llm: LlmProvider): TrackedLlm {
  let calls = 0;
  let estimatedTokens = 0;
  return {
    llm: {
      complete: async (req) => {
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
