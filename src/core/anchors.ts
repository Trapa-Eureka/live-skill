// distill 응답(마크다운 본문)에서 [§sectionId] 각주를 결정론으로 뽑는다(DESIGN §5.1) — LLM에게 별도로
// anchors 목록을 묻지 않는다.
const ANCHOR_RE = /\[§([^\]\s]+)\]/gu;

export function extractAnchors(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(ANCHOR_RE)) {
    const id = m[1];
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}
