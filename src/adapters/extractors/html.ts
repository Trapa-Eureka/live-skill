// HTML extractor (cheerio). Walks the DOM **once** in document order (F4, DESIGN §5.1), turning
// headings, paragraphs, the direct text of containers, tables, lists and code blocks into
// Markdown-like blocks before handing them to the shared structurer (structureText). The previous
// version selected only h1-h6, p, li, blockquote and pre, dropping td/th and the direct text of divs
// (001-010), so documents that kept their rules and figures in tables silently lost information.
// Every text node is collected exactly once, from its nearest block, so nested elements never
// duplicate text. Not in msg-agent; new to live-skill (CLAUDE.md stack: "cheerio + conversion").
import * as cheerio from "cheerio";
import { isTag, isText, type AnyNode, type Element } from "domhandler";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../../core/index.js";
import { hasExtension } from "./route.js";

const MIMES = new Set(["text/html", "application/xhtml+xml"]);
const EXTS = [".html", ".htm"];

/** Not body content: skipped entirely. */
const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "title",
  "svg",
  "canvas",
  "iframe",
  "object",
]);
/** Block elements that break the line before and after them. Tables, lists, headings and pre are
 * handled separately. */
const BLOCK = new Set([
  "html",
  "body",
  "p",
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "figure",
  "figcaption",
  "blockquote",
  "details",
  "summary",
  "dl",
  "dt",
  "dd",
  "address",
  "form",
  "fieldset",
  "legend",
  "hr",
  "center",
  "li",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "tfoot",
  "caption",
]);
const HEADING = /^h([1-6])$/u;

const tagOf = (el: Element): string => el.tagName.toLowerCase();
const collapse = (s: string): string => s.replace(/\s+/gu, " ").trim();

/** Collects descendant text onto a single line (for headings, table cells and list items). Block
 * children are padded with spaces so words do not run together. */
function inlineText(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!isTag(node)) return "";
  const tag = tagOf(node);
  if (SKIP.has(tag)) return "";
  if (tag === "br") return " ";
  const inner = node.children.map(inlineText).join("");
  return BLOCK.has(tag) || tag === "ul" || tag === "ol" || tag === "table" ? ` ${inner} ` : inner;
}

/** For pre: keeps whitespace and newlines as they are. */
function rawText(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!isTag(node)) return "";
  const tag = tagOf(node);
  if (SKIP.has(tag)) return "";
  if (tag === "br") return "\n";
  return node.children.map(rawText).join("");
}

/** One table becomes the caption (if any) plus a Markdown pipe table, as **one block**. Rows keep
 * document order and `|` inside a cell is escaped. It is one block so that a single-row table does
 * not trip the structurer's "short single line = heading" heuristic. */
function tableBlock(table: Element): string {
  const rows: string[][] = [];
  const captions: string[] = [];
  const visit = (node: AnyNode): void => {
    if (!isTag(node)) return;
    const tag = tagOf(node);
    if (tag === "caption") {
      const text = collapse(inlineText(node));
      if (text !== "") captions.push(text);
      return;
    }
    if (tag === "tr") {
      rows.push(
        node.children
          .filter(isTag)
          .filter((c) => tagOf(c) === "td" || tagOf(c) === "th")
          .map((c) => collapse(inlineText(c)).replace(/\|/gu, "\\|")),
      );
      return;
    }
    for (const c of node.children) visit(c);
  };
  for (const c of table.children) visit(c);
  const lines = [...captions];
  const [head, ...rest] = rows;
  if (head !== undefined) {
    const width = Math.max(...rows.map((r) => r.length));
    const line = (cells: string[]): string =>
      `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
    lines.push(line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
    for (const r of rest) lines.push(line(r));
  }
  return lines.join("\n");
}

/** A list becomes one line per item (`- ` / `1. `), nested lists indented by two spaces. An item's
 * inline content goes on its marker line; its nested lists follow. */
function listLines(list: Element, depth: number): string[] {
  const ordered = tagOf(list) === "ol";
  const lines: string[] = [];
  let n = 0;
  for (const item of list.children) {
    if (!isTag(item)) continue;
    const tag = tagOf(item);
    if (tag === "ul" || tag === "ol") {
      lines.push(...listLines(item, depth + 1)); // a list nested directly without an li is kept too
      continue;
    }
    if (tag !== "li") continue;
    n += 1;
    const own: string[] = [];
    const nested: string[] = [];
    for (const c of item.children) {
      if (isTag(c) && (tagOf(c) === "ul" || tagOf(c) === "ol"))
        nested.push(...listLines(c, depth + 1));
      else own.push(inlineText(c));
    }
    lines.push(`${"  ".repeat(depth)}${ordered ? `${String(n)}.` : "-"} ${collapse(own.join(""))}`);
    lines.push(...nested);
  }
  return lines;
}

/**
 * Walks the body DOM once and turns it into Markdown-like blocks. Inline text accumulates in a buffer
 * and becomes one block at the next block boundary; `br` is a line break inside the block (the block
 * is not split, so a short leading line is not mistaken for a heading). `pre` is wrapped in a code
 * fence so that a `# …` line inside it cannot become a heading.
 */
export function htmlToBlocks(html: string): string {
  const $ = cheerio.load(html);
  const blocks: string[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    const text = buffer
      .join("")
      .split("\n")
      .map(collapse)
      .filter((l) => l !== "")
      .join("\n");
    buffer = [];
    if (text !== "") blocks.push(text);
  };

  function walk(node: AnyNode): void {
    if (isText(node)) {
      buffer.push(node.data);
      return;
    }
    if (!isTag(node)) return; // comments, processing instructions, etc.
    const tag = tagOf(node);
    if (SKIP.has(tag)) return;
    const heading = HEADING.exec(tag);
    if (heading?.[1] !== undefined) {
      flush();
      const text = collapse(inlineText(node));
      if (text !== "") blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
      return;
    }
    if (tag === "pre") {
      flush();
      const text = rawText(node).replace(/^\n+/u, "").trimEnd();
      if (text !== "") blocks.push(`\`\`\`\n${text}\n\`\`\``);
      return;
    }
    if (tag === "table") {
      flush();
      const text = tableBlock(node);
      if (text !== "") blocks.push(text);
      return;
    }
    if (tag === "ul" || tag === "ol") {
      flush();
      const lines = listLines(node, 0);
      if (lines.length > 0) blocks.push(lines.join("\n"));
      return;
    }
    if (tag === "br") {
      buffer.push("\n");
      return;
    }
    if (BLOCK.has(tag)) {
      flush();
      for (const c of node.children) walk(c);
      flush();
      return;
    }
    for (const c of node.children) walk(c); // inline element: its text continues the current block
  }

  for (const root of $.root().children()) walk(root);
  flush();
  return blocks.join("\n\n");
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
