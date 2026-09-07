// T10 acceptance criterion: "test the script itself with a dry (scripted) structure". scripts/smoke.ts
// is not executed here (it requires a real ANTHROPIC_API_KEY and calls the real network). Instead
// runSmoke() from src/cli/smoke.ts, which holds the logic, is driven with a ScriptedLlm script: the
// real samples/manual.pdf is read by the real extractor and only the LLM is replaced (guardrail 3:
// zero real network and real LLM calls).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { loadConfig } from "../src/core/config.js";
import { LlmProviderError } from "../src/core/llmError.js";
import type { SkillPlan } from "../src/core/index.js";
import { script } from "../src/mocks/scriptedLlm.js";
import { runSmoke, type SmokeDeps } from "../src/cli/smoke.js";

function lines(): { out: (l: string) => void; all: string[] } {
  const all: string[] = [];
  return { out: (l) => all.push(l), all };
}

const samplePath = join(process.cwd(), "samples", "manual.pdf");

function baseDeps(overrides: Partial<SmokeDeps> & Pick<SmokeDeps, "llm">): SmokeDeps {
  return {
    out: () => undefined,
    readSourceFile: (p) => Promise.resolve({ path: p, bytes: new Uint8Array(readFileSync(p)) }),
    extractors: createExtractors(),
    clock: { now: () => new Date() },
    config: loadConfig({ QA_PER_SECTION: "1" }),
    ...overrides,
  };
}

// A plan covering the full real extraction of samples/manual.pdf (4 sections with body text). Since
// B1 the outline must cover the population exactly once, so a partial plan ends in outline_invalid
// before the gate.
const manualPlan: SkillPlan = {
  slug: "skillsync-x200",
  title: "SkillSync X200 User Manual (Fixture)",
  chapters: [
    {
      id: "overview",
      file: "ignored",
      title: "Overview",
      sectionIds: ["skillsync-x200-user-manual-fixture", "overview"],
    },
    {
      id: "installation-troubleshooting",
      file: "ignored",
      title: "Installation & Troubleshooting",
      sectionIds: ["installation", "troubleshooting"],
    },
  ],
};

/** A 4-question script; only the last question's verdict changes to produce a pass or a fail. */
function manualScript(lastVerdict: "correct" | "wrong") {
  return script()
    .outline(manualPlan)
    .distill(
      "ch01",
      "The SkillSync X200 is a fictional bench-top controller used only as a sample for this " +
        "project. [§skillsync-x200-user-manual-fixture]\n\n" +
        "The X200 reads sensor input over a serial bus and reports status through three LEDs: " +
        "power, link, and fault. [§overview]",
    )
    .distill(
      "ch02",
      "Mount the unit on a flat, grounded surface. [§installation]\n\n" +
        "If the link LED never turns solid, hold the control button for five seconds to reboot. " +
        "[§troubleshooting]",
    )
    .qa([
      {
        question: "What kind of device is the SkillSync X200?",
        refAnswer: "A fictional bench-top controller sample.",
        anchorQuote:
          "The SkillSync X200 is a fictional bench-top controller used only as a sample for this project.",
      },
    ])
    .qa([
      {
        question: "Which three LEDs does the X200 report status through?",
        refAnswer: "Power, link, and fault.",
        anchorQuote:
          "The X200 reads sensor input over a serial bus and reports status through three LEDs: power, link, and fault.",
      },
    ])
    .qa([
      {
        question: "Where should the unit be mounted?",
        refAnswer: "On a flat, grounded surface.",
        anchorQuote: "Mount the unit on a flat, grounded surface.",
      },
    ])
    .qa([
      {
        question: "What do you do if the link LED never turns solid?",
        refAnswer: "Hold the control button for five seconds to reboot.",
        anchorQuote: "hold the control button for five seconds to reboot.",
      },
    ])
    .selectChapter("chapters/ch01-overview.md")
    .answer("A fictional bench-top controller sample.")
    .grade("correct")
    .selectChapter("chapters/ch01-overview.md")
    .answer("Power, link, and fault.")
    .grade("correct")
    .selectChapter("chapters/ch02-installation-troubleshooting.md")
    .answer("On a flat, grounded surface.")
    .grade("correct")
    .selectChapter("chapters/ch02-installation-troubleshooting.md")
    .answer(
      lastVerdict === "correct"
        ? "Hold the control button for five seconds to reboot."
        : "Unplug it and wait a day.",
    )
    .grade(lastVerdict)
    .build();
}

