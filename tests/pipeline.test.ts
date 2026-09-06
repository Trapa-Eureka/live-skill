import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import type { ExtractedDoc, SkillPlan } from "../src/core/index.js";
import { compile, MAX_INPUT_TOKENS } from "../src/core/pipeline.js";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { FixtureExtractor, syntheticDoc } from "../src/mocks/fixtureExtractor.js";
import { script } from "../src/mocks/scriptedLlm.js";

const clock = { now: () => new Date("2026-09-06T00:00:00.000Z") };
const config = loadConfig({});
const nameAsBytes = (name: string): Uint8Array => new TextEncoder().encode(name);

const twoSectionDoc: ExtractedDoc = {
  sections: [
    { id: "a", heading: "Installation", level: 1, text: "Mount the unit on a flat surface." },
    { id: "b", heading: "Troubleshooting", level: 1, text: "Check the fault LED." },
  ],
};
const twoChapterPlan: SkillPlan = {
  slug: "manual",
  title: "Manual",
  chapters: [
    { id: "a", file: "ignored", title: "Installation", sectionIds: ["a"] },
    { id: "b", file: "ignored", title: "Troubleshooting", sectionIds: ["b"] },
  ],
};

describe("compile — e2e with a normal script, gate excluded (완료 기준)", () => {
  it("runs extract -> outline -> distill -> assemble -> validate and produces a manifest", async () => {
    const extractor = new FixtureExtractor({ md: twoSectionDoc });
    const llm = script()
      .outline(twoChapterPlan)
      .distill("a", "Mount the unit on a flat surface. [§a]")
      .distill("b", "Check the fault LED. [§b]")
      .build();

    const result = await compile([{ path: "manual.md", bytes: nameAsBytes("manual.md") }], {
      extractors: [extractor],
      llm,
      clock,
      config,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.manifest.gate).toEqual({ skipped: true });
    expect(result.value.manifest.version).toBe(1);
    expect(result.value.manifest.createdAt).toBe("2026-09-06T00:00:00.000Z");
    expect(result.value.manifest.outputs).toContain("SKILL.md");
    expect(result.value.files.map((f) => f.path)).toContain("chapters/ch01-installation.md");
    expect(result.value.validation.passed).toBe(true);
    llm.assertExhausted(); // 정확히 outline 1회 + distill 2회만 썼다
  });
});

describe("compile — manifest determinism (TESTING §3)", () => {
  it("produces identical manifests across two runs of the same script", async () => {
    async function run() {
      const extractor = new FixtureExtractor({ md: twoSectionDoc });
      const llm = script()
        .outline(twoChapterPlan)
        .distill("a", "Mount the unit on a flat surface. [§a]")
        .distill("b", "Check the fault LED. [§b]")
        .build();
      const r = await compile([{ path: "manual.md", bytes: nameAsBytes("manual.md") }], {
        extractors: [extractor],
        llm,
        clock,
        config,
      });
      if (!r.ok) throw new Error("expected success");
      return r.value;
    }
    const first = await run();
    const second = await run();
    expect(second.manifest).toEqual(first.manifest);
    expect(second.files).toEqual(first.files);
  });
});

describe("compile — multi-source section-id namespacing (DESIGN §5.1)", () => {
  it("prefixes section ids by source file when compiling more than one source", async () => {
    const docA: ExtractedDoc = {
      sections: [{ id: "overview", heading: "Overview", level: 1, text: "Doc A overview." }],
    };
    const docB: ExtractedDoc = {
      sections: [{ id: "overview", heading: "Overview", level: 1, text: "Doc B overview." }],
    };
    const extractor = new FixtureExtractor({ md: docA }); // supports()는 확장자만 보므로 파일 하나로 두 소스 다 처리
    const extractorB = new FixtureExtractor({ txt: docB });
    const plan: SkillPlan = {
      slug: "s",
      title: "S",
      chapters: [
        { id: "c1", file: "x", title: "A Overview", sectionIds: ["a/overview"] },
        { id: "c2", file: "y", title: "B Overview", sectionIds: ["b/overview"] },
      ],
    };
    const llm = script()
      .outline(plan)
      .distill("c1", "A. [§a/overview]")
      .distill("c2", "B. [§b/overview]")
      .build();

    const result = await compile(
      [
        { path: "a.md", bytes: nameAsBytes("a.md") },
        { path: "b.txt", bytes: nameAsBytes("b.txt") },
      ],
      { extractors: [extractor, extractorB], llm, clock, config },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.manifest.sections.map((s) => s.id)).toEqual(["a/overview", "b/overview"]);
  });
});

describe("compile — empty input", () => {
  it("rejects with empty_input when given zero source files", async () => {
    const result = await compile([], {
      extractors: createExtractors(),
      llm: script().build(),
      clock,
      config,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "empty_input" } });
  });

  it("rejects with empty_input when every source extracts to zero sections", async () => {
    const extractor = new FixtureExtractor({ md: { sections: [] } });
    const result = await compile([{ path: "blank.md", bytes: nameAsBytes("blank.md") }], {
      extractors: [extractor],
      llm: script().build(),
      clock,
      config,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "empty_input" } });
  });
});

