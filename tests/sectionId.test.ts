import { describe, expect, it } from "vitest";
import {
  assignSectionIds,
  disambiguate,
  namespacePrefixes,
  slugifyHeading,
  type HeadingRef,
} from "../src/core/index.js";

describe("slugifyHeading", () => {
  it("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(slugifyHeading("3.2 Prerequisites & Setup")).toBe("3-2-prerequisites-setup");
  });

  it("keeps non-Latin letters (Korean, Tagalog use Latin/Hangul scripts directly)", () => {
    expect(slugifyHeading("설치 방법")).toBe("설치-방법"); // deliberately Korean: Hangul letters must be kept
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

  it("is stable across repeated extraction of the same document (T1 completion criterion)", () => {
    expect(assignSectionIds(doc)).toEqual(assignSectionIds(doc));
    // A different array instance (simulating re-extraction) must still yield the same values.
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

  // F2 (001-006, completion criterion): the suffix is chosen against the final set, not by
  // occurrence count.
  it("never produces two equal ids even when a heading literally reads like a suffixed one (A, A, A-2)", () => {
    const tricky: HeadingRef[] = [
      { level: 1, heading: "A" },
      { level: 1, heading: "A" },
      { level: 1, heading: "A-2" },
    ];
    const ids = assignSectionIds(tricky);
    expect(ids).toEqual(["a", "a-2", "a-2-2"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps ids unique in the reverse order too (A-2 first, then A, A)", () => {
    const ids = assignSectionIds([
      { level: 1, heading: "A-2" },
      { level: 1, heading: "A" },
      { level: 1, heading: "A" },
    ]);
    expect(ids).toEqual(["a-2", "a", "a-3"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("nests children under the ancestor's final id, so duplicate parents keep their subtrees apart", () => {
    const ids = assignSectionIds([
      { level: 1, heading: "Overview" },
      { level: 2, heading: "Steps" },
      { level: 1, heading: "Overview" },
      { level: 2, heading: "Steps" },
    ]);
    expect(ids).toEqual(["overview", "overview/steps", "overview-2", "overview-2/steps"]);
  });

  it("stays unique for any mix of duplicates and suffix-looking headings (property)", () => {
    const pool = ["A", "A-2", "A-3", "a", "B", "B-2", "Section", ""];
    for (let seed = 1; seed <= 200; seed += 1) {
      let x = seed;
      const headings: HeadingRef[] = Array.from({ length: 12 }, (_, i) => {
        x = (x * 48271) % 2147483647;
        return { level: 1 + (i % 3 === 0 ? 0 : x % 3), heading: pool[x % pool.length] ?? "A" };
      });
      const ids = assignSectionIds(headings);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("disambiguate", () => {
  it("returns the base when free and the first free numbered candidate otherwise, recording its choice", () => {
    const used = new Set<string>();
    expect(disambiguate("a", used)).toBe("a");
    expect(disambiguate("a", used)).toBe("a-2");
    expect(disambiguate("a-2", used)).toBe("a-2-2");
    expect(disambiguate("a", used)).toBe("a-3");
    expect([...used].sort()).toEqual(["a", "a-2", "a-2-2", "a-3"]);
  });
});

describe("namespacePrefixes (F2 — multi-source prefixes, completion criterion)", () => {
  it("returns no prefix for a single source", () => {
    expect(namespacePrefixes(["/root/docs/readme.md"])).toEqual([]);
    expect(namespacePrefixes([])).toEqual([]);
  });

  it("tells apart the same file name in different folders (basename alone used to collide)", () => {
    expect(namespacePrefixes(["/root/docs/a/readme.md", "/root/docs/b/readme.md"])).toEqual([
      "a-readme",
      "b-readme",
    ]);
  });

  it("uses only the path below the common directory, in input order, and strips the extension", () => {
    expect(
      namespacePrefixes([
        "/root/docs/intro.md",
        "/root/docs/guides/setup.txt",
        "/root/docs/faq.html",
      ]),
    ).toEqual(["intro", "guides-setup", "faq"]);
  });

  it("keeps a file that sits at the common directory itself distinct from a deeper one", () => {
    expect(namespacePrefixes(["/r/x.md", "/r/sub/x.md"])).toEqual(["x", "sub-x"]);
  });

  it("de-duplicates prefixes that slugify alike (A.md vs a.md) with the same suffix rule", () => {
    expect(namespacePrefixes(["/r/A.md", "/r/a.md", "/r/a-2.md"])).toEqual(["a", "a-2", "a-2-2"]);
  });

  it("accepts Windows separators", () => {
    expect(namespacePrefixes(["C:\\docs\\a\\readme.md", "C:\\docs\\b\\readme.md"])).toEqual([
      "a-readme",
      "b-readme",
    ]);
  });

  it("is stable: the same inputs always give the same prefixes", () => {
    const paths = ["/root/docs/a/readme.md", "/root/docs/b/readme.md", "/root/docs/b/notes.md"];
    expect(namespacePrefixes(paths)).toEqual(namespacePrefixes([...paths]));
  });
});
