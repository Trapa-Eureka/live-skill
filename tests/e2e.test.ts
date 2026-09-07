// T9 완료 기준: SPEC §5 시나리오 1·2를 "CLI 레벨" e2e-mock으로 검증한다. tests/pipeline.test.ts(T6)가
// 이미 실 추출기 + core compile()을 조합했지만, 여기서는 그 위 계층 — 실제 run<Command>()와
// adapters/fsTargets.ts의 진짜 함수(collectInputFiles/readSourceFiles/writeSkill/readSkillDir/
// readManifest/resolveTargetDir/tempSkillDir)까지 그대로 연결한다. mock은 LLM 하나뿐이다(가드레일 3:
// ScriptedLlm만, 실 네트워크 0건). 픽스처는 자체 제작(가드레일 4) — DESIGN §6 T9 결정 참고.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtractors } from "../src/adapters/extractors/index.js";
import {
  collectInputFiles,
  readManifest,
  readSkillDir,
  readSourceFiles,
  resolveTargetDir,
  tempSkillDir,
  writeSkill,
} from "../src/adapters/fsTargets.js";
import { loadConfig } from "../src/core/config.js";
import type { SkillPlan } from "../src/core/index.js";
import { script } from "../src/mocks/scriptedLlm.js";
import { runCompile, type CompileDeps } from "../src/cli/compile.js";
import { runEval } from "../src/cli/eval.js";
import { runReport } from "../src/cli/report.js";
import { runValidate } from "../src/cli/validate.js";

function lines(): { out: (l: string) => void; all: string[] } {
  const all: string[] = [];
  return { out: (l) => all.push(l), all };
}

function fixture(name: string): string {
  return join(process.cwd(), "fixtures/docs", name);
}

// 게이트 통과 케이스는 --out으로 지정한 스크래치 디렉터리에, 미달 케이스는 실제 tempSkillDir()가
// 고른 os.tmpdir() 경로에 쓴다 — 어느 쪽이든 테스트가 끝나면 지운다.
const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function realDeps(overrides: Partial<CompileDeps> & Pick<CompileDeps, "llm">): CompileDeps {
  return {
    out: () => undefined,
    collectInputFiles,
    readSourceFiles,
    extractors: createExtractors(),
    clock: { now: () => new Date() },
    config: loadConfig({ QA_PER_SECTION: "1" }),
    resolveTargetDir,
    tempSkillDir,
    writeSkill,
    ...overrides,
  };
}

