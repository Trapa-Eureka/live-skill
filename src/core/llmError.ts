// Error thrown by LlmProvider implementations. Per DESIGN §2, LlmProvider.complete() signals failure
// by throwing (unlike the extractors, which wrap failures in a Result). The retryable flag drives the
// T6 pipeline's retry policy.
export type LlmErrorKind =
  "auth" | "rate_limit" | "network" | "server" | "bad_response" | "refusal" | "unknown";

/** Per-kind fix advice, used in PipelineError messages. The CLI wording lives in reportFormat.ts. */
export function llmErrorAdvice(kind: LlmErrorKind): string {
  switch (kind) {
    case "auth":
      return "check ANTHROPIC_API_KEY in .env (copy .env.example) — the provider rejected the credentials.";
    case "rate_limit":
      return "wait a moment and run the same command again; lower QA_PER_SECTION to make fewer calls.";
    case "network":
      return "check the network/proxy and run the command again.";
    case "server":
      return "the provider reported an outage — run the command again later.";
    case "bad_response":
      return "run the command again; if it repeats, try another MODEL.";
    case "refusal":
      return "the model refused this content — review the source document; it is not retried.";
    case "unknown":
      return "run the command again; if it repeats, report the message below as an issue.";
  }
}

export class LlmProviderError extends Error {
  readonly kind: LlmErrorKind;
  readonly retryable: boolean;

  constructor(kind: LlmErrorKind, retryable: boolean, message?: string) {
    super(message ?? kind);
    this.name = "LlmProviderError";
    this.kind = kind;
    this.retryable = retryable;
  }
}
