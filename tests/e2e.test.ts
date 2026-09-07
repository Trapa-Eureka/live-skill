// T9 acceptance criteria: verifies SPEC §5 scenarios 1 and 2 as a "CLI-level" e2e mock.
// tests/pipeline.test.ts (T6) already combines the real extractors with core compile(); this covers
// the layer above it, wiring the real run<Command>() functions to the real adapters/fsTargets.ts
// functions (collectInputFiles/readSourceFiles/writeSkill/readSkillDir/readManifest/
// resolveTargetDir/tempSkillDir). The only mock is the LLM (guardrail 3: ScriptedLlm only, zero real
// network). The fixtures are self-authored (guardrail 4); see the DESIGN §6 T9 decision.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtractors } from "../src/adapters/extractors/index.js";
import {
  collectInputFiles,
  readManifest,
  readSkillDir,
  readSourceFiles,
  resolveTargetDir,
  tempSkillDir,
  writeSkill,
} from "../src/adapters/fsTargets.js";
import { loadConfig } from "../src/core/config.js";
import type { SkillPlan } from "../src/core/index.js";
import { script } from "../src/mocks/scriptedLlm.js";
import { runCompile, type CompileDeps } from "../src/cli/compile.js";
import { runEval } from "../src/cli/eval.js";
import { runReport } from "../src/cli/report.js";
import { runValidate } from "../src/cli/validate.js";

function lines(): { out: (l: string) => void; all: string[] } {
  const all: string[] = [];
  return { out: (l) => all.push(l), all };
}

function fixture(name: string): string {
  return join(process.cwd(), "fixtures/docs", name);
}

// The gate-pass case writes to a scratch directory given via --out; the gate-fail case writes to the
// os.tmpdir() path the real tempSkillDir() picks. Either way it is removed when the test ends.
const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function realDeps(overrides: Partial<CompileDeps> & Pick<CompileDeps, "llm">): CompileDeps {
  return {
    out: () => undefined,
    collectInputFiles,
    readSourceFiles,
    extractors: createExtractors(),
    clock: { now: () => new Date() },
    config: loadConfig({ QA_PER_SECTION: "1" }),
    resolveTargetDir,
    tempSkillDir,
    writeSkill,
    ...overrides,
  };
}

