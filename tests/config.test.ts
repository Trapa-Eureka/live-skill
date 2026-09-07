import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/index.js";

describe("loadConfig", () => {
  it("applies every default when env is empty (DESIGN §7)", () => {
    expect(loadConfig({})).toEqual({
      model: "claude-sonnet-4-5",
      gateThreshold: 0.9,
      qaPerSection: 3,
      maxLlmCalls: 300,
      budgets: { skillMd: 4000, chapter: 1000, glossary: 1500, patterns: 2000, cheatsheet: 1000 },
    });
  });

  it("overrides defaults from env", () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: "sk-test",
      MODEL: "claude-opus-4",
      GATE_THRESHOLD: "0.95",
      QA_PER_SECTION: "5",
      MAX_LLM_CALLS: "150",
    });
    expect(config.anthropicApiKey).toBe("sk-test");
    expect(config.model).toBe("claude-opus-4");
    expect(config.gateThreshold).toBe(0.95);
    expect(config.qaPerSection).toBe(5);
    expect(config.maxLlmCalls).toBe(150);
  });

  it("treats an empty string the same as unset (falls back to default)", () => {
    expect(loadConfig({ GATE_THRESHOLD: "" }).gateThreshold).toBe(0.9);
  });

  it("treats a whitespace-only value as unset, not as 0 (B4 — Number('  ') is 0)", () => {
    expect(loadConfig({ GATE_THRESHOLD: "   " }).gateThreshold).toBe(0.9);
    expect(loadConfig({ MAX_LLM_CALLS: "\t" }).maxLlmCalls).toBe(300);
    expect(loadConfig({ MODEL: "  " }).model).toBe("claude-sonnet-4-5");
  });

  it("throws a cause+fix error for a non-numeric override (CLAUDE.md error-message convention)", () => {
    expect(() => loadConfig({ MAX_LLM_CALLS: "not-a-number" })).toThrow(/MAX_LLM_CALLS/);
  });

  it("rejects a gate threshold above 1", () => {
    expect(() => loadConfig({ GATE_THRESHOLD: "1.5" })).toThrow(/GATE_THRESHOLD/u);
  });

  // B4 (SEC-007, AUD-008, completion criterion): the 0.5 floor is policy. Set to 0, even zero
  // questions used to pass.
  it.each(["0", "0.49", "-1"])(
    "rejects GATE_THRESHOLD=%s below the policy floor with a cause+fix message",
    (value) => {
      expect(() => loadConfig({ GATE_THRESHOLD: value })).toThrow(/at least 0\.5/u);
      expect(() => loadConfig({ GATE_THRESHOLD: value })).toThrow(/Fix:/u);
    },
  );

  it.each(["0.5", "0.9", "1"])("accepts GATE_THRESHOLD=%s inside [0.5, 1]", (value) => {
    expect(loadConfig({ GATE_THRESHOLD: value }).gateThreshold).toBe(Number(value));
  });

  it("wraps schema failures in a plain Error naming the field (no raw zod dump)", () => {
    expect(() => loadConfig({ GATE_THRESHOLD: "0" })).toThrow(
      /invalid configuration — gateThreshold/u,
    );
  });

  it("rejects a non-positive qaPerSection", () => {
    expect(() => loadConfig({ QA_PER_SECTION: "0" })).toThrow();
  });
});
