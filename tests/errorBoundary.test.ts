// G1 (DESIGN §6): sanitizing error text from outside and the top-level CLI error boundary. Pure, no IO.
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, sanitizeExternalText } from "../src/core/index.js";
import { describeTopLevelError } from "../src/cli/errorBoundary.js";

describe("sanitizeExternalText (G1 — keys, control characters, length)", () => {
  it("drops control characters, folds newlines, redacts key-like tokens and credential fields", () => {
    const raw = `429 Too Many Requests[31m\nkey sk-ant-api03-SECRETSECRETSECRET-x\tapi_key: abc123 Authorization=Bearer zzz`;
    const out = sanitizeExternalText(raw);
    expect(out).not.toMatch(/\p{Cc}/u);
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("zzz");
    expect(out).toContain("429 Too Many Requests");
    expect(out).toContain("sk-***");
    expect(out).toContain("api_key: ***");
    expect(out).toContain("Authorization=***");
  });

  it("caps the length with an ellipsis", () => {
    const out = sanitizeExternalText("x".repeat(500));
    expect(out).toHaveLength(201);
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeExternalText("short")).toBe("short");
  });
});

describe("describeTopLevelError (G1 — configuration error 1, internal error 2)", () => {
  it("reports a ConfigError as a configuration problem with exit code 1", () => {
    let thrown: unknown;
    try {
      loadConfig({ GATE_THRESHOLD: "not-a-number" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    const failure = describeTopLevelError(thrown);
    expect(failure.exitCode).toBe(1);
    expect(failure.message).toContain("Configuration error");
    expect(failure.message).toContain("GATE_THRESHOLD");
    expect(failure.message).toContain("Fix:");
  });

  it("reports anything else as an internal error with exit code 2 and an issue hint, sanitized", () => {
    const failure = describeTopLevelError(new TypeError("boom sk-ant-api03-LEAKLEAKLEAK"));
    expect(failure.exitCode).toBe(2);
    expect(failure.message).toContain("Internal error");
    expect(failure.message).toContain("TypeError: boom");
    expect(failure.message).not.toContain("LEAK");
    expect(failure.message).not.toMatch(/\p{Cc}/u);
    expect(failure.message).toContain("report an issue");
    expect(describeTopLevelError("just a string").exitCode).toBe(2);
    expect(describeTopLevelError("just a string").message).toContain("just a string");
  });
});
