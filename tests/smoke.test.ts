// T10 완료 기준: "dry 구조(대본)로 스크립트 자체 테스트" — scripts/smoke.ts 자체는 실행하지 않는다(실
// ANTHROPIC_API_KEY를 요구하고 실 네트워크를 부른다). 대신 그 로직이 담긴 src/cli/smoke.ts의
// runSmoke()를 ScriptedLlm 대본으로 돌려, 실 samples/manual.pdf를 실 추출기로 읽되 LLM만 대신한다
// (가드레일 3: 실 네트워크·실 LLM 호출 0건).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { loadConfig } from "../src/core/config.js";
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

describe("runSmoke — dry run (실 samples/manual.pdf + ScriptedLlm)", () => {
  it("게이트 통과: 리포트와 비용 요약을 찍고 0을 반환한다", async () => {
    const plan: SkillPlan = {
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

    const llm = script()
      .outline(plan)
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
      .answer("Hold the control button for five seconds to reboot.")
      .grade("correct")
      .build();

    const captured = lines();
    const code = await runSmoke({ path: samplePath }, baseDeps({ out: captured.out, llm }));

    expect(code).toBe(0);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("PASSED");
    expect(output).toContain("비용 요약: LLM 호출 19회");
  });

  it("게이트 미달: 리포트와 비용 요약을 찍고 1을 반환한다", async () => {
    const plan: SkillPlan = {
      slug: "skillsync-x200",
      title: "SkillSync X200 User Manual (Fixture)",
      chapters: [
        {
          id: "overview",
          file: "ignored",
          title: "Overview",
          sectionIds: ["overview"],
        },
      ],
    };
    const llm = script()
      .outline(plan)
      .distill(
        "ch01",
        "The X200 reads sensor input over a serial bus and reports status through three LEDs: " +
          "power, link, and fault. [§overview]",
      )
      .qa([
        {
          question: "Which three LEDs does the X200 report status through?",
          refAnswer: "Power, link, and fault.",
          anchorQuote:
            "The X200 reads sensor input over a serial bus and reports status through three LEDs: power, link, and fault.",
        },
      ])
      .selectChapter("chapters/ch01-overview.md")
      .answer("It doesn't have any status indicators.")
      .grade("wrong")
      .build();

    const captured = lines();
    const code = await runSmoke(
      { path: samplePath },
      baseDeps({ out: captured.out, llm, config: loadConfig({ QA_PER_SECTION: "1" }) }),
    );

    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("FAILED");
    expect(output).toContain("비용 요약: LLM 호출 6회");
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
});
