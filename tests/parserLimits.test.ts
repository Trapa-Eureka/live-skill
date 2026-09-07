// D4 acceptance criteria (DESIGN §6 D4): the DOCX decompression cap uses measured bytes rather than
// the sizes the headers declare, and a timeout or cancellation signals the parser and discards the
// result. ZIP fixtures are built inside the test with JSZip (guardrail 4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { describe, expect, it, vi } from "vitest";
import { DocxExtractor, measureZip } from "../src/adapters/extractors/docx.js";
import { TIMEOUT, withDeadline, type ExtractOutcome } from "../src/adapters/extractors/limits.js";
import { PdfExtractor } from "../src/adapters/extractors/pdf.js";
import { ok } from "../src/core/index.js";

const FIXTURES = join(process.cwd(), "fixtures", "docs");
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function makeZip(entries: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(entries)) zip.file(name, data);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Overwrites the central directory's "uncompressed size" field with a bogus value. JSZip trusts
 * only this field (it skips the local header). */
function forgeDeclaredSize(bytes: Uint8Array, declared: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i + 30 <= out.length; i += 1) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x01 && out[i + 3] === 0x02) {
      view.setUint32(i + 24, declared, true);
    }
  }
  return out;
}

/** The value the old zipBudget trusted: a private JSZip field, read only to show that the forgery
 * actually took effect. */
async function declaredSizes(bytes: Uint8Array): Promise<number[]> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => {
      const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data;
      return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : -1;
    });
}

const doc = ok({ sections: [{ id: "a", heading: "A", level: 1, text: "x" }] });

describe("withDeadline (D4: a timeout aborts the signal and discards the result)", () => {
  it("returns the parser's result when it finishes in time, without aborting", async () => {
    let seen: AbortSignal | undefined;
    const result = await withDeadline((signal) => {
      seen = signal;
      return Promise.resolve(doc);
    }, 1_000);
    expect(result).toEqual(doc);
    expect(seen?.aborted).toBe(false);
  });

  it("aborts the signal and returns timeout when the parser never finishes", async () => {
    let seen: AbortSignal | undefined;
    const result = await withDeadline((signal) => {
      seen = signal;
      return new Promise<ExtractOutcome>(() => undefined);
    }, 1);
    expect(result).toEqual(TIMEOUT);
    expect(seen?.aborted).toBe(true);
  });

  it("discards a result that arrives after the deadline, and a late rejection does not surface", async () => {
    let finish: ((r: ExtractOutcome) => void) | undefined;
    let fail: ((e: Error) => void) | undefined;
    const first = await withDeadline(
      () =>
        new Promise<ExtractOutcome>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      1,
    );
    expect(first).toEqual(TIMEOUT);
    finish?.(doc); // late result: the value already returned does not change
    fail?.(new Error("late")); // late rejection: if it were unhandled, vitest would fail this file
    await tick();
    expect(first).toEqual(TIMEOUT);
  });

  it("an outer signal cancels the same way (already aborted, or aborted later)", async () => {
    const already = AbortSignal.abort();
    expect(await withDeadline(() => Promise.resolve(doc), 1_000, already)).toEqual(TIMEOUT);

    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = withDeadline(
      (signal) => {
        seen = signal;
        return new Promise<ExtractOutcome>(() => undefined);
      },
      10_000,
      controller.signal,
    );
    controller.abort();
    expect(await pending).toEqual(TIMEOUT);
    expect(seen?.aborted).toBe(true);
  });
});

describe("measureZip (D4: measured inflated bytes)", () => {
  const limits = { maxEntries: 10, maxUncompressedBytes: 64 * 1024 };

  it("counts entries and the bytes inflate actually produces", async () => {
    const zip = await makeZip({ "a.txt": "hello", "b/c.txt": new Uint8Array(1000) });
    expect(await measureZip(zip, limits)).toEqual({ ok: true, entries: 2, uncompressed: 1005 });
  });

  it("refuses an entry that inflates past the budget, stopping mid-stream", async () => {
    const zip = await makeZip({ "word/document.xml": new Uint8Array(1024 * 1024) }); // 1 MiB of zeros → a few KiB
    expect(zip.byteLength).toBeLessThan(8 * 1024);
    expect(await measureZip(zip, limits)).toEqual({ ok: false, reason: "too_many_bytes" });
  });

  it("does not trust the declared size: a forged header claiming 10 bytes is still refused", async () => {
    const forged = forgeDeclaredSize(
      await makeZip({ "word/document.xml": new Uint8Array(1024 * 1024) }),
      10,
    );
    expect(await declaredSizes(forged)).toEqual([10]); // the old zipBudget added 10 here and let it through
    expect(await measureZip(forged, limits)).toEqual({ ok: false, reason: "too_many_bytes" });
  });

  it("applies the budget to the running total across entries", async () => {
    const zip = await makeZip({
      "a.bin": new Uint8Array(40 * 1024),
      "b.bin": new Uint8Array(40 * 1024),
    });
    expect(await measureZip(zip, limits)).toEqual({ ok: false, reason: "too_many_bytes" });
    expect(await measureZip(zip, { ...limits, maxUncompressedBytes: 80 * 1024 })).toEqual({
      ok: true,
      entries: 2,
      uncompressed: 80 * 1024,
    });
  });

  it("refuses too many entries before inflating anything, and stops when the signal is aborted", async () => {
    const zip = await makeZip({ a: "1", b: "2", c: "3" });
    expect(await measureZip(zip, { ...limits, maxEntries: 2 })).toEqual({
      ok: false,
      reason: "too_many_entries",
    });
    expect(await measureZip(zip, limits, AbortSignal.abort())).toEqual({
      ok: false,
      reason: "aborted",
    });
  });
});

describe("DocxExtractor (D4)", () => {
  it("rejects the real fixture with zip_budget when the measured bytes exceed the cap", async () => {
    const result = await new DocxExtractor({ maxUncompressedBytes: 1024 }).extract(
      fixture("sample.docx"),
    );
    expect(result).toEqual({ ok: false, error: { kind: "corrupt", detail: "zip_budget" } });
  });

  it("still extracts the real fixture under the default caps", async () => {
    const result = await new DocxExtractor().extract(fixture("sample.docx"));
    expect(result.ok).toBe(true);
  });

  it("returns timeout when cancelled from outside, never reaching mammoth", async () => {
    const controller = new AbortController();
    const pending = new DocxExtractor().extract(fixture("sample.docx"), controller.signal);
    controller.abort();
    expect(await pending).toEqual(TIMEOUT);
  });
});

describe("PdfExtractor (D4: cancellation destroys the pdf.js document)", () => {
  it("returns timeout when cancelled while parsing is in flight, destroys the document, and keeps working afterwards", async () => {
    const destroy = vi.spyOn(PDFParse.prototype, "destroy");
    try {
      const extractor = new PdfExtractor();
      const controller = new AbortController();
      const pending = extractor.extract(fixture("regulation.pdf"), controller.signal);
      controller.abort(); // while getInfo is in flight; a small fixture is already done one tick later
      expect(await pending).toEqual(TIMEOUT);
      await tick();
      // A parser that finishes late still destroys the document and drops its result.
      expect(destroy).toHaveBeenCalled();

      // destroy did not corrupt module state.
      const again = await extractor.extract(fixture("regulation.pdf"));
      expect(again.ok).toBe(true);
    } finally {
      destroy.mockRestore();
    }
  });

  it("returns timeout immediately for an already-aborted signal", async () => {
    const result = await new PdfExtractor().extract(fixture("regulation.pdf"), AbortSignal.abort());
    expect(result).toEqual(TIMEOUT);
  });
});
