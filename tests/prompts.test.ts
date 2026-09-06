import { describe, expect, it } from "vitest";
import {
  answerPrompt,
  chapterSelectionPrompt,
  detectPromptRole,
  distillPrompt,
  gradePrompt,
  outlinePrompt,
  parseGradeVerdict,
  qaGenPrompt,
} from "../src/core/index.js";
import type { ChapterPlan, ExtractedDoc, Section } from "../src/core/index.js";

const section: Section = {
  id: "installation",
  heading: "Installation",
  level: 1,
  text: "Mount the unit using the two M3 screw holes on the base plate.",
};
const doc: ExtractedDoc = { sections: [section] };
const chapter: ChapterPlan = {
  id: "installation",
  file: "chapters/ch01-installation.md",
  title: "Installation",
  sectionIds: ["installation"],
};

describe("prompt role tagging (TESTING §2: 역할 라우팅)", () => {
  it("tags every one of the 5 roles so ScriptedLlm can route on it", () => {
    expect(detectPromptRole(outlinePrompt(doc).system)).toBe("outline");
    expect(detectPromptRole(distillPrompt(chapter, [section]).system)).toBe("distill");
    expect(detectPromptRole(qaGenPrompt(section, 3).system)).toBe("qaGen");
    expect(detectPromptRole(chapterSelectionPrompt("# SKILL.md", "q").system)).toBe("answerer");
    expect(detectPromptRole(answerPrompt("body", "q").system)).toBe("answerer");
    expect(
      detectPromptRole(
        gradePrompt({ question: "q", refAnswer: "a", anchorQuote: "x" }, "a").system,
      ),
    ).toBe("grader");
  });

  it("returns undefined for an untagged system prompt", () => {
    expect(detectPromptRole("You are a helpful assistant.")).toBeUndefined();
  });
});

describe("outlinePrompt", () => {
  it("includes every section id so the model can only reference real sections", () => {
    const { prompt } = outlinePrompt(doc);
    expect(prompt).toContain("[§installation]");
  });

  it("labels a heading-less section and truncates an overlong excerpt", () => {
    const long: Section = { id: "x", heading: "", level: 1, text: "a".repeat(500) };
    const { prompt } = outlinePrompt({ sections: [long] });
    expect(prompt).toContain("(제목 없음)");
    expect(prompt).toContain("…");
    expect(prompt).not.toContain("a".repeat(500));
  });
});

describe("distillPrompt", () => {
  it("asks for anchors and includes the grouped sections' text", () => {
    const { system, prompt } = distillPrompt(chapter, [section]);
    expect(system).toContain("[§sectionId]");
    expect(prompt).toContain(section.text);
  });

  it("scales maxTokens with the chapter budget", () => {
    expect(distillPrompt(chapter, [section], 2000).maxTokens).toBeGreaterThan(
      distillPrompt(chapter, [section], 500).maxTokens,
    );
  });
});

describe("qaGenPrompt", () => {
  it("asks for exactly k items and requires a verbatim anchor quote", () => {
    const { system, prompt } = qaGenPrompt(section, 3);
    expect(system).toContain("3개");
    expect(system).toContain("anchorQuote");
    expect(prompt).toContain(section.text);
  });
});

describe("answerer prompts (isolation, 가드레일 2)", () => {
  it("chapterSelectionPrompt only receives the index, never chapter bodies", () => {
    const { prompt } = chapterSelectionPrompt(
      "# SKILL.md\n\n- chapters/ch01-installation.md: Installation",
      "q",
    );
    expect(prompt).not.toContain(section.text);
  });

  it("answerPrompt embeds exactly the loaded context it was given", () => {
    const { prompt } = answerPrompt("loaded chapter body only", "What is X?");
    expect(prompt).toContain("loaded chapter body only");
    expect(prompt).toContain("What is X?");
  });
});

describe("gradePrompt / parseGradeVerdict (보수 채점)", () => {
  it("instructs conservative grading", () => {
    const { system } = gradePrompt(
      { question: "q", refAnswer: "a", anchorQuote: "x" },
      "candidate",
    );
    expect(system).toMatch(/불확실/u);
  });

  it("parses a bare CORRECT as correct, tolerating only trivial decoration", () => {
    expect(parseGradeVerdict("CORRECT")).toBe("correct");
    expect(parseGradeVerdict("correct.")).toBe("correct");
    expect(parseGradeVerdict("  Correct\n")).toBe("correct");
    expect(parseGradeVerdict("**CORRECT**")).toBe("correct");
    expect(parseGradeVerdict('"CORRECT"')).toBe("correct");
  });

  it("treats anything else — including empty or off-format text — as wrong", () => {
    expect(parseGradeVerdict("WRONG")).toBe("wrong");
    expect(parseGradeVerdict("I'm not sure, maybe correct?")).toBe("wrong");
    expect(parseGradeVerdict("")).toBe("wrong");
  });

  // B5 (SEC-010·AUD-013, 완료 기준): 접두사만 보던 시절엔 아래가 전부 "correct"였다.
  it.each([
    "CORRECT? No, WRONG.",
    "CORRECT WRONG",
    "CORRECT because the answer matches the anchor.",
    "Correct, but the second half contradicts the source, so WRONG",
    "CORRECTLY answered? No.",
    "INCORRECT",
    "Not CORRECT",
    "CORRECT\n\nExplanation: ...",
  ])("grades %j as wrong — the whole response must be the single word CORRECT", (raw) => {
    expect(parseGradeVerdict(raw)).toBe("wrong");
  });
});
