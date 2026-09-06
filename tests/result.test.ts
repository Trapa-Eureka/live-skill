import { describe, expect, it } from "vitest";
import { err, ok } from "../src/core/index.js";

describe("Result", () => {
  it("ok() wraps a value", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("err() wraps an error", () => {
    expect(err({ kind: "empty_text" })).toEqual({ ok: false, error: { kind: "empty_text" } });
  });
});
