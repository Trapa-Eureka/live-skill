// validate 명령 — 구조 검증만, LLM 0회(DESIGN §6). 로직은 core/validator.ts에 있다, 여긴 조립만.
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
    deps.out(`"${skillDir}"를 읽을 수 없습니다. 수정 방법: 경로가 맞는지 확인하세요. (${detail})`);
    return 1;
  }
  const report = validateSkill(files, deps.budgets);
  deps.out(formatValidationReport(report));
  return report.passed ? 0 : 1;
}
