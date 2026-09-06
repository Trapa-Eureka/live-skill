// 섹션 id — 헤딩 경로 기반 슬러그(DESIGN §2/§5). 같은 문서를 다시 추출해도 같은 id가 나와야
// 한다(v0.2 증분 재컴파일의 전제). 순수 함수만 — 외부 IO 없음.

const MAX_SLUG_LENGTH = 60;

export interface HeadingRef {
  level: number;
  heading: string;
}

/** 헤딩 텍스트 하나를 슬러그로 만든다. 문자/숫자가 아닌 연속 구간은 하이픈 하나로 뭉친다. */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug === "" ? "section" : slug;
}

/**
 * 문서 순서대로 나열된 헤딩들에 안정적인 섹션 id를 매긴다.
 * - id는 조상 헤딩들의 슬러그를 "/"로 이어붙인 경로다(예: "installation/prerequisites").
 * - 레벨을 건너뛴 경우(H1 다음 바로 H3 등)엔 빠진 조상 자리를 "section"으로 채운다.
 * - 같은 경로가 중복되면 등장 순서로 "-2", "-3"…을 붙여 구분한다.
 */
export function assignSectionIds(headings: readonly HeadingRef[]): string[] {
  const pathSlugs: string[] = [];
  const seen = new Map<string, number>();
  const ids: string[] = [];

  for (const { level, heading } of headings) {
    const depth = Math.max(1, Math.trunc(level));
    const slug = slugifyHeading(heading);

    pathSlugs.length = Math.min(pathSlugs.length, depth - 1);
    while (pathSlugs.length < depth - 1) pathSlugs.push("section");
    pathSlugs[depth - 1] = slug;

    const basePath = pathSlugs.slice(0, depth).join("/");
    const count = seen.get(basePath) ?? 0;
    seen.set(basePath, count + 1);
    ids.push(count === 0 ? basePath : `${basePath}-${String(count + 1)}`);
  }

  return ids;
}
