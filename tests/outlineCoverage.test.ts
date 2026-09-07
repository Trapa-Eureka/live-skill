// B1: unit tests for the pure functions of the outline coverage check (core/outlineCoverage.ts). The
// pipeline wiring is covered by tests/pipeline.test.ts "compile — outline coverage".
import { describe, expect, it } from "vitest";
import {
  checkOutlineCoverage,
  formatOutlineCoverageIssues,
  isSubstantiveSection,
} from "../src/core/outlineCoverage.js";
import type { SkillPlan } from "../src/core/index.js";

const population = [{ id: "a" }, { id: "b" }, { id: "c" }];

function plan(chapters: { id: string; sectionIds: string[] }[]): SkillPlan {
  return {
    slug: "s",
    title: "S",
    chapters: chapters.map((c) => ({ id: c.id, file: "x", title: c.id, sectionIds: c.sectionIds })),
  };
}

describe("isSubstantiveSection", () => {
  it("is true only when the body has non-whitespace text", () => {
    expect(isSubstantiveSection({ text: "Mount it." })).toBe(true);
    expect(isSubstantiveSection({ text: "" })).toBe(false);
    expect(isSubstantiveSection({ text: " \n\t " })).toBe(false);
  });
});

describe("checkOutlineCoverage", () => {
  it("returns undefined for an exact cover, however the sections are grouped", () => {
    expect(checkOutlineCoverage(plan([{ id: "x", sectionIds: ["a", "b", "c"] }]), population)).toBe(
      undefined,
    );
    expect(
      checkOutlineCoverage(
        plan([
          { id: "x", sectionIds: ["c"] },
          { id: "y", sectionIds: ["a", "b"] },
        ]),
        population,
      ),
    ).toBe(undefined);
  });

  it("reports unassigned sections in population order", () => {
    const issues = checkOutlineCoverage(plan([{ id: "x", sectionIds: ["b"] }]), population);
    expect(issues?.missing).toEqual(["a", "c"]);
  });

  it("reports unknown ids", () => {
    const issues = checkOutlineCoverage(
      plan([{ id: "x", sectionIds: ["a", "b", "c", "zzz"] }]),
      population,
    );
    expect(issues?.unknown).toEqual(["zzz"]);
    expect(issues?.missing).toEqual([]);
  });

  it("reports a section assigned twice, across or within chapters", () => {
    expect(
      checkOutlineCoverage(
        plan([
          { id: "x", sectionIds: ["a", "b"] },
          { id: "y", sectionIds: ["b", "c"] },
        ]),
        population,
      )?.duplicateSections,
    ).toEqual(["b"]);
    expect(
      checkOutlineCoverage(plan([{ id: "x", sectionIds: ["a", "a", "b", "c"] }]), population)
        ?.duplicateSections,
    ).toEqual(["a"]);
  });

  it("reports duplicate chapter ids", () => {
    const issues = checkOutlineCoverage(
      plan([
        { id: "same", sectionIds: ["a", "b"] },
        { id: "same", sectionIds: ["c"] },
      ]),
      population,
    );
    expect(issues?.duplicateChapters).toEqual(["same"]);
  });

  it("collects every kind of issue at once so one retry can fix them all", () => {
    const issues = checkOutlineCoverage(
      plan([
        { id: "d", sectionIds: ["a", "a", "zzz"] },
        { id: "d", sectionIds: ["b"] },
      ]),
      population,
    );
    expect(issues).toEqual({
      missing: ["c"],
      unknown: ["zzz"],
      duplicateSections: ["a"],
      duplicateChapters: ["d"],
    });
    if (issues === undefined) throw new Error("expected issues");
    expect(formatOutlineCoverageIssues(issues)).toBe(
      "unassigned sections: c; unknown section ids: zzz; sections assigned more than once: a; duplicate chapter ids: d",
    );
  });
});
