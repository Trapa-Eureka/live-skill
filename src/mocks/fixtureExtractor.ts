// FixtureExtractor maps a file extension to a fixed ExtractedDoc (TESTING §2). It does no real
// parsing. Ported from ../msg-agent/src/mocks/fixtureExtractor.ts.
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../core/index.js";
import { err, ok, structureText, toExtractedDoc } from "../core/index.js";

export type FixtureEntry = ExtractedDoc | { error: ExtractError };

export class FixtureExtractor implements DocumentExtractor {
  readonly extracted: string[] = [];

  constructor(private readonly byExt: Readonly<Record<string, FixtureEntry>>) {}

  supports(_mime: string, name: string): boolean {
    return this.keyFor(name) !== undefined;
  }

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    // In this mock the "file name" arrives inside bytes: tests encode the name as the content.
    const name = new TextDecoder().decode(bytes);
    const key = this.keyFor(name);
    const entry = key === undefined ? undefined : this.byExt[key];
    this.extracted.push(name);
    if (entry === undefined) return Promise.resolve(err({ kind: "corrupt", detail: "no fixture" }));
    if ("error" in entry) return Promise.resolve(err(entry.error));
    return Promise.resolve(ok(entry));
  }

  private keyFor(name: string): string | undefined {
    const ext = name.toLowerCase().split(".").pop() ?? "";
    return ext in this.byExt ? ext : undefined;
  }
}

/** Builds an ExtractedDoc of roughly `chars` characters spread over `sections` headings, for
 * size-based tests such as budget overflow. The "ko" variant is deliberate Korean-language content
 * (it exercises CJK handling such as token estimation), so its sentence and heading stay Korean. */
export function syntheticDoc(chars: number, sections = 4, lang: "en" | "ko" = "en"): ExtractedDoc {
  const sentence =
    lang === "en"
      ? "The device logs every cycle and reports faults to the maintenance console. "
      : "장비는 모든 주기를 기록하고 오류를 정비 콘솔에 보고합니다. ";
  const perSection = Math.ceil(chars / sections);
  const parts: string[] = [];
  for (let i = 0; i < sections; i++) {
    let body = "";
    while (body.replace(/\s+/gu, "").length < perSection) body += sentence;
    parts.push(`# ${lang === "en" ? "Section" : "조항"} ${String(i + 1)}\n\n${body.trim()}`);
  }
  return toExtractedDoc(structureText(parts.join("\n\n")));
}
