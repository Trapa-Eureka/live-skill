// Heading/paragraph structuring: pure logic shared by every extractor (DESIGN §3). Text that has
// been through per-format preprocessing (per-page plain text for PDF, markdown conversion for
// DOCX/HTML) is split into a section list here. Ported from ../msg-agent (src/core/sections.ts);
// only the field names (heading/level always present) and the section-id coupling were adjusted
// to match DESIGN §2.
import { assignSectionIds, slugifyHeading } from "./sectionId.js";
import type { ExtractedDoc } from "./types.js";

const MAX_TITLE_CHARS = 80;
const TERMINAL_PUNCT = /[.!?:;,。．！？：；、]$/u;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/u;
const ORDERED_LIST = /^(?:\d+[.)]|[-*+•])\s+/u;

/** Normalizes line endings and the BOM and collapses runs of 3+ blank lines to 2. HTML comments
 * (`<!-- … -->`) are not body text, so they are removed (B1, DESIGN §5.1): text a markdown renderer
 * would not even show must not become a section or part of the verification population. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\uFEFF/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

interface HeadingBlock {
  heading: string;
  level: number;
}

/** Decides whether a block is a heading: a markdown ATX heading, or a short single line with no
 * terminal punctuation. */
function asHeading(block: string): HeadingBlock | undefined {
  const md = MARKDOWN_HEADING.exec(block);
  const hashes = md?.[1];
  const title = md?.[2];
  if (hashes !== undefined && title !== undefined) {
    return { heading: title.trim(), level: hashes.length };
  }
  if (block.includes("\n")) return undefined;
  if (block.length > MAX_TITLE_CHARS) return undefined;
  if (TERMINAL_PUNCT.test(block)) return undefined;
  if (ORDERED_LIST.test(block)) return undefined;
  if (block.includes("](")) return undefined; // a bare markdown link is body text, not a heading
  return { heading: block, level: 1 };
}

export interface RawSection {
  heading: string;
  level: number;
  text: string;
}

/** A code-fence opening/closing line (CommonMark: up to 3 spaces of indent, 3+ backticks or
 * tildes). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
/** An ATX heading line: `#` to `######` followed by whitespace and content. Without the space, as
 * in `#hashtag`, it is not a heading. */
const ATX_LINE = /^ {0,3}#{1,6}\s+\S/u;

/**
 * Splits text into blocks (F5, DESIGN §5.1). Blank lines still separate blocks, but (1) an ATX
 * heading line is **a block on its own** even with no blank line around it (markdown written
 * tightly, like `# Title\nBody.\n## Sub`), and (2) inside a code fence, blank lines do not split
 * and `#` lines do not become headings (the whole fence is one block). An unclosed fence is one
 * block to the end.
 */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | undefined; // the open fence marker; closes only on the same char, same length or longer
  const flush = (): void => {
    const block = current.join("\n").trim();
    current = [];
    if (block !== "") blocks.push(block);
  };
  for (const line of text.split("\n")) {
    const mark = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      current.push(line);
      if (
        mark !== undefined &&
        mark.startsWith(fence.slice(0, 1)) &&
        mark.length >= fence.length &&
        line.trim() === mark
      ) {
        fence = undefined;
        flush(); // the line after a closing fence starts a new block
      }
      continue;
    }
    if (mark !== undefined) {
      flush();
      fence = mark;
      current.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (ATX_LINE.test(line)) {
      flush();
      current.push(line);
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Splits normalized text into sections: among the blocks (split on blank lines, ATX heading lines
 * and code fences by splitBlocks), a heading-like block opens a new section and everything else is
 * appended to the current section's body. Content before the first heading becomes a section with
 * heading: "".
 */
export function structureText(raw: string): RawSection[] {
  const text = normalizeText(raw);
  if (text === "") return [];

  const sections: RawSection[] = [];
  let current: RawSection | undefined;
  const blocks = splitBlocks(text);

  for (const block of blocks) {
    const heading = asHeading(block);
    if (heading !== undefined) {
      current = { heading: heading.heading, level: heading.level, text: "" };
      sections.push(current);
      continue;
    }
    if (current === undefined) {
      current = { heading: "", level: 1, text: "" };
      sections.push(current);
    }
    current.text = current.text === "" ? block : `${current.text}\n\n${block}`;
  }
  return sections;
}

/** Assigns stable section ids to RawSection[] and produces the final ExtractedDoc (coupled with
 * core/sectionId.ts). */
export function toExtractedDoc(rawSections: readonly RawSection[]): ExtractedDoc {
  const ids = assignSectionIds(rawSections);
  const sections = rawSections.map((raw, i) => ({
    id: ids[i] ?? slugifyHeading(raw.heading),
    heading: raw.heading,
    level: raw.level,
    text: raw.text,
  }));
  return { sections };
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const MAX_PDF_HEADING_CHARS = 60;
const SHORT_LAST_LINE_RATIO = 0.7;

function joinWrapped(a: string, b: string): string {
  const tail = a.at(-1) ?? "";
  const head = b.at(0) ?? "";
  // CJK text broken by a line wrap has no space at the seam; everything else is joined with one.
  return CJK.test(tail) && CJK.test(head) ? `${a}${b}` : `${a} ${b}`;
}

/**
 * Rebuilds paragraphs/headings from PDF plain text that has a newline after every visual line. A
 * short line with no terminal punctuation is a heading; a line that ends in terminal punctuation
 * and is clearly shorter than the page's longest line ends a paragraph. Anything else is a wrapped
 * continuation and is joined. Output uses "# heading" markdown notation so structureText can read
 * it.
 */
export function pdfPagesToText(pages: readonly string[]): string {
  const out: string[] = [];
  for (const page of pages) {
    const lines = normalizeText(page)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const maxLen = Math.max(0, ...lines.map((l) => l.length));
    let para = "";
    let prevComplete = true;
    for (const line of lines) {
      const endsSentence = TERMINAL_PUNCT.test(line);
      const headingLike =
        prevComplete &&
        para === "" &&
        !endsSentence &&
        line.length <= MAX_PDF_HEADING_CHARS &&
        line.length < maxLen * SHORT_LAST_LINE_RATIO &&
        !ORDERED_LIST.test(line);
      if (headingLike) {
        out.push(`# ${line}`);
        prevComplete = true;
        continue;
      }
      para = para === "" ? line : joinWrapped(para, line);
      const shortLastLine = line.length < maxLen * SHORT_LAST_LINE_RATIO;
      if (endsSentence && shortLastLine) {
        out.push(para);
        para = "";
        prevComplete = true;
      } else {
        prevComplete = false;
      }
    }
    if (para !== "") out.push(para);
  }
  return out.join("\n\n");
}

/** Total character count excluding whitespace, used by budget and size guards. */
export function countChars(text: string): number {
  return text.replace(/\s+/gu, "").length;
}
