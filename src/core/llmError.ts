// LlmProvider 구현체가 던지는 에러 — DESIGN §2 LlmProvider.complete()는 예외로 실패를 알린다(추출기와
// 달리 Result로 감싸지 않는다). retryable 플래그는 T6 파이프라인의 재시도 정책에 쓴다.
export type LlmErrorKind =
  "auth" | "rate_limit" | "network" | "server" | "bad_response" | "refusal" | "unknown";

/** 종류별 수정 방법(영어 — PipelineError 메시지용). 한국어 CLI 문구는 reportFormat.ts에 있다. */
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
