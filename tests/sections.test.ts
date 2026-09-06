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