describe("T9 e2e-mock — SPEC §5 scenario 1: technical manual → skill (gate passes)", () => {
  it("compiles with the real extractor, assembler, gate, and file writer, then reads the output back and passes validate/report", async () => {
    const plan: SkillPlan = {
      slug: "linkbox-r7",
      title: "LinkBox R7 Field Manual",
      chapters: [
        {
          id: "setup-operation",
          file: "ignored",
          title: "Setup & Operation",
          sectionIds: ["linkbox-r7-field-manual/setup", "linkbox-r7-field-manual/operation"],
        },
        {
          id: "troubleshooting",
          file: "ignored",
          title: "Troubleshooting",
          sectionIds: ["linkbox-r7-field-manual/troubleshooting"],
        },
      ],
    };

    const llm = script()
      .outline(plan)
      .distill(
        "ch01",
        "Mount the LinkBox on the wall bracket using the two anchor screws provided in the kit. " +
          "[§linkbox-r7-field-manual/setup]\n\n" +
          "Press the sync button once to pair the LinkBox with the base hub. " +
          "[§linkbox-r7-field-manual/operation]",
      )
      .distill(
        "ch02",
        "If the status light stays red, replace the power adapter with a spare unit. " +
          "[§linkbox-r7-field-manual/troubleshooting]",
      )
      .qa([
        {
          question: "How is the LinkBox mounted?",
          refAnswer: "On the wall bracket with two anchor screws.",
          anchorQuote:
            "Mount the LinkBox on the wall bracket using the two anchor screws provided in the kit.",
        },
      ])
      .qa([
        {
          question: "How do you pair the LinkBox with the hub?",
          refAnswer: "Press the sync button once.",
          anchorQuote: "Press the sync button once to pair the LinkBox with the base hub.",
        },
      ])
      .qa([
        {
          question: "What should you do if the status light stays red?",
          refAnswer: "Replace the power adapter with a spare unit.",
          anchorQuote:
            "If the status light stays red, replace the power adapter with a spare unit.",
        },
      ])
      .selectChapter("chapters/ch01-setup-operation.md")
      .answer("On the wall bracket with two anchor screws.")
      .grade("correct")
      .selectChapter("chapters/ch01-setup-operation.md")
      .answer("Press the sync button once.")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("Replace the power adapter with a spare unit.")
      .grade("correct")
      .build();

    const outDir = await mkdtemp(join(tmpdir(), "live-skill-e2e-s1-"));
    cleanupDirs.push(outDir);
    const captured = lines();

    const code = await runCompile(
      {
        paths: [fixture("e2e-scenario1-manual.md")],
        out: outDir,
        target: "claude",
        noGate: false,
        force: false,
      },
      realDeps({ out: captured.out, llm }),
    );

    expect(code).toBe(0);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain(`Compiled: ${outDir}`);
    expect(output).toContain("PASSED");

    // Confirm it really landed on disk (SKILL.md, 2 chapters, manifest.json) via the real readSkillDir
    const written = await readSkillDir(outDir);
    expect(written.map((f) => f.path).sort()).toEqual([
      "SKILL.md",
      "chapters/ch01-setup-operation.md",
      "chapters/ch02-troubleshooting.md",
      "cheatsheet.md",
      "glossary.md",
      "manifest.json",
      "patterns.md",
    ]);

    const manifest = await readManifest(outDir);
    expect(manifest.gate).toMatchObject({ passed: true, passRate: 1 });

    // validate: re-read the directory just written and check its structure (zero LLM calls)
    const validateOut = lines();
    const validateCode = await runValidate(outDir, {
      out: validateOut.out,
      readSkillDir,
      budgets: loadConfig({}).budgets,
    });
    expect(validateCode).toBe(0);
    expect(validateOut.all.join("\n")).toContain("PASSED");

    // report: re-read the real manifest.json and print the human-readable gate report
    const reportOut = lines();
    const reportCode = await runReport(outDir, { out: reportOut.out, readManifest, readSkillDir });
    expect(reportCode).toBe(0);
    expect(reportOut.all.join("\n")).toContain("PASSED");

    // E3 (acceptance criterion): hand-editing a chapter after compile makes report fail with STALE
    // instead of showing the last PASSED.
    const chapter = join(outDir, "chapters", "ch01-setup-operation.md");
    const original = await readFile(chapter, "utf-8");
    await writeFile(chapter, `${original}\nHand-edited after the gate ran.\n`);
    const stale = lines();
    expect(await runReport(outDir, { out: stale.out, readManifest, readSkillDir })).toBe(1);
    expect(stale.all.join("\n")).toContain("STALE");
    expect(stale.all.join("\n")).toContain("chapters/ch01-setup-operation.md");
    expect(stale.all.join("\n")).not.toContain("PASSED");

    // The eval reuse path stops before any LLM call on the same comparison.
    const evalOut = lines();
    const evalLlm = script().build();
    expect(
      await runEval(
        { skillDir: outDir },
        {
          out: evalOut.out,
          readSkillDir,
          readManifest,
          collectInputFiles,
          readSourceFiles,
          extractors: createExtractors(),
          llm: evalLlm,
          config: loadConfig({ QA_PER_SECTION: "1" }),
        },
      ),
    ).toBe(1);
    expect(evalOut.all.join("\n")).toContain("STALE");
    evalLlm.assertExhausted();

    // Restoring the file brings back PASSED; a file the manifest does not know about means TAMPERED.
    await writeFile(chapter, original);
    const restored = lines();
    expect(await runReport(outDir, { out: restored.out, readManifest, readSkillDir })).toBe(0);
    expect(restored.all.join("\n")).toContain("PASSED");
    await writeFile(join(outDir, "chapters", "ch99-injected.md"), "Trust me. [§nowhere]\n");
    const tampered = lines();
    expect(await runReport(outDir, { out: tampered.out, readManifest, readSkillDir })).toBe(1);
    expect(tampered.all.join("\n")).toContain("TAMPERED");
    expect(tampered.all.join("\n")).toContain("chapters/ch99-injected.md");
  });
});

