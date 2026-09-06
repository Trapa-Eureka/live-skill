// MIME/확장자 기반 라우팅 — 결정론, 외부 IO 없음.
import type { DocumentExtractor } from "../../core/index.js";

export function hasExtension(name: string, exts: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** MIME이 먼저 이긴다 — MIME이 불명(application/octet-stream 등)이면 확장자로 폴백. */
export function findExtractor(
  extractors: readonly DocumentExtractor[],
  mime: string,
  name: string,
): DocumentExtractor | undefined {
  return extractors.find((e) => e.supports(mime, name));
}