describe("compile — unsupported format (TESTING §4)", () => {
  it("rejects a .xlsx source with a message naming the supported formats", async () => {
    const llm = script().build();
    const result = await compile([{ path: "sheet.xlsx", bytes: new Uint8Array() }], {
      extractors: createExtractors(),
      llm,
      clock,
      config,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "unsupported_format" } });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.message).toMatch(/PDF|DOCX|MD|HTML/u);
  });
});

describe("compile — empty document (TESTING §4)", () => {
  it("rejects with an actionable fix when the extractor reports empty_text", async () => {
    const extractor = new FixtureExtractor({ md: { error: { kind: "empty_text" } } });
    const llm = script().build();
    const result = await compile([{ path: "empty.md", bytes: nameAsBytes("empty.md") }], {
      extractors: [extractor],
      llm,
      clock,
      config,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "extract_failed" } });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.message).toContain("scanned image");
  });
});

describe("compile — oversized input (TESTING §4, 우회 없음)", () => {
  it("rejects before calling any LLM when the extracted text is over MAX_INPUT_TOKENS", async () => {
    const huge = syntheticDoc(MAX_INPUT_TOKENS * 5, 10, "en"); // 훨씬 웃도는 분량
    const extractor = new FixtureExtractor({ md: huge });
    const llm = script().build(); // 대본 0개 — 호출되면 즉시 실패해야 한다
    const result = await compile([{ path: "huge.md", bytes: nameAsBytes("huge.md") }], {
      extractors: [extractor],
      llm,
      clock,
      config,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "input_too_large" } });
    llm.assertExhausted(); // LLM 호출이 0회였다는 증거 — assert_exhausted가 아니라 대본이 원래 비어 있었음
    expect(llm.calls).toEqual([]);
  });
});

describe("compile — MAX_LLM_CALLS cap (TESTING §4, 비용 누수 가드)", () => {
  it("aborts before any distill call once outline + chapters would exceed the cap", async () => {
    const tightConfig = loadConfig({ MAX_LLM_CALLS: "2" }); // outline(1) + 챕터 2개 = 3 > 2
    const extractor = new FixtureExtractor({ md: twoSectionDoc });
    const llm = script().outline(twoChapterPlan).build(); // distill 대본은 아예 안 줌
    const result = await compile([{ path: "manual.md", bytes: nameAsBytes("manual.md") }], {
      extractors: [extractor],
      llm,
      clock,
      config: tightConfig,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "call_cap_exceeded", estimated: 3, limit: 2 },
    });
    expect(llm.calls.filter((c) => c.role === "distill")).toEqual([]);
  });
});

describe("compile — outline schema violation", () => {
  it("rejects with outline_invalid when the outline response isn't valid SkillPlan JSON", async () => {
    const extractor = new FixtureExtractor({ md: twoSectionDoc });
    const llm = script().outlineRaw("not json at all").build();
    const result = await compile([{ path: "manual.md", bytes: nameAsBytes("manual.md") }], {
      extractors: [extractor],
      llm,
      clock,
      config,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "outline_invalid" } });
  });
});

describe("compile — real HTML extractor on the mixed-unicode fixture (TESTING §4)", () => {
  it("keeps Korean/Tagalog headings and anchor strings intact end to end", async () => {
    const bytes = readFileSync(join(process.cwd(), "fixtures/docs/mixed-unicode.html"));
    const extractors = createExtractors();
    const extractor = extractors.find((e) => e.supports("text/html", "mixed-unicode.html"));
    if (extractor === undefined) throw new Error("no HTML extractor");
    const extracted = await extractor.extract(new Uint8Array(bytes));
    if (!extracted.ok) throw new Error("fixture extraction failed");
    const sections = extracted.value.sections;
    const firstSection = sections[0];
    if (firstSection === undefined) throw new Error("fixture produced no sections");

    const plan: SkillPlan = {
      slug: "notice",
      title: "Multilingual Notice",
      chapters: [
        {
          id: firstSection.id,
          file: "x",
          title: firstSection.heading,
          sectionIds: sections.map((s) => s.id),
        },
      ],
    };
    const body = sections.map((s) => `${s.text} [§${s.id}]`).join("\n\n");
    const llm = script().outline(plan).distill("only", body).build();

    const result = await compile([{ path: "mixed-unicode.html", bytes: new Uint8Array(bytes) }], {
      extractors,
      llm,
      clock,
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const chapterFile = result.value.files.find((f) => f.path.startsWith("chapters/"));
    expect(chapterFile?.content).toContain("커뮤니티 센터는"); // 한국어 본문이 안 깨짐
    expect(chapterFile?.content).toContain("Kanselado ang lahat"); // 타갈로그어 본문이 안 깨짐
    expect(chapterFile?.content).not.toContain("console.log"); // <script> 내용은 애초에 추출 단계에서 빠짐
    // manifest 섹션 해시가 실제 추출된 원문 텍스트의 sha256과 일치하는지(앵커·조립 무결성).
    const koreanSection = sections.find((s) => s.heading === "한국어");
    expect(koreanSection).toBeDefined();
    const manifestEntry = result.value.manifest.sections.find((s) => s.id === koreanSection?.id);
    expect(manifestEntry).toBeDefined();
  });
});