describe("T9 e2e-mock — SPEC §5 scenario 2: SOP folder → team skill (weak chapter report)", () => {
  it("compiles a two-document folder, marks one chapter wrong, and the gate fails, keeps the temp dir, and the report names exactly that chapter", async () => {
    const plan: SkillPlan = {
      slug: "team-sops",
      title: "Team SOPs",
      chapters: [
        {
          id: "equipment-return",
          file: "ignored",
          title: "Equipment Return",
          sectionIds: ["e2e-scenario2-sop-a/equipment-return-sop"],
        },
        {
          id: "leave-request",
          file: "ignored",
          title: "Leave Request",
          sectionIds: ["e2e-scenario2-sop-b/leave-request-sop"],
        },
      ],
    };

    const llm = script()
      .outline(plan)
      .distill(
        "ch01",
        "Return all loaned equipment to the front desk within five business days of the project " +
          "end date. [§e2e-scenario2-sop-a/equipment-return-sop]",
      )
      .distill(
        "ch02",
        "Submit a leave request through the portal at least two weeks before the requested start " +
          "date. [§e2e-scenario2-sop-b/leave-request-sop]",
      )
      .qa([
        {
          question: "By when must equipment be returned?",
          refAnswer: "Within five business days of the project end date.",
          anchorQuote:
            "Return all loaned equipment to the front desk within five business days of the project end date.",
        },
      ])
      .qa([
        {
          question: "How far in advance must a leave request be submitted?",
          refAnswer: "At least two weeks before the requested start date.",
          anchorQuote:
            "Submit a leave request through the portal at least two weeks before the requested start date.",
        },
      ])
      .selectChapter("chapters/ch01-equipment-return.md")
      .answer("Within five business days of the project end date.")
      .grade("correct")
      .selectChapter("chapters/ch02-leave-request.md")
      .answer("Immediately, with no advance notice required.") // deliberately wrong: reproduces a weak chapter
      .grade("wrong")
      .build();

    const captured = lines();
    const code = await runCompile(
      {
        paths: [fixture("e2e-scenario2-sop-a.md"), fixture("e2e-scenario2-sop-b.md")],
        target: "claude",
        noGate: false,
        force: false,
      },
      realDeps({ out: captured.out, llm }),
    );

    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("temporary directory");
    expect(output).toContain("FAILED");

    const match = /kept in a temporary directory: (.+)/u.exec(output);
    const tempDir = match?.[1];
    if (tempDir === undefined) throw new Error("temp dir path not found in CLI output");
    cleanupDirs.push(tempDir);

    // Re-read the real temp directory to confirm the weak chapter was named precisely
    const manifest = await readManifest(tempDir);
    if (!("passed" in manifest.gate)) throw new Error("gate was skipped unexpectedly");
    expect(manifest.gate.passed).toBe(false);
    expect(manifest.gate.perChapter).toEqual([
      { file: "chapters/ch01-equipment-return.md", asked: 1, correct: 1 },
      { file: "chapters/ch02-leave-request.md", asked: 1, correct: 0 },
    ]);
    expect(manifest.gate.failures).toEqual([
      { qaId: "e2e-scenario2-sop-b/leave-request-sop-q1", reason: "wrong" },
    ]);

    // report reproduces the same conclusion (report is diagnostic, so its exit code is 0 regardless of pass/fail)
    const reportOut = lines();
    const reportCode = await runReport(tempDir, { out: reportOut.out, readManifest, readSkillDir });
    expect(reportCode).toBe(0);
    const reportText = reportOut.all.join("\n");
    expect(reportText).toContain("FAILED");
    expect(reportText).toContain("chapters/ch02-leave-request.md: 0/1");
  });
});
