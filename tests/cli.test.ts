// T8 acceptance criteria: the CLI items of TESTING §4 (eval reuse, report, exit codes) plus "cli is
// assembly only" (fake deps injected, no real fs/network). Pattern source: ../msg-agent/tests/cli.test.ts.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { sha256Hex } from "../src/core/hash.js";
import { trackCost } from "../src/core/costTracker.js";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { FsTargetError } from "../src/adapters/fsTargets.js";
import { LlmProviderError } from "../src/core/llmError.js";
import { FixtureExtractor } from "../src/mocks/fixtureExtractor.js";
import { script } from "../src/mocks/scriptedLlm.js";
import { runCompile, type CompileDeps } from "../src/cli/compile.js";
import { runEval, type EvalDeps } from "../src/cli/eval.js";
import { runReport, type ReportDeps } from "../src/cli/report.js";
import { runValidate, type ValidateDeps } from "../src/cli/validate.js";
import type {
  AssembledFile,
  ExtractedDoc,
  GoldenQA,
  Manifest,
  SkillPlan,
} from "../src/core/index.js";

function lines(): { out: (l: string) => void; all: string[] } {
  const all: string[] = [];
  return { out: (l) => all.push(l), all };
}

const config = loadConfig({});

describe("runValidate", () => {
  const budgets = config.budgets;

  it("returns 0 and prints PASSED for a clean skill dir", async () => {
    const captured = lines();
    const deps: ValidateDeps = {
      out: captured.out,
      readSkillDir: () =>
        Promise.resolve([
          { path: "SKILL.md", content: "---\nname: a\ndescription: b\n---\n\n# A" },
        ]),
      budgets,
    };
    const code = await runValidate("dir", deps);
    expect(code).toBe(0);
    expect(captured.all.join("\n")).toContain("PASSED");
  });

  it("returns 1 and prints FAILED for a broken skill dir", async () => {
    const captured = lines();
    const deps: ValidateDeps = {
      out: captured.out,
      readSkillDir: () => Promise.resolve([{ path: "SKILL.md", content: "no frontmatter" }]),
      budgets,
    };
    expect(await runValidate("dir", deps)).toBe(1);
    expect(captured.all.join("\n")).toContain("FAILED");
  });

  it("returns 1 with an actionable message when the directory can't be read", async () => {
    const captured = lines();
    const deps: ValidateDeps = {
      out: captured.out,
      readSkillDir: () => Promise.reject(new Error("ENOENT")),
      budgets,
    };
    expect(await runValidate("missing", deps)).toBe(1);
    expect(captured.all.join("\n")).toContain("missing");
  });
});

