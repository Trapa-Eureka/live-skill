// DOCX 추출기 (mammoth). 헤딩을 마크다운 헤딩으로 바꿔 공유 구조화기(structureText)가 그대로 인식하게
// 한다. 이식 출처: ../msg-agent/src/adapters/extractors/docx.ts.
import JSZip from "jszip";
import mammoth from "mammoth";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../../core/index.js";
import { asBuffer } from "./bytes.js";
import { EXTRACT_TIMEOUT_MS, withDeadline } from "./limits.js";
import { hasExtension } from "./route.js";

const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * mammoth가 만든 HTML을 마크다운 느낌의 블록으로 바꾼다(선형 태그 스캔): 헤딩은 레벨을 유지하고, 링크는
 * [텍스트](url)로, 순서 있는 목록은 번호를, 중첩 목록은 들여쓰기를 유지한다.
 */
export function htmlToBlocks(html: string): string {
  const decode = (t: string): string =>
    t.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (e) => ENTITIES[e] ?? e);
  const lists: { ordered: boolean; n: number }[] = [];
  let out = "";
  let heading: number | undefined;
  let headingText = "";
  let href: string | undefined;
  const push = (t: string): void => {
    if (heading !== undefined) headingText += t;
    else out += t;
  };
  for (const m of html.matchAll(/<\/?([a-z][a-z0-9]*)\b([^>]*)>|[^<]+/giu)) {
    const [token, tag, attrs] = m;
    if (tag === undefined) {
      push(decode(token));
      continue;
    }
    const closing = token.startsWith("</");
    const name = tag.toLowerCase();
    if (/^h[1-6]$/u.test(name)) {
      if (!closing) {
        heading = Number(name.slice(1));
        headingText = "";
      } else {
        out += `\n\n${"#".repeat(heading ?? 1)} ${headingText.trim()}\n\n`;
        heading = undefined;
      }
    } else if (name === "br") push("\n");
    else if (name === "ul" || name === "ol") {
      if (!closing) lists.push({ ordered: name === "ol", n: 0 });
      else {
        lists.pop();
        if (lists.length === 0) push("\n\n");
      }
    } else if (name === "li") {
      if (!closing) {
        const list = lists[lists.length - 1] ?? { ordered: false, n: 0 };
        list.n += 1;
        const indent = "  ".repeat(Math.max(0, lists.length - 1));
        push(`\n${indent}${list.ordered ? `${String(list.n)}.` : "-"} `);
      }
    } else if (name === "a") {
      if (!closing) {
        const found = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/iu.exec(attrs ?? "");
        href = decode(found?.[1] ?? found?.[2] ?? "");
        push("[");
      } else {
        push(href === undefined || href === "" ? "]" : `](${href})`);
        href = undefined;
      }
    } else if (name === "td" || name === "th") {
      if (closing) push("\t");
    } else if (closing && ["p", "tr", "div", "blockquote", "table"].includes(name)) push("\n\n");
  }
  return out;
}

export const DOCX_MAX_ENTRIES = 200;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;

export interface DocxExtractorOptions {
  maxEntries?: number;
  maxUncompressedBytes?: number;
  timeoutMs?: number;
}

/** mammoth에 넘기기 전 ZIP 예산을 확인한다(zip bomb·엔트리 폭탄 방지). */
export async function zipBudget(
  bytes: Uint8Array,
): Promise<{ entries: number; uncompressed: number }> {
  const zip = await JSZip.loadAsync(bytes);
  let entries = 0;
  let uncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    entries += 1;
    const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data;
    const size = data?.uncompressedSize;
    uncompressed += typeof size === "number" && size > 0 ? size : 0;
  }
  return { entries, uncompressed };
}

/** 이미지는 디코딩 전에 버린다 — 변환기가 image.read()를 아예 호출하지 않는다. */
const dropImages = mammoth.images.imgElement(() => Promise.resolve({ src: "" }));

export class DocxExtractor implements DocumentExtractor {
  private readonly maxEntries: number;
  private readonly maxUncompressed: number;
  private readonly timeoutMs: number;

  constructor(opts: DocxExtractorOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DOCX_MAX_ENTRIES;
    this.maxUncompressed = opts.maxUncompressedBytes ?? DOCX_MAX_UNCOMPRESSED_BYTES;
    this.timeoutMs = opts.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  }

  supports(mime: string, name: string): boolean {
    return mime.toLowerCase() === MIME || hasExtension(name, [".docx"]);
  }

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    return withDeadline(this.parse(bytes), this.timeoutMs);
  }

  private async parse(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    let html: string;
    try {
      const budget = await zipBudget(bytes);
      if (budget.entries > this.maxEntries || budget.uncompressed > this.maxUncompressed) {
        return err({ kind: "corrupt", detail: "zip_budget" });
      }
      const result = await mammoth.convertToHtml(
        { buffer: asBuffer(bytes) }, // D3: 복사 대신 뷰 — mammoth는 읽기만 한다
        { convertImage: dropImages },
      );
      html = result.value;
    } catch (e) {
      return err({ kind: "corrupt", detail: e instanceof Error ? e.name : "unknown" });
    }
    const doc = toExtractedDoc(structureText(htmlToBlocks(html)));
    if (doc.sections.length === 0) return err({ kind: "empty_text" });
    return ok(doc);
  }
}
