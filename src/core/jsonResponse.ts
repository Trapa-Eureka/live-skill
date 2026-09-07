// Envelope-tolerant parsing for the JSON-mode LLM responses (outline, qaGen) — L2 (DESIGN §4).
// The prompts ask for bare JSON, but models still wrap it in ``` fences or put a sentence around it,
// and the first real-LLM smoke failed exactly there ("doesn't match the expected schema") on a
// response that was fine underneath. Only the *envelope* is tolerated here: the caller still parses
// the value with the strict zod schema, so nothing in this file loosens a gate or a format boundary.
// Pure, no IO.
import { z } from "zod";

const FENCE = /^```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/u;

function unwrapFence(text: string): string {
  const m = FENCE.exec(text);
  const inner = m?.[1];
  return inner === undefined ? text : inner.trim();
}

/** The outermost `{…}` or `[…]` span, for a value surrounded by prose; undefined when there is none. */
function outermostSpan(text: string): string | undefined {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) return undefined;
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (end <= start) return undefined;
  return text.slice(start, end + 1);
}

/** Parses a model response that should be a JSON value, tolerating a code fence or surrounding prose.
 * Throws a SyntaxError (message prefixed "not valid JSON") when no JSON value can be found. */
export function parseJsonResponse(raw: string): unknown {
  const text = unwrapFence(raw.trim());
  try {
    return JSON.parse(text) as unknown;
  } catch (first) {
    const span = outermostSpan(text);
    if (span !== undefined && span !== text) {
      try {
        return JSON.parse(span) as unknown;
      } catch {
        /* fall through to the original error */
      }
    }
    throw new SyntaxError(
      `not valid JSON (${first instanceof Error ? first.message : String(first)})`,
      { cause: first },
    );
  }
}

/** A one-line reason for a parse or schema failure: zod issues as `path: message` (first five), or the
 * SyntaxError message. Values are not echoed, only paths and rule messages. */
export function describeParseFailure(e: unknown): string {
  if (e instanceof z.ZodError) {
    const shown = e.issues.slice(0, 5).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    const more = e.issues.length > 5 ? `; +${String(e.issues.length - 5)} more` : "";
    return `schema: ${shown.join("; ")}${more}`;
  }
  return e instanceof Error ? e.message : "unknown";
}
