// Token estimation: a deterministic approximation with no real tokenizer (assembler and validator
// use it for budget math, DESIGN §3). CJK (Korean/Chinese/Japanese) counts roughly 1 token per
// character; everything else roughly 1 token per 4 characters.
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export function estimateTokens(text: string): number {
  const cjkCount = text.match(CJK_RE)?.length ?? 0;
  const rest = text.replace(CJK_RE, "");
  return cjkCount + Math.ceil(rest.length / 4);
}

/** Input cap for a single compile: the summed token estimate of the extracted body sections
 * (DESIGN §5.1). compile() applies it before calling outline, so every later stage (distill
 * prompts, ...) can assume it (F1). A generous constant, several times the total output budget. */
export const MAX_INPUT_TOKENS = 30_000;
