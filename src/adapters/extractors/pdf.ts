// 텍스트형 PDF 추출기 (pdf-parse/pdf.js). 텍스트 레이어가 없는 스캔 PDF는 empty_text로 처리한다
// (OCR은 v0.2 이후, SPEC §4 비목표). 이식 출처: ../msg-agent/src/adapters/extractors/pdf.ts.
import { PasswordException, PDFParse, VerbosityLevel } from "pdf-parse";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, pdfPagesToText, structureText, toExtractedDoc } from "../../core/index.js";
import { EXTRACT_TIMEOUT_MS, withDeadline } from "./limits.js";
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

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    return withDeadline(this.parse(bytes), this.timeoutMs);
  }

  private async parse(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    // pdf.js는 넘겨받은 버퍼를 transfer(detach)한다; 호출자가 bytes를 재사용할 수 있게 복사본을 준다.
    const parser = new PDFParse({ data: bytes.slice(), verbosity: VerbosityLevel.ERRORS });
    let text: string;
    try {
      const info = await parser.getInfo();
      if (info.total > this.maxPages) return err({ kind: "corrupt", detail: "too_many_pages" });
      const result = await parser.getText();
      text = pdfPagesToText(result.pages.map((p) => p.text));
    } catch (e) {
      if (e instanceof PasswordException) return err({ kind: "corrupt", detail: "encrypted" });
      return err({ kind: "corrupt", detail: e instanceof Error ? e.name : "unknown" });
    } finally {
      await parser.destroy();
    }
    const doc = toExtractedDoc(structureText(text));
    if (doc.sections.length === 0) return err({ kind: "empty_text" });
    return ok(doc);
  }
}
