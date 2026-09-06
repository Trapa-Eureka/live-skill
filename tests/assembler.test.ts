import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleSkill, estimateTokens } from "../src/core/index.js";
import type { ChapterPlan, DistilledChapter, SkillPlan } from "../src/core/index.js";

const installation: ChapterPlan = {
  id: "installation",
  file: "ignored-by-assembler.md", // T4 결정: outline이 제안한 file은 신뢰하지 않는다
  title: "Installation",
  sectionIds: ["installation", "installation/prerequisites"],
};
const troubleshooting: ChapterPlan = {
  id: "troubleshooting",
  file: "also-ignored.md",
  title: "Troubleshooting",
  sectionIds: ["troubleshooting"],
};
const plan: SkillPlan = {
  slug: "skillsync-x200",
  title: "SkillSync X200 Manual",
  chapters: [installation, troubleshooting],
};

const installationBody = [
  "Mount the unit on a flat, grounded surface. [§installation]",
  "",
  "**Prerequisite** — a host running Console v4 or later. [§installation/prerequisites]",
  "",
  "- [PROCEDURE] Assign a static address before powering on. [§installation/prerequisites]",
  "- [RULE] If the link LED never turns solid, reboot the unit. [§installation]",
].join("\n");
const troubleshootingBody = [
  "Cross-check the fault LED against the error code table. [§troubleshooting]",
  "",
  "- [ANTI-PATTERN] Do not substitute a higher-rated fuse. [§troubleshooting]",
  "**Prerequisite** — repeated in another chapter to prove dedup. [§troubleshooting]",
].join("\n");

const distilled: DistilledChapter[] = [
  {
    id: "installation",
    file: "unused",
    body: installationBody,
    anchors: ["installation", "installation/prerequisites"],
  },
  {
    id: "troubleshooting",
    file: "unused",
    body: troubleshootingBody,
    anchors: ["troubleshooting"],
  },
];

describe("assembleSkill — fixed-input snapshot (완료 기준)", () => {
  it("produces the same 5 files for the same input, every time", () => {
    const files = assembleSkill(plan, distilled, { verified: true });
    expect(files).toMatchSnapshot();
    // 결정론: 두 번째 호출도 완전히 동일해야 한다(SPEC §6 재현성).
    expect(assembleSkill(plan, distilled, { verified: true })).toEqual(files);
  });
});

describe("assembleSkill — file naming (T4 결정: outline의 file 제안을 신뢰하지 않는다)", () => {
  it("recomputes chapters/chNN-slug.md from chapter order and title, ignoring ChapterPlan.file", () => {
    const files = assembleSkill(plan, distilled, { verified: true });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("chapters/ch01-installation.md");
    expect(paths).toContain("chapters/ch02-troubleshooting.md");
    expect(paths).not.toContain("ignored-by-assembler.md");
  });
});

describe("assembleSkill — token budget calculation (완료 기준)", () => {
  it("attaches estimateTokens(content) as estimatedTokens for every file", () => {
    for (const f of assembleSkill(plan, distilled, { verified: true })) {
      expect(f.estimatedTokens).toBe(estimateTokens(f.content));
    }
  });
});

describe("assembleSkill — unverified marker (DESIGN §3)", () => {
  it("adds the unverified banner to SKILL.md when verified is false", () => {
    const skillMd = assembleSkill(plan, distilled, { verified: false }).find(
      (f) => f.path === "SKILL.md",
    );
    expect(skillMd?.content).toContain("unverified");
  });

  it("omits the banner when verified is true", () => {
    const skillMd = assembleSkill(plan, distilled, { verified: true }).find(
      (f) => f.path === "SKILL.md",
    );
    expect(skillMd?.content).not.toContain("unverified");
  });
});

describe("assembleSkill — glossary/patterns/cheatsheet extraction (DESIGN §3 T4 결정)", () => {
  const files = assembleSkill(plan, distilled, { verified: true });
  const byPath = (p: string): string => files.find((f) => f.path === p)?.content ?? "";

  it("collects a term's first definition once and lists every chapter that mentions it", () => {
    const glossary = byPath("glossary.md");
    expect(glossary).toContain("**Prerequisite** — a host running Console v4 or later.");
    expect(glossary).not.toContain("repeated in another chapter to prove dedup");
    expect(glossary).toContain("chapters/ch01-installation.md");
    expect(glossary).toContain("chapters/ch02-troubleshooting.md");
  });

  it("groups patterns/procedures/anti-patterns by kind with a chapter reference", () => {
    const patterns = byPath("patterns.md");
    expect(patterns).toContain("Assign a static address before powering on.");
    expect(patterns).toContain("Do not substitute a higher-rated fuse.");
    expect(patterns.indexOf("## 절차")).toBeLessThan(patterns.indexOf("## 안티패턴"));
  });

  it("lists every rule for the cheatsheet", () => {
    expect(byPath("cheatsheet.md")).toContain(
      "If the link LED never turns solid, reboot the unit.",
    );
  });

  it("keeps the tagged lines inside the chapter body too (context stays intact)", () => {
    const chapter = byPath("chapters/ch01-installation.md");
    expect(chapter).toContain("- [PROCEDURE]");
    expect(chapter).toContain("- [RULE]");
  });
});

describe("assembleSkill — sparse input", () => {
  it("falls back to a placeholder message when no chapter has any tagged lines", () => {
    const plain: DistilledChapter[] = [
      {
        id: "installation",
        file: "u",
        body: "Just prose, no tags. [§installation]",
        anchors: ["installation"],
      },
      {
        id: "troubleshooting",
        file: "u",
        body: "More prose. [§troubleshooting]",
        anchors: ["troubleshooting"],
      },
    ];
    const files = assembleSkill(plan, plain, { verified: true });
    expect(files.find((f) => f.path === "glossary.md")?.content).toContain(
      "추출된 용어가 없습니다",
    );
    expect(files.find((f) => f.path === "patterns.md")?.content).toContain(
      "추출된 패턴이 없습니다",
    );
    expect(files.find((f) => f.path === "cheatsheet.md")?.content).toContain(
      "추출된 규칙이 없습니다",
    );
  });

  it("throws a cause+fix error when outline and distill disagree on chapter ids", () => {
    const onlyInstallation = distilled.filter((d) => d.id === "installation");
    expect(() => assembleSkill(plan, onlyInstallation, { verified: true })).toThrow(
      /troubleshooting/u,
    );
  });
});

describe("assembler.ts — LLM 의존 0 (완료 기준, import 검사)", () => {
  it("never imports an LLM provider, ScriptedLlm, or the Anthropic SDK", () => {
    const source = readFileSync(join(process.cwd(), "src/core/assembler.ts"), "utf-8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/u.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/llmProvider|scriptedLlm|@anthropic-ai/iu);
  });
});
