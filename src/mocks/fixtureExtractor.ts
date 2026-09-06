// FixtureExtractor — 확장자를 고정된 ExtractedDoc으로 매핑한다(TESTING §2). 실제 파싱은 하지 않는다.
// 이식 출처: ../msg-agent/src/mocks/fixtureExtractor.ts.
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
    // 이 목에서는 "파일명"이 bytes 안에 들어온다: 테스트가 이름을 내용으로 인코딩해 넘긴다.
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

/** 대략 chars자 분량, sections개 헤딩을 가진 ExtractedDoc을 만든다(예산 초과 등 크기 기반 테스트용). */
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
