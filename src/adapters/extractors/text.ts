// UTF-8 TXT/MD 추출기 — 이미 마크다운에 가까운 형식이라 structureText가 직접 헤딩을 인식한다.
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../../core/index.js";
import { hasExtension } from "./route.js";

const MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const EXTS = [".txt", ".md", ".markdown"];

export class TextExtractor implements DocumentExtractor {
  supports(mime: string, name: string): boolean {
    return MIMES.has(mime.toLowerCase()) || hasExtension(name, EXTS);
  }

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return Promise.resolve(err({ kind: "corrupt", detail: "invalid_utf8" }));
    }
    const doc = toExtractedDoc(structureText(text));
    if (doc.sections.length === 0) return Promise.resolve(err({ kind: "empty_text" }));
    return Promise.resolve(ok(doc));
  }
}
