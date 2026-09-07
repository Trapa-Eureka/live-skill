// DOCX extractor (mammoth). Headings are converted to Markdown headings so the shared structurer
// (structureText) recognizes them as-is. Ported from ../msg-agent/src/adapters/extractors/docx.ts.
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
 * Turns the HTML mammoth produced into Markdown-like blocks (linear tag scan): headings keep their
 * level, links become [text](url), ordered lists keep their numbers, nested lists keep their indent.
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

/** Public JSZip API that its d.ts omits (it is documented): inflates an entry as a stream. */
interface StreamingEntry {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
}

/** Actually inflates one entry while counting its bytes. The moment the count exceeds budget, the
 * stream is paused and undefined is returned; the inflated bytes are discarded. */
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

/** Measures the ZIP budget before handing the file to mammoth (D4, zip-bomb and entry-bomb guard):
 * counts the bytes inflate actually produces rather than the sizes the headers *declare*, and stops
 * the moment the running total exceeds the cap, so memory is bounded by the cap plus one chunk. The
 * same deflate stream yields the same bytes, so what mammoth inflates afterwards stays within the
 * cap as well. */
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

/** Images are dropped before decoding: the converter never calls image.read(). */
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

  /** The optional signal lets the caller cancel from outside: a wider signature than the
   * DocumentExtractor interface requires (D4). */
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
      if (signal.aborted) return TIMEOUT; // mammoth cannot be cancelled: check once more before entering
      const result = await mammoth.convertToHtml(
        { buffer: asBuffer(bytes) }, // D3: a view instead of a copy; mammoth only reads it
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
