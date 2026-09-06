import { describe, expect, it } from "vitest";
import {
  answerPrompt,
  chapterSelectionPrompt,
  distillPrompt,
  gradePrompt,
  outlinePrompt,
  qaGenPrompt,
} from "../src/core/index.js";
import type { ChapterPlan, ExtractedDoc, Section, SkillPlan } from "../src/core/index.js";
import { ScriptExhaustedError, UnknownRoleError, script } from "../src/mocks/scriptedLlm.js";

const section: Section = { id: "a", heading: "A", level: 1, text: "Body of section A." };
const doc: ExtractedDoc = { sections: [section] };
const chapter: ChapterPlan = { id: "a", file: "chapters/ch01-a.md", title: "A", sectionIds: ["a"] };
const plan: SkillPlan = { slug: "s", title: "S", chapters: [chapter] };

describe("ScriptedLlm — role routing + sequential replay (TESTING §2)", () => {
  it("replays one entry per role in FIFO order, routed by the system prompt's role tag", async () => {
    const llm = script()
      .outline(plan)
      .distill("ch01", "# A\n\nDistilled body. [§a]")
      .qa([{ question: "Q?", refAnswer: "A.", anchorQuote: "Body" }])
      .selectChapter("chapters/ch01-a.md")
      .answer("The answer.")
      .grade("correct")
      .build();

    expect(await llm.complete(outlinePrompt(doc))).toBe(JSON.stringify(plan));
    expect(await llm.complete(distillPrompt(chapter, [section]))).toBe(
      "# A\n\nDistilled body. [§a]",
    );
    expect(JSON.parse(await llm.complete(qaGenPrompt(section, 1)))).toEqual({
      items: [{ question: "Q?", refAnswer: "A.", anchorQuote: "Body" }],
    });
    expect(await llm.complete(chapterSelectionPrompt("# SKILL.md", "Q?"))).toBe(
      "chapters/ch01-a.md",
    );
    expect(await llm.complete(answerPrompt("loaded chapter", "Q?"))).toBe("The answer.");
    expect(
      await llm.complete(gradePrompt({ question: "q", refAnswer: "a", anchorQuote: "x" }, "cand")),
    ).toBe("CORRECT");
    llm.assertExhausted();
  });

  it("keeps roles independent — draining one role's queue does not affect another's", async () => {
    const llm = script().grade("correct").grade("wrong").build();
    const g = () => gradePrompt({ question: "q", refAnswer: "a", anchorQuote: "x" }, "c");
    expect(await llm.complete(g())).toBe("CORRECT");
    expect(await llm.complete(g())).toBe("WRONG");
  });

  it("records every call for inspection (answerer isolation tests, T7)", async () => {
    const llm = script().grade("correct").build();
    const req = gradePrompt({ question: "q", refAnswer: "a", anchorQuote: "x" }, "c");
    await llm.complete(req);
    expect(llm.calls).toEqual([{ role: "grader", ...req }]);
  });
});

describe("ScriptedLlm — clear failure on exhaustion (완료 기준)", () => {
  it("rejects with ScriptExhaustedError when a role's queue is empty", async () => {
    const llm = script().build();
    await expect(llm.complete(outlinePrompt(doc))).rejects.toThrow(ScriptExhaustedError);
  });

  it("rejects once the single scripted response for a role has already been consumed", async () => {
    const llm = script().grade("correct").build();
    const req = gradePrompt({ question: "q", refAnswer: "a", anchorQuote: "x" }, "c");
    await llm.complete(req);
    await expect(llm.complete(req)).rejects.toThrow(ScriptExhaustedError);
  });
});

describe("ScriptedLlm — clear failure on role mismatch (완료 기준)", () => {
  it("rejects with UnknownRoleError for a system prompt with no recognized role tag", async () => {
    const llm = script().build();
    await expect(
      llm.complete({ system: "You are a helpful assistant.", prompt: "hi", maxTokens: 10 }),
    ).rejects.toThrow(UnknownRoleError);
  });
});

describe("ScriptedLlm — assertExhausted", () => {
  it("throws when a scripted response was never consumed", () => {
    const llm = script().grade("correct", "unused-grade").build();
    expect(() => {
      llm.assertExhausted();
    }).toThrow(/unused-grade/u);
  });

  it("passes silently when every queue is empty", () => {
    expect(() => {
      script().build().assertExhausted();
    }).not.toThrow();
  });
});
