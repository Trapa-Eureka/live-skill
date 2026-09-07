// I1(001-018): `--target`은 claude|agents만 — 오탈자는 실행 전에 거부된다(예전엔 조용히 claude로 갔다).
// commander의 exitOverride로 프로세스를 띄우지 않고 파싱만 검증한다(LLM·fs 0건).
import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import { SKILL_TARGETS, buildProgram } from "../src/cli/program.js";

function silentProgram() {
  const program = buildProgram();
  program.exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  for (const sub of program.commands) {
    sub.exitOverride();
    sub.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  }
  return program;
}

describe("compile --target (I1)", () => {
  it("declares exactly claude|agents as the allowed choices with claude as the default", () => {
    const compile = buildProgram().commands.find((c) => c.name() === "compile");
    const target = compile?.options.find((o) => o.long === "--target");
    expect(target?.argChoices).toEqual([...SKILL_TARGETS]);
    expect(target?.defaultValue).toBe("claude");
  });

  it.each(["claud", "Claude", "agent", "codex", ""])(
    "rejects %j before running anything, naming the allowed choices",
    async (bad) => {
      const program = silentProgram();
      let thrown: unknown;
      try {
        await program.parseAsync(["compile", "doc.md", "--target", bad], { from: "user" });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(CommanderError);
      const err = thrown as CommanderError;
      expect(err.code).toBe("commander.invalidArgument");
      expect(err.exitCode).not.toBe(0);
      expect(err.message).toContain("claude, agents");
    },
  );
});
