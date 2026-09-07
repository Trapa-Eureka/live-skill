// HTML 추출기 (cheerio). DOM을 문서 순서로 **한 번만** 걸으며(F4, DESIGN §5.1) 헤딩·문단·컨테이너의 직접 텍스트·
// 표·목록·코드 블록을 마크다운 느낌의 블록으로 바꾼 뒤 공유 구조화기(structureText)에 넘긴다. 예전엔 h1~h6·p·li·
// blockquote·pre만 선택자로 골라 td/th와 div의 직접 텍스트를 버렸다(001-010) — 규칙·수치가 표에 든 문서에서 정보가
// 조용히 사라졌다. 텍스트 노드는 가장 가까운 블록에서 정확히 한 번만 수집되므로 중첩 요소로 인한 중복이 없다.
// msg-agent에 없는, live-skill 신규 구현(CLAUDE.md 스택: "cheerio+변환").
import * as cheerio from "cheerio";
import { isTag, isText, type AnyNode, type Element } from "domhandler";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../../core/index.js";
import { hasExtension } from "./route.js";

const MIMES = new Set(["text/html", "application/xhtml+xml"]);
const EXTS = [".html", ".htm"];

/** 본문이 아닌 것 — 통째로 건너뛴다. */
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
/** 앞뒤에서 줄을 끊는 블록 요소. 표·목록·헤딩·pre는 따로 다룬다. */
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

/** 자손 텍스트를 한 줄로 모은다(헤딩·표 셀·목록 항목용). 블록 자식은 공백으로 띄워 단어가 붙지 않게 한다. */
function inlineText(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!isTag(node)) return "";
  const tag = tagOf(node);
  if (SKIP.has(tag)) return "";
  if (tag === "br") return " ";
  const inner = node.children.map(inlineText).join("");
  return BLOCK.has(tag) || tag === "ul" || tag === "ol" || tag === "table" ? ` ${inner} ` : inner;
}

/** pre용 — 공백·개행을 그대로 둔다. */
function rawText(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!isTag(node)) return "";
  const tag = tagOf(node);
  if (SKIP.has(tag)) return "";
  if (tag === "br") return "\n";
  return node.children.map(rawText).join("");
}

/** 표 하나 → 캡션(있으면) + 마크다운 파이프 표를 **한 블록**으로. 행은 문서 순서, 셀 안 `|`는 이스케이프한다.
 * 한 블록으로 묶는 이유: 한 줄짜리 표가 구조화기의 "짧은 한 줄 = 헤딩" 휴리스틱에 걸리지 않게. */
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

/** 목록 → 항목마다 한 줄(`- ` / `1. `), 중첩은 두 칸 들여쓰기. 항목의 인라인 내용은 표식 줄에, 중첩 목록은 그 뒤에. */
function listLines(list: Element, depth: number): string[] {
  const ordered = tagOf(list) === "ol";
  const lines: string[] = [];
  let n = 0;
  for (const item of list.children) {
    if (!isTag(item)) continue;
    const tag = tagOf(item);
    if (tag === "ul" || tag === "ol") {
      lines.push(...listLines(item, depth + 1)); // li 없이 바로 중첩된 목록도 잃지 않는다
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
 * 본문 DOM을 한 번 걸어 마크다운 느낌의 블록들로 바꾼다. 인라인 텍스트는 버퍼에 모였다가 블록 경계에서 한 블록이 되고,
 * `br`은 블록 안 줄바꿈이다(짧은 앞 줄이 헤딩으로 오인되지 않게 블록을 쪼개지 않는다). `pre`는 코드 펜스로 감싼다 —
 * 안의 `# …` 줄이 헤딩이 되면 안 된다.
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
    if (!isTag(node)) return; // 주석·처리 지시 등
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
    for (const c of node.children) walk(c); // 인라인 요소 — 텍스트가 현재 블록에 이어진다
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
