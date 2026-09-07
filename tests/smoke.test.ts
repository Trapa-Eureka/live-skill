// T10 완료 기준: "dry 구조(대본)로 스크립트 자체 테스트" — scripts/smoke.ts 자체는 실행하지 않는다(실
// ANTHROPIC_API_KEY를 요구하고 실 네트워크를 부른다). 대신 그 로직이 담긴 src/cli/smoke.ts의
// runSmoke()를 ScriptedLlm 대본으로 돌려, 실 samples/manual.pdf를 실 추출기로 읽되 LLM만 대신한다
// (가드레일 3: 실 네트워크·실 LLM 호출 0건).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { loadConfig } from "../src/core/config.js";
import { LlmProviderError } from "../src/core/llmError.js";
import type { SkillPlan } from "../src/core/index.js";
import { script } from "../src/mocks/scriptedLlm.js";
import { runSmoke, type SmokeDeps } from "../src/cli/smoke.js";

function lines(): { out: (l: string) => void; all: string[] } {
  const all: string[] = [];
  return { out: (l) => all.push(l), all };
}

const samplePath = join(process.cwd(), "samples", "manual.pdf");

function baseDeps(overrides: Partial<SmokeDeps> & Pick<SmokeDeps, "llm">): SmokeDeps {
  return {
    out: () => undefined,
    readSourceFile: (p) => Promise.resolve({ path: p, bytes: new Uint8Array(readFileSync(p)) }),
    extractors: createExtractors(),
    clock: { now: () => new Date() },
    config: loadConfig({ QA_PER_SECTION: "1" }),
    ...overrides,
  };
}

// samples/manual.pdf의 실제 추출 결과(본문 있는 섹션 4개)를 전부 덮는 계획 — B1 이후 outline은 모집단을 정확히
// 한 번씩 덮어야 하므로 일부만 넣은 계획은 게이트 이전에 outline_invalid로 끝난다.
const manualPlan: SkillPlan = {
  slug: "skillsync-x200",
  title: "SkillSync X200 User Manual (Fixture)",
  chapters: [
    {
      id: "overview",
      file: "ignored",
      title: "Overview",
      sectionIds: ["skillsync-x200-user-manual-fixture", "overview"],
    },
    {
      id: "installation-troubleshooting",
      file: "ignored",
      title: "Installation & Troubleshooting",
      sectionIds: ["installation", "troubleshooting"],
    },
  ],
};

/** 4문항 대본 — 마지막 문항의 채점만 바꿔 통과/미달을 만든다. */
function manualScript(lastVerdict: "correct" | "wrong") {
  return script()
    .outline(manualPlan)
    .distill(
      "ch01",
      "The SkillSync X200 is a fictional bench-top controller used only as a sample for this " +
        "project. [§skillsync-x200-user-manual-fixture]\n\n" +
        "The X200 reads sensor input over a serial bus and reports status through three LEDs: " +
        "power, link, and fault. [§overview]",
    )
    .distill(
      "ch02",
      "Mount the unit on a flat, grounded surface. [§installation]\n\n" +
        "If the link LED never turns solid, hold the control button for five seconds to reboot. " +
        "[§troubleshooting]",
    )
    .qa([
      {
        question: "What kind of device is the SkillSync X200?",
        refAnswer: "A fictional bench-top controller sample.",
        anchorQuote:
          "The SkillSync X200 is a fictional bench-top controller used only as a sample for this project.",
      },
    ])
    .qa([
      {
        question: "Which three LEDs does the X200 report status through?",
        refAnswer: "Power, link, and fault.",
        anchorQuote:
          "The X200 reads sensor input over a serial bus and reports status through three LEDs: power, link, and fault.",
      },
    ])
    .qa([
      {
        question: "Where should the unit be mounted?",
        refAnswer: "On a flat, grounded surface.",
        anchorQuote: "Mount the unit on a flat, grounded surface.",
      },
    ])
    .qa([
      {
        question: "What do you do if the link LED never turns solid?",
        refAnswer: "Hold the control button for five seconds to reboot.",
        anchorQuote: "hold the control button for five seconds to reboot.",
      },
    ])
    .selectChapter("chapters/ch01-overview.md")
    .answer("A fictional bench-top controller sample.")
    .grade("correct")
    .selectChapter("chapters/ch01-overview.md")
    .answer("Power, link, and fault.")
    .grade("correct")
    .selectChapter("chapters/ch02-installation-troubleshooting.md")
    .answer("On a flat, grounded surface.")
    .grade("correct")
    .selectChapter("chapters/ch02-installation-troubleshooting.md")
    .answer(
      lastVerdict === "correct"
        ? "Hold the control button for five seconds to reboot."
        : "Unplug it and wait a day.",
    )
    .grade(lastVerdict)
    .build();
}

