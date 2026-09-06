// LlmProvider 구현체가 던지는 에러 — DESIGN §2 LlmProvider.complete()는 예외로 실패를 알린다(추출기와
// 달리 Result로 감싸지 않는다). retryable 플래그는 T6 파이프라인의 재시도 정책에 쓴다.
export type LlmErrorKind =
  "auth" | "rate_limit" | "network" | "server" | "bad_response" | "refusal" | "unknown";

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
