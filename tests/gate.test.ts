// T7 completion criteria: all 5 items of TESTING §4 "gate discrimination" (no deletion or relaxation,
// CLAUDE.md guardrail 1) plus both "answerer isolation" items.
import { describe, expect, it } from "vitest";
import type { AssembledFile } from "../src/core/assembler.js";
import {
  estimateEvalCalls,
  estimateGateCalls,
  evaluateGoldenQa,
  generateGoldenQa,
  missingChapterFiles,
  runGate,
  type GateChapter,
} from "../src/core/gate.js";
import type { GoldenQA, Section } from "../src/core/index.js";
import { trackCost } from "../src/core/costTracker.js";
import { script } from "../src/mocks/scriptedLlm.js";

const sectionA: Section = {
  id: "a",
  heading: "Installation",
  level: 1,
  text: "The device requires 500 mA of current to operate correctly.",
};
const sectionB: Section = {
  id: "b",
  heading: "Troubleshooting",
  level: 1,
  text: "The fault LED blinks red when there is an error condition.",
};

const skillMd: AssembledFile = {
  path: "SKILL.md",
  content: "# Manual\n\n- chapters/ch01-installation.md\n- chapters/ch02-troubleshooting.md\n",
  estimatedTokens: 20,
};
const chapter1: AssembledFile = {
  path: "chapters/ch01-installation.md",
  content: "The device requires 500 mA of current to operate correctly. [§a]",
  estimatedTokens: 20,
};
const chapter2: AssembledFile = {
  path: "chapters/ch02-troubleshooting.md",
  content: "The fault LED blinks red when there is an error condition. [§b]",
  estimatedTokens: 20,
};
const chapters: GateChapter[] = [
  { file: "chapters/ch01-installation.md", sectionIds: ["a"] },
  { file: "chapters/ch02-troubleshooting.md", sectionIds: ["b"] },
];

