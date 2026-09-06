import { describe, expect, it } from "vitest";
import { assignSectionIds, slugifyHeading, type HeadingRef } from "../src/core/index.js";

describe("slugifyHeading", () => {
  it("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(slugifyHeading("3.2 Prerequisites & Setup")).toBe("3-2-prerequisites-setup");
  });

  it("keeps non-Latin letters (Korean, Tagalog use Latin/Hangul scripts directly)", () => {
    expect(slugifyHeading("설치 방법")).toBe("설치-방법");
    expect(slugifyHeading("Paunang Salita")).toBe("paunang-salita");
  });

  it("falls back to a placeholder for a heading with no letters/numbers", () => {
    expect(slugifyHeading("---")).toBe("section");
  });
});

describe("assignSectionIds", () => {
  const doc: HeadingRef[] = [
    { level: 1, heading: "Installation" },
    { level: 2, heading: "Prerequisites" },
    { level: 2, heading: "Steps" },
    { level: 1, heading: "Troubleshooting" },
  ];

  it("builds a heading-path slug per section", () => {
    expect(assignSectionIds(doc)).toEqual([
      "installation",
      "installation/prerequisites",
      "installation/steps",
      "troubleshooting",
    ]);
  });

  it("is stable across repeated extraction of the same document (T1 완료 기준)", () => {
    expect(assignSectionIds(doc)).toEqual(assignSectionIds(doc));
    // 참조가 다른 배열이어도(재추출을 흉내) 값은 동일해야 한다.
    const reExtracted: HeadingRef[] = doc.map((h) => ({ ...h }));
    expect(assignSectionIds(reExtracted)).toEqual(assignSectionIds(doc));
  });

  it("disambiguates duplicate heading paths in order of appearance", () => {
    const withDup: HeadingRef[] = [
      { level: 1, heading: "Overview" },
      { level: 1, heading: "Overview" },
      { level: 1, heading: "Overview" },
    ];
    expect(assignSectionIds(withDup)).toEqual(["overview", "overview-2", "overview-3"]);
  });

  it("fills skipped levels (H1 -> H3) with a placeholder ancestor", () => {
    const skipped: HeadingRef[] = [
      { level: 1, heading: "Guide" },
      { level: 3, heading: "Deep Note" },
    ];
    expect(assignSectionIds(skipped)).toEqual(["guide", "guide/section/deep-note"]);
  });

  it("resets a shallower level's descendants when a new sibling starts", () => {
    const siblings: HeadingRef[] = [
      { level: 1, heading: "A" },
      { level: 2, heading: "Shared" },
      { level: 1, heading: "B" },
      { level: 2, heading: "Shared" },
    ];
    expect(assignSectionIds(siblings)).toEqual(["a", "a/shared", "b", "b/shared"]);
  });
});
