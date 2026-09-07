// MIME/extension based routing: deterministic, no external IO.
import type { DocumentExtractor } from "../../core/index.js";

export function hasExtension(name: string, exts: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** MIME wins first; when the MIME type is uninformative (application/octet-stream etc.), fall back
 * to the extension. */
export function findExtractor(
  extractors: readonly DocumentExtractor[],
  mime: string,
  name: string,
): DocumentExtractor | undefined {
  return extractors.find((e) => e.supports(mime, name));
}
