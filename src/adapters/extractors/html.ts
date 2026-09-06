// HTML 추출기 (cheerio). 본문에서 헤딩·문단·목록 항목을 문서 순서대로 뽑아 마크다운 느낌의 블록으로
// 바꾼 뒤 공유 구조화기(structureText)에 넘긴다. msg-agent에 없는, live-skill 신규 구현
// (CLAUDE.md 스택: "cheerio+변환").
import * as cheerio from "cheerio";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../../core/index.js";
import { hasExtension } from "./route.js";

const MIMES = new Set(["text/html", "application/xhtml+xml"]);
const EXTS = [".html", ".htm"];

/**
 * 본문의 헤딩(h1~h6)·문단·목록 항목·인용문을 문서 순서대로 뽑아 마크다운 느낌의 줄로 바꾼다.
 * 목록 안에 중첩된 문단처럼 드문 조합은 중복될 수 있다 — v0.1은 자체 제작 문서를 전제하므로 이 정도
 * 단순화로 충분하다(CLAUDE.md 가드레일 4).
 */
export function htmlToBlocks(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, head").remove();

  const parts: string[] = [];
  $("body")
    .find("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre")
    .each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/gu, " ");
      if (text === "") return;
      const headingMatch = /^h([1-6])$/u.exec(el.tagName.toLowerCase());
      if (headingMatch?.[1] !== undefined) {
        parts.push(`${"#".repeat(Number(headingMatch[1]))} ${text}`);
      } else if (el.tagName.toLowerCase() === "li") {
        parts.push(`- ${text}`);
      } else {
        parts.push(text);
      }
    });
  return parts.join("\n\n");
}

export class HtmlExtractor implements DocumentExtractor {
  supports(mime: string, name: string): boolean {
    return MIMES.has(mime.toLowerCase()) || hasExtension(name, EXTS);
  }

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return Promise.resolve(err({ kind: "corrupt", detail: "invalid_utf8" }));
    }
    const doc = toExtractedDoc(structureText(htmlToBlocks(raw)));
    if (doc.sections.length === 0) return Promise.resolve(err({ kind: "empty_text" }));
    return Promise.resolve(ok(doc));
  }
}
