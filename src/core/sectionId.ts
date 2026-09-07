// 섹션 id — 헤딩 경로 기반 슬러그(DESIGN §2/§5). 같은 문서를 다시 추출해도 같은 id가 나와야
// 한다(v0.2 증분 재컴파일의 전제). 순수 함수만 — 외부 IO 없음.
// F2(DESIGN §5.1, 001-006): 모든 id는 **최종 집합 안에서 유일**해야 한다 — 접미사는 "같은 경로가 몇 번째냐"가 아니라
// "이미 쓰인 id와 겹치지 않는 첫 후보"로 고른다(`A, A, A-2` → `a, a-2, a-2-2`). 겹치면 pipeline의 Map이 앞 섹션을
// 조용히 덮어써 증류 원문·manifest 해시·평가 대상이 틀어졌다.

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

/** base가 used에 없으면 그대로, 있으면 `base-2`, `base-3`… 중 used에 없는 첫 후보. 고른 값을 used에 넣는다. */
export function disambiguate(base: string, used: Set<string>): string {
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${String(n)}`;
  used.add(candidate);
  return candidate;
}

/**
 * 문서 순서대로 나열된 헤딩들에 안정적인 섹션 id를 매긴다.
 * - id는 조상 헤딩들의 **최종 id**를 "/"로 이어붙인 경로다(예: "installation/prerequisites"). 조상이 중복으로
 *   접미사를 받았으면 자식도 그 위에 붙는다("overview-2/steps") — 어느 조상 밑인지 id만 보고 알 수 있다.
 * - 레벨을 건너뛴 경우(H1 다음 바로 H3 등)엔 빠진 조상 자리를 "section"으로 채운다.
 * - 후보가 이미 쓰인 id와 겹치면 "-2", "-3"… 중 비어 있는 첫 값을 붙인다(F2) — 결과는 항상 전부 유일하다.
 */
export function assignSectionIds(headings: readonly HeadingRef[]): string[] {
  const pathIds: string[] = []; // 깊이별 조상의 최종 id(슬러그가 아니라 접미사까지 붙은 값)
  const used = new Set<string>();
  const ids: string[] = [];

  for (const { level, heading } of headings) {
    const depth = Math.max(1, Math.trunc(level));
    const slug = slugifyHeading(heading);

    pathIds.length = Math.min(pathIds.length, depth - 1);
    while (pathIds.length < depth - 1) pathIds.push("section");
    const parent = pathIds.slice(0, depth - 1).join("/");
    const id = disambiguate(parent === "" ? slug : `${parent}/${slug}`, used);
    pathIds[depth - 1] = id.slice(parent === "" ? 0 : parent.length + 1);
    ids.push(id);
  }

  return ids;
}

const PATH_SEPARATORS = /[\\/]+/u;

/** 마지막 세그먼트의 확장자를 뗀다("readme.md" → "readme"). 점으로 시작하는 이름(".env")은 그대로 둔다. */
function stripExtension(name: string): string {
  return name.replace(/(?<=.)\.[^.]+$/u, "");
}

/**
 * 소스가 여러 개일 때 각 파일의 섹션 id 앞에 붙일 접두어(F2). 파일명(basename)만 쓰면 다른 폴더의 같은 이름
 * (`a/readme.md`·`b/readme.md`)이 충돌하므로, 모든 경로에 공통인 상위 디렉터리를 뺀 **상대 경로**를 슬러그로 만든다
 * (`a-readme`, `b-readme`). 슬러그가 그래도 겹치면(`A.md`·`a.md`) 같은 접미사 규칙으로 유일하게 만든다.
 * 경로 1개 이하면 빈 배열 — 단일 문서는 접두어를 붙이지 않는다(DESIGN §5.1). 순서는 입력 순서.
 */
export function namespacePrefixes(paths: readonly string[]): string[] {
  if (paths.length <= 1) return [];
  const split = paths.map((p) => p.split(PATH_SEPARATORS).filter((s) => s !== ""));
  const first = split[0] ?? [];
  let common = 0;
  // 파일 자체는 공통 접두어가 될 수 없으므로 가장 짧은 경로의 마지막 세그먼트는 남겨 둔다.
  const maxCommon = Math.min(...split.map((s) => s.length)) - 1;
  while (common < maxCommon && split.every((s) => s[common] === first[common])) common += 1;
  const used = new Set<string>();
  return split.map((segments) => {
    const relative = segments.slice(common);
    const last = relative.pop();
    const parts = [...relative, stripExtension(last ?? "")].filter((s) => s !== "");
    return disambiguate(slugifyHeading(parts.join("-")), used);
  });
}
