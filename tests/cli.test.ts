// T8 완료 기준: TESTING §4 CLI 관련 항목(eval 재사용·report·종료코드) + "cli는 조립만"(fake deps 주입,
// 실제 fs/네트워크 없음). 패턴 출처: ../msg-agent/tests/cli.test.ts.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { createExtractors } from "../src/adapters/extractors/index.js";
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
    const deps: ReportDeps = { out: captured.out, readManifest: () => Promise.resolve(manifest) };
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
    await runReport("dir", { out: captured.out, readManifest: () => Promise.resolve(manifest) });
    const text = captured.all.join("\n");
    expect(text).toContain("FAILED");
    expect(text).toContain("미검증 섹션");
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
      gate: { skipped: true },
      goldenQa: [],
    };
    const deps: ReportDeps = { out: captured.out, readManifest: () => Promise.resolve(manifest) };
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
    };
    await runReport(undefined, deps);
    expect(seenDir).toBe(".");
  });

  it("returns 1 with a fix-it message when manifest.json is missing", async () => {
    const captured = lines();
    const deps: ReportDeps = {
      out: captured.out,
      readManifest: () => Promise.reject(new Error("ENOENT")),
    };
    expect(await runReport("dir", deps)).toBe(1);
    expect(captured.all.join("\n")).toContain("compile");
  });
});

describe("runEval — reuse path (완료 기준: eval이 manifest의 QA 재사용)", () => {
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
      readSourceFile: (p) => Promise.resolve({ path: p, bytes: new Uint8Array() }),
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
    llm.assertExhausted(); // qaGen 큐를 아예 안 건드렸다는 증거 — 대본에도 안 줬다
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
        readSourceFile: (p) =>
          Promise.resolve({ path: p, bytes: new TextEncoder().encode("a.md") }),
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

  it("returns 1 before any LLM call when the manifest names a chapter that is not on disk (B3)", async () => {
    const captured = lines();
    const llm = script().build(); // 대본 0개 — 호출되면 즉시 실패
    const code = await runEval(
      { skillDir: "dir" },
      baseDeps({
        out: captured.out,
        llm,
        readSkillDir: () => Promise.resolve([{ path: "SKILL.md", content: "# x" }]), // 챕터 파일이 없다
      }),
    );
    expect(code).toBe(1);
    expect(captured.all.join("\n")).toContain("chapters/ch01-a.md");
    llm.assertExhausted();
  });
});

describe("runCompile — exit codes + gate-fail temp dir (완료 기준)", () => {
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
      readSourceFile: (p) =>
        Promise.resolve({ path: p, bytes: new TextEncoder().encode("manual.md") }),
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
    expect(captured.all.join("\n")).toContain("컴파일 완료");
  });

  it("gate fails: writes to a fresh temp dir with the user's --force only, exit 1 (완료 기준: 임시 디렉터리 보존)", async () => {
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
    // A1: 임시 디렉터리는 mkdtemp가 새로 만든 빈 디렉터리라 force 특례가 사라졌다 — 사용자가 준 값(false)만 전달.
    expect(writes).toEqual([{ dir: "/tmp/live-skill-manual-abc123", force: false }]);
    expect(captured.all.join("\n")).toContain("임시 디렉터리");
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
    expect(writes).toEqual([]); // 경로를 못 정하면 아무것도 쓰지 않는다
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
    llm.assertExhausted(); // qaGen/answerer/grader 대본을 아예 안 줬는데도 안 부름 — 진짜로 스킵됐다는 증거
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

  it("returns 1 and never writes when the pipeline itself fails", async () => {
    const captured = lines();
    const writes: string[] = [];
    const code = await runCompile(
      { paths: ["sheet.xlsx"], target: "claude", noGate: true, force: false },
      baseDeps({
        out: captured.out,
        extractors: createExtractors(), // 진짜 라우팅 — .xlsx는 지원하지 않는다
        readSourceFile: (p) => Promise.resolve({ path: p, bytes: new Uint8Array() }),
        writeSkill: (dir) => {
          writes.push(dir);
          return Promise.resolve();
        },
      }),
    );
    expect(code).toBe(1);
    expect(writes).toEqual([]);
    expect(captured.all.join("\n")).toContain("컴파일 실패");
  });

  it("returns 1 with the adapter's message when writeSkill itself rejects (예: --force 없이 기존 디렉터리)", async () => {
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
