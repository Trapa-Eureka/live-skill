// E2 완료 기준(DESIGN §3.1): 프런트매터를 YAML 라이브러리로 쓰고 읽는다 — "Guide: Setup" 제목이 assembler →
// validator → 파서를 거쳐 그대로 돌아와야 한다. 순수 계산이라 IO·LLM 없이 검증한다.
import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION_CHARS,
  assembleSkill,
  parseFrontmatter,
  serializeFrontmatter,
  validateSkill,
  type Budgets,
  type DistilledChapter,
  type SkillPlan,
} from "../src/core/index.js";

const BUDGETS: Budgets = {
  skillMd: 4000,
  chapter: 1000,
  glossary: 1500,
  patterns: 2000,
  cheatsheet: 1000,
};

function parsedFields(content: string) {
  const r = parseFrontmatter(content);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("serializeFrontmatter / parseFrontmatter — round trip", () => {
  it.each([
    "Guide: Setup",
    'He said "hi" #not-a-comment',
    "- looks like a list",
    "true",
    "yes",
    "null",
    "123",
    "  padded  ",
    "한글 제목: 설정",
    "key: [a, b] {c: d}",
    "*alias &anchor !tag @at | > %",
    "backslash \\ and tab\tinside",
    "emoji 🚀",
  ])("round-trips the description %j through YAML unchanged", (title) => {
    const text = serializeFrontmatter({ name: "manual", description: title });
    expect(text.startsWith("---\n")).toBe(true);
    expect(text.endsWith("\n---")).toBe(true);
    expect(parsedFields(`${text}\n\n# body`).fields).toEqual({
      name: "manual",
      description: title,
    });
  });

  it("always double-quotes values so YAML 1.1 consumers cannot read yes/no/null as booleans or null", () => {
    expect(serializeFrontmatter({ name: "no", description: "yes" })).toBe(
      '---\nname: "no"\ndescription: "yes"\n---',
    );
  });

  it("never folds a long description onto several lines", () => {
    const long = "word ".repeat(100).trim();
    const text = serializeFrontmatter({ name: "manual", description: long });
    expect(text.split("\n")).toHaveLength(4); // ---, name, description, ---
    expect(parsedFields(text).fields.description).toBe(long);
  });

  it("returns the body after the block and lists keys the standard does not define", () => {
    const parsed = parsedFields(
      '---\nname: manual\ndescription: "A manual"\nlicense: MIT\ncolour: blue\n---\n# Body\n',
    );
    expect(parsed.body).toBe("# Body\n");
    expect(parsed.unknownKeys).toEqual(["colour"]);
  });
});

describe("parseFrontmatter — problems, each told apart", () => {
  it("missing_block: no leading --- block", () => {
    expect(parseFrontmatter("# Just a heading")).toEqual({
      ok: false,
      error: { kind: "missing_block" },
    });
    expect(parseFrontmatter("\n---\nname: a\n---\n")).toMatchObject({
      ok: false,
      error: { kind: "missing_block" },
    });
  });

  it("syntax: the unquoted title the review used breaks YAML", () => {
    const r = parseFrontmatter("---\nname: manual\ndescription: Guide: Setup\n---\n");
    expect(r).toMatchObject({ ok: false, error: { kind: "syntax" } });
    if (r.ok) throw new Error("unreachable");
    expect(r.error.kind === "syntax" ? r.error.detail : "").toMatch(/mapping/iu);
  });

  it("not_a_map: a list, a bare scalar, or an empty block", () => {
    for (const block of ["- a\n- b", "just text", ""]) {
      const content = block === "" ? "---\n---\n" : `---\n${block}\n---\n`;
      expect(parseFrontmatter(content)).toEqual({ ok: false, error: { kind: "not_a_map" } });
    }
  });

  it("missing_field: names every required key that is absent", () => {
    expect(parseFrontmatter("---\nlicense: MIT\n---\n")).toEqual({
      ok: false,
      error: { kind: "missing_field", fields: ["name", "description"] },
    });
    expect(parseFrontmatter("---\nname: manual\n---\n")).toEqual({
      ok: false,
      error: { kind: "missing_field", fields: ["description"] },
    });
  });

  it.each([
    ["name: 123\ndescription: x", "name"], // 숫자 — 문자열이 아니다
    ["name: Not A Slug\ndescription: x", "name"],
    ["name: manual\ndescription: 42", "description"],
    ["name: manual\ndescription: ''", "description"],
    ["name: manual\ndescription: '   '", "description"],
    [`name: manual\ndescription: "${"x".repeat(MAX_DESCRIPTION_CHARS + 1)}"`, "description"],
    ['name: manual\ndescription: "a\\u0007b"', "description"], // 제어문자
    ["name: manual\ndescription: [a, b]", "description"],
  ])("invalid_field: %j → field %s", (block, field) => {
    expect(parseFrontmatter(`---\n${block}\n---\n`)).toMatchObject({
      ok: false,
      error: { kind: "invalid_field", field },
    });
  });

  it("accepts a multi-line description and a description exactly at the limit", () => {
    const multi = parsedFields("---\nname: manual\ndescription: |\n  line one\n  line two\n---\n");
    expect(multi.fields.description).toBe("line one\nline two\n");
    const max = "x".repeat(MAX_DESCRIPTION_CHARS);
    expect(parsedFields(`---\nname: manual\ndescription: "${max}"\n---\n`).fields.description).toBe(
      max,
    );
  });
});

describe("assembler → validator → parser (완료 기준: Guide: Setup 라운드트립)", () => {
  const plan: SkillPlan = {
    slug: "guide-setup",
    title: "Guide: Setup",
    chapters: [{ id: "setup", file: "ignored", title: "Setup: Step 1", sectionIds: ["setup"] }],
  };
  const distilled: DistilledChapter[] = [
    { id: "setup", file: "", body: "Mount the unit. [§setup]", anchors: ["setup"] },
  ];

  it("a title with ': ' is serialized safely, passes validation, and reads back verbatim", () => {
    const files = assembleSkill(plan, distilled, { verified: true });
    const skillMd = files.find((f) => f.path === "SKILL.md");
    if (skillMd === undefined) throw new Error("no SKILL.md");
    expect(
      skillMd.content.startsWith('---\nname: "guide-setup"\ndescription: "Guide: Setup"\n---\n'),
    ).toBe(true);
    expect(validateSkill(files, BUDGETS).passed).toBe(true);
    expect(parsedFields(skillMd.content).fields).toEqual({
      name: "guide-setup",
      description: "Guide: Setup",
    });
  });
});