describe("runReport", () => {
  it("prints a formatted GateReport and returns 0 regardless of pass/fail", async () => {
    const captured = lines();
    const manifest: Manifest = {
      version: 1,
      createdAt: "t",
      sourceFiles: [],
      sections: [],
      outputs: [],
      outputHashes: [],
      gate: {
        passRate: 0.5,
        threshold: 0.9,
        passed: false,
        perChapter: [],
        failures: [],
        loadHistory: [],
        coverage: [],
      },
      goldenQa: [],
    };
    const deps: ReportDeps = {
      out: captured.out,
      readManifest: () => Promise.resolve(manifest),
      readSkillDir: () => Promise.resolve([]),
    };
    expect(await runReport(undefined, deps)).toBe(0);
    expect(captured.all.join("\n")).toContain("FAILED");
  });

  it("lists unverified sections (qa_generation_failed) and shortfalls in the printed report (B2)", async () => {
    const captured = lines();
    const manifest: Manifest = {
      version: 1,
      createdAt: "t",
      sourceFiles: [],
      sections: [],
      outputs: [],
      outputHashes: [],
      gate: {
        passRate: 1,
        threshold: 0.9,
        passed: false,
        perChapter: [{ file: "chapters/ch01-a.md", asked: 1, correct: 1 }],
        failures: [{ qaId: "b-q0", reason: "qa_generation_failed" }],
        loadHistory: [],
        coverage: [
          { sectionId: "a", requested: 3, generated: 1 },
          { sectionId: "b", requested: 3, generated: 0 },
        ],
      },
      goldenQa: [],
    };
    await runReport("dir", {
      out: captured.out,
      readManifest: () => Promise.resolve(manifest),
      readSkillDir: () => Promise.resolve([]),
    });
    const text = captured.all.join("\n");
    expect(text).toContain("FAILED");
    expect(text).toContain("Unverified sections");
    expect(text).toContain("  - b");
    expect(text).toContain("a: 1/3");
    expect(text).toContain("b-q0: qa_generation_failed");
  });

  it("prints the skipped-gate message when the gate was skipped", async () => {
    const captured = lines();
    const manifest: Manifest = {
      version: 1,
      createdAt: "t",
      sourceFiles: [],
      sections: [],
      outputs: [],
      outputHashes: [],
      gate: { skipped: true },
      goldenQa: [],
    };
    const deps: ReportDeps = {
      out: captured.out,
      readManifest: () => Promise.resolve(manifest),
      readSkillDir: () => Promise.resolve([]),
    };
    expect(await runReport("some/dir", deps)).toBe(0);
    expect(captured.all.join("\n")).toContain("SKIPPED");
  });

  it("defaults skillDir to '.' when omitted", async () => {
    let seenDir: string | undefined;
    const deps: ReportDeps = {
      out: () => undefined,
      readManifest: (dir) => {
        seenDir = dir;
        return Promise.reject(new Error("no manifest"));
      },
      readSkillDir: () => Promise.resolve([]),
    };
    await runReport(undefined, deps);
    expect(seenDir).toBe(".");
  });

  it("returns 1 with a fix-it message when manifest.json is missing", async () => {
    const captured = lines();
    const deps: ReportDeps = {
      out: captured.out,
      readManifest: () => Promise.reject(new Error("ENOENT")),
      readSkillDir: () => Promise.resolve([]),
    };
    expect(await runReport("dir", deps)).toBe(1);
    expect(captured.all.join("\n")).toContain("compile");
  });
});

