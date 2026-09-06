#!/usr/bin/env node
// CLI 조립 루트 — 로직 없음(CLAUDE.md 컨벤션: cli/는 조립만). 실제 IO는 adapters/, 실제 파이프라인·게이트
// 판단은 core/에 있다. 여기선 commander 옵션을 읽어 deps를 만들고 run<Command>()에 넘길 뿐이다.
import { Command } from "commander";
import { ClaudeLlmProvider } from "../adapters/llmProvider.js";
import {
  collectInputFiles,
  readManifest,
  readSkillDir,
  readSourceFile,
  resolveTargetDir,
  tempSkillDir,
  writeSkill,
} from "../adapters/fsTargets.js";
import { createExtractors } from "../adapters/extractors/index.js";
import { loadConfig } from "../core/index.js";
import { PACKAGE_VERSION } from "../version.js";
import { runCompile } from "./compile.js";
import { runEval } from "./eval.js";
import { runReport } from "./report.js";
import { runValidate } from "./validate.js";

// Node 20.12+는 .env를 직접 읽을 수 있다 — 없거나 지원 안 하면 조용히 넘어간다(guardrail 7: .env는 커밋 안 함).
try {
  process.loadEnvFile();
} catch {
  /* .env 없음 — 무시 */
}

const out = (line: string): void => {
  console.log(line);
};

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key === "") {
    console.error(
      "ANTHROPIC_API_KEY가 설정되지 않았습니다. 수정 방법: .env.example을 .env로 복사하고 키를 채우세요.",
    );
    process.exit(1);
  }
  return key;
}

const program = new Command();
program
  .name("live-skill")
  .description("문서·폴더·URL을 검증된 에이전트 스킬로 컴파일하는 CLI")
  .version(PACKAGE_VERSION);

program
  .command("compile")
  .description("문서/폴더/글롭을 Agent Skills 표준 스킬로 컴파일 + 품질 게이트")
  .argument("<paths...>", "컴파일할 파일/폴더")
  .option("--out <dir>", "출력 디렉터리")
  .option("--target <target>", "타깃 스킬 디렉터리 (claude|agents)", "claude")
  .option("--no-gate", "품질 게이트 건너뛰기 (산출물에 unverified 표시)")
  .option("--force", "기존 스킬 디렉터리 덮어쓰기 허용")
  .action(
    async (
      paths: string[],
      options: { out?: string; target: string; gate: boolean; force?: boolean },
    ) => {
      const config = loadConfig(process.env);
      const target = options.target === "agents" ? "agents" : "claude";
      process.exitCode = await runCompile(
        { paths, out: options.out, target, noGate: !options.gate, force: options.force ?? false },
        {
          out,
          collectInputFiles,
          readSourceFile,
          extractors: createExtractors(),
          llm: new ClaudeLlmProvider({ apiKey: requireApiKey(), model: config.model }),
          clock: { now: () => new Date() },
          config,
          resolveTargetDir,
          tempSkillDir,
          writeSkill,
        },
      );
    },
  );

program
  .command("validate")
  .description("스킬 디렉터리 구조 검증만 (LLM 0회)")
  .argument("<skillDir>", "검증할 스킬 디렉터리")
  .action(async (skillDir: string) => {
    const config = loadConfig(process.env);
    process.exitCode = await runValidate(skillDir, { out, readSkillDir, budgets: config.budgets });
  });

program
  .command("eval")
  .description("기존 스킬 재채점")
  .argument("<skillDir>", "재채점할 스킬 디렉터리")
  .option("--source <paths...>", "재채점에 쓸 원문 경로 (미지정 시 manifest의 QA 재사용)")
  .action(async (skillDir: string, options: { source?: string[] }) => {
    const config = loadConfig(process.env);
    process.exitCode = await runEval(
      { skillDir, source: options.source },
      {
        out,
        readSkillDir,
        readManifest,
        collectInputFiles,
        readSourceFile,
        extractors: createExtractors(),
        llm: new ClaudeLlmProvider({ apiKey: requireApiKey(), model: config.model }),
        config,
      },
    );
  });

program
  .command("report")
  .description("마지막 GateReport 사람용 출력")
  .argument("[skillDir]", "스킬 디렉터리 (미지정 시 현재 디렉터리)")
  .action(async (skillDir: string | undefined) => {
    process.exitCode = await runReport(skillDir, { out, readManifest });
  });

await program.parseAsync(process.argv);
