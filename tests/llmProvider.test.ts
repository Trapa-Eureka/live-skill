// T3 완료 기준: 목 fetch 요청 형태 테스트. 패턴 출처: ../msg-agent/tests/providers.test.ts.
import { describe, expect, it } from "vitest";
import { ClaudeLlmProvider } from "../src/adapters/llmProvider.js";
import { LlmProviderError } from "../src/core/index.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 요청을 기록하고 정해진 응답을 순서대로 재생하는 fetch 대역. */
function mockFetch(responses: { status: number; body: unknown }[]): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const h = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    h.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const raw = init?.body;
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
    });
    const next = responses[calls.length - 1] ?? {
      status: 500,
      body: { error: "no canned response" },
    };
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch: fetchImpl, calls };
}

const claudeMessage = (text: string, stop = "end_turn"): unknown => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5",
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

describe("ClaudeLlmProvider (SDK + injected fetch, 네트워크 0회)", () => {
  it("sends one Messages request with the expected URL, headers, and body shape", async () => {
    const m = mockFetch([{ status: 200, body: claudeMessage("hello") }]);
    const provider = new ClaudeLlmProvider({ apiKey: "sk-test", fetch: m.fetch, maxRetries: 0 });

    const text = await provider.complete({
      system: "[live-skill:grader]\nBe brief.",
      prompt: "Q?",
      maxTokens: 20,
    });

    expect(text).toBe("hello");
    expect(m.calls).toHaveLength(1);
    const c = m.calls[0];
    if (c === undefined) throw new Error("no request captured");
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.method).toBe("POST");
    expect(c.headers["x-api-key"]).toBe("sk-test");
    expect(c.body).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 20,
      system: "[live-skill:grader]\nBe brief.",
      messages: [{ role: "user", content: "Q?" }],
    });
  });

  it("uses the configured model", async () => {
    const m = mockFetch([{ status: 200, body: claudeMessage("x") }]);
    const provider = new ClaudeLlmProvider({ apiKey: "k", model: "claude-opus-4", fetch: m.fetch });
    await provider.complete({ system: "s", prompt: "p", maxTokens: 10 });
    expect(m.calls[0]?.body).toMatchObject({ model: "claude-opus-4" });
  });

  it("does not let the SDK retry on its own (cost-cap guardrail 6): one HTTP call per attempt", async () => {
    const m = mockFetch([
      { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "x" } } },
    ]);
    const provider = new ClaudeLlmProvider({ apiKey: "k", fetch: m.fetch }); // maxRetries 미지정 -> 기본 0
    await expect(
      provider.complete({ system: "s", prompt: "p", maxTokens: 10 }),
    ).rejects.toMatchObject({
      kind: "server",
    });
    expect(m.calls).toHaveLength(1);
  });

  it("maps auth/rate-limit/server/refusal outcomes to LlmProviderError with the right kind+retryable", async () => {
    const cases: { status: number; body: unknown; kind: string; retryable: boolean }[] = [
      {
        status: 401,
        body: { type: "error", error: { type: "authentication_error", message: "x" } },
        kind: "auth",
        retryable: false,
      },
      {
        status: 429,
        body: { type: "error", error: { type: "rate_limit_error", message: "x" } },
        kind: "rate_limit",
        retryable: true,
      },
      {
        status: 529,
        body: { type: "error", error: { type: "overloaded_error", message: "x" } },
        kind: "server",
        retryable: true,
      },
      { status: 200, body: claudeMessage("", "refusal"), kind: "refusal", retryable: false },
    ];
    for (const c of cases) {
      const m = mockFetch([{ status: c.status, body: c.body }]);
      const provider = new ClaudeLlmProvider({ apiKey: "k", fetch: m.fetch, maxRetries: 0 });
      const e = await provider
        .complete({ system: "s", prompt: "p", maxTokens: 10 })
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmProviderError);
      expect(e).toMatchObject({ kind: c.kind, retryable: c.retryable });
    }
  });

  it("rejects an empty text response as a retryable bad_response", async () => {
    const m = mockFetch([{ status: 200, body: claudeMessage("") }]);
    const provider = new ClaudeLlmProvider({ apiKey: "k", fetch: m.fetch, maxRetries: 0 });
    const e = await provider
      .complete({ system: "s", prompt: "p", maxTokens: 10 })
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "bad_response", retryable: true });
  });

  it("rejects a max_tokens cutoff as a non-retryable bad_response (truncated output can't be trusted)", async () => {
    const m = mockFetch([{ status: 200, body: claudeMessage("partial...", "max_tokens") }]);
    const provider = new ClaudeLlmProvider({ apiKey: "k", fetch: m.fetch, maxRetries: 0 });
    const e = await provider
      .complete({ system: "s", prompt: "p", maxTokens: 10 })
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "bad_response", retryable: false });
  });
});
