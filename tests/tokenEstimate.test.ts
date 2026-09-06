import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/core/index.js";

describe("estimateTokens", () => {
  it("counts ~4 non-CJK characters as 1 token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("counts each CJK character as ~1 token", () => {
    expect(estimateTokens("한국어")).toBe(3);
  });

  it("adds the CJK and non-CJK estimates for mixed text", () => {
    // "한글" = 2 CJK chars (2 tokens) + "abcd" = 4 non-CJK chars (1 token) = 3.
    expect(estimateTokens("한글abcd")).toBe(3);
  });

  it("is 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
