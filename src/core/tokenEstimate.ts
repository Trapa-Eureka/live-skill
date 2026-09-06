// 토큰 추정 — 실 토크나이저 없이 결정론으로 근사한다(assembler·validator가 예산 계산에 쓴다, DESIGN §3).
// CJK(한·중·일)는 글자당 대략 1토큰, 그 외는 4자당 대략 1토큰으로 잡는다.
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export function estimateTokens(text: string): number {
  const cjkCount = text.match(CJK_RE)?.length ?? 0;
  const rest = text.replace(CJK_RE, "");
  return cjkCount + Math.ceil(rest.length / 4);
}
