import { describe, expect, it } from "vitest";
import {
  countChars,
  normalizeText,
  pdfPagesToText,
  structureText,
  toExtractedDoc,
} from "../src/core/index.js";

describe("normalizeText", () => {
  it("normalizes CRLF, strips BOM, and collapses 3+ blank lines to 1", () => {
    expect(normalizeText("﻿a\r\nb\n\n\n\nc")).toBe("a\nb\n\nc");
  });
});

describe("normalizeText — HTML comments are not body text (B1)", () => {
  it("strips <!-- --> comments, including multi-line ones, so a comment-only preamble yields no section", () => {
    const md = "<!-- 자체 제작 문서\n   두 줄 주석 -->\n\n# Title\n\nBody.";
    expect(normalizeText(md)).toBe("# Title\n\nBody.");
    const sections = structureText(md);
    expect(sections.map((s) => s.heading)).toEqual(["Title"]);
    expect(sections[0]?.text).toBe("Body.");
  });

  it("strips a comment sitting inside a section's body without touching the surrounding text", () => {
    expect(structureText("# T\n\nBefore. <!-- note --> After.")[0]?.text).toBe("Before.  After.");
  });
});

describe("structureText", () => {
  it("returns no sections for empty/whitespace-only input", () => {
    expect(structureText("")).toEqual([]);
    expect(structureText("   \n\n  ")).toEqual([]);
  });

  it("opens a new section on a Markdown ATX heading and keeps the level", () => {
    const sections = structureText("# Title\n\nIntro.\n\n## Sub\n\nBody.");
    expect(sections).toEqual([
      { heading: "Title", level: 1, text: "Intro." },
      { heading: "Sub", level: 2, text: "Body." },
    ]);
  });

  it("treats a short line with no terminal punctuation as an implicit heading", () => {
    const sections = structureText("Installation\n\nConnect the cable.");
    expect(sections[0]).toEqual({ heading: "Installation", level: 1, text: "Connect the cable." });
  });

  it("attaches leading content before the first heading to a heading:'' section", () => {
    const sections = structureText("Just a paragraph with no heading above it, and a period.");
    expect(sections).toEqual([
      { heading: "", level: 1, text: "Just a paragraph with no heading above it, and a period." },
    ]);
  });

  it("does not treat a full sentence or a bare link as a heading", () => {
    const sections = structureText("This is a full sentence.\n\n[a link](http://example.invalid)");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe("");
  });

  it("does not treat an ordered-list item as a heading", () => {
    const sections = structureText("1. First step");
    expect(sections[0]?.heading).toBe("");
    expect(sections[0]?.text).toBe("1. First step");
  });

  // F5 (001-011, 완료 기준): 헤딩은 줄 단위 — 빈 줄이 없어도 인식하고, 코드 펜스 안의 `#`는 무시한다.
  it("recognizes ATX headings with no blank lines around them (F5)", () => {
    expect(structureText("# Title\nBody.\n## Sub\nDetail.\n### Deep\nMore.")).toEqual([
      { heading: "Title", level: 1, text: "Body." },
      { heading: "Sub", level: 2, text: "Detail." },
      { heading: "Deep", level: 3, text: "More." },
    ]);
  });

  it("keeps the heading-path ids of a tightly written document (the same as with blank lines)", () => {
    const tight = toExtractedDoc(structureText("# A\nx.\n## B\ny.\n## C\nz."));
    const spaced = toExtractedDoc(structureText("# A\n\nx.\n\n## B\n\ny.\n\n## C\n\nz."));
    expect(tight.sections.map((s) => s.id)).toEqual(["a", "a/b", "a/c"]);
    expect(tight).toEqual(spaced);
  });

  it("ignores '#' lines inside a ``` code fence, even across blank lines inside the fence (F5)", () => {
    const sections = structureText("# Real\n```\n# not a heading\n\necho hi\n```\nAfter the code.");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe("Real");
    expect(sections[0]?.text).toBe("```\n# not a heading\n\necho hi\n```\n\nAfter the code.");
  });

  it("treats ~~~ fences and longer fences the same way, and closes only on a matching fence", () => {
    const sections = structureText("~~~\n# still code\n```\n# still code too\n~~~\n## Next\nBody.");
    expect(sections.map((s) => s.heading)).toEqual(["", "Next"]);
    expect(sections[0]?.text).toContain("# still code too");
  });

  it("an unclosed fence swallows the rest of the document without creating headings", () => {
    const sections = structureText("Intro.\n```\n# a\n\n# b");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe("");
    expect(sections[0]?.text).toBe("Intro.\n\n```\n# a\n\n# b");
  });

  it("a heading right after a closing fence still opens a section", () => {
    const sections = structureText("```\nx\n```\n## Next\nBody.");
    expect(sections.map((s) => s.heading)).toEqual(["", "Next"]);
    expect(sections[1]?.text).toBe("Body.");
  });

  it("'#hashtag' without a space is not an ATX heading, and a lone '#' inside a paragraph stays text", () => {
    const sections = structureText("Use the tag #release when you ship.\nThen #\nDone.");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe("");
  });
});

describe("pdfPagesToText", () => {
  it("turns a short heading-like line into a Markdown heading and joins wrapped lines", () => {
    const page = ["Overview", "This sentence wraps across", "two lines in the PDF."].join("\n");
    const text = pdfPagesToText([page]);
    expect(text).toContain("# Overview");
    expect(text).toContain("This sentence wraps across two lines in the PDF.");
  });

  it("joins wrapped CJK lines with no inserted space", () => {
    const page = ["개요", "이 문장은 페이지 안에서", "두 줄로 줄바꿈됩니다."].join("\n");
    const text = pdfPagesToText([page]);
    expect(text).toContain("이 문장은 페이지 안에서두 줄로 줄바꿈됩니다.");
  });

  it("flushes a trailing paragraph that never hit a short terminal-punctuated line", () => {
    const page = ["Overview", "word ".repeat(30).trim()].join("\n");
    const text = pdfPagesToText([page]);
    expect(text.endsWith("word")).toBe(true);
  });
});

describe("toExtractedDoc", () => {
  it("assigns a heading-path id to every section", () => {
    const doc = toExtractedDoc(structureText("# A\n\nIntro.\n\n## B\n\nDetail."));
    expect(doc.sections.map((s) => s.id)).toEqual(["a", "a/b"]);
  });
});

describe("countChars", () => {
  it("counts non-whitespace characters only", () => {
    expect(countChars("a b\nc")).toBe(3);
  });
});
