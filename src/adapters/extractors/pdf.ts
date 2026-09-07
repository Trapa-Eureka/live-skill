// Text-based PDF extractor (pdf-parse/pdf.js). A scanned PDF without a text layer is reported as
// empty_text (OCR is v0.2 or later, a SPEC §4 non-goal). Ported from
// ../msg-agent/src/adapters/extractors/pdf.ts. D4 (DESIGN §6): on timeout or cancellation the pdf.js
// document is destroyed through PDFParse.destroy(), which actually stops the work in progress (on
// Node, pdf.js runs on the same thread without a worker, so cooperative cancellation is the best
// v0.1 can do).
import { PasswordException, PDFParse, VerbosityLevel } from "pdf-parse";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, pdfPagesToText, structureText, toExtractedDoc } from "../../core/index.js";
import { EXTRACT_TIMEOUT_MS, TIMEOUT, withDeadline } from "./limits.js";
import { hasExtension } from "./route.js";

export const PDF_MAX_PAGES = 500;

export interface PdfExtractorOptions {
  maxPages?: number;
  timeoutMs?: number;
}

export class PdfExtractor implements DocumentExtractor {
  private readonly maxPages: number;
  private readonly timeoutMs: number;

  constructor(opts: PdfExtractorOptions = {}) {
    this.maxPages = opts.maxPages ?? PDF_MAX_PAGES;
    this.timeoutMs = opts.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  }

  supports(mime: string, name: string): boolean {
    return mime.toLowerCase() === "application/pdf" || hasExtension(name, [".pdf"]);
  }

  /** The optional signal lets the caller cancel from outside: a wider signature than the
   * DocumentExtractor interface requires (D4). */
  extract(bytes: Uint8Array, signal?: AbortSignal): Promise<Result<ExtractedDoc, ExtractError>> {
    return withDeadline((s) => this.parse(bytes, s), this.timeoutMs, signal);
  }

  private async parse(
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<Result<ExtractedDoc, ExtractError>> {
    // pdf.js transfers (detaches) the buffer it is given; pass a copy so the caller can reuse bytes.
    const parser = new PDFParse({ data: bytes.slice(), verbosity: VerbosityLevel.ERRORS });
    const destroy = (): Promise<void> => parser.destroy().catch(() => undefined);
    const onAbort = (): void => {
      void destroy(); // the in-flight getInfo/getText rejects and parse ends with timeout
    };
    // The value changes between awaits, so read it fresh every time (avoids TS control-flow narrowing).
    const cancelled = (): boolean => signal.aborted;
    if (cancelled()) return TIMEOUT;
    signal.addEventListener("abort", onAbort, { once: true });
    let text: string;
    try {
      const info = await parser.getInfo();
      if (info.total > this.maxPages) return err({ kind: "corrupt", detail: "too_many_pages" });
      if (cancelled()) return TIMEOUT; // cancelled during load: do not start the heavy text extraction
      const result = await parser.getText();
      text = pdfPagesToText(result.pages.map((p) => p.text));
    } catch (e) {
      if (cancelled()) return TIMEOUT;
      if (e instanceof PasswordException) return err({ kind: "corrupt", detail: "encrypted" });
      return err({ kind: "corrupt", detail: e instanceof Error ? e.name : "unknown" });
    } finally {
      signal.removeEventListener("abort", onAbort);
      await destroy();
    }
    const doc = toExtractedDoc(structureText(text));
    if (doc.sections.length === 0) return err({ kind: "empty_text" });
    return ok(doc);
  }
}
