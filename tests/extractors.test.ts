// T2 acceptance criteria: per-format structure extraction tests (TESTING §4 "real extractors"), with
// one self-authored PDF, DOCX, MD and HTML fixture each.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocxExtractor,
  HtmlExtractor,
  PdfExtractor,
  TextExtractor,
  createExtractors,
  findExtractor,
} from "../src/adapters/extractors/index.js";
import { asBuffer } from "../src/adapters/extractors/bytes.js";
import { htmlToBlocks } from "../src/adapters/extractors/html.js";
import type { ExtractedDoc } from "../src/core/index.js";

const FIXTURES = join(process.cwd(), "fixtures", "docs");
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

async function extractOk(name: string): Promise<ExtractedDoc> {
  const x = findExtractor(createExtractors(), "application/octet-stream", name);
  if (x === undefined) throw new Error(`no extractor for ${name}`);
  const r = await x.extract(fixture(name));
  if (!r.ok) throw new Error(`extract failed: ${r.error.kind}`);
  return r.value;
}

describe("routing", () => {
  const all = createExtractors();

  it("routes by MIME type first", () => {
    expect(findExtractor(all, "application/pdf", "noext")).toBeInstanceOf(PdfExtractor);
    expect(
      findExtractor(
        all,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x",
      ),
    ).toBeInstanceOf(DocxExtractor);
    expect(findExtractor(all, "text/markdown", "x")).toBeInstanceOf(TextExtractor);
    expect(findExtractor(all, "text/html", "x")).toBeInstanceOf(HtmlExtractor);
  });

  it("falls back to the extension when the MIME type is generic", () => {
    expect(findExtractor(all, "application/octet-stream", "Report.PDF")).toBeInstanceOf(
      PdfExtractor,
    );
    expect(findExtractor(all, "application/octet-stream", "a.docx")).toBeInstanceOf(DocxExtractor);
    expect(findExtractor(all, "application/octet-stream", "notes.md")).toBeInstanceOf(
      TextExtractor,
    );
    expect(findExtractor(all, "application/octet-stream", "page.htm")).toBeInstanceOf(
      HtmlExtractor,
    );
  });

  it("returns undefined for an unsupported format such as .xlsx", () => {
    expect(findExtractor(all, "application/octet-stream", "sheet.xlsx")).toBeUndefined();
  });
});

describe("real extractors on self-authored fixtures (guardrail 4: no copyrighted text)", () => {
  it("PdfExtractor structures a real regulation-style PDF", async () => {
    const doc = await extractOk("regulation.pdf");
    expect(doc.sections.length).toBeGreaterThan(3);
    expect(doc.sections.some((s) => /article 1/iu.test(s.heading))).toBe(true);
  });

  it("DocxExtractor structures a real onboarding DOCX with headings and a bullet list", async () => {
    const doc = await extractOk("sample.docx");
    const headings = doc.sections.map((s) => s.heading);
    expect(headings).toContain("New Hire Onboarding Checklist");
    expect(headings).toContain("Before Day One");
    expect(doc.sections.some((s) => s.text.includes("- Ship the welcome kit."))).toBe(true);
  });

  it("TextExtractor structures the real 12+-section manual.md", async () => {
    const doc = await extractOk("manual.md");
    const headings = doc.sections.map((s) => s.heading);
    expect(headings).toContain("Installation");
    expect(headings).toContain("Troubleshooting");
    // A nested heading (H3 Prerequisites under H2 Installation) is reflected in the heading-path id.
    const installationId = doc.sections.find((s) => s.heading === "Installation")?.id;
    expect(installationId).toBeDefined();
    expect(
      doc.sections.some(
        (s) => s.heading === "Prerequisites" && s.id === `${installationId ?? ""}/prerequisites`,
      ),
    ).toBe(true);
  });

  it("HtmlExtractor structures the real mixed-unicode HTML and drops <script> content", async () => {
    const doc = await extractOk("mixed-unicode.html");
    const headings = doc.sections.map((s) => s.heading);
    // The Korean heading is deliberate multilingual (CJK) input: it must survive extraction intact.
    expect(headings).toContain("한국어");
    expect(headings).toContain("Tagalog");
    const wholeText = doc.sections.map((s) => s.text).join("\n");
    expect(wholeText).not.toContain("console.log");
  });
});

