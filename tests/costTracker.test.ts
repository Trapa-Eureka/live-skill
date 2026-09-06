// trackCost — 순수 카운팅 래퍼(core/costTracker.ts, T10). 감싸인 LlmProvider에 전부 위임하되 호출
// 수·추정 토큰만 옆에서 센다. ScriptedLlm으로 실 네트워크 없이 검증(가드레일 3).
import { describe, expect, it } from "vitest";
import { trackCost } from "../src/core/costTracker.js";
import { script } from "../src/mocks/scriptedLlm.js";

describe("trackCost", () => {
  it("호출마다 세고, 실제 응답은 그대로 통과시킨다", async () => {
    const llm = script().outline({ slug: "s", title: "T", chapters: [] }).build();
    const tracked = trackCost(llm);

    expect(tracked.summary()).toEqual({ calls: 0, estimatedTokens: 0 });

    const req = { system: "[live-skill:outline] role tag", prompt: "hello", maxTokens: 100 };
    const response = await tracked.llm.complete(req);
    expect(response).toBe(JSON.stringify({ slug: "s", title: "T", chapters: [] }));

    const summary = tracked.summary();
    expect(summary.calls).toBe(1);
    expect(summary.estimatedTokens).toBeGreaterThan(0);
    llm.assertExhausted();
  });

  it("여러 번 호출하면 누적된다", async () => {
    const llm = script()
      .outline({ slug: "a", title: "A", chapters: [] })
      .outlineRaw("not json")
      .build();
    const tracked = trackCost(llm);
    const req = { system: "[live-skill:outline] tag", prompt: "p", maxTokens: 10 };

    await tracked.llm.complete(req);
    const afterOne = tracked.summary();
    await tracked.llm.complete(req);
    const afterTwo = tracked.summary();

    expect(afterOne.calls).toBe(1);
    expect(afterTwo.calls).toBe(2);
    expect(afterTwo.estimatedTokens).toBeGreaterThan(afterOne.estimatedTokens);
  });
});
