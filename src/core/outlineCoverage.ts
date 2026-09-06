// outline 커버리지 검증 — B1(DESIGN §5.1, 001-004·SEC-004·AUD-004). 검증 모집단(파이프라인이 결정한
// 실질 섹션 전체)은 모델 재량이 아니다: 모델이 만든 계획이 그 모집단을 정확히 한 번씩 덮는지 여기서
// 결정론으로 확인한다. 순수 함수, 외부 IO 없음.
import type { Section, SkillPlan } from "./types.js";

/** 실질 섹션 = 본문이 있는 섹션. 본문 없는 헤딩(하위 헤딩만 거느린 컨테이너)은 모집단에서 뺀다 —
 * 증류할 것도, 질문을 뽑을 원문도 없다. 이 판정은 outline을 부르기 전에 파이프라인이 한다. */
export function isSubstantiveSection(section: Pick<Section, "text">): boolean {
  return section.text.trim() !== "";
}

export interface OutlineCoverageIssues {
  /** 모집단에 있는데 어느 챕터에도 배정되지 않은 섹션 id(모집단 순서). */
  missing: string[];
  /** 계획이 참조했지만 모집단에 없는 id(계획 순서). */
  unknown: string[];
  /** 두 번 이상 배정된 섹션 id. */
  duplicateSections: string[];
  /** 두 번 이상 쓰인 chapter id. */
  duplicateChapters: string[];
}

/** 문제가 없으면 undefined. 있으면 네 종류를 전부 모아 돌려준다(한 번에 다 고칠 수 있게). */
export function checkOutlineCoverage(
  plan: SkillPlan,
  population: readonly Pick<Section, "id">[],
): OutlineCoverageIssues | undefined {
  const required = new Set(population.map((s) => s.id));
  const assigned = new Map<string, number>();
  const chapterIds = new Map<string, number>();
  for (const chapter of plan.chapters) {
    chapterIds.set(chapter.id, (chapterIds.get(chapter.id) ?? 0) + 1);
    for (const id of chapter.sectionIds) assigned.set(id, (assigned.get(id) ?? 0) + 1);
  }

  const issues: OutlineCoverageIssues = {
    missing: [...required].filter((id) => !assigned.has(id)),
    unknown: [...assigned.keys()].filter((id) => !required.has(id)),
    duplicateSections: [...assigned].filter(([, n]) => n > 1).map(([id]) => id),
    duplicateChapters: [...chapterIds].filter(([, n]) => n > 1).map(([id]) => id),
  };
  const clean =
    issues.missing.length === 0 &&
    issues.unknown.length === 0 &&
    issues.duplicateSections.length === 0 &&
    issues.duplicateChapters.length === 0;
  return clean ? undefined : issues;
}

/** 사람이 읽을 한 줄 요약 — CLI 오류 메시지와 PipelineError.detail에 그대로 쓴다. */
export function formatOutlineCoverageIssues(issues: OutlineCoverageIssues): string {
  const parts: string[] = [];
  if (issues.missing.length > 0) parts.push(`unassigned sections: ${issues.missing.join(", ")}`);
  if (issues.unknown.length > 0) parts.push(`unknown section ids: ${issues.unknown.join(", ")}`);
  if (issues.duplicateSections.length > 0) {
    parts.push(`sections assigned more than once: ${issues.duplicateSections.join(", ")}`);
  }
  if (issues.duplicateChapters.length > 0) {
    parts.push(`duplicate chapter ids: ${issues.duplicateChapters.join(", ")}`);
  }
  return parts.join("; ");
}
