// 텍스트형 PDF 추출기 (pdf-parse/pdf.js). 텍스트 레이어가 없는 스캔 PDF는 empty_text로 처리한다
// (OCR은 v0.2 이후, SPEC §4 비목표). 이식 출처: ../msg-agent/src/adapters/extractors/pdf.ts.
// D4(DESIGN §6): 타임아웃·취소 신호가 오면 PDFParse.destroy()로 pdf.js 문서를 파괴해 진행 중인 작업을 실제로
// 멈춘다(Node에서 pdf.js는 워커 없이 같은 스레드에서 돈다 — 협조적 취소가 v0.1의 최선).
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

  /** signal(선택)은 바깥에서 취소할 때 — 인터페이스(DocumentExtractor)보다 넓은 시그니처(D4). */
  extract(bytes: Uint8Array, signal?: AbortSignal): Promise<Result<ExtractedDoc, ExtractError>> {
    return withDeadline((s) => this.parse(bytes, s), this.timeoutMs, signal);
  }

  private async parse(
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<Result<ExtractedDoc, ExtractError>> {
    // pdf.js는 넘겨받은 버퍼를 transfer(detach)한다; 호출자가 bytes를 재사용할 수 있게 복사본을 준다.
    const parser = new PDFParse({ data: bytes.slice(), verbosity: VerbosityLevel.ERRORS });
    const destroy = (): Promise<void> => parser.destroy().catch(() => undefined);
    const onAbort = (): void => {
      void destroy(); // 진행 중인 getInfo/getText가 거부되며 parse가 timeout으로 끝난다
    };
    // await 사이에 바뀌는 값이라 매번 새로 읽는다(TS의 제어 흐름 좁힘을 피한다).
    const cancelled = (): boolean => signal.aborted;
    if (cancelled()) return TIMEOUT;
    signal.addEventListener("abort", onAbort, { once: true });
    let text: string;
    try {
      const info = await parser.getInfo();
      if (info.total > this.maxPages) return err({ kind: "corrupt", detail: "too_many_pages" });
      if (cancelled()) return TIMEOUT; // 로드 중에 취소됐다 — 무거운 텍스트 추출은 시작하지 않는다
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
