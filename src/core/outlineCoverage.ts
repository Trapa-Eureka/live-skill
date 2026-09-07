// Outline coverage check: B1 (DESIGN §5.1, 001-004/SEC-004/AUD-004). The verification population
// (every substantive section, as decided by the pipeline) is not up to the model: this module checks
// deterministically that the model's plan covers that population exactly once. Pure function, no
// external IO.
import type { Section, SkillPlan } from "./types.js";

/** A substantive section is one with body text. A heading without a body (a container holding only
 * sub-headings) is excluded from the population: there is nothing to distill and no source to draw
 * questions from. The pipeline makes this call before invoking outline. */
export function isSubstantiveSection(section: Pick<Section, "text">): boolean {
  return section.text.trim() !== "";
}

export interface OutlineCoverageIssues {
  /** Section ids in the population that no chapter was assigned (population order). */
  missing: string[];
  /** Ids the plan references that are not in the population (plan order). */
  unknown: string[];
  /** Section ids assigned more than once. */
  duplicateSections: string[];
  /** Chapter ids used more than once. */
  duplicateChapters: string[];
}

/** Returns undefined when there are no issues; otherwise collects all four kinds at once (so one retry
 * can fix them all). */
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

/** Human-readable one-line summary, used verbatim in CLI error messages and PipelineError.detail. */
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
