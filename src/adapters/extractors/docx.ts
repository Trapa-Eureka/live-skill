// DOCX 추출기 (mammoth). 헤딩을 마크다운 헤딩으로 바꿔 공유 구조화기(structureText)가 그대로 인식하게
// 한다. 이식 출처: ../msg-agent/src/adapters/extractors/docx.ts.
import JSZip from "jszip";
import mammoth from "mammoth";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../../core/index.js";
import { asBuffer } from "./bytes.js";
import { EXTRACT_TIMEOUT_MS, TIMEOUT, withDeadline } from "./limits.js";
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

export interface ZipLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
}

export type ZipMeasure =
  | { ok: true; entries: number; uncompressed: number }
  | { ok: false; reason: "too_many_entries" | "too_many_bytes" | "aborted" };

/** JSZip이 d.ts에 싣지 않은 공개 API(문서화됨) — 엔트리를 스트리밍으로 푼다. */
interface StreamingEntry {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
}

/** 엔트리 하나를 실제로 풀며 바이트를 센다. budget을 넘는 순간 스트림을 멈추고 undefined — 푼 바이트는 버린다. */
function inflatedSize(entry: JSZip.JSZipObject, budget: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const stream = (entry as unknown as StreamingEntry).internalStream("uint8array");
    let size = 0;
    stream
      .on("data", (chunk) => {
        size += chunk.byteLength;
        if (size > budget) {
          stream.pause();
          resolve(undefined);
        }
      })
      .on("error", reject)
      .on("end", () => {
        resolve(size);
      })
      .resume();
  });
}

/** mammoth에 넘기기 전 ZIP 예산을 실측한다(D4, zip bomb·엔트리 폭탄 방지): 헤더가 *선언한* 크기가 아니라
 * inflate가 실제로 내놓는 바이트를 세고, 누적이 상한을 넘는 순간 멈춘다 — 메모리는 상한 + 청크 하나로 묶인다.
 * 같은 deflate 스트림은 같은 바이트를 내놓으므로 뒤이어 mammoth가 푸는 양도 이 상한 안이다. */
export async function measureZip(
  bytes: Uint8Array,
  limits: ZipLimits,
  signal?: AbortSignal,
): Promise<ZipMeasure> {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > limits.maxEntries) return { ok: false, reason: "too_many_entries" };
  let uncompressed = 0;
  for (const entry of files) {
    if (signal?.aborted === true) return { ok: false, reason: "aborted" };
    const size = await inflatedSize(entry, limits.maxUncompressedBytes - uncompressed);
    if (size === undefined) return { ok: false, reason: "too_many_bytes" };
    uncompressed += size;
  }
  return { ok: true, entries: files.length, uncompressed };
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

  /** signal(선택)은 바깥에서 취소할 때 — 인터페이스(DocumentExtractor)보다 넓은 시그니처(D4). */
  extract(bytes: Uint8Array, signal?: AbortSignal): Promise<Result<ExtractedDoc, ExtractError>> {
    return withDeadline((s) => this.parse(bytes, s), this.timeoutMs, signal);
  }

  private async parse(
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<Result<ExtractedDoc, ExtractError>> {
    let html: string;
    try {
      const measured = await measureZip(
        bytes,
        { maxEntries: this.maxEntries, maxUncompressedBytes: this.maxUncompressed },
        signal,
      );
      if (!measured.ok) {
        return measured.reason === "aborted"
          ? TIMEOUT
          : err({ kind: "corrupt", detail: "zip_budget" });
      }
      if (signal.aborted) return TIMEOUT; // mammoth는 취소할 수 없다 — 들어가기 전에 한 번 더 본다
      const result = await mammoth.convertToHtml(
        { buffer: asBuffer(bytes) }, // D3: 복사 대신 뷰 — mammoth는 읽기만 한다
        { convertImage: dropImages },
      );
      html = result.value;
    } catch (e) {
      if (signal.aborted) return TIMEOUT;
      return err({ kind: "corrupt", detail: e instanceof Error ? e.name : "unknown" });
    }
    const doc = toExtractedDoc(structureText(htmlToBlocks(html)));
    if (doc.sections.length === 0) return err({ kind: "empty_text" });
    return ok(doc);
  }
}