describe("runSmoke — dry run (실 samples/manual.pdf + ScriptedLlm)", () => {
  it("게이트 통과: 리포트와 비용 요약을 찍고 0을 반환한다", async () => {
    const llm = manualScript("correct");
    const captured = lines();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));

    expect(code).toBe(0);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("PASSED");
    expect(output).toContain("비용 요약: LLM 호출 19회");
  });

  it("게이트 미달(3/4 = 75% < 90%): 리포트와 비용 요약을 찍고 1을 반환한다", async () => {
    const llm = manualScript("wrong");
    const captured = lines();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));

    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("FAILED");
    expect(output).toContain("비용 요약: LLM 호출 19회");
  });

  it("경로를 읽을 수 없으면 수정 방법 담긴 메시지와 함께 1을 반환하고, LLM은 한 번도 부르지 않는다", async () => {
    const captured = lines();
    const llm = script().build(); // 대본 0개 — 실제로 호출되면 즉시 실패한다
    const code = await runSmoke(
      { path: "/nonexistent/path/manual.pdf" },
      baseDeps({
        out: captured.out,
        llm,
        readSourceFile: () => Promise.reject(new Error("ENOENT")),
      }),
    );
    expect(code).toBe(1);
    llm.assertExhausted();
    expect(captured.all.join("\n")).toContain("nonexistent/path/manual.pdf");
  });

  it("컴파일 자체가 실패하면(미지원 형식) 실패 메시지 + 비용 요약(호출 0회)을 찍고 1을 반환한다", async () => {
    const captured = lines();
    const llm = script().build();
    const code = await runSmoke(
      { path: "sheet.xlsx" },
      baseDeps({
        out: captured.out,
        llm,
        readSourceFile: (p) => Promise.resolve({ path: p, bytes: new Uint8Array() }),
      }),
    );
    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("컴파일 실패");
    expect(output).toContain("비용 요약: LLM 호출 0회");
  });

  it("provider 실패(rate_limit)가 중간에 나면 단계·종류·수정 방법과 비용 요약(그때까지 호출 수)을 찍고 1을 반환한다 (G1)", async () => {
    const captured = lines();
    const llm = script()
      .outline(manualPlan)
      .distill(
        "ch01",
        "The X200 is a fictional controller. [§skillsync-x200-user-manual-fixture] [§overview]",
      )
      .fail("distill", new LlmProviderError("rate_limit", true, "429 Too Many Requests"))
      .build();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));
    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain(
      "컴파일 실패 — 증류 중 LLM 호출 실패: 요청 한도 초과(rate limit)(rate_limit, 재시도 가능)",
    );
    expect(output).toContain("수정 방법");
    expect(output).toContain("비용 요약: LLM 호출 3회"); // outline 1 + distill 1 + 실패한 distill 1
  });

  it("구조 검증에 걸리면(챕터 예산 초과) 게이트를 부르지 않고 검증 리포트 + 비용 요약(호출 3회)을 찍고 1을 반환한다 (E1)", async () => {
    const captured = lines();
    const llm = script()
      .outline(manualPlan)
      .distill(
        "ch01",
        "The X200 is a fictional controller. [§skillsync-x200-user-manual-fixture] [§overview]",
      )
      .distill("ch02", "Mount it on a flat surface. [§installation] [§troubleshooting]")
      .build(); // 게이트 대본 없음
    const base = loadConfig({ QA_PER_SECTION: "1" });
    const code = await runSmoke(
      { path: samplePath },
      baseDeps({
        out: captured.out,
        llm,
        config: { ...base, budgets: { ...base.budgets, chapter: 5 } },
      }),
    );
    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("검증: FAILED");
    expect(output).toContain("[ERROR] chapters/ch01-overview.md (budget_exceeded)");
    expect(output).toContain("비용 요약: LLM 호출 3회");
  });
});