describe("HtmlExtractor — single-pass DOM walk keeps tables, container text, lists and code (F4, acceptance criteria)", () => {
  const wholeTextOf = (doc: ExtractedDoc): string => doc.sections.map((s) => s.text).join("\n");
  const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

  it("extracts exactly the real headings, in order — no false headings from table rows, captions or list items", async () => {
    const doc = await extractOk("tables.html");
    expect(doc.sections.map((s) => s.heading)).toEqual([
      "Lab Freezer Operating Notes",
      "Temperature Limits",
      "Startup Procedure",
      "Alarm Codes",
    ]);
  });

  it("keeps table rows and cells in document order as a pipe table, with the caption", async () => {
    const doc = await extractOk("tables.html");
    const limits = doc.sections.find((s) => s.heading === "Temperature Limits")?.text ?? "";
    expect(limits).toContain("Keep the chamber between the limits below."); // the div's direct text
    expect(limits).toContain("Chamber limits by mode");
    expect(limits).toContain("| Mode | Minimum | Maximum |");
    expect(limits).toContain("| --- | --- | --- |");
    expect(limits).toContain("| Storage | -40 °C | -30 °C |");
    expect(limits).toContain("| Defrost | -5 °C | +4 °C |");
    expect(limits.indexOf("Storage")).toBeLessThan(limits.indexOf("Defrost"));
  });

  it("keeps a plain div's direct text (the intro that used to be dropped)", async () => {
    const doc = await extractOk("tables.html");
    expect(wholeTextOf(doc)).toContain(
      "This fictional note describes the FrostBox 40 sample freezer used only as a test fixture.",
    );
  });

  it("collects every text node exactly once — nested containers never duplicate text", async () => {
    const whole = wholeTextOf(await extractOk("tables.html"));
    for (const once of [
      "Keep the chamber between the limits below.",
      "Storage",
      "Green means ready.",
      "Close the lid and latch it.",
      "Silence an alarm only after the cause is written down.",
      "Fictional fixture — no real device.",
    ]) {
      expect(count(whole, once)).toBe(1);
    }
  });

  it("renders ordered and nested lists with markers and indentation", async () => {
    const steps =
      (await extractOk("tables.html")).sections.find((s) => s.heading === "Startup Procedure")
        ?.text ?? "";
    expect(steps).toContain("1. Close the lid and latch it.");
    expect(steps).toContain("2. Press POWER and wait for the status LED.");
    expect(steps).toContain("  - Green means ready.");
    expect(steps).toContain("  - Amber means still cooling.");
    expect(steps).toContain("3. Log the start time on the sheet.");
  });

  it("preserves <pre> verbatim inside a code fence so a '#' line inside it is not a heading", async () => {
    const doc = await extractOk("tables.html");
    const alarms = doc.sections.find((s) => s.heading === "Alarm Codes")?.text ?? "";
    expect(alarms).toContain(
      "```\n# E01 lid open longer than 90 seconds\nE02 compressor overload\n```",
    );
    expect(doc.sections.map((s) => s.heading)).not.toContain("E01 lid open longer than 90 seconds");
  });

  it("treats <br> as a line break inside the block, keeps blockquote and footer text, drops <script>", async () => {
    const whole = wholeTextOf(await extractOk("tables.html"));
    expect(whole).toContain("First line of the note\nSecond line after a break.");
    expect(whole).toContain("Silence an alarm only after the cause is written down.");
    expect(whole).toContain("Fictional fixture — no real device.");
    expect(whole).not.toContain("console.log");
  });

  it("htmlToBlocks: escapes pipes in cells, pads ragged rows, and survives lists nested without <li>", () => {
    const blocks = htmlToBlocks(
      "<table><tr><th>a|b</th><th>c</th></tr><tr><td>only</td></tr></table><ul><ul><li>deep</li></ul></ul>",
    );
    expect(blocks).toContain("| a\\|b | c |");
    expect(blocks).toContain("| only |  |");
    expect(blocks).toContain("  - deep");
  });
});

describe("TextExtractor — Markdown headings without blank lines and fenced '#' (F5, acceptance criteria)", () => {
  it("splits a tightly written Markdown file into its real sections and leaves fenced '#' lines alone", async () => {
    const md =
      "# Title\nBody.\n## Sub\nDetail.\n```\n# not a heading\n\n# nor this\n```\n## After\nEnd.";
    const result = await new TextExtractor().extract(new TextEncoder().encode(md));
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.sections.map((s) => [s.level, s.heading])).toEqual([
      [1, "Title"],
      [2, "Sub"],
      [2, "After"],
    ]);
    expect(result.value.sections[1]?.text).toContain("# not a heading");
    expect(result.value.sections[1]?.text).toContain("# nor this");
  });
});

describe("edge cases (TESTING §4)", () => {
  it("rejects an empty document with empty_text", async () => {
    const x = findExtractor(createExtractors(), "application/octet-stream", "empty.txt");
    const r = await x?.extract(fixture("empty.txt"));
    expect(r).toEqual({ ok: false, error: { kind: "empty_text" } });
  });

  it("produces an oversized document with well over 100,000 non-whitespace characters", async () => {
    const doc = await extractOk("oversized.md");
    const totalChars = doc.sections.reduce((n, s) => n + s.text.replace(/\s+/gu, "").length, 0);
    expect(totalChars).toBeGreaterThan(100_000);
  });
});

describe("asBuffer (D3: a Buffer view without a copy)", () => {
  it("returns a Buffer that is a view over the same memory, and the same object for a Buffer", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const view = backing.subarray(2, 5);
    const buf = asBuffer(view);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([2, 3, 4]);
    buf[0] = 99;
    expect(backing[2]).toBe(99); // same memory, not a copy

    const original = Buffer.from("hi");
    expect(asBuffer(original)).toBe(original);
  });

  it("DocxExtractor still reads the real onboarding DOCX through the view", async () => {
    const doc = await extractOk("sample.docx");
    expect(doc.sections.length).toBeGreaterThan(0);
  });
});
