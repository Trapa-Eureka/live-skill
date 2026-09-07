// Claude adapter: the official SDK with an injected fetch (tests inject a mock fetch, so zero network
// calls, guardrail 3). Pattern from ../msg-agent/src/adapters/providers/claude.ts (the structure is
// ported; the interface is live-skill's own).
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
      // Always explicit, regardless of guardrails: an env var must not silently redirect the
      // endpoint, and SDK debug logging must not print request bodies.
      baseURL: CLAUDE_BASE_URL,
      logLevel: "off",
      timeout: CLAUDE_TIMEOUT_MS,
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
      // Retries belong to the pipeline (T6): if the SDK also retried, the cost-cap accounting would
      // be off.
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
