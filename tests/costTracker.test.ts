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

  it("maxCalls를 넘기는 호출은 감싸인 provider에 닿기 전에 LlmCallCapError로 막는다 (D1)", async () => {
    const llm = script()
      .outline({ slug: "a", title: "A", chapters: [] })
      .outline({ slug: "b", title: "B", chapters: [] })
      .build(); // 3번째 대본은 없다 — 상한이 막지 못하면 exhausted로 실패한다
    const tracked = trackCost(llm, { maxCalls: 2 });
    const req = { system: "[live-skill:outline] tag", prompt: "p", maxTokens: 10 };

    await tracked.llm.complete(req);
    await tracked.llm.complete(req);
    await expect(tracked.llm.complete(req)).rejects.toMatchObject({
      name: "LlmCallCapError",
      calls: 2,
      limit: 2,
    });
    await expect(tracked.llm.complete(req)).rejects.toThrow(/MAX_LLM_CALLS=2/u);
    expect(tracked.summary().calls).toBe(2); // 막힌 호출은 세지 않는다
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
