// commander program definition, no logic (CLAUDE.md convention: cli/ is assembly only). Real IO lives
// in adapters/, and the real pipeline/gate decisions in core/. index.ts loads .env, wraps the error
// boundary, and runs this program. The definition was pulled out here (I1) so option validation
// (the `--target` choices) can be tested without spawning a process.
import { Command, Option } from "commander";
import { ClaudeLlmProvider } from "../adapters/llmProvider.js";
import {
  collectInputFiles,
  readManifest,
  readSkillDir,
  readSourceFiles,
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

export const SKILL_TARGETS = ["claude", "agents"] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];

const out = (line: string): void => {
  console.log(line);
};

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key === "") {
    console.error(
      "ANTHROPIC_API_KEY is not set. Fix: copy .env.example to .env and fill in the key.",
    );
    process.exit(1);
  }
  return key;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("live-skills")
    .description("Compile documents, folders, and URLs into verified agent skills")
    .version(PACKAGE_VERSION);

  program
    .command("compile")
    .description(
      "Compile files/folders/globs into an Agent Skills-standard skill and run the quality gate",
    )
    .argument("<paths...>", "files or folders to compile")
    .option("--out <dir>", "output directory")
    // I1(001-018): a typo ("claud") used to be silently treated as claude; choices reject it before
    // anything runs.
    .addOption(
      new Option("--target <target>", "target skill directory")
        .choices([...SKILL_TARGETS])
        .default("claude"),
    )
    .option("--no-gate", "skip the quality gate (the output is marked unverified)")
    .option("--force", "allow overwriting an existing skill directory")
    .action(
      async (
        paths: string[],
        options: { out?: string; target: SkillTarget; gate: boolean; force?: boolean },
      ) => {
        const config = loadConfig(process.env);
        process.exitCode = await runCompile(
          {
            paths,
            out: options.out,
            target: options.target,
            noGate: !options.gate,
            force: options.force ?? false,
          },
          {
            out,
            collectInputFiles,
            readSourceFiles,
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
    .description("Validate a skill directory's structure only (no LLM calls)")
    .argument("<skillDir>", "skill directory to validate")
    .action(async (skillDir: string) => {
      const config = loadConfig(process.env);
      process.exitCode = await runValidate(skillDir, {
        out,
        readSkillDir,
        budgets: config.budgets,
      });
    });

  program
    .command("eval")
    .description("Re-grade an existing skill")
    .argument("<skillDir>", "skill directory to re-grade")
    .option(
      "--source <paths...>",
      "source documents to re-grade against (default: reuse the QA in the manifest)",
    )
    .action(async (skillDir: string, options: { source?: string[] }) => {
      const config = loadConfig(process.env);
      process.exitCode = await runEval(
        { skillDir, source: options.source },
        {
          out,
          readSkillDir,
          readManifest,
          collectInputFiles,
          readSourceFiles,
          extractors: createExtractors(),
          llm: new ClaudeLlmProvider({ apiKey: requireApiKey(), model: config.model }),
          config,
        },
      );
    });

  program
    .command("report")
    .description("Print the last GateReport in human-readable form")
    .argument("[skillDir]", "skill directory (default: current directory)")
    .action(async (skillDir: string | undefined) => {
      process.exitCode = await runReport(skillDir, { out, readManifest, readSkillDir });
    });

  return program;
}
