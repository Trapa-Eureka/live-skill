// trackCost: pure counting wrapper (core/costTracker.ts, T10). Delegates everything to the wrapped
// LlmProvider and only counts calls and estimated tokens alongside. Verified with ScriptedLlm, no real
// network (guardrail 3).
import { describe, expect, it } from "vitest";
import { trackCost } from "../src/core/costTracker.js";
import { script } from "../src/mocks/scriptedLlm.js";

describe("trackCost", () => {
  it("counts every call and passes the real response through", async () => {
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

  it("blocks a call beyond maxCalls with LlmCallCapError before it reaches the wrapped provider (D1)", async () => {
    const llm = script()
      .outline({ slug: "a", title: "A", chapters: [] })
      .outline({ slug: "b", title: "B", chapters: [] })
      .build(); // no 3rd script entry; if the cap does not block, the call fails as exhausted
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
    expect(tracked.summary().calls).toBe(2); // the blocked call is not counted
    llm.assertExhausted();
  });

  it("accumulates across multiple calls", async () => {
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
