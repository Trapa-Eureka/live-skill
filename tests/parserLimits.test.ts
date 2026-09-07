// D4 완료 기준(DESIGN §6 D4): DOCX 압축 해제 상한은 헤더가 선언한 크기가 아니라 실측 바이트로, 타임아웃·취소는
// 파서에 신호를 전달하고 결과를 버린다. ZIP 픽스처는 테스트 안에서 JSZip으로 직접 만든다(가드레일 4).
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

/** 중앙 디렉터리의 "압축 해제 크기" 필드를 거짓 값으로 바꾼다 — JSZip은 이 값만 믿는다(local header는 건너뛴다). */
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

/** 옛 zipBudget이 믿던 값 — JSZip 비공개 필드. 위조가 실제로 먹혔음을 보이는 용도로만 읽는다. */
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

describe("withDeadline (D4 — 타임아웃은 취소 신호 + 결과 폐기)", () => {
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
    finish?.(doc); // 늦은 결과 — 이미 돌려준 값은 바뀌지 않는다
    fail?.(new Error("late")); // 늦은 거부 — unhandled rejection이면 vitest가 이 파일을 실패시킨다
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

describe("measureZip (D4 — 실측 압축 해제 바이트)", () => {
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
    expect(await declaredSizes(forged)).toEqual([10]); // 옛 zipBudget은 여기서 10을 더하고 통과시켰다
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

describe("PdfExtractor (D4 — 취소 시 pdf.js 문서 파괴)", () => {
  it("returns timeout when cancelled while parsing is in flight, destroys the document, and keeps working afterwards", async () => {
    const destroy = vi.spyOn(PDFParse.prototype, "destroy");
    try {
      const extractor = new PdfExtractor();
      const controller = new AbortController();
      const pending = extractor.extract(fixture("regulation.pdf"), controller.signal);
      controller.abort(); // getInfo가 진행 중일 때 — 작은 픽스처는 한 틱 뒤면 이미 끝나 있다
      expect(await pending).toEqual(TIMEOUT);
      await tick();
      expect(destroy).toHaveBeenCalled(); // 늦게 끝난 파서도 문서를 파괴하고 결과를 버린다

      const again = await extractor.extract(fixture("regulation.pdf")); // destroy가 모듈 상태를 망치지 않았다
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
