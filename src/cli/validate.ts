// validate command: structural validation only, zero LLM calls (DESIGN §6). The logic lives in
// core/validator.ts; this is assembly only.
import { formatValidationReport, validateSkill, type Budgets } from "../core/index.js";
import type { SkillFile } from "../core/validator.js";

export interface ValidateDeps {
  out: (line: string) => void;
  readSkillDir: (dir: string) => Promise<SkillFile[]>;
  budgets: Budgets;
}

export async function runValidate(skillDir: string, deps: ValidateDeps): Promise<number> {
  let files: SkillFile[];
  try {
    files = await deps.readSkillDir(skillDir);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(`Cannot read "${skillDir}". Fix: check that the path is correct. (${detail})`);
    return 1;
  }
  const report = validateSkill(files, deps.budgets);
  deps.out(formatValidationReport(report));
  return report.passed ? 0 : 1;
}