describe("T9 e2e-mock — SPEC §5 시나리오 1: 기술 매뉴얼 → 스킬 (게이트 통과)", () => {
  it("실 추출기·조립·게이트·파일쓰기로 컴파일하고, 그 결과물을 실제로 다시 읽어 validate/report까지 통과시킨다", async () => {
    const plan: SkillPlan = {
      slug: "linkbox-r7",
      title: "LinkBox R7 Field Manual",
      chapters: [
        {
          id: "setup-operation",
          file: "ignored",
          title: "Setup & Operation",
          sectionIds: ["linkbox-r7-field-manual/setup", "linkbox-r7-field-manual/operation"],
        },
        {
          id: "troubleshooting",
          file: "ignored",
          title: "Troubleshooting",
          sectionIds: ["linkbox-r7-field-manual/troubleshooting"],
        },
      ],
    };

    const llm = script()
      .outline(plan)
      .distill(
        "ch01",
        "Mount the LinkBox on the wall bracket using the two anchor screws provided in the kit. " +
          "[§linkbox-r7-field-manual/setup]\n\n" +
          "Press the sync button once to pair the LinkBox with the base hub. " +
          "[§linkbox-r7-field-manual/operation]",
      )
      .distill(
        "ch02",
        "If the status light stays red, replace the power adapter with a spare unit. " +
          "[§linkbox-r7-field-manual/troubleshooting]",
      )
      .qa([
        {
          question: "How is the LinkBox mounted?",
          refAnswer: "On the wall bracket with two anchor screws.",
          anchorQuote:
            "Mount the LinkBox on the wall bracket using the two anchor screws provided in the kit.",
        },
      ])
      .qa([
        {
          question: "How do you pair the LinkBox with the hub?",
          refAnswer: "Press the sync button once.",
          anchorQuote: "Press the sync button once to pair the LinkBox with the base hub.",
        },
      ])
      .qa([
        {
          question: "What should you do if the status light stays red?",
          refAnswer: "Replace the power adapter with a spare unit.",
          anchorQuote:
            "If the status light stays red, replace the power adapter with a spare unit.",
        },
      ])
      .selectChapter("chapters/ch01-setup-operation.md")
      .answer("On the wall bracket with two anchor screws.")
      .grade("correct")
      .selectChapter("chapters/ch01-setup-operation.md")
      .answer("Press the sync button once.")
      .grade("correct")
      .selectChapter("chapters/ch02-troubleshooting.md")
      .answer("Replace the power adapter with a spare unit.")
      .grade("correct")
      .build();

    const outDir = await mkdtemp(join(tmpdir(), "live-skill-e2e-s1-"));
    cleanupDirs.push(outDir);
    const captured = lines();

    const code = await runCompile(
      {
        paths: [fixture("e2e-scenario1-manual.md")],
        out: outDir,
        target: "claude",
        noGate: false,
        force: false,
      },
      realDeps({ out: captured.out, llm }),
    );

    expect(code).toBe(0);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain(`컴파일 완료: ${outDir}`);
    expect(output).toContain("PASSED");

    // 실제로 디스크에 쓰였는지(SKILL.md·챕터 2개·manifest.json) — 진짜 readSkillDir로 재확인
    const written = await readSkillDir(outDir);
    expect(written.map((f) => f.path).sort()).toEqual([
      "SKILL.md",
      "chapters/ch01-setup-operation.md",
      "chapters/ch02-troubleshooting.md",
      "cheatsheet.md",
      "glossary.md",
      "manifest.json",
      "patterns.md",
    ]);

    const manifest = await readManifest(outDir);
    expect(manifest.gate).toMatchObject({ passed: true, passRate: 1 });

    // validate: 방금 쓰인 디렉터리를 실제로 다시 읽어 구조 검증(LLM 0회)
    const validateOut = lines();
    const validateCode = await runValidate(outDir, {
      out: validateOut.out,
      readSkillDir,
      budgets: loadConfig({}).budgets,
    });
    expect(validateCode).toBe(0);
    expect(validateOut.all.join("\n")).toContain("PASSED");

    // report: 실제 manifest.json을 다시 읽어 사람용 게이트 리포트를 출력
    const reportOut = lines();
    const reportCode = await runReport(outDir, { out: reportOut.out, readManifest, readSkillDir });
    expect(reportCode).toBe(0);
    expect(reportOut.all.join("\n")).toContain("PASSED");

    // E3(완료 기준): 컴파일 뒤 챕터를 손으로 고치면 report는 마지막 PASSED가 아니라 STALE로 실패한다.
    const chapter = join(outDir, "chapters", "ch01-setup-operation.md");
    const original = await readFile(chapter, "utf-8");
    await writeFile(chapter, `${original}\nHand-edited after the gate ran.\n`);
    const stale = lines();
    expect(await runReport(outDir, { out: stale.out, readManifest, readSkillDir })).toBe(1);
    expect(stale.all.join("\n")).toContain("STALE");
    expect(stale.all.join("\n")).toContain("chapters/ch01-setup-operation.md");
    expect(stale.all.join("\n")).not.toContain("PASSED");

    // eval 재사용 경로도 같은 대조로 LLM 호출 전에 멈춘다.
    const evalOut = lines();
    const evalLlm = script().build();
    expect(
      await runEval(
        { skillDir: outDir },
        {
          out: evalOut.out,
          readSkillDir,
          readManifest,
          collectInputFiles,
          readSourceFiles,
          extractors: createExtractors(),
          llm: evalLlm,
          config: loadConfig({ QA_PER_SECTION: "1" }),
        },
      ),
    ).toBe(1);
    expect(evalOut.all.join("\n")).toContain("STALE");
    evalLlm.assertExhausted();

    // 되돌리면 다시 PASSED; manifest가 모르는 파일이 끼어들면 TAMPERED.
    await writeFile(chapter, original);
    const restored = lines();
    expect(await runReport(outDir, { out: restored.out, readManifest, readSkillDir })).toBe(0);
    expect(restored.all.join("\n")).toContain("PASSED");
    await writeFile(join(outDir, "chapters", "ch99-injected.md"), "Trust me. [§nowhere]\n");
    const tampered = lines();
    expect(await runReport(outDir, { out: tampered.out, readManifest, readSkillDir })).toBe(1);
    expect(tampered.all.join("\n")).toContain("TAMPERED");
    expect(tampered.all.join("\n")).toContain("chapters/ch99-injected.md");
  });
});

