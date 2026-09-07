// L2 (DESIGN §4): JSON-mode responses may arrive inside a code fence or with a sentence around them.
// The envelope is tolerated; the value is still schema-checked by the callers (pipeline/gate tests).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeParseFailure, parseJsonResponse } from "../src/core/jsonResponse.js";

const plan = { slug: "manual", title: "Manual", chapters: [] };

describe("parseJsonResponse", () => {
  it("parses bare JSON objects and arrays unchanged", () => {
    expect(parseJsonResponse(JSON.stringify(plan))).toEqual(plan);
    expect(parseJsonResponse(" [1, 2] \n")).toEqual([1, 2]);
  });

  it.each(["```json", "```JSON", "```", "```json   "])(
    "unwraps a %s fence with or without trailing newline",
    (opener) => {
      expect(parseJsonResponse(`${opener}\n${JSON.stringify(plan)}\n\`\`\``)).toEqual(plan);
      expect(parseJsonResponse(`${opener}\n${JSON.stringify(plan)}\`\`\`\n`)).toEqual(plan);
    },
  );

  it("takes the outermost value when prose surrounds it", () => {
    const raw = `Here is the outline you asked for:\n${JSON.stringify(plan)}\nLet me know if you need changes.`;
    expect(parseJsonResponse(raw)).toEqual(plan);
  });

  it("handles a fence inside prose", () => {
    const raw = `Sure!\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\nDone.`;
    expect(parseJsonResponse(raw)).toEqual(plan);
  });

  it("throws a SyntaxError naming the problem when no JSON value can be found", () => {
    expect(() => parseJsonResponse("not json at all")).toThrow(SyntaxError);
    expect(() => parseJsonResponse("not json at all")).toThrow(/not valid JSON/u);
    expect(() => parseJsonResponse("prefix { still broken ] suffix")).toThrow(/not valid JSON/u);
    expect(() => parseJsonResponse("")).toThrow(SyntaxError);
  });

  it("does not repair the value itself (a truncated object still fails)", () => {
    expect(() => parseJsonResponse('```json\n{"slug": "manual", "chapters": [\n```')).toThrow(
      SyntaxError,
    );
  });
});

describe("describeParseFailure", () => {
  it("lists zod issues as path: message without echoing values", () => {
    const schema = z.object({
      slug: z.string().regex(/^[a-z-]+$/u, "lowercase only"),
      n: z.number(),
    });
    const result = schema.safeParse({ slug: "Bad Slug SECRET", n: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const text = describeParseFailure(result.error);
    expect(text).toContain("schema: slug: lowercase only");
    expect(text).toContain("n: ");
    expect(text).not.toContain("SECRET");
  });

  it("caps the issue list at five and counts the rest", () => {
    const schema = z.object(Object.fromEntries("abcdefg".split("").map((k) => [k, z.number()])));
    const result = schema.safeParse({});
    if (result.success) throw new Error("expected failure");
    expect(describeParseFailure(result.error)).toMatch(/; \+2 more$/u);
  });

  it("passes SyntaxError and other Error messages through", () => {
    expect(describeParseFailure(new SyntaxError("not valid JSON (x)"))).toBe("not valid JSON (x)");
    expect(describeParseFailure("weird")).toBe("unknown");
  });
});