describe("runSmoke — dry run (real samples/manual.pdf + ScriptedLlm)", () => {
  it("gate passes: prints the report and the cost summary, returns 0", async () => {
    const llm = manualScript("correct");
    const captured = lines();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));

    expect(code).toBe(0);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("PASSED");
    expect(output).toContain("Cost summary: 19 LLM calls");
  });

  it("gate fails (3/4 = 75% < 90%): prints the report and the cost summary, returns 1", async () => {
    const llm = manualScript("wrong");
    const captured = lines();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));

    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("FAILED");
    expect(output).toContain("Cost summary: 19 LLM calls");
  });

  it("returns 1 with a fix-it message when the path cannot be read, and never calls the LLM", async () => {
    const captured = lines();
    const llm = script().build(); // empty script: any real call fails immediately
    const code = await runSmoke(
      { path: "/nonexistent/path/manual.pdf" },
      baseDeps({
        out: captured.out,
        llm,
        readSourceFile: () => Promise.reject(new Error("ENOENT")),
      }),
    );
    expect(code).toBe(1);
    llm.assertExhausted();
    expect(captured.all.join("\n")).toContain("nonexistent/path/manual.pdf");
  });

  it("when compile itself fails (unsupported format), prints the failure message and a cost summary (0 calls), returns 1", async () => {
    const captured = lines();
    const llm = script().build();
    const code = await runSmoke(
      { path: "sheet.xlsx" },
      baseDeps({
        out: captured.out,
        llm,
        readSourceFile: (p) => Promise.resolve({ path: p, bytes: new Uint8Array() }),
      }),
    );
    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("Compile failed");
    expect(output).toContain("Cost summary: 0 LLM calls");
  });

  it("a provider failure (rate_limit) mid-run prints the stage, kind, fix, and a cost summary (calls so far), returns 1 (G1)", async () => {
    const captured = lines();
    const llm = script()
      .outline(manualPlan)
      .distill(
        "ch01",
        "The X200 is a fictional controller. [§skillsync-x200-user-manual-fixture] [§overview]",
      )
      .fail("distill", new LlmProviderError("rate_limit", true, "429 Too Many Requests"))
      .build();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));
    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain(
      "Compile failed. LLM call failed during distillation: rate limit exceeded (rate_limit, retryable)",
    );
    expect(output).toContain("Fix:");
    expect(output).toContain("Cost summary: 3 LLM calls"); // outline 1 + distill 1 + failed distill 1
  });

  it("a structural validation failure (chapter budget exceeded) skips the gate and prints the validation report plus a cost summary (3 calls), returns 1 (E1)", async () => {
    const captured = lines();
    const llm = script()
      .outline(manualPlan)
      .distill(
        "ch01",
        "The X200 is a fictional controller. [§skillsync-x200-user-manual-fixture] [§overview]",
      )
      .distill("ch02", "Mount it on a flat surface. [§installation] [§troubleshooting]")
      .build(); // no gate script
    const base = loadConfig({ QA_PER_SECTION: "1" });
    const code = await runSmoke(
      { path: samplePath },
      baseDeps({
        out: captured.out,
        llm,
        config: { ...base, budgets: { ...base.budgets, chapter: 5 } },
      }),
    );
    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("Validation: FAILED");
    expect(output).toContain("[ERROR] chapters/ch01-overview.md (budget_exceeded)");
    expect(output).toContain("Cost summary: 3 LLM calls");
  });
});
