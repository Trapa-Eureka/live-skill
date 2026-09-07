// 토큰 추정 — 실 토크나이저 없이 결정론으로 근사한다(assembler·validator가 예산 계산에 쓴다, DESIGN §3).
// CJK(한·중·일)는 글자당 대략 1토큰, 그 외는 4자당 대략 1토큰으로 잡는다.
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export function estimateTokens(text: string): number {
  const cjkCount = text.match(CJK_RE)?.length ?? 0;
  const rest = text.replace(CJK_RE, "");
  return cjkCount + Math.ceil(rest.length / 4);
}

/** 컴파일 1회의 입력 상한 — 추출된 본문 섹션 텍스트의 추정 토큰 합(DESIGN §5.1). compile()이 outline을 부르기 전에
 * 걸러 그 아래 단계(distill 프롬프트 등)는 이 값을 전제할 수 있다(F1). 산출 예산 합계의 몇 배 수준으로 넉넉히 잡은 상수. */
export const MAX_INPUT_TOKENS = 30_000;
