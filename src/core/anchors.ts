// Deterministically extracts [§sectionId] footnotes from a distill response (markdown body),
// DESIGN §5.1. The LLM is never asked for a separate anchors list.
const ANCHOR_RE = /\[§([^\]\s]+)\]/gu;

export function extractAnchors(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(ANCHOR_RE)) {
    const id = m[1];
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}
