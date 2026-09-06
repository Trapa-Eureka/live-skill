// T7 완료 기준 — TESTING §4 "게이트 판별력" 5항목 전부(삭제·완화 금지, CLAUDE.md 가드레일 1) +
// "answerer 격리" 2항목 전부.
import { describe, expect, it } from "vitest";
import type { AssembledFile } from "../src/core/assembler.js";
import {
  estimateGateCalls,
  generateGoldenQa,
  runGate,
  type GateChapter,
} from "../src/core/gate.js";
import type { Section } from "../src/core/index.js";
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

describe("runGate — normal script (게이트 판별력 1/5)", () => {
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

    const report = await runGate(
      { files: [skillMd, chapter1, chapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(report.passRate).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    llm.assertExhausted();
  });
});

describe("runGate — 챕터 누락 주입 (게이트 판별력 2/5, 삭제·완화 금지)", () => {
  it("fails the section with not_found when its chapter is missing from assembly, and identifies the weak chapter", async () => {
    const filesWithoutChapter2 = [skillMd, chapter1]; // chapter2가 조립 결과에서 빠졌다
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
      // ch02는 SKILL.md 인덱스엔 여전히 있으니 LLM은 그대로 선택하지만, 실제 파일이 없다.
      .selectChapter("chapters/ch02-troubleshooting.md")
      .build();

    const report = await runGate(
      { files: filesWithoutChapter2, chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(report.passRate).toBeCloseTo(0.5);
    expect(report.passed).toBe(false); // 임계치(0.9) 미달
    expect(report.failures).toContainEqual({ qaId: "b-q1", reason: "not_found" });
    const weakChapter = report.perChapter.find(
      (c) => c.file === "chapters/ch02-troubleshooting.md",
    );
    expect(weakChapter).toEqual({ file: "chapters/ch02-troubleshooting.md", asked: 1, correct: 0 });
    // 증거: not_found로 조기 종료됐으므로 answer/grade는 그 문항에 대해 전혀 호출되지 않았다(대본에도 안 줌).
    llm.assertExhausted();
  });
});

describe("runGate — 오답 증류 주입 (게이트 판별력 3/5, 삭제·완화 금지)", () => {
  it("fails via the grader when a corrupted chapter leads to a contradicting answer", async () => {
    // 앵커 문구("The fault LED blinks")는 훼손된 챕터에도 살아남지만, 핵심 사실(red→green)은 반전됐다.
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
      .answer("green") // 훼손된 챕터를 그대로 읽었다면 나올 법한 답
      .grade("wrong") // grader가 refAnswer("red")와 모순됨을 잡아낸다
      .build();

    const report = await runGate(
      { files: [skillMd, chapter1, corruptedChapter2], chapters, sections: [sectionA, sectionB] },
      { llm, k: 1 },
    );

    expect(report.passed).toBe(false);
    expect(report.failures).toContainEqual({ qaId: "b-q1", reason: "wrong" });
    llm.assertExhausted();
  });
});

describe("runGate — anchor_missing: 선택된 챕터에 앵커 문구 자체가 사라진 경우", () => {
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
      .build(); // answer/grade는 대본에 없다 — 호출되면 테스트가 실패한다

    const report = await runGate(
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

describe("runGate — 임계치 경계, 부동소수 처리 (게이트 판별력 4/5, 삭제·완화 금지)", () => {
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
    const report = await runGate(
      { files: [skillMd, ...tenFiles], chapters: tenChapters, sections: tenSections },
      { llm, k: 1, threshold: 0.9 },
    );
    expect(report.passRate).toBe(0.9);
    expect(report.passed).toBe(true);
  });

  it("fails when short by exactly one question (8/10 correct)", async () => {
    const llm = buildScript(8);
    const report = await runGate(
      { files: [skillMd, ...tenFiles], chapters: tenChapters, sections: tenSections },
      { llm, k: 1, threshold: 0.9 },
    );
    expect(report.passRate).toBeCloseTo(0.8);
    expect(report.passed).toBe(false);
  });
});

describe("runGate — answerer isolation (완료 기준: 격리 2항목 전부)", () => {
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
    expect(answererCalls).toHaveLength(2); // 선택 1회 + 답변 1회
    const answerCall = answererCalls[1];
    expect(answerCall?.prompt).not.toContain("UNIQUE_CHAPTER1_MARKER");
    expect(answerCall?.prompt).not.toContain("UNIQUE_GLOSSARY_MARKER");
    expect(answerCall?.prompt).toContain("UNIQUE_CHAPTER2_MARKER"); // 선택된 챕터는 실제로 로드된다
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
    const report = await runGate(
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

// 게이트 판별력 5/5 ("--no-gate → 배포되지만 unverified 표시, manifest.gate = skipped")는
// gate.ts 자체가 아니라 파이프라인 통합(T6 pipeline.ts)의 동작이라 tests/pipeline.test.ts에서 검증한다.

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

  it("excludes the item entirely if the regenerated one also fails (문항 제외)", async () => {
    const llm = script()
      .qa([{ question: "Q1", refAnswer: "A1", anchorQuote: "not in the section" }])
      .qa([{ question: "Q1-retry", refAnswer: "A1", anchorQuote: "also not in the section" }])
      .build();
    const qas = await generateGoldenQa(sectionA, 1, llm);
    expect(qas).toEqual([]);
    llm.assertExhausted(); // 정확히 최초 1회 + 재생성 1회만 — 무한 재시도 없음
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

describe("estimateGateCalls", () => {
  it("computes sections*(1 + 3k) as the upper-bound call estimate (DESIGN §4 T7 결정)", () => {
    expect(estimateGateCalls(5, 3)).toBe(5 * (1 + 3 * 3));
  });
});