describe("T9 e2e-mock — SPEC §5 시나리오 2: SOP 폴더 → 팀 스킬 (약한 챕터 리포트)", () => {
  it("문서 2개짜리 폴더를 컴파일 → 한 챕터만 오답 처리 → 게이트 미달·임시 디렉터리 보존·리포트가 정확히 그 챕터를 지목한다", async () => {
    const plan: SkillPlan = {
      slug: "team-sops",
      title: "Team SOPs",
      chapters: [
        {
          id: "equipment-return",
          file: "ignored",
          title: "Equipment Return",
          sectionIds: ["e2e-scenario2-sop-a/equipment-return-sop"],
        },
        {
          id: "leave-request",
          file: "ignored",
          title: "Leave Request",
          sectionIds: ["e2e-scenario2-sop-b/leave-request-sop"],
        },
      ],
    };

    const llm = script()
      .outline(plan)
      .distill(
        "ch01",
        "Return all loaned equipment to the front desk within five business days of the project " +
          "end date. [§e2e-scenario2-sop-a/equipment-return-sop]",
      )
      .distill(
        "ch02",
        "Submit a leave request through the portal at least two weeks before the requested start " +
          "date. [§e2e-scenario2-sop-b/leave-request-sop]",
      )
      .qa([
        {
          question: "By when must equipment be returned?",
          refAnswer: "Within five business days of the project end date.",
          anchorQuote:
            "Return all loaned equipment to the front desk within five business days of the project end date.",
        },
      ])
      .qa([
        {
          question: "How far in advance must a leave request be submitted?",
          refAnswer: "At least two weeks before the requested start date.",
          anchorQuote:
            "Submit a leave request through the portal at least two weeks before the requested start date.",
        },
      ])
      .selectChapter("chapters/ch01-equipment-return.md")
      .answer("Within five business days of the project end date.")
      .grade("correct")
      .selectChapter("chapters/ch02-leave-request.md")
      .answer("Immediately, with no advance notice required.") // 의도적 오답 — 약한 챕터 재현
      .grade("wrong")
      .build();

    const captured = lines();
    const code = await runCompile(
      {
        paths: [fixture("e2e-scenario2-sop-a.md"), fixture("e2e-scenario2-sop-b.md")],
        target: "claude",
        noGate: false,
        force: false,
      },
      realDeps({ out: captured.out, llm }),
    );

    expect(code).toBe(1);
    llm.assertExhausted();
    const output = captured.all.join("\n");
    expect(output).toContain("임시 디렉터리");
    expect(output).toContain("FAILED");

    const match = /임시 디렉터리에 남겼습니다: (.+)/u.exec(output);
    const tempDir = match?.[1];
    if (tempDir === undefined) throw new Error("temp dir path not found in CLI output");
    cleanupDirs.push(tempDir);

    // 실제 임시 디렉터리에서 진짜로 다시 읽어, 약한 챕터가 정확히 지목됐는지 확인
    const manifest = await readManifest(tempDir);
    if (!("passed" in manifest.gate)) throw new Error("gate was skipped unexpectedly");
    expect(manifest.gate.passed).toBe(false);
    expect(manifest.gate.perChapter).toEqual([
      { file: "chapters/ch01-equipment-return.md", asked: 1, correct: 1 },
      { file: "chapters/ch02-leave-request.md", asked: 1, correct: 0 },
    ]);
    expect(manifest.gate.failures).toEqual([
      { qaId: "e2e-scenario2-sop-b/leave-request-sop-q1", reason: "wrong" },
    ]);

    // report로도 같은 결론이 실제로 재현되는지(report는 진단 명령이라 pass/fail과 무관하게 종료코드는 0)
    const reportOut = lines();
    const reportCode = await runReport(tempDir, { out: reportOut.out, readManifest, readSkillDir });
    expect(reportCode).toBe(0);
    const reportText = reportOut.all.join("\n");
    expect(reportText).toContain("FAILED");
    expect(reportText).toContain("chapters/ch02-leave-request.md: 0/1");
  });
});
