import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleSkill, validateSkill } from "../src/core/index.js";
import type {
  Budgets,
  ChapterPlan,
  DistilledChapter,
  SkillFile,
  SkillPlan,
} from "../src/core/index.js";

const BUDGETS: Budgets = {
  skillMd: 4000,
  chapter: 1000,
  glossary: 1500,
  patterns: 2000,
  cheatsheet: 1000,
};

function skillMd(chapterLinks: string[]): string {
  return [
    "---",
    "name: manual",
    "description: A manual",
    "---",
    "",
    "# Manual",
    "",
    "## Chapters",
    "",
    ...chapterLinks.map((f) => `- \`${f}\``),
  ].join("\n");
}

const VALID_SKILL_MD: SkillFile = { path: "SKILL.md", content: skillMd(["chapters/ch01-a.md"]) };
const VALID_CHAPTER: SkillFile = {
  path: "chapters/ch01-a.md",
  content: "Mount the unit. [§a]\n\nCheck the fault LED. [§a]",
};
const VALID_GLOSSARY: SkillFile = {
  path: "glossary.md",
  content: "# Glossary\n\n**Unit** — the device. [§a]",
};
const VALID_PATTERNS: SkillFile = {
  path: "patterns.md",
  content: "# Patterns\n\n(no patterns extracted.)",
};
const VALID_CHEATSHEET: SkillFile = {
  path: "cheatsheet.md",
  content: "# Cheatsheet\n\n(no rules extracted.)",
};
const validFiles: SkillFile[] = [
  VALID_SKILL_MD,
  VALID_CHAPTER,
  VALID_GLOSSARY,
  VALID_PATTERNS,
  VALID_CHEATSHEET,
];

describe("validateSkill — clean input", () => {
  it("passes with no issues at all", () => {
    expect(validateSkill(validFiles, BUDGETS)).toEqual({ passed: true, issues: [] });
  });
});

describe("validateSkill — budget exceeded (TESTING §3, error)", () => {
  it("flags a chapter file over its per-file budget", () => {
    const oversized = "word ".repeat(2000); // far over the budget
    const files: SkillFile[] = [
      VALID_SKILL_MD,
      { path: "chapters/ch01-a.md", content: `${oversized} [§a]` },
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    const report = validateSkill(files, BUDGETS);
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "budget_exceeded",
        file: "chapters/ch01-a.md",
      }),
    );
  });

  it("does not flag a file within budget", () => {
    const report = validateSkill(validFiles, BUDGETS);
    expect(report.issues.filter((i) => i.code === "budget_exceeded")).toEqual([]);
  });
});

describe("validateSkill — frontmatter (TESTING §3, error)", () => {
  it("flags a missing SKILL.md entirely", () => {
    const files = validFiles.filter((f) => f.path !== "SKILL.md");
    const report = validateSkill(files, BUDGETS);
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "missing_frontmatter", file: "SKILL.md" }),
    );
  });

  it("flags a SKILL.md with no frontmatter block", () => {
    const files: SkillFile[] = [
      { path: "SKILL.md", content: "# Manual\n\nno frontmatter here" },
      VALID_CHAPTER,
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    expect(validateSkill(files, BUDGETS).issues).toContainEqual(
      expect.objectContaining({ code: "missing_frontmatter" }),
    );
  });

  it("flags a frontmatter block missing the description field", () => {
    const files: SkillFile[] = [
      { path: "SKILL.md", content: "---\nname: manual\n---\n\n# Manual" },
      VALID_CHAPTER,
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    const report = validateSkill(files, BUDGETS);
    const issue = report.issues.find((i) => i.code === "missing_frontmatter");
    expect(issue?.message).toContain("description");
  });
});

