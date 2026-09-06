// T2 완료 기준: 형식별 구조 추출 테스트(TESTING §4 "실 추출기") — 자체 제작 PDF/DOCX/MD/HTML 각 1건.
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
    // 중첩 헤딩(H2 Installation 아래 H3 Prerequisites)이 헤딩 경로 id로 반영되는지.
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
    expect(headings).toContain("한국어");
    expect(headings).toContain("Tagalog");
    const wholeText = doc.sections.map((s) => s.text).join("\n");
    expect(wholeText).not.toContain("console.log");
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

describe("asBuffer (D3 — 복사 없는 Buffer 뷰)", () => {
  it("returns a Buffer that is a view over the same memory, and the same object for a Buffer", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const view = backing.subarray(2, 5);
    const buf = asBuffer(view);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([2, 3, 4]);
    buf[0] = 99;
    expect(backing[2]).toBe(99); // 같은 메모리 — 복사가 아니다

    const original = Buffer.from("hi");
    expect(asBuffer(original)).toBe(original);
  });

  it("DocxExtractor still reads the real onboarding DOCX through the view", async () => {
    const doc = await extractOk("sample.docx");
    expect(doc.sections.length).toBeGreaterThan(0);
  });
});
