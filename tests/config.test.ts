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

  it("throws a cause+fix error for a non-numeric override (CLAUDE.md error-message convention)", () => {
    expect(() => loadConfig({ MAX_LLM_CALLS: "not-a-number" })).toThrow(/MAX_LLM_CALLS/);
  });

  it("rejects a gate threshold outside [0, 1]", () => {
    expect(() => loadConfig({ GATE_THRESHOLD: "1.5" })).toThrow();
  });

  it("rejects a non-positive qaPerSection", () => {
    expect(() => loadConfig({ QA_PER_SECTION: "0" })).toThrow();
  });
});
