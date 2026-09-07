// F3 (DESIGN §5.1): the source → population code shared by compile and eval --source, and the
// manifest comparison. Pure computation, zero LLM calls.
import { describe, expect, it } from "vitest";
import {
  buildPopulation,
  extractSources,
  matchManifestSections,
  namespaceSections,
  sha256Hex,
  type ExtractedDoc,
  type Manifest,
} from "../src/core/index.js";
import { FixtureExtractor } from "../src/mocks/fixtureExtractor.js";

const bytes = (name: string): Uint8Array => new TextEncoder().encode(name);

describe("extractSources", () => {
  it("extracts every source in order and keeps the path with each file's sections", async () => {
    const doc: ExtractedDoc = {
      sections: [{ id: "overview", heading: "Overview", level: 1, text: "Overview text." }],
    };
    const result = await extractSources(
      [
        { path: "/r/a/readme.md", bytes: bytes("readme.md") },
        { path: "/r/b/readme.md", bytes: bytes("readme.md") },
      ],
      [new FixtureExtractor({ md: doc })],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.map((f) => f.path)).toEqual(["/r/a/readme.md", "/r/b/readme.md"]);
  });

  it("stops at the first unsupported or failed source with a fix message", async () => {
    const unsupported = await extractSources([{ path: "x.xlsx", bytes: bytes("x.xlsx") }], []);
    expect(unsupported).toMatchObject({ ok: false, error: { kind: "unsupported_format" } });
    if (unsupported.ok) throw new Error("unreachable");
    expect(unsupported.error.message).toMatch(/Fix:/u);

    const failing = await extractSources(
      [{ path: "e.md", bytes: bytes("e.md") }],
      [new FixtureExtractor({ md: { error: { kind: "empty_text" } } })],
    );
    expect(failing).toMatchObject({ ok: false, error: { kind: "extract_failed", path: "e.md" } });
  });
});

describe("buildPopulation (B1 + F2 in one place)", () => {
  const overview = { id: "overview", heading: "Overview", level: 1, text: "Overview text." };
  const empty = { id: "container", heading: "Container", level: 1, text: "   " };

  it("prefixes ids per source below the common directory and drops body-less headings", () => {
    const population = buildPopulation([
      { path: "/r/a/readme.md", sections: [overview, empty] },
      { path: "/r/b/readme.md", sections: [overview] },
    ]);
    expect(population.map((s) => s.id)).toEqual(["a-readme/overview", "b-readme/overview"]);
    expect(population.map((s) => s.sourcePath)).toEqual(["/r/a/readme.md", "/r/b/readme.md"]);
  });

  it("leaves a single source unprefixed", () => {
    expect(
      buildPopulation([{ path: "/r/only.md", sections: [overview] }]).map((s) => s.id),
    ).toEqual(["overview"]);
  });

  it("refuses loudly if two sections would still share an id (silent overwrite must never return)", () => {
    expect(() =>
      namespaceSections([{ path: "/r/only.md", sections: [overview, { ...overview }] }]),
    ).toThrow(/section id collision/u);
  });
});

describe("matchManifestSections (eval --source vs manifest)", () => {
  const text = "Overview text.";
  const manifest: Manifest = {
    version: 1,
    createdAt: "2026-09-07T00:00:00.000Z",
    sourceFiles: [],
    sections: [
      { id: "a-readme/overview", sha256: sha256Hex(text), chapterFile: "chapters/ch01-a.md" },
      { id: "b-readme/overview", sha256: sha256Hex(text), chapterFile: "chapters/ch02-b.md" },
    ],
    outputs: [],
    outputHashes: [],
    gate: { skipped: true },
    goldenQa: [],
  };
  const section = (id: string, body = text) => ({ id, heading: "Overview", level: 1, text: body });

  it("is a clean match when the ids and bodies are the same", () => {
    expect(
      matchManifestSections(manifest, [section("a-readme/overview"), section("b-readme/overview")]),
    ).toEqual({ missing: [], unknown: [], changed: [] });
  });

  it("names ids only the manifest has, ids only the sources have, and bodies that changed", () => {
    expect(
      matchManifestSections(manifest, [
        section("a-readme/overview", "Overview text, revised."),
        section("c-readme/overview"),
      ]),
    ).toEqual({
      missing: ["b-readme/overview"],
      unknown: ["c-readme/overview"],
      changed: ["a-readme/overview"],
    });
  });

  it("sees the old un-prefixed re-extraction as a mismatch, not as zero questions (001-008)", () => {
    const m = matchManifestSections(manifest, [section("overview")]);
    expect(m.missing).toEqual(["a-readme/overview", "b-readme/overview"]);
    expect(m.unknown).toEqual(["overview"]);
  });
});