describe("validateSkill — frontmatter is really parsed as YAML (E2)", () => {
  const withSkillMd = (content: string): SkillFile[] => [
    { path: "SKILL.md", content },
    VALID_CHAPTER,
    VALID_GLOSSARY,
    VALID_PATTERNS,
    VALID_CHEATSHEET,
  ];

  it("rejects the unquoted 'Guide: Setup' description that used to pass (invalid_frontmatter, syntax)", () => {
    const report = validateSkill(
      withSkillMd("---\nname: manual\ndescription: Guide: Setup\n---\n\n# Manual"),
      BUDGETS,
    );
    expect(report.passed).toBe(false);
    const issue = report.issues.find((i) => i.code === "invalid_frontmatter");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toMatch(/not valid YAML.*Fix: quote/u);
  });

  it("accepts the same title once quoted — what compile now emits", () => {
    const report = validateSkill(
      withSkillMd('---\nname: manual\ndescription: "Guide: Setup"\n---\n\n# Manual'),
      BUDGETS,
    );
    expect(report.issues.filter((i) => i.file === "SKILL.md")).toEqual([]);
  });

  it.each([
    ["---\nname: Not A Slug\ndescription: x\n---", /field "name"/u],
    ["---\nname: 42\ndescription: x\n---", /field "name"/u],
    ["---\nname: manual\ndescription: ''\n---", /field "description"/u],
    ["---\n- name\n- description\n---", /YAML mapping/u],
  ])("flags wrong types and values, not just missing keys: %j", (content, expected) => {
    const report = validateSkill(withSkillMd(content), BUDGETS);
    expect(report.passed).toBe(false);
    const issue = report.issues.find((i) => i.code === "invalid_frontmatter");
    expect(issue?.message).toMatch(expected);
  });

  it("warns (does not fail) on keys the Agent Skills standard does not define", () => {
    const report = validateSkill(
      withSkillMd("---\nname: manual\ndescription: x\nlicense: MIT\ncolour: blue\n---"),
      BUDGETS,
    );
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "unknown_frontmatter_key",
        file: "SKILL.md",
        message: expect.stringContaining('"colour"') as string,
      }),
    ]);
  });
});

describe("validateSkill — chapter links (TESTING §3, error)", () => {
  it("flags a link to a chapter file that was not provided", () => {
    const files: SkillFile[] = [
      { path: "SKILL.md", content: skillMd(["chapters/ch01-a.md", "chapters/ch02-missing.md"]) },
      VALID_CHAPTER,
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    const report = validateSkill(files, BUDGETS);
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "broken_link", file: "SKILL.md" }),
    );
  });

  it("does not flag a chapter file that exists but is unreferenced (only broken links, not orphans)", () => {
    const files: SkillFile[] = [
      { path: "SKILL.md", content: skillMd([]) },
      VALID_CHAPTER,
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    expect(validateSkill(files, BUDGETS).issues.filter((i) => i.code === "broken_link")).toEqual(
      [],
    );
  });
});

describe("validateSkill — anchor ratio (TESTING §3, warning — does not fail passed)", () => {
  it("warns when fewer than half of a chapter's substantive lines carry an anchor", () => {
    const files: SkillFile[] = [
      VALID_SKILL_MD,
      {
        path: "chapters/ch01-a.md",
        content: "No anchor here.\n\nNor here.\n\nOnly this one. [§a]",
      },
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    const report = validateSkill(files, BUDGETS);
    expect(report.passed).toBe(true); // a warning alone does not fail it
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "low_anchor_ratio",
        file: "chapters/ch01-a.md",
      }),
    );
  });

  it("respects a custom minAnchorRatio", () => {
    const files: SkillFile[] = [
      VALID_SKILL_MD,
      { path: "chapters/ch01-a.md", content: "Anchored. [§a]\n\nNot anchored." },
      VALID_GLOSSARY,
      VALID_PATTERNS,
      VALID_CHEATSHEET,
    ];
    expect(validateSkill(files, BUDGETS, { minAnchorRatio: 0.9 }).issues).toContainEqual(
      expect.objectContaining({ code: "low_anchor_ratio" }),
    );
    expect(validateSkill(files, BUDGETS, { minAnchorRatio: 0.4 }).issues).toEqual([]);
  });
});

describe("validateSkill — integration with assembleSkill (T4/T5 integration)", () => {
  it("passes on a well-anchored assembler output", () => {
    const chapter: ChapterPlan = {
      id: "a",
      file: "ignored",
      title: "Installation",
      sectionIds: ["a"],
    };
    const plan: SkillPlan = { slug: "manual", title: "Manual", chapters: [chapter] };
    const distilled: DistilledChapter[] = [
      {
        id: "a",
        file: "unused",
        body: "Mount the unit. [§a]\n\n**Unit** — the device itself. [§a]",
        anchors: ["a"],
      },
    ];
    const files = assembleSkill(plan, distilled, { verified: true });
    expect(validateSkill(files, BUDGETS)).toEqual({ passed: true, issues: [] });
  });
});

describe("validator.ts — zero LLM calls guaranteed (completion criterion, import check)", () => {
  it("never imports an LLM provider, ScriptedLlm, or the Anthropic SDK", () => {
    const source = readFileSync(join(process.cwd(), "src/core/validator.ts"), "utf-8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/u.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/llmProvider|scriptedLlm|@anthropic-ai/iu);
  });
});
