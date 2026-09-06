// Claude 어댑터 — 공식 SDK, fetch 주입(테스트는 목 fetch를 넣어 네트워크 0회, 가드레일 3).
// 패턴 출처: ../msg-agent/src/adapters/providers/claude.ts (구조는 이식, 인터페이스는 live-skill 것).
import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "../core/index.js";
import { LlmProviderError } from "../core/index.js";

export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-5";
export const CLAUDE_BASE_URL = "https://api.anthropic.com";
const CLAUDE_TIMEOUT_MS = 120_000;

export interface ClaudeLlmProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
}

function toLlmProviderError(e: unknown): LlmProviderError {
  if (e instanceof LlmProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new LlmProviderError("auth", false, e.message);
  }
  if (e instanceof Anthropic.RateLimitError)
    return new LlmProviderError("rate_limit", true, e.message);
  if (e instanceof Anthropic.InternalServerError)
    return new LlmProviderError("server", true, e.message);
  if (e instanceof Anthropic.APIConnectionError)
    return new LlmProviderError("network", true, e.message);
  if (e instanceof Anthropic.APIError) return new LlmProviderError("unknown", false, e.message);
  return new LlmProviderError("unknown", false, e instanceof Error ? e.message : "unknown error");
}

export class ClaudeLlmProvider implements LlmProvider {
  private readonly client: Anthropic;
  readonly model: string;

  constructor(opts: ClaudeLlmProviderOptions) {
    this.model = opts.model ?? CLAUDE_DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // 가드레일과 무관하게 항상 명시: 환경변수가 엔드포인트를 몰래 바꾸거나 SDK 디버그 로그가 본문을 찍지 않게.
      baseURL: CLAUDE_BASE_URL,
      logLevel: "off",
      timeout: CLAUDE_TIMEOUT_MS,
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
      // 재시도는 파이프라인(T6)의 몫 — SDK가 중복으로 재시도하면 비용 상한 계산이 어긋난다.
      maxRetries: opts.maxRetries ?? 0,
    });
  }

  async complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      });
    } catch (e) {
      throw toLlmProviderError(e);
    }
    if (!Array.isArray(response.content)) {
      throw new LlmProviderError("bad_response", true, "schema");
    }
    if (response.stop_reason === "refusal") throw new LlmProviderError("refusal", false);
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text === "") throw new LlmProviderError("bad_response", true, "empty_text");
    if (response.stop_reason === "max_tokens") {
      throw new LlmProviderError("bad_response", false, "max_tokens");
    }
    return text;
  }
}