describe("runEval — reuse path (acceptance criterion: eval reuses the manifest's QA)", () => {
  const chapterFile: AssembledFile = {
    path: "chapters/ch01-a.md",
    content: "Mount the unit. [§a]",
    estimatedTokens: 5,
  };
  const goldenQa: GoldenQA[] = [
    {
      id: "a-q1",
      sectionId: "a",
      question: "Where?",
      refAnswer: "on the unit",
      anchorQuote: "Mount the unit",
    },
  ];
  const manifest: Manifest = {
    version: 1,
    createdAt: "t",
    sourceFiles: [],
    sections: [{ id: "a", sha256: "x".repeat(64), chapterFile: chapterFile.path }],
    outputs: [chapterFile.path],
    outputHashes: [{ path: chapterFile.path, sha256: sha256Hex(chapterFile.content) }],
    gate: {
      passRate: 1,
      threshold: 0.9,
      passed: true,
      perChapter: [],
      failures: [],
      loadHistory: [],
      coverage: [],
    },
    goldenQa,
  };

  function baseDeps(overrides: Partial<EvalDeps> = {}): EvalDeps {
    return {
      out: () => undefined,
      readSkillDir: () => Promise.resolve([chapterFile]),
      readManifest: () => Promise.resolve(manifest),
      collectInputFiles: () => Promise.resolve([]),
      readSourceFiles: (paths) =>
        Promise.resolve(paths.map((p) => ({ path: p, bytes: new Uint8Array() }))),
      extractors: [],
      llm: script().build(),
      config,
      ...overrides,
    };
  }

  it("without --source, grades manifest.goldenQa without ever calling qaGen", async () => {
    const captured = lines();
    const llm = script()
      .selectChapter(chapterFile.path)
      .answer("on the unit")
      .grade("correct")
      .build();
    const code = await runEval({ skillDir: "dir" }, baseDeps({ out: captured.out, llm }));
    expect(code).toBe(0);
    expect(captured.all.join("\n")).toContain("PASSED");
    llm.assertExhausted(); // proof the qaGen queue was never touched: the script never had one
  });

  it("a provider failure while re-grading ends with a human message and the calls made so far (G1)", async () => {
    const captured = lines();
    const llm = script()
      .selectChapter(chapterFile.path)
      .fail("answerer", new LlmProviderError("network", true, "ECONNRESET"))
      .build();
    const code = await runEval({ skillDir: "dir" }, baseDeps({ out: captured.out, llm }));
    expect(code).toBe(1);
    const text = captured.all.join("\n");
    expect(text).toContain(
      "Re-grading aborted. LLM call failed during re-grading: network error (network, retryable)",
    );
    expect(text).toContain("2 LLM calls"); // 1 chapter selection + 1 failed answer
    expect(text).toContain("Provider message: ECONNRESET");
    llm.assertExhausted();
  });

  it("with --source, re-extracts and runs qaGen fresh", async () => {
    const doc: ExtractedDoc = {
      sections: [{ id: "a", heading: "A", level: 1, text: "Mount the unit." }],
    };
    const extractor = new FixtureExtractor({ md: doc });
    const llm = script()
      .qa([{ question: "Where?", refAnswer: "on the unit", anchorQuote: "Mount the unit" }])
      .selectChapter(chapterFile.path)
      .answer("on the unit")
      .grade("correct")
      .build();
    const code = await runEval(
      { skillDir: "dir", source: ["a.md"] },
      baseDeps({
        llm,
        extractors: [extractor],
        collectInputFiles: () => Promise.resolve(["a.md"]),
        readSourceFiles: (paths) =>
          Promise.resolve(paths.map((p) => ({ path: p, bytes: new TextEncoder().encode("a.md") }))),
        config: loadConfig({ QA_PER_SECTION: "1" }),
      }),
    );
    expect(code).toBe(0);
    llm.assertExhausted();
  });

  it("returns 1 with an actionable message when the skill dir can't be read", async () => {
    const captured = lines();
    const code = await runEval(
      { skillDir: "missing" },
      baseDeps({ out: captured.out, readManifest: () => Promise.reject(new Error("ENOENT")) }),
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("missing");
  });

  it("refuses before any LLM call when the reuse path would exceed MAX_LLM_CALLS (D2 preflight)", async () => {
    const captured = lines();
    const llm = script().build(); // empty script
    const code = await runEval(
      { skillDir: "dir" },
      baseDeps({ out: captured.out, llm, config: loadConfig({ MAX_LLM_CALLS: "2" }) }), // 1 question × 3 = 3 > 2
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("MAX_LLM_CALLS limit of 2");
    llm.assertExhausted();
  });

  it("stops mid-run when the cap trips during grading and reports it instead of crashing (D2 runtime)", async () => {
    const captured = lines();
    const inner = script()
      .selectChapter(chapterFile.path)
      .answer("on the unit") // no script for the 3rd call (grade); the cap must stop it
      .build();
    // The config cap (300) passes, but the injected provider itself blocks at 2 calls, so the
    // runtime cap-handling path is exercised.
    const capped = trackCost(inner, { maxCalls: 2 });
    const code = await runEval(
      { skillDir: "dir" },
      baseDeps({ out: captured.out, llm: capped.llm }),
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("Re-grading aborted");
    expect(inner.calls).toHaveLength(2);
    inner.assertExhausted();
  });

  it("prints the measured LLM call count after a successful re-grade (D2)", async () => {
    const captured = lines();
    const llm = script()
      .selectChapter(chapterFile.path)
      .answer("on the unit")
      .grade("correct")
      .build();
    await runEval({ skillDir: "dir" }, baseDeps({ out: captured.out, llm }));
    expect(captured.all.join("\n")).toContain("LLM calls: 3");
  });

  // F3 (001-008, acceptance criterion): multi-source skill. eval must apply the same prefix compile
  // did (`a-readme/overview`) or no questions are generated.
  it("with --source, a skill compiled from two same-named files in different folders generates QA and passes", async () => {
    const text = "Overview text.";
    const chapters: AssembledFile[] = [
      { path: "chapters/ch01-a.md", content: `${text} [§a-readme/overview]`, estimatedTokens: 5 },
      { path: "chapters/ch02-b.md", content: `${text} [§b-readme/overview]`, estimatedTokens: 5 },
    ];
    const multi: Manifest = {
      ...manifest,
      sections: [
        { id: "a-readme/overview", sha256: sha256Hex(text), chapterFile: "chapters/ch01-a.md" },
        { id: "b-readme/overview", sha256: sha256Hex(text), chapterFile: "chapters/ch02-b.md" },
      ],
      outputs: chapters.map((c) => c.path),
      outputHashes: chapters.map((c) => ({ path: c.path, sha256: sha256Hex(c.content) })),
      goldenQa: [],
    };
    const doc: ExtractedDoc = {
      sections: [{ id: "overview", heading: "Overview", level: 1, text }],
    };
    const captured = lines();
    const llm = script()
      .qa([{ question: "A?", refAnswer: "Overview text.", anchorQuote: text }])
      .qa([{ question: "B?", refAnswer: "Overview text.", anchorQuote: text }])
      .selectChapter("chapters/ch01-a.md")
      .answer("Overview text.")
      .grade("correct")
      .selectChapter("chapters/ch02-b.md")
      .answer("Overview text.")
      .grade("correct")
      .build();
    const code = await runEval(
      { skillDir: "dir", source: ["/root/docs"] },
      baseDeps({
        out: captured.out,
        llm,
        readManifest: () => Promise.resolve(multi),
        readSkillDir: () => Promise.resolve(chapters),
        extractors: [new FixtureExtractor({ md: doc })],
        collectInputFiles: () =>
          Promise.resolve(["/root/docs/a/readme.md", "/root/docs/b/readme.md"]),
        readSourceFiles: (paths) =>
          Promise.resolve(
            paths.map((p) => ({ path: p, bytes: new TextEncoder().encode("readme.md") })),
          ),
        config: loadConfig({ QA_PER_SECTION: "1" }),
      }),
    );
    expect(code).toBe(0);
    expect(captured.all.join("\n")).toContain("PASSED");
    llm.assertExhausted(); // qaGen 2 + (select + answer + grade) × 2: both sections got questions
  });

  it("with --source, sources that do not match the manifest's sections fail explicitly before any LLM call (F3)", async () => {
    const captured = lines();
    const llm = script().build();
    const doc: ExtractedDoc = {
      sections: [{ id: "other", heading: "Other", level: 1, text: "Other text." }],
    };
    const code = await runEval(
      { skillDir: "dir", source: ["other.md"] },
      baseDeps({
        out: captured.out,
        llm,
        extractors: [new FixtureExtractor({ md: doc })],
        collectInputFiles: () => Promise.resolve(["other.md"]),
        readSourceFiles: (paths) =>
          Promise.resolve(
            paths.map((p) => ({ path: p, bytes: new TextEncoder().encode("other.md") })),
          ),
        config: loadConfig({ QA_PER_SECTION: "1" }),
      }),
    );
    expect(code).toBe(1);
    const text = captured.all.join("\n");
    expect(text).toContain("do not match");
    expect(text).toContain("1 section(s) in manifest but not in source: a");
    expect(text).toContain("1 section(s) in source but not in manifest: other");
    expect(text).toContain("Fix:");
    llm.assertExhausted();
  });

  it("with --source, a section whose body changed since compile is reported but still re-graded (F3)", async () => {
    const captured = lines();
    const doc: ExtractedDoc = {
      sections: [{ id: "a", heading: "A", level: 1, text: "Mount the unit." }], // differs from the manifest hash ("x"×64)
    };
    const llm = script()
      .qa([{ question: "Where?", refAnswer: "on the unit", anchorQuote: "Mount the unit" }])
      .selectChapter(chapterFile.path)
      .answer("on the unit")
      .grade("correct")
      .build();
    const code = await runEval(
      { skillDir: "dir", source: ["a.md"] },
      baseDeps({
        out: captured.out,
        llm,
        extractors: [new FixtureExtractor({ md: doc })],
        collectInputFiles: () => Promise.resolve(["a.md"]),
        readSourceFiles: (paths) =>
          Promise.resolve(paths.map((p) => ({ path: p, bytes: new TextEncoder().encode("a.md") }))),
        config: loadConfig({ QA_PER_SECTION: "1" }),
      }),
    );
    expect(code).toBe(0);
    expect(captured.all.join("\n")).toContain("1 section(s) changed since compile (a)");
    llm.assertExhausted();
  });

  it("with --source, refuses before any LLM call when the gate estimate exceeds MAX_LLM_CALLS (D2 preflight)", async () => {
    const captured = lines();
    const doc: ExtractedDoc = {
      sections: [{ id: "a", heading: "A", level: 1, text: "Mount the unit." }],
    };
    const llm = script().build();
    const code = await runEval(
      { skillDir: "dir", source: ["a.md"] },
      baseDeps({
        out: captured.out,
        llm,
        extractors: [new FixtureExtractor({ md: doc })],
        collectInputFiles: () => Promise.resolve(["a.md"]),
        readSourceFiles: (paths) =>
          Promise.resolve(paths.map((p) => ({ path: p, bytes: new TextEncoder().encode("a.md") }))),
        config: loadConfig({ QA_PER_SECTION: "1", MAX_LLM_CALLS: "4" }), // 1 section: 2 + 3 = 5 > 4
      }),
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("MAX_LLM_CALLS limit of 4");
    llm.assertExhausted();
  });

  it("with --source, refuses oversized input before reading or calling the LLM (D3)", async () => {
    const captured = lines();
    const reads: string[] = [];
    const llm = script().build();
    const code = await runEval(
      { skillDir: "dir", source: ["big.pdf"] },
      baseDeps({
        out: captured.out,
        llm,
        collectInputFiles: () =>
          Promise.reject(
            new FsTargetError(
              "file_too_large",
              'refusing "big.pdf" — it is 30 MiB, over the per-file limit of 25 MiB. Fix: remove it from the input, or split it into smaller documents.',
            ),
          ),
        readSourceFiles: (paths) => {
          reads.push(...paths);
          return Promise.resolve([]);
        },
      }),
    );
    expect(code).toBe(1);
    expect(reads).toEqual([]);
    const text = captured.all.join("\n");
    expect(text).toContain("--source: Input rejected");
    expect(text).toContain("25 MiB");
    llm.assertExhausted();
  });

  it("returns 1 before any LLM call when the manifest names a chapter that is not on disk (B3 → E3 STALE)", async () => {
    const captured = lines();
    const llm = script().build(); // empty script: any call fails immediately
    const code = await runEval(
      { skillDir: "dir" },
      baseDeps({
        out: captured.out,
        llm,
        readSkillDir: () => Promise.resolve([]), // the chapter file is absent
      }),
    );
    expect(code).toBe(1);
    const text = captured.all.join("\n");
    expect(text).toContain("STALE");
    expect(text).toContain("chapters/ch01-a.md");
    expect(text).toContain("The LLM was not called");
    llm.assertExhausted();
  });

  it("refuses to re-grade files that no longer match the manifest hashes (E3 STALE), before any LLM call", async () => {
    const captured = lines();
    const llm = script().build();
    const code = await runEval(
      { skillDir: "dir" },
      baseDeps({
        out: captured.out,
        llm,
        readSkillDir: () =>
          Promise.resolve([{ ...chapterFile, content: "Mount the unit on the wall. [§a]" }]),
      }),
    );
    expect(code).toBe(1);
    const text = captured.all.join("\n");
    expect(text).toContain("STALE");
    expect(text).toContain("Modified files");
    expect(text).toContain("compile --force");
    llm.assertExhausted();
  });
});

describe("runCompile — exit codes + gate-fail temp dir (acceptance criteria)", () => {
  const doc: ExtractedDoc = {
    sections: [{ id: "a", heading: "A", level: 1, text: "Mount the unit on a flat surface." }],
  };
  const plan: SkillPlan = {
    slug: "manual",
    title: "Manual",
    chapters: [{ id: "a", file: "ignored", title: "A", sectionIds: ["a"] }],
  };
  const clock = { now: () => new Date("2026-09-06T00:00:00.000Z") };

  function baseDeps(overrides: Partial<CompileDeps> = {}): CompileDeps {
    return {
      out: () => undefined,
      collectInputFiles: (paths) => Promise.resolve([...paths]),
      readSourceFiles: (paths) =>
        Promise.resolve(
          paths.map((p) => ({ path: p, bytes: new TextEncoder().encode("manual.md") })),
        ),
      extractors: [new FixtureExtractor({ md: doc })],
      llm: script().build(),
      clock,
      config: loadConfig({ QA_PER_SECTION: "1" }),
      resolveTargetDir: (target, slug) => `/target/${target}/${slug}`,
      tempSkillDir: (slug) => Promise.resolve(`/tmp/live-skill-${slug}-abc123`),
      writeSkill: () => Promise.resolve(),
      ...overrides,
    };
  }

  it("gate passes: writes to the resolved target dir, exit 0", async () => {
    const captured = lines();
    const writes: { dir: string; force: boolean | undefined }[] = [];
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .qa([{ question: "Where?", refAnswer: "on a flat surface", anchorQuote: "flat surface" }])
      .selectChapter("chapters/ch01-a.md")
      .answer("On a flat surface.")
      .grade("correct")
      .build();
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: false, force: false },
      baseDeps({
        out: captured.out,
        llm,
        writeSkill: (dir, _f, _m, opts) => {
          writes.push({ dir, force: opts.force });
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(0);
    expect(writes).toEqual([{ dir: "/target/claude/manual", force: false }]);
    expect(captured.all.join("\n")).toContain("Compiled:");
  });

  it("gate fails: writes to a fresh temp dir with the user's --force only, exit 1 (acceptance criterion: temp dir is kept)", async () => {
    const captured = lines();
    const writes: { dir: string; force: boolean | undefined }[] = [];
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .qa([{ question: "Where?", refAnswer: "on a flat surface", anchorQuote: "flat surface" }])
      .selectChapter("chapters/ch01-a.md")
      .answer("Somewhere else.")
      .grade("wrong")
      .build();
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: false, force: false },
      baseDeps({
        out: captured.out,
        llm,
        writeSkill: (dir, _f, _m, opts) => {
          writes.push({ dir, force: opts.force });
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    // A1: the temp dir is a fresh empty mkdtemp directory, so the force special case is gone; only
    // the user's value (false) is passed through.
    expect(writes).toEqual([{ dir: "/tmp/live-skill-manual-abc123", force: false }]);
    expect(captured.all.join("\n")).toContain("temporary directory");
  });

  it("returns 1 with the adapter's message when target-dir resolution rejects the slug (A1)", async () => {
    const captured = lines();
    const writes: string[] = [];
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .build();
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        llm,
        resolveTargetDir: () => {
          throw new Error("refusing slug — unsafe");
        },
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    expect(writes).toEqual([]); // nothing is written when the path cannot be resolved
    expect(captured.all.join("\n")).toContain("unsafe");
  });

  it("--no-gate skips the gate entirely: manifest.gate skipped, writes with the given --force", async () => {
    const writes: { dir: string; force: boolean | undefined }[] = [];
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .build();
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: true, force: true },
      baseDeps({
        llm,
        writeSkill: (dir, _f, _m, opts) => {
          writes.push({ dir, force: opts.force });
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(0);
    expect(writes).toEqual([{ dir: "/target/claude/manual", force: true }]);
    llm.assertExhausted(); // no qaGen/answerer/grader script was given and none was called: proof it was really skipped
  });

  it("--out overrides target-dir resolution", async () => {
    const writes: string[] = [];
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .build();
    await runCompile(
      { paths: ["manual.md"], out: "/custom/out", target: "claude", noGate: true, force: false },
      baseDeps({
        llm,
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(writes).toEqual(["/custom/out"]);
  });

  it("returns 1 and never writes when no input files are found", async () => {
    const captured = lines();
    const writes: string[] = [];
    const code = await runCompile(
      { paths: ["empty-dir"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        collectInputFiles: () => Promise.resolve([]),
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    expect(writes).toEqual([]);
    expect(captured.all.join("\n")).toContain("empty-dir");
  });

  it("a structurally invalid assembly is not deployed: exit 1, no write, no gate call, report printed (E1)", async () => {
    const captured = lines();
    const writes: string[] = [];
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .build(); // no gate script: any gate call fails
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: false, force: false },
      baseDeps({
        out: captured.out,
        llm,
        config: {
          ...loadConfig({ QA_PER_SECTION: "1" }),
          budgets: { ...config.budgets, chapter: 5 },
        },
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    expect(writes).toEqual([]);
    const text = captured.all.join("\n");
    expect(text).toContain("Compile failed");
    expect(text).toContain("Validation: FAILED");
    expect(text).toContain("[ERROR] chapters/ch01-a.md (budget_exceeded)");
    llm.assertExhausted();
  });

  it("prints validation warnings after a successful compile, without blocking it (E1)", async () => {
    const captured = lines();
    const writes: string[] = [];
    const llm = script().outline(plan).distill("a", "Mount the unit on a flat surface.").build(); // no anchor
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        llm,
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(0);
    expect(writes).toEqual(["/target/claude/manual"]);
    const text = captured.all.join("\n");
    expect(text).toContain("Validation: PASSED");
    expect(text).toContain("[WARNING] chapters/ch01-a.md (low_anchor_ratio)");
  });

  // G1 (001-017·AUD-015, acceptance criterion): a provider failure shows the stage, kind,
  // retryability, call count, and fix, not a stack trace.
  it("a rate_limit thrown mid-run ends with a human message, the calls made so far, exit 1 and no write (G1)", async () => {
    const captured = lines();
    const writes: string[] = [];
    const llm = script()
      .outline(plan)
      .fail(
        "distill",
        new LlmProviderError(
          "rate_limit",
          true,
          "429 Too Many Requests sk-ant-api03-SECRETSECRETSECRET",
        ),
      )
      .build();
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: false, force: false },
      baseDeps({
        out: captured.out,
        llm,
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    expect(writes).toEqual([]);
    const text = captured.all.join("\n");
    expect(text).toContain(
      "Compile failed. LLM call failed during distillation: rate limit exceeded (rate_limit, retryable)",
    );
    expect(text).toContain("2 LLM calls");
    expect(text).toContain("Fix: retry the same command in a moment.");
    expect(text).toContain("Provider message: 429 Too Many Requests sk-***");
    expect(text).not.toContain("SECRET");
    expect(text.replace(/\n/gu, "")).not.toMatch(/\p{Cc}/u); // no control characters other than newlines
    llm.assertExhausted();
  });

  it("refuses oversized input before reading a single file, with the adapter's fix message (D3)", async () => {
    const captured = lines();
    const reads: string[] = [];
    const llm = script().build(); // empty script: reaching the LLM fails
    const code = await runCompile(
      { paths: ["huge-folder"], target: "claude", noGate: false, force: false },
      baseDeps({
        out: captured.out,
        llm,
        collectInputFiles: () =>
          Promise.reject(
            new FsTargetError(
              "too_many_files",
              "refusing the input — it has more than 500 files (stopped counting at 501). Fix: point at a smaller folder, or split the documents into several skills.",
            ),
          ),
        readSourceFiles: (paths) => {
          reads.push(...paths);
          return Promise.resolve([]);
        },
      }),
    );
    expect(code).toBe(1);
    expect(reads).toEqual([]); // rejected before reading
    const text = captured.all.join("\n");
    expect(text).toContain("Input rejected");
    expect(text).toContain("more than 500 files");
    expect(text).toContain("Fix:");
    llm.assertExhausted();
  });

  it("keeps the path-check hint for plain read errors such as ENOENT", async () => {
    const captured = lines();
    const code = await runCompile(
      { paths: ["missing.md"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        collectInputFiles: () =>
          Promise.reject(new Error("ENOENT: no such file, lstat 'missing.md'")),
      }),
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("check the path");
    expect(captured.all.join("\n")).toContain("ENOENT");
  });

  it("returns 1 and never writes when the pipeline itself fails", async () => {
    const captured = lines();
    const writes: string[] = [];
    const code = await runCompile(
      { paths: ["sheet.xlsx"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        extractors: createExtractors(), // real routing: .xlsx is not supported
        readSourceFiles: (paths) =>
          Promise.resolve(paths.map((p) => ({ path: p, bytes: new Uint8Array() }))),
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    expect(writes).toEqual([]);
    expect(captured.all.join("\n")).toContain("Compile failed");
  });

  it("returns 1 with the adapter's message when writeSkill itself rejects (e.g. an existing directory without --force)", async () => {
    const captured = lines();
    const llm = script()
      .outline(plan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .build();
    const code = await runCompile(
      { paths: ["manual.md"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        llm,
        writeSkill: () => Promise.reject(new Error("already exists, pass --force")),
      }),
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("--force");
  });
});
