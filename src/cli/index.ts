#!/usr/bin/env node
// CLI 조립 루트 — 로직 없음(CLAUDE.md 컨벤션: cli/는 조립만).
// 실제 구현(파이프라인·게이트)은 core/adapters가 채워지는 이후 태스크에서 여기 연결한다(DESIGN.md §6).
import { Command } from "commander";
import { PACKAGE_VERSION } from "../version.js";

const notImplemented = (task: string): void => {
  console.error(`not implemented yet — see docs/TASKS.md ${task}`);
  process.exitCode = 1;
};

const program = new Command();
program
  .name("live-skill")
  .description("문서·폴더·URL을 검증된 에이전트 스킬로 컴파일하는 CLI")
  .version(PACKAGE_VERSION);

program
  .command("compile")
  .description("문서/폴더/글롭을 Agent Skills 표준 스킬로 컴파일 + 품질 게이트")
  .argument("<paths...>", "컴파일할 파일/폴더/글롭")
  .option("--out <dir>", "출력 디렉터리")
  .option("--target <target>", "타깃 스킬 디렉터리 (claude|agents)")
  .option("--no-gate", "품질 게이트 건너뛰기 (산출물에 unverified 표시)")
  .option("--force", "기존 스킬 디렉터리 덮어쓰기 허용")
  .action(() => {
    notImplemented("T6~T8");
  });

program
  .command("validate")
  .description("스킬 디렉터리 구조 검증만 (LLM 0회)")
  .argument("<skillDir>", "검증할 스킬 디렉터리")
  .action(() => {
    notImplemented("T5, T8");
  });

program
  .command("eval")
  .description("기존 스킬 재채점")
  .argument("<skillDir>", "재채점할 스킬 디렉터리")
  .option("--source <paths...>", "재채점에 쓸 원문 경로 (미지정 시 manifest의 QA 재사용)")
  .action(() => {
    notImplemented("T7, T8");
  });

program
  .command("report")
  .description("마지막 GateReport 사람용 출력")
  .argument("[skillDir]", "스킬 디렉터리 (미지정 시 기본 타깃)")
  .action(() => {
    notImplemented("T8");
  });

await program.parseAsync(process.argv);
