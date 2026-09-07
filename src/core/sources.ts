// 원문 → 검증 모집단(DESIGN §5.1 B1·F2·F3). compile과 eval --source가 **같은 코드**로 원문을 추출하고, 소스가 여러 개면
// 같은 접두어를 붙이고, 같은 규칙(본문 있는 섹션만)으로 모집단을 만든다 — 예전엔 eval이 자기 루프로 재추출해 접두어가
// 없었고, 다중 소스 스킬의 manifest 배정(`x/a`)과 재추출 id(`a`)가 어긋나 질문 0개로 게이트가 실패했다(001-008).
// 순수 계산 + 주입된 추출기 호출만 — 파일 읽기는 어댑터 몫.
import { sha256Hex } from "./hash.js";
import { isSubstantiveSection } from "./outlineCoverage.js";
import { err, ok, type Result } from "./result.js";
import { namespacePrefixes } from "./sectionId.js";
import type { DocumentExtractor, ExtractError, Manifest, Section } from "./types.js";

export interface SourceFile {
  path: string;
  bytes: Uint8Array;
  /** 없으면 "application/octet-stream" — 확장자 기반 라우팅으로 폴백(adapters/extractors/route.ts). */
  mime?: string;
}

export interface PerFileSections {
  path: string;
  sections: Section[];
}

export interface NamedSection extends Section {
  sourcePath: string;
}

export type SourceError =
  | { kind: "unsupported_format"; path: string; message: string }
  | { kind: "extract_failed"; path: string; error: ExtractError; message: string };

export const SUPPORTED_FORMATS = "PDF(텍스트형)·DOCX·MD/TXT·HTML";

/** 소스 파일들을 순서대로 추출한다. 첫 실패에서 멈추고 원인 + 수정 방법을 담아 돌려준다. */
export async function extractSources(
  sources: readonly SourceFile[],
  extractors: readonly DocumentExtractor[],
): Promise<Result<PerFileSections[], SourceError>> {
  const perFile: PerFileSections[] = [];
  for (const src of sources) {
    const mime = src.mime ?? "application/octet-stream";
    const extractor = extractors.find((e) => e.supports(mime, src.path));
    if (extractor === undefined) {
      return err({
        kind: "unsupported_format",
        path: src.path,
        message: `"${src.path}": unsupported format. Fix: use one of ${SUPPORTED_FORMATS}.`,
      });
    }
    const result = await extractor.extract(src.bytes);
    if (!result.ok) {
      const fix =
        result.error.kind === "empty_text"
          ? "the document has no extractable text — check it isn't a scanned image (OCR is not supported in v0.1)."
          : "the file may be corrupt or password-protected — try re-exporting it.";
      return err({
        kind: "extract_failed",
        path: src.path,
        error: result.error,
        message: `"${src.path}": extraction failed (${result.error.kind}). Fix: ${fix}`,
      });
    }
    perFile.push({ path: src.path, sections: result.value.sections });
  }
  return ok(perFile);
}

/** 소스가 여러 개면 파일마다 접두어(공통 상위 디렉터리를 뺀 상대 경로 슬러그, F2)를 붙여 섹션 id 충돌을 막는다.
 * 결과 id는 전부 유일해야 한다 — 겹치면 뒤의 Map이 앞 섹션을 조용히 덮어쓰므로 여기서 크게 실패한다. */
export function namespaceSections(perFile: readonly PerFileSections[]): NamedSection[] {
  const prefixes = namespacePrefixes(perFile.map((f) => f.path));
  const named = perFile.flatMap(({ path, sections }, i) => {
    const prefix = prefixes[i];
    return sections.map((s) => ({
      ...s,
      id: prefix === undefined ? s.id : `${prefix}/${s.id}`,
      sourcePath: path,
    }));
  });
  const seen = new Set<string>();
  for (const s of named) {
    if (seen.has(s.id)) {
      throw new Error(
        `section id collision: "${s.id}" appears twice after namespacing — this is a bug in core/sectionId.ts (ids must be unique by construction).`,
      );
    }
    seen.add(s.id);
  }
  return named;
}

/** 검증 모집단(B1): 접두어를 붙인 뒤 본문 있는 섹션만. compile의 outline·게이트와 eval --source가 같은 집합을 본다(F3). */
export function buildPopulation(perFile: readonly PerFileSections[]): NamedSection[] {
  return namespaceSections(perFile).filter(isSubstantiveSection);
}

export interface PopulationMatch {
  /** manifest에는 있는데 지금 원문에서 나오지 않은 섹션 id — 파일이 빠졌거나 폴더 구조가 달라 접두어가 바뀌었다. */
  missing: string[];
  /** 지금 원문에는 있는데 manifest에 없는 섹션 id — 파일이 더 들어왔거나 헤딩이 추가됐다. */
  unknown: string[];
  /** 양쪽에 있지만 본문 해시가 다른 섹션 id — 컴파일 뒤 원문이 바뀌었다(문항은 현재 원문으로 새로 만든다). */
  changed: string[];
}

/** eval --source가 재추출한 모집단이 manifest가 컴파일한 모집단과 같은 집합인지(F3). id 집합이 다르면 챕터 배정을
 * 적용할 수 없으므로 호출자는 명시적으로 실패해야 한다; 본문만 바뀐 것은 참고 사항이다. */
export function matchManifestSections(
  manifest: Manifest,
  population: readonly Section[],
): PopulationMatch {
  const byId = new Map(population.map((s) => [s.id, s]));
  const manifestIds = new Set(manifest.sections.map((s) => s.id));
  const missing = manifest.sections.map((s) => s.id).filter((id) => !byId.has(id));
  const unknown = population.map((s) => s.id).filter((id) => !manifestIds.has(id));
  const changed = manifest.sections
    .filter((s) => {
      const now = byId.get(s.id);
      return now !== undefined && sha256Hex(now.text) !== s.sha256;
    })
    .map((s) => s.id);
  return { missing, unknown, changed };
}
