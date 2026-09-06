import { describe, expect, it } from "vitest";
import {
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
});

describe("gateReportSchema", () => {
  const valid: GateReport = {
    passRate: 0.9,
    threshold: 0.9,
    passed: true,
    perChapter: [{ file: "chapters/ch01-installation.md", asked: 3, correct: 3 }],
    failures: [],
    loadHistory: [
      {
        qaId: "qa-1",
        selectedFile: "chapters/ch01-installation.md",
        loadedFiles: ["chapters/ch01-installation.md"],
      },
    ],
    coverage: [{ sectionId: "installation", requested: 3, generated: 3 }],
  };

  it("round-trips a valid GateReport", () => {
    expect(gateReportSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a passRate outside [0, 1]", () => {
    expect(() => gateReportSchema.parse({ ...valid, passRate: 1.5 })).toThrow();
  });

  it("rejects an unknown failure reason", () => {
    const invalid = { ...valid, failures: [{ qaId: "qa-1", reason: "unknown" }] };
    expect(() => gateReportSchema.parse(invalid)).toThrow();
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

  it("round-trips a valid Manifest with a skipped gate", () => {
    expect(manifestSchema.parse(valid)).toEqual(valid);
  });

  it("round-trips a valid Manifest with a real GateReport", () => {
    const withGate: Manifest = {
      ...valid,
      gate: {
        passRate: 1,
        threshold: 0.9,
        passed: true,
        perChapter: [],
        failures: [{ qaId: "b-q0", reason: "qa_generation_failed" }],
        loadHistory: [],
        coverage: [{ sectionId: "b", requested: 3, generated: 0 }],
      },
    };
    expect(manifestSchema.parse(withGate)).toEqual(withGate);
  });

  it("rejects a GateReport without the coverage field (B2 schema)", () => {
    const missingCoverage = {
      ...valid,
      gate: {
        passRate: 1,
        threshold: 0.9,
        passed: true,
        perChapter: [],
        failures: [],
        loadHistory: [],
      },
    };
    expect(() => manifestSchema.parse(missingCoverage)).toThrow();
  });

  it("rejects a sha256 of the wrong length", () => {
    const invalid = { ...valid, sourceFiles: [{ path: "x", sha256: "too-short" }] };
    expect(() => manifestSchema.parse(invalid)).toThrow();
  });

  it("rejects a manifest version other than 1", () => {
    expect(() => manifestSchema.parse({ ...valid, version: 2 })).toThrow();
  });
});
