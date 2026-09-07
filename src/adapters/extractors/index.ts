import type { DocumentExtractor } from "../../core/index.js";
import { DocxExtractor } from "./docx.js";
import { HtmlExtractor } from "./html.js";
import { PdfExtractor } from "./pdf.js";
import { TextExtractor } from "./text.js";

export { DocxExtractor, HtmlExtractor, PdfExtractor, TextExtractor };
export { findExtractor, hasExtension } from "./route.js";

/** The v0.1 extractor set: text-based PDF, DOCX, UTF-8 TXT/MD, HTML (SPEC §3.1). */
export function createExtractors(): DocumentExtractor[] {
  return [new PdfExtractor(), new DocxExtractor(), new TextExtractor(), new HtmlExtractor()];
}
