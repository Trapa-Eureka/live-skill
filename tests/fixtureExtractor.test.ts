import { describe, expect, it } from "vitest";
import { FixtureExtractor, syntheticDoc } from "../src/mocks/fixtureExtractor.js";

const encode = (name: string): Uint8Array => new TextEncoder().encode(name);

describe("FixtureExtractor", () => {
  const doc = { sections: [{ id: "a", heading: "A", level: 1, text: "body" }] };
  const extractor = new FixtureExtractor({
    md: doc,
    bad: { error: { kind: "corrupt", detail: "boom" } },
  });

  it("supports only the configured extensions", () => {
    expect(extractor.supports("application/octet-stream", "x.md")).toBe(true);
    expect(extractor.supports("application/octet-stream", "x.pdf")).toBe(false);
  });

  it("returns the fixed ExtractedDoc for a configured extension", async () => {
    const r = await extractor.extract(encode("notes.md"));
    expect(r).toEqual({ ok: true, value: doc });
  });

  it("returns the configured error", async () => {
    const r = await extractor.extract(encode("x.bad"));
    expect(r).toEqual({ ok: false, error: { kind: "corrupt", detail: "boom" } });
  });

  it("returns a no-fixture error for an unconfigured extension", async () => {
    const r = await extractor.extract(encode("x.unknown"));
    expect(r).toEqual({ ok: false, error: { kind: "corrupt", detail: "no fixture" } });
  });

  it("records every extraction request by name", async () => {
    await extractor.extract(encode("notes.md"));
    expect(extractor.extracted).toContain("notes.md");
  });
});

describe("syntheticDoc", () => {
  it("builds roughly the requested character count across the requested sections", () => {
    const doc = syntheticDoc(10_000, 4, "en");
    expect(doc.sections).toHaveLength(4);
    const total = doc.sections.reduce((n, s) => n + s.text.replace(/\s+/gu, "").length, 0);
    expect(total).toBeGreaterThanOrEqual(10_000);
  });

  it("supports Korean synthetic content", () => {
    // Deliberate Korean: the "ko" variant exists to produce CJK content, so its heading is Korean.
    const doc = syntheticDoc(500, 2, "ko");
    expect(doc.sections[0]?.heading).toBe("조항 1");
  });
});
