// Model output text hygiene (C1, DESIGN §4). Pure functions, no external IO. Control-character ranges
// are invisible, so they are written only as \u escapes (never put a literal control character in the
// source; same reason as the past BOM-literal incident).

// C0 control characters (except newline U+000A and tab U+0009) and DEL (U+007F).
// eslint-disable-next-line no-control-regex -- the purpose is to strip control characters
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

/** Removes C0 control characters (except newline and tab) and DEL; applied to model output that is
 * written to files as-is, such as distilled bodies. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_EXCEPT_NEWLINE_TAB, "");
}

/** For single-line fields (titles, ids): no control characters at all, newline included. */
/** Trims an error message coming from outside before putting it into output (G1, AUD-015): control
 * characters and newlines become spaces, key-like tokens are masked, and the length is capped, so a
 * sentence returned by the API cannot carry terminal control sequences or keys. */
export const MAX_EXTERNAL_TEXT_CHARS = 200;
const KEY_LIKE = /\bsk-[A-Za-z0-9_-]{8,}/gu;
const CREDENTIAL_FIELD =
  /\b(api[_-]?key|authorization|bearer|token)\b(\s*[:=]\s*)(?:bearer\s+)?\S+/giu;
export function sanitizeExternalText(text: string, maxChars = MAX_EXTERNAL_TEXT_CHARS): string {
  const cleaned = stripControlChars(text)
    .replace(/[\n\r\t]+/gu, " ")
    .replace(KEY_LIKE, "sk-***")
    .replace(CREDENTIAL_FIELD, "$1$2***")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
}

export const SINGLE_LINE_PATTERN = /^[^\p{Cc}]+$/u;

/** For multi-line fields (question, answer, quote): only newline and tab are allowed; any other
 * control character is rejected. */
// eslint-disable-next-line no-control-regex -- the purpose is to check for control characters
export const MULTI_LINE_PATTERN = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u;