describe("runGate — normal script (gate discrimination 1/5)", () => {
  it("passes with passRate 1.0 when every answer is graded correct", async () => {
    const llm = script()
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qa([
        {
          question: "What does the fault LED do?",
          refAnswer: "blinks red",
          anchorQuote: "blinks red",
        },
      ])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("It blinks red")
      .grade("correct")
      .build();

    const { report } = await runGate(
      { files: [skillMd, chapter1, chapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(report.passRate).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    llm.assertExhausted();
  });
});

describe("runGate — missing chapter injection (gate discrimination 2/5, no deletion or relaxation)", () => {
  it("fails the section with not_found when its chapter is missing from assembly, and identifies the weak chapter", async () => {
    const filesWithoutChapter2 = [skillMd, chapter1]; // chapter2 is missing from the assembled output
    const llm = script()
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qa([
        {
          question: "What does the fault LED do?",
          refAnswer: "blinks red",
          anchorQuote: "blinks red",
        },
      ])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      // ch02 is still in the SKILL.md index, so the LLM selects it as usual, but the file does not exist.
      .selectChapter("chapters/ch02-troubleshooting.md")
      .build();

    const { report } = await runGate(
      { files: filesWithoutChapter2, chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(report.passRate).toBeCloseTo(0.5);
    expect(report.passed).toBe(false); // below the threshold (0.9)
    expect(report.failures).toContainEqual({ qaId: "b-q1", reason: "not_found" });
    const weakChapter = report.perChapter.find(
      (c) => c.file === "chapters/ch02-troubleshooting.md",
    );
    expect(weakChapter).toEqual({ file: "chapters/ch02-troubleshooting.md", asked: 1, correct: 0 });
    // Evidence: the not_found early exit means answer/grade were never called for that question
    // (none were scripted either).
    llm.assertExhausted();
  });
});

describe("runGate — wrong distillation injection (gate discrimination 3/5, no deletion or relaxation)", () => {
  it("fails via the grader when a corrupted chapter leads to a contradicting answer", async () => {
    // The anchor phrase ("The fault LED blinks") survives in the corrupted chapter, but the key fact
    // is flipped (red → green).
    const corruptedChapter2: AssembledFile = {
      ...chapter2,
      content: "The fault LED blinks green when there is an error condition. [§b]",
    };
    const llm = script()
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qa([
        {
          question: "What color does the fault LED blink?",
          refAnswer: "red",
          anchorQuote: "The fault LED blinks",
        },
      ])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("green") // the answer an agent would give after reading the corrupted chapter
      .grade("wrong") // the grader catches the contradiction with refAnswer ("red")
      .build();

    const { report } = await runGate(
      { files: [skillMd, chapter1, corruptedChapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(report.passed).toBe(false);
    expect(report.failures).toContainEqual({ qaId: "b-q1", reason: "wrong" });
    llm.assertExhausted();
  });
});

describe("runGate — anchor_missing: the anchor phrase itself is gone from the selected chapter", () => {
  it("fails with anchor_missing without ever calling answer/grade", async () => {
    const brokenChapter2: AssembledFile = {
      ...chapter2,
      content: "This chapter no longer mentions the fault LED at all. [§b]",
    };
    const llm = script()
      .qa([
        {
          question: "What does the fault LED do?",
          refAnswer: "blinks red",
          anchorQuote: "blinks red",
        },
      ])
      .selectChapter("chapters/ch02-troubleshooting.md")
      .build(); // answer/grade are not scripted; the test fails if they are called

    const { report } = await runGate(
      {
        files: [skillMd, brokenChapter2],
        chapters: [{ file: "chapters/ch02-troubleshooting.md", sectionIds: ["b"] }],
        sections: [sectionB],
      },
      { llm, k: 1 },
    );

    expect(report.failures).toEqual([{ qaId: "b-q1", reason: "anchor_missing" }]);
    llm.assertExhausted();
  });
});

describe("evaluateGoldenQa — reuse path (T8 eval, qaGen skipped)", () => {
  it("grades already-generated QA without ever calling qaGen", async () => {
    const qas: GoldenQA[] = [
      {
        id: "a-q1",
        sectionId: "a",
        question: "How much current?",
        refAnswer: "500 mA",
        anchorQuote: "500 mA of current",
      },
      {
        id: "b-q1",
        sectionId: "b",
        question: "LED behavior?",
        refAnswer: "blinks red",
        anchorQuote: "blinks red",
      },
    ];
    const llm = script()
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("blinks red")
      .grade("correct")
      .build(); // no qa script at all; a call would fail as exhausted

    const report = await evaluateGoldenQa(
      qas,
      { files: [skillMd, chapter1, chapter2], chapters },
      llm,
    );

    expect(report.passRate).toBe(1);
    expect(report.passed).toBe(true);
    llm.assertExhausted();
  });
});

describe("generateGoldenQa — item hygiene (C1)", () => {
  it("discards an item carrying control characters and accepts the clean regenerated one", async () => {
    const llm = script()
      .qa([
        { question: "How much?\u001B[31m", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .build();
    const qas = await generateGoldenQa(sectionA, 1, llm);
    expect(qas.map((q) => q.question)).toEqual(["How much current?"]);
    llm.assertExhausted();
  });
});

describe("generateGoldenQa — malformed qaGen response", () => {
  it("treats invalid JSON as zero items and retries once before giving up", async () => {
    const llm = script()
      .qaRaw("this is not valid JSON at all")
      .qa([{ question: "Q1-retry", refAnswer: "A1", anchorQuote: "500 mA of current" }])
      .build();
    const qas = await generateGoldenQa(sectionA, 1, llm);
    expect(qas).toHaveLength(1);
    expect(qas[0]?.question).toBe("Q1-retry");
    llm.assertExhausted();
  });
});

describe("runGate — threshold boundary and floating-point handling (gate discrimination 4/5, no deletion or relaxation)", () => {
  const tenSections: Section[] = Array.from({ length: 10 }, (_, i) => ({
    id: `s${String(i)}`,
    heading: `Section ${String(i)}`,
    level: 1,
    text: `Fact number ${String(i)} is stated here.`,
  }));
  const tenFiles: AssembledFile[] = tenSections.map((s) => ({
    path: `chapters/ch${s.id}.md`,
    content: `${s.text} [§${s.id}]`,
    estimatedTokens: 5,
  }));
  const tenChapters: GateChapter[] = tenSections.map((s) => ({
    file: `chapters/ch${s.id}.md`,
    sectionIds: [s.id],
  }));

  function buildScript(correctCount: number) {
    let b = script();
    for (const s of tenSections) {
      b = b.qa([{ question: `Q ${s.id}`, refAnswer: "A", anchorQuote: "is stated here" }]);
    }
    for (let i = 0; i < tenSections.length; i++) {
      const s = tenSections[i];
      if (s === undefined) continue;
      b = b
        .selectChapter(`chapters/ch${s.id}.md`)
        .answer("A")
        .grade(i < correctCount ? "correct" : "wrong");
    }
    return b.build();
  }

  it("passes at exactly 90% (9/10 correct)", async () => {
    const llm = buildScript(9);
    const { report } = await runGate(
      { files: [skillMd, ...tenFiles], chapters: tenChapters, sections: tenSections },
      { llm, k: 1, threshold: 0.9 },
    );
    expect(report.passRate).toBe(0.9);
    expect(report.passed).toBe(true);
  });

  it("fails when short by exactly one question (8/10 correct)", async () => {
    const llm = buildScript(8);
    const { report } = await runGate(
      { files: [skillMd, ...tenFiles], chapters: tenChapters, sections: tenSections },
      { llm, k: 1, threshold: 0.9 },
    );
    expect(report.passRate).toBeCloseTo(0.8);
    expect(report.passed).toBe(false);
  });
});

describe("runGate — answerer isolation (completion criteria: both isolation items)", () => {
  const markedChapter1: AssembledFile = {
    ...chapter1,
    content: `UNIQUE_CHAPTER1_MARKER ${chapter1.content}`,
  };
  const markedChapter2: AssembledFile = {
    ...chapter2,
    content: `UNIQUE_CHAPTER2_MARKER ${chapter2.content}`,
  };
  const glossary: AssembledFile = {
    path: "glossary.md",
    content: "UNIQUE_GLOSSARY_MARKER",
    estimatedTokens: 3,
  };

  it("1/2 — never injects content from unselected chapters or other files into the answerer payload", async () => {
    const llm = script()
      .qa([
        {
          question: "What does the fault LED do?",
          refAnswer: "blinks red",
          anchorQuote: "blinks red",
        },
      ])
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("It blinks red")
      .grade("correct")
      .build();

    await runGate(
      {
        files: [skillMd, markedChapter1, markedChapter2, glossary],
        chapters: [{ file: "chapters/ch02-troubleshooting.md", sectionIds: ["b"] }],
        sections: [sectionB],
      },
      { llm, k: 1 },
    );

    const answererCalls = llm.calls.filter((c) => c.role === "answerer");
    expect(answererCalls).toHaveLength(2); // 1 selection + 1 answer
    const answerCall = answererCalls[1];
    expect(answerCall?.prompt).not.toContain("UNIQUE_CHAPTER1_MARKER");
    expect(answerCall?.prompt).not.toContain("UNIQUE_GLOSSARY_MARKER");
    expect(answerCall?.prompt).toContain("UNIQUE_CHAPTER2_MARKER"); // the selected chapter is actually loaded
  });

  it("2/2 — records the load history for every QA in the report", async () => {
    const llm = script()
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .build();

    const chapter1Only: GateChapter = { file: "chapters/ch01-installation.md", sectionIds: ["a"] };
    const { report } = await runGate(
      { files: [skillMd, chapter1], chapters: [chapter1Only], sections: [sectionA] },
      { llm, k: 1 },
    );

    expect(report.loadHistory).toEqual([
      {
        qaId: "a-q1",
        selectedFile: "chapters/ch01-installation.md",
        loadedFiles: ["chapters/ch01-installation.md"],
      },
    ]);
  });
});

// Gate discrimination 5/5 ("--no-gate → deployed but marked unverified, manifest.gate = skipped") is
// pipeline integration behavior (T6 pipeline.ts), not gate.ts itself, so tests/pipeline.test.ts
// covers it.

describe("generateGoldenQa — anchor validation + one retry (TESTING §3)", () => {
  it("discards an item whose anchorQuote isn't in the section text, keeps a valid regenerated one", async () => {
    const llm = script()
      .qa([{ question: "Q1", refAnswer: "A1", anchorQuote: "this text is not in the section" }])
      .qa([{ question: "Q1-retry", refAnswer: "A1", anchorQuote: "500 mA of current" }])
      .build();
    const qas = await generateGoldenQa(sectionA, 1, llm);
    expect(qas).toHaveLength(1);
    expect(qas[0]?.question).toBe("Q1-retry");
    llm.assertExhausted();
  });

  it("returns no items if the regenerated one also fails — the gate then marks the section unverified (B2)", async () => {
    const llm = script()
      .qa([{ question: "Q1", refAnswer: "A1", anchorQuote: "not in the section" }])
      .qa([{ question: "Q1-retry", refAnswer: "A1", anchorQuote: "also not in the section" }])
      .build();
    const qas = await generateGoldenQa(sectionA, 1, llm);
    expect(qas).toEqual([]);
    llm.assertExhausted(); // exactly one initial call + one regeneration; no unbounded retries
  });

  it("does not retry when the first batch already satisfies k", async () => {
    const llm = script()
      .qa([{ question: "Q1", refAnswer: "A1", anchorQuote: "500 mA of current" }])
      .build();
    const qas = await generateGoldenQa(sectionA, 1, llm);
    expect(qas).toHaveLength(1);
    llm.assertExhausted();
  });
});

describe("runGate — question generation failure injection (B2, SEC-005/AUD-005, completion criteria, discrimination 6/6)", () => {
  it("fails when one chapter's qaGen fails twice even though every asked question is correct", async () => {
    const llm = script()
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qaRaw("{not json") // b: first attempt fails
      .qa([{ question: "LED?", refAnswer: "x", anchorQuote: "quote that is not in section b" }]) // b: the regeneration fails the anchor check too
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .build();

    const { report, goldenQa } = await runGate(
      { files: [skillMd, chapter1, chapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(goldenQa.map((q) => q.sectionId)).toEqual(["a"]); // no questions for b
    expect(report.passRate).toBe(1); // 100% of the questions that were asked...
    expect(report.passed).toBe(false); // ...but an unverified section still means no pass
    expect(report.coverage).toEqual([
      { sectionId: "a", requested: 1, generated: 1 },
      { sectionId: "b", requested: 1, generated: 0 },
    ]);
    expect(report.failures).toEqual([{ qaId: "b-q0", reason: "qa_generation_failed" }]);
    expect(report.perChapter).toEqual([
      { file: "chapters/ch01-installation.md", asked: 1, correct: 1 },
      { file: "chapters/ch02-troubleshooting.md", asked: 0, correct: 0 },
    ]);
    llm.assertExhausted(); // answer/grade were never called for b: there was no question to ask
  });

  it("records a shortfall (some but fewer than k valid items) in coverage without failing on it alone", async () => {
    const llm = script()
      // a: k=2 requested, 1 valid on the first attempt, 0 valid on regeneration → generated 1/2
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qa([{ question: "junk", refAnswer: "x", anchorQuote: "not in a" }])
      // b: 2 valid in one go
      .qa([
        { question: "LED colour?", refAnswer: "red", anchorQuote: "blinks red" },
        { question: "When?", refAnswer: "error", anchorQuote: "error condition" },
      ])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("red")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("error")
      .grade("correct")
      .build();

    const { report } = await runGate(
      { files: [skillMd, chapter1, chapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 2 },
    );

    expect(report.coverage).toEqual([
      { sectionId: "a", requested: 2, generated: 1 },
      { sectionId: "b", requested: 2, generated: 2 },
    ]);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    llm.assertExhausted();
  });

  it("evaluateGoldenQa (eval reuse path) fails a manifest whose QA list has no question for a section", async () => {
    const qas: GoldenQA[] = [
      {
        id: "a-q1",
        sectionId: "a",
        question: "How much current?",
        refAnswer: "500 mA",
        anchorQuote: "500 mA of current",
      },
    ];
    const llm = script()
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .build();
    const report = await evaluateGoldenQa(
      qas,
      { files: [skillMd, chapter1, chapter2], chapters, qaPerSection: 1 },
      llm,
    );
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([{ qaId: "b-q0", reason: "qa_generation_failed" }]);
    expect(report.coverage.find((c) => c.sectionId === "b")).toEqual({
      sectionId: "b",
      requested: 1,
      generated: 0,
    });
    llm.assertExhausted();
  });
});

describe("evaluateGoldenQa — the code holds the chapter allow-list (B3, SEC-006/AUD-006, guardrail 2, completion criteria)", () => {
  const SECRET = "SECRET_REFERENCE_MARKER_7f3a";
  const qa: GoldenQA = {
    id: "a-q1",
    sectionId: "a",
    question: "How much current?",
    refAnswer: `500 mA ${SECRET}`,
    anchorQuote: "500 mA of current",
  };
  const manifestJson = {
    path: "manifest.json",
    content: JSON.stringify({ goldenQa: [qa] }), // the file holding the answers; the answerer must never see it
  };

  it("never loads manifest.json even when a (tampered) chapter list names it — not_found, no answer call, no leak", async () => {
    const tamperedChapters: GateChapter[] = [
      { file: "manifest.json", sectionIds: ["a"] }, // covers even a direct injection that bypassed the schema
    ];
    const llm = script().selectChapter("manifest.json").build(); // no answer/grade scripted

    const report = await evaluateGoldenQa(
      [qa],
      { files: [skillMd, chapter1, manifestJson], chapters: tamperedChapters, qaPerSection: 1 },
      llm,
    );

    expect(report.failures).toEqual([{ qaId: "a-q1", reason: "not_found" }]);
    expect(report.loadHistory).toEqual([
      { qaId: "a-q1", selectedFile: "manifest.json", loadedFiles: [] },
    ]);
    expect(report.passed).toBe(false);
    for (const call of llm.calls) {
      expect(call.prompt).not.toContain(SECRET);
      expect(call.system).not.toContain(SECRET);
    }
    llm.assertExhausted();
  });

  it("treats a real chapter file that is not in the chapter list as not_found (allow-list, not directory listing)", async () => {
    const llm = script().selectChapter("chapters/ch02-troubleshooting.md").build();
    const report = await evaluateGoldenQa(
      [qa],
      {
        files: [skillMd, chapter1, chapter2], // ch02 is on disk,
        chapters: [{ file: "chapters/ch01-installation.md", sectionIds: ["a"] }], // but not in the list
        qaPerSection: 1,
      },
      llm,
    );
    expect(report.failures).toEqual([{ qaId: "a-q1", reason: "not_found" }]);
    llm.assertExhausted();
  });

  it("missingChapterFiles lists manifest chapters that are not on disk", () => {
    expect(
      missingChapterFiles(
        [
          { file: "chapters/ch01-installation.md", sectionIds: ["a"] },
          { file: "chapters/ch09-gone.md", sectionIds: ["z"] },
        ],
        [skillMd, chapter1],
      ),
    ).toEqual(["chapters/ch09-gone.md"]);
  });
});

describe("evaluateGoldenQa — threshold floor and zero questions (B4, SEC-007/AUD-008, completion criteria)", () => {
  it("fails with zero questions regardless of the threshold, even with an empty population", async () => {
    const llm = script().build();
    const report = await evaluateGoldenQa([], { files: [skillMd], chapters: [] }, llm, 0.5);
    expect(report.passRate).toBe(0);
    expect(report.passed).toBe(false);
    llm.assertExhausted();
  });

  it("refuses a threshold below the policy floor instead of grading against it", async () => {
    const llm = script().build();
    await expect(evaluateGoldenQa([], { files: [skillMd], chapters: [] }, llm, 0)).rejects.toThrow(
      /outside the allowed range \[0\.5, 1\]/u,
    );
    await expect(
      evaluateGoldenQa([], { files: [skillMd], chapters: [] }, llm, 1.01),
    ).rejects.toThrow(/outside the allowed range/u);
    llm.assertExhausted();
  });

  it("runGate with no sections at all is a failed gate, not a vacuous pass", async () => {
    const llm = script().build();
    const { report, goldenQa } = await runGate(
      { files: [skillMd], chapters: [], sections: [] },
      { llm, k: 1 },
    );
    expect(goldenQa).toEqual([]);
    expect(report.passed).toBe(false);
    llm.assertExhausted();
  });
});

describe("estimateGateCalls", () => {
  it("computes sections*(2 + 3k) — one qaGen retry per section is part of the bound (DESIGN §4 D1 correction)", () => {
    expect(estimateGateCalls(5, 3)).toBe(5 * (2 + 3 * 3));
  });

  it("is a true upper bound: a gate where every section needs the qaGen retry never exceeds it", async () => {
    // 2 sections, k=1: 2 qaGen calls per section (first fails → regenerate) + 2 questions × 3
    // = 4 + 6 = 10 = estimateGateCalls(2, 1)
    const llm = script()
      .qaRaw("{bad")
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qaRaw("{bad")
      .qa([{ question: "LED?", refAnswer: "blinks red", anchorQuote: "blinks red" }])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("blinks red")
      .grade("correct")
      .build();
    await runGate(
      { files: [skillMd, chapter1, chapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );
    expect(llm.calls).toHaveLength(estimateGateCalls(2, 1));
    llm.assertExhausted();
  });
});

describe("estimateEvalCalls (D2)", () => {
  it("is 3 calls per golden QA (select + answer + grade)", () => {
    expect(estimateEvalCalls(0)).toBe(0);
    expect(estimateEvalCalls(7)).toBe(21);
  });
});

describe("runGate under a call cap (D1, completion criteria: a cap of 6 blocks the 7th call)", () => {
  it("throws LlmCallCapError before the 7th call and never reaches the underlying provider for it", async () => {
    const inner = script()
      .qa([
        { question: "How much current?", refAnswer: "500 mA", anchorQuote: "500 mA of current" },
      ])
      .qa([{ question: "LED?", refAnswer: "blinks red", anchorQuote: "blinks red" }])
      .selectChapter("chapters/ch01-installation.md")
      .answer("500 mA")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      // nothing is scripted from the 7th call (answer) on; had the cap not blocked it, the test would
      // have failed as exhausted
      .build();
    const capped = trackCost(inner, { maxCalls: 6 });

    await expect(
      runGate(
        { files: [skillMd, chapter1, chapter2], chapters, sections: [sectionA, sectionB] },
        { llm: capped.llm, k: 1 },
      ),
    ).rejects.toMatchObject({ name: "LlmCallCapError", calls: 6, limit: 6 });
    expect(capped.summary().calls).toBe(6);
    expect(inner.calls).toHaveLength(6);
    inner.assertExhausted();
  });
});
