// Source → verification population (DESIGN §5.1 B1, F2, F3). compile and eval --source extract
// the source with **the same code**, apply the same prefixes when there are several sources, and
// build the population by the same rule (sections with body text only). eval used to re-extract in
// its own loop without prefixes, so for a multi-source skill the manifest's assignment (`x/a`) and
// the re-extracted id (`a`) disagreed and the gate failed with zero questions (001-008).
// Pure computation plus calls to the injected extractors; file reading belongs to the adapter.
import { sha256Hex } from "./hash.js";
import { isSubstantiveSection } from "./outlineCoverage.js";
import { err, ok, type Result } from "./result.js";
import { namespacePrefixes } from "./sectionId.js";
import type { DocumentExtractor, ExtractError, Manifest, Section } from "./types.js";

export interface SourceFile {
  path: string;
  bytes: Uint8Array;
  /** Defaults to "application/octet-stream", which falls back to extension-based routing
   * (adapters/extractors/route.ts). */
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

export const SUPPORTED_FORMATS = "PDF (text-based), DOCX, MD/TXT, HTML";

/** Extracts the source files in order. Stops at the first failure and returns it with cause + fix. */
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

/** With several sources, prefixes each file's section ids (the slug of the relative path below the
 * common directory, F2) to prevent collisions. Every resulting id must be unique: a collision would
 * let the downstream Map silently overwrite the earlier section, so this fails loudly instead. */
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

/** Verification population (B1): after prefixing, only sections with body text. compile's outline
 * and gate and eval --source all see the same set (F3). */
export function buildPopulation(perFile: readonly PerFileSections[]): NamedSection[] {
  return namespaceSections(perFile).filter(isSubstantiveSection);
}

export interface PopulationMatch {
  /** Section ids in the manifest that the current source no longer produces: a file is missing, or
   * a different folder layout changed the prefix. */
  missing: string[];
  /** Section ids in the current source that the manifest lacks: extra files came in, or headings
   * were added. */
  unknown: string[];
  /** Section ids present on both sides whose body hash differs: the source changed after compile
   * (questions are regenerated from the current source). */
  changed: string[];
}

/** Whether the population eval --source re-extracted is the same set the manifest compiled (F3).
 * If the id sets differ, the chapter assignment cannot be applied and the caller must fail
 * explicitly; a changed body alone is informational. */
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
