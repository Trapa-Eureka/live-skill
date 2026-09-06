// 헤딩/문단 구조화 — 모든 추출기가 공유하는 순수 로직(DESIGN §3). 형식별 전처리(PDF의 페이지별 평문,
// DOCX/HTML의 마크다운 변환)를 거친 텍스트를 여기서 섹션 목록으로 나눈다. 이식 출처: ../msg-agent
// (src/core/sections.ts) — DESIGN §2에 맞춰 필드명(heading/level 항상 존재)과 섹션 id 결합만 조정했다.
import { assignSectionIds, slugifyHeading } from "./sectionId.js";
import type { ExtractedDoc } from "./types.js";

const MAX_TITLE_CHARS = 80;
const TERMINAL_PUNCT = /[.!?:;,。．！？：；、]$/u;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/u;
const ORDERED_LIST = /^(?:\d+[.)]|[-*+•])\s+/u;

/** 줄바꿈·BOM을 정규화하고 빈 줄 3개 이상을 2개로 줄인다. HTML 주석(`<!-- … -->`)은 본문이 아니므로
 * 지운다(B1, DESIGN §5.1) — 마크다운 렌더러도 보여주지 않는 텍스트가 섹션·검증 모집단이 되면 안 된다. */
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

/** 블록이 헤딩인지 판별한다: 마크다운 ATX 헤딩이거나, 종결부호 없는 짧은 한 줄. */
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
  if (block.includes("](")) return undefined; // 헐벗은 마크다운 링크는 헤딩이 아니라 본문이다
  return { heading: block, level: 1 };
}

export interface RawSection {
  heading: string;
  level: number;
  text: string;
}

/**
 * 정규화된 텍스트를 섹션으로 나눈다: 빈 줄이 블록을 구분하고, 헤딩처럼 보이는 블록은 새 섹션을 열며,
 * 나머지는 현재 섹션 본문에 이어붙는다. 첫 헤딩 이전의 내용은 heading: ""인 섹션이 된다.
 */
export function structureText(raw: string): RawSection[] {
  const text = normalizeText(raw);
  if (text === "") return [];

  const sections: RawSection[] = [];
  let current: RawSection | undefined;
  const blocks = text
    .split(/\n\s*\n/u)
    .map((b) => b.trim())
    .filter((b) => b !== "");

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

/** RawSection[]에 안정적인 섹션 id를 매겨 최종 ExtractedDoc으로 만든다(core/sectionId.ts 결합). */
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
  // 줄바꿈으로 잘린 CJK 텍스트는 공백이 없다; 그 외는 공백 하나로 잇는다.
  return CJK.test(tail) && CJK.test(head) ? `${a}${b}` : `${a} ${b}`;
}

/**
 * PDF에서 뽑은, 시각적 줄마다 개행이 들어간 평문을 문단/헤딩으로 재구성한다. 짧고 종결부호 없는 줄은
 * 헤딩으로, 종결부호로 끝나며 페이지 최장 줄보다 뚜렷이 짧은 줄은 문단의 끝으로 본다. 그 외는 줄바꿈으로
 * 잘린 이어지는 줄로 보고 합친다. structureText가 읽을 수 있게 "# 헤딩" 마크다운 표기로 출력한다.
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

/** 공백을 뺀 전체 글자 수 — 예산·크기 가드에 쓴다. */
export function countChars(text: string): number {
  return text.replace(/\s+/gu, "").length;
}
