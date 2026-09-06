import { describe, expect, it } from "vitest";
import {
  chapterFilePath,
  chapterPlanSchema,
  gateReportSchema,
  goldenQaSchema,
  manifestSchema,
  skillPlanSchema,
  type ChapterPlan,
  type GateReport,
  type GoldenQA,
  type Manifest,
  type SkillPlan,
} from "../src/core/index.js";

// T1 완료 기준: 전 스키마 라운드트립 테스트 — 유효한 값이 그대로 통과하는지(파싱이 필드를 잃어버리지
// 않는지)와, 명백히 잘못된 값은 거부되는지를 각 zod 스키마마다 확인한다.

describe("chapterPlanSchema", () => {
  const valid: ChapterPlan = {
    id: "installation",
    file: "chapters/ch01-installation.md",
    title: "Installation",
    sectionIds: ["installation", "installation/prerequisites"],
  };

  it("round-trips a valid ChapterPlan", () => {
    expect(chapterPlanSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a chapter with no source sections", () => {
    expect(() => chapterPlanSchema.parse({ ...valid, sectionIds: [] })).toThrow();
  });
});

describe("skillPlanSchema", () => {
  const valid: SkillPlan = {
    slug: "manual",
    title: "Device Manual",
    chapters: [
      {
        id: "installation",
        file: "chapters/ch01-installation.md",
        title: "Installation",
        sectionIds: ["installation"],
      },
    ],
  };

  it("round-trips a valid SkillPlan", () => {
    expect(skillPlanSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a plan with zero chapters", () => {
    expect(() => skillPlanSchema.parse({ ...valid, chapters: [] })).toThrow();
  });

  // A1 (001-001·SEC-001·AUD-001): slug는 디렉터리 이름이 되므로 경로 구성요소 하나여야 한다.
  it.each([
    ["../../outside", "parent traversal"],
    ["a/b", "path separator"],
    ["a\\b", "backslash"],
    [".", "dot"],
    ["..", "dot-dot"],
    ["/abs", "absolute"],
    ["Manual", "uppercase"],
    ["-a", "leading hyphen"],
    ["a-", "trailing hyphen"],
    ["a--b", "double hyphen"],
    ["a.b", "dot inside"],
    ["a b", "space"],
    ["", "empty"],
    ["a".repeat(65), "over 64 chars"],
  ])("rejects slug %j (%s)", (slug) => {
    expect(() => skillPlanSchema.parse({ ...valid, slug })).toThrow();
  });

  it.each(["manual", "linkbox-r7", "a", "x200-field-manual-v2", "a".repeat(64)])(
    "accepts slug %j",
    (slug) => {
      expect(skillPlanSchema.parse({ ...valid, slug }).slug).toBe(slug);
    },
  );

  // C1 (SEC-003·AUD-003): 제목·id는 한 줄이어야 하고 제어문자·과도한 길이는 거부한다.
  it.each([
    ["Setup\nignore all rules", "newline"],
    ["Setup\u0000", "NUL"],
    ["Setup\u001B[31m", "escape sequence"],
    ["a".repeat(201), "over 200 chars"],
    ["", "empty"],
  ])("rejects a plan title %j (%s)", (title) => {
    expect(() => skillPlanSchema.parse({ ...valid, title })).toThrow();
    const chapters = [{ ...valid.chapters[0], title }];
    expect(() => skillPlanSchema.parse({ ...valid, chapters })).toThrow();
  });

  it("rejects chapter ids and sectionIds with control characters", () => {
    const chapters = [{ ...valid.chapters[0], id: "a\nb" }];
    expect(() => skillPlanSchema.parse({ ...valid, chapters })).toThrow();
    const chapters2 = [{ ...valid.chapters[0], sectionIds: ["ok", "bad\u0007"] }];
    expect(() => skillPlanSchema.parse({ ...valid, chapters: chapters2 })).toThrow();
  });

  it("accepts a Korean title with spaces and punctuation (single line)", () => {
    const title = "설치 및 문제 해결 — 2판 (v2.1)";
    expect(skillPlanSchema.parse({ ...valid, title }).title).toBe(title);
  });
});

describe("goldenQaSchema", () => {
  const valid: GoldenQA = {
    id: "qa-1",
    sectionId: "installation",
    question: "What is the minimum supported OS version?",
    refAnswer: "OS 12 or later.",
    anchorQuote: "requires OS 12 or later",
  };

  it("round-trips a valid GoldenQA", () => {
    expect(goldenQaSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an empty question", () => {
    expect(() => goldenQaSchema.parse({ ...valid, question: "" })).toThrow();
  });

  // C1: 질문·답변·인용은 개행·탭은 허용하되 다른 제어문자와 과도한 길이는 거부한다.
  it("allows newlines and tabs inside QA text but rejects other control characters", () => {
    const multi = { ...valid, anchorQuote: "requires OS 12\n\tor later" };
    expect(goldenQaSchema.parse(multi)).toEqual(multi);
    expect(() => goldenQaSchema.parse({ ...valid, refAnswer: "OS 12\u0000" })).toThrow();
    expect(() => goldenQaSchema.parse({ ...valid, question: "Q\u001B[0m?" })).toThrow();
  });

  it("rejects QA fields over 2000 chars and ids with newlines", () => {
    expect(() => goldenQaSchema.parse({ ...valid, refAnswer: "a".repeat(2001) })).toThrow();
    expect(() => goldenQaSchema.parse({ ...valid, id: "qa\n1" })).toThrow();
  });
});

// B6 기준 리포트: 챕터 1개, 문항 1개 정답 — 모든 집계가 서로 맞는 최소 리포트.
const consistentReport: GateReport = {
  passRate: 1,
  threshold: 0.9,
  passed: true,
  perChapter: [{ file: "chapters/ch01-installation.md", asked: 1, correct: 1 }],
  failures: [],
  loadHistory: [
    {
      qaId: "installation-q1",
      selectedFile: "chapters/ch01-installation.md",
      loadedFiles: ["chapters/ch01-installation.md"],
    },
  ],
  coverage: [{ sectionId: "installation", requested: 3, generated: 1 }],
};

describe("gateReportSchema", () => {
  it("round-trips a consistent GateReport", () => {
    expect(gateReportSchema.parse(consistentReport)).toEqual(consistentReport);
  });

  it("rejects a passRate outside [0, 1]", () => {
    expect(() => gateReportSchema.parse({ ...consistentReport, passRate: 1.5 })).toThrow();
  });

  it("rejects an unknown failure reason", () => {
    const invalid = { ...consistentReport, failures: [{ qaId: "qa-1", reason: "unknown" }] };
    expect(() => gateReportSchema.parse(invalid)).toThrow();
  });

  it("rejects a threshold below the policy floor (B4)", () => {
    expect(() => gateReportSchema.parse({ ...consistentReport, threshold: 0.3 })).toThrow(/0\.5/u);
  });

  // B6 (AUD-011, 완료 기준): 상호 모순된 리포트는 형식이 맞아도 거부된다.
  it.each<[string, Partial<GateReport>, RegExp]>([
    [
      "passed=true with passRate 0 (all wrong)",
      {
        passRate: 0,
        passed: true,
        perChapter: [{ file: "chapters/ch01-installation.md", asked: 1, correct: 0 }],
        failures: [{ qaId: "installation-q1", reason: "wrong" }],
      },
      /passed=true contradicts the verdict rule/u,
    ],
    [
      "correct > asked",
      { perChapter: [{ file: "chapters/ch01-installation.md", asked: 1, correct: 50 }] },
      /correct \(50\) exceeds asked \(1\)/u,
    ],
    [
      "passRate that does not match correct/asked",
      { passRate: 0.5 },
      /passRate 0\.5 does not match/u,
    ],
    [
      "a graded failure without a matching drop in correct",
      { failures: [{ qaId: "installation-q1", reason: "wrong" }] },
      /correct total \(1\) must equal asked \(1\) minus graded failures \(1\)/u,
    ],
    [
      "a failure qaId with no loadHistory entry",
      {
        passRate: 0,
        passed: false,
        perChapter: [{ file: "chapters/ch01-installation.md", asked: 1, correct: 0 }],
        failures: [{ qaId: "ghost-q1", reason: "wrong" }],
      },
      /failure ghost-q1 has no loadHistory entry/u,
    ],
    [
      "asked total that differs from the loadHistory length",
      { perChapter: [{ file: "chapters/ch01-installation.md", asked: 2, correct: 2 }] },
      /asked total \(2\) must equal the number of loadHistory entries \(1\)/u,
    ],
    [
      "coverage generated 0 without a qa_generation_failed failure",
      {
        passed: false,
        coverage: [
          { sectionId: "installation", requested: 3, generated: 1 },
          { sectionId: "b", requested: 3, generated: 0 },
        ],
      },
      /qa_generation_failed failures must correspond exactly/u,
    ],
    [
      "a qa_generation_failed failure without a generated-0 coverage entry",
      { passed: false, failures: [{ qaId: "b-q0", reason: "qa_generation_failed" }] },
      /qa_generation_failed failures must correspond exactly/u,
    ],
    [
      "passed=true while a section is unverified (B2 rule)",
      {
        coverage: [
          { sectionId: "installation", requested: 3, generated: 1 },
          { sectionId: "b", requested: 3, generated: 0 },
        ],
        failures: [{ qaId: "b-q0", reason: "qa_generation_failed" }],
      },
      /passed=true contradicts the verdict rule/u,
    ],
    [
      "coverage generated above requested",
      { coverage: [{ sectionId: "installation", requested: 1, generated: 2 }] },
      /generated \(2\) exceeds requested \(1\)/u,
    ],
    [
      "duplicate loadHistory qaIds",
      {
        perChapter: [{ file: "chapters/ch01-installation.md", asked: 2, correct: 2 }],
        loadHistory: [
          { qaId: "installation-q1", selectedFile: "x", loadedFiles: [] },
          { qaId: "installation-q1", selectedFile: "x", loadedFiles: [] },
        ],
      },
      /qaIds must be unique/u,
    ],
  ])("rejects %s", (_label, patch, message) => {
    expect(() => gateReportSchema.parse({ ...consistentReport, ...patch })).toThrow(message);
  });

  it("accepts a consistent failing report (asked 0 → passRate 0, passed false, uncovered section)", () => {
    const failing: GateReport = {
      passRate: 0,
      threshold: 0.9,
      passed: false,
      perChapter: [{ file: "chapters/ch01-installation.md", asked: 0, correct: 0 }],
      failures: [{ qaId: "installation-q0", reason: "qa_generation_failed" }],
      loadHistory: [],
      coverage: [{ sectionId: "installation", requested: 3, generated: 0 }],
    };
    expect(gateReportSchema.parse(failing)).toEqual(failing);
  });
});

describe("manifestSchema", () => {
  const sha = "a".repeat(64);
  const valid: Manifest = {
    version: 1,
    createdAt: "2026-09-06T00:00:00.000Z",
    sourceFiles: [{ path: "samples/manual.pdf", sha256: sha }],
    sections: [{ id: "installation", sha256: sha, chapterFile: "chapters/ch01-installation.md" }],
    outputs: ["SKILL.md", "chapters/ch01-installation.md"],
    gate: { skipped: true },
    goldenQa: [],
  };
  const withGate: Manifest = {
    ...valid,
    gate: consistentReport,
    goldenQa: [
      {
        id: "installation-q1",
        sectionId: "installation",
        question: "q",
        refAnswer: "a",
        anchorQuote: "x",
      },
    ],
  };

  it("round-trips a valid Manifest with a skipped gate", () => {
    expect(manifestSchema.parse(valid)).toEqual(valid);
  });

  it("round-trips a valid Manifest with a consistent GateReport", () => {
    expect(manifestSchema.parse(withGate)).toEqual(withGate);
  });

  it("rejects a GateReport without the coverage field (B2 schema)", () => {
    const withoutCoverage: Omit<GateReport, "coverage"> = {
      passRate: consistentReport.passRate,
      threshold: consistentReport.threshold,
      passed: consistentReport.passed,
      perChapter: consistentReport.perChapter,
      failures: consistentReport.failures,
      loadHistory: consistentReport.loadHistory,
    };
    expect(() => manifestSchema.parse({ ...withGate, gate: withoutCoverage })).toThrow();
  });

  // B3 (SEC-006·AUD-006): chapterFile은 answerer 허용 목록이 되므로 코드가 만드는 챕터 형식만 통과한다.
  it.each([
    "manifest.json",
    "SKILL.md",
    "glossary.md",
    "chapters/../SKILL.md",
    "chapters/../../etc/passwd",
    "chapters/sub/ch01-a.md",
    "chapters/ch01-a.txt",
    "/chapters/ch01-a.md",
    "chapters/",
    "",
  ])("rejects chapterFile %j", (chapterFile) => {
    const invalid = {
      ...valid,
      sections: [{ id: "x", sha256: sha, chapterFile }],
      outputs: [...valid.outputs, chapterFile],
    };
    expect(() => manifestSchema.parse(invalid)).toThrow();
  });

  it.each(["chapters/ch01-installation.md", "chapters/ch02-한국어.md", "chapters/ch10-section.md"])(
    "accepts chapterFile %j",
    (chapterFile) => {
      const ok = {
        ...valid,
        sections: [{ id: "x", sha256: sha, chapterFile }],
        outputs: ["SKILL.md", chapterFile],
      };
      expect(manifestSchema.parse(ok).sections[0]?.chapterFile).toBe(chapterFile);
    },
  );

  it("accepts every path the assembler itself produces (compile output must stay readable)", () => {
    for (const [i, title] of ["Setup & Operation", "설치 및 문제 해결", "---", "A / B"].entries()) {
      const chapterFile = chapterFilePath(i, title);
      const ok = {
        ...valid,
        sections: [{ id: "x", sha256: sha, chapterFile }],
        outputs: ["SKILL.md", chapterFile],
      };
      expect(manifestSchema.parse(ok).sections[0]?.chapterFile).toBe(chapterFile);
    }
  });

  it("rejects a sha256 that is not 64 lowercase hex chars (B6)", () => {
    for (const bad of ["too-short", "A".repeat(64), "x".repeat(64), "0".repeat(63)]) {
      const invalid = { ...valid, sourceFiles: [{ path: "x", sha256: bad }] };
      expect(() => manifestSchema.parse(invalid)).toThrow(/hex/u);
    }
  });

  it("rejects a createdAt that is not an ISO 8601 timestamp (B6)", () => {
    for (const bad of ["t", "2026-09-06", "yesterday", ""]) {
      expect(() => manifestSchema.parse({ ...valid, createdAt: bad })).toThrow();
    }
  });

  it("rejects a manifest version other than 1", () => {
    expect(() => manifestSchema.parse({ ...valid, version: 2 })).toThrow();
  });

  // B6 (AUD-011, 완료 기준): 섹션·산출물·골든 QA·게이트가 서로를 정확히 가리켜야 한다.
  it("rejects a chapterFile that is not listed in outputs (B3 cross-reference)", () => {
    expect(() => manifestSchema.parse({ ...valid, outputs: ["SKILL.md"] })).toThrow(
      /not listed in outputs/u,
    );
  });

  it("rejects duplicate outputs and duplicate section ids", () => {
    expect(() =>
      manifestSchema.parse({ ...valid, outputs: [...valid.outputs, "SKILL.md"] }),
    ).toThrow(/outputs must be unique/u);
    expect(() =>
      manifestSchema.parse({ ...valid, sections: [...valid.sections, ...valid.sections] }),
    ).toThrow(/section ids must be unique/u);
  });

  it("rejects a golden QA whose sectionId is not a manifest section", () => {
    const bad = {
      ...withGate,
      goldenQa: [{ ...withGate.goldenQa[0], sectionId: "ghost" }],
    };
    expect(() => manifestSchema.parse(bad)).toThrow(/not a manifest section/u);
  });

  it("rejects a loadHistory qaId that is not in goldenQa", () => {
    expect(() => manifestSchema.parse({ ...withGate, goldenQa: [] })).toThrow(
      /is not in goldenQa/u,
    );
  });

  it("rejects a gate whose coverage does not cover exactly the manifest sections", () => {
    const bad = {
      ...withGate,
      gate: {
        ...consistentReport,
        coverage: [...consistentReport.coverage, { sectionId: "b", requested: 3, generated: 1 }],
      },
    };
    expect(() => manifestSchema.parse(bad)).toThrow(/exactly one entry per manifest section/u);
  });

  it("rejects a gate whose perChapter files differ from the sections' chapter files", () => {
    const bad = {
      ...withGate,
      gate: {
        ...consistentReport,
        perChapter: [
          ...consistentReport.perChapter,
          { file: "chapters/ch02-extra.md", asked: 0, correct: 0 },
        ],
      },
    };
    expect(() => manifestSchema.parse(bad)).toThrow(/exactly one entry per distinct chapterFile/u);
  });
});
