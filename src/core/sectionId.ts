// Section ids: heading-path slugs (DESIGN §2/§5). Re-extracting the same document must yield the
// same ids (the premise of v0.2 incremental recompiles). Pure functions only, no external IO.
// F2 (DESIGN §5.1, 001-006): every id must be **unique within the final set**. The suffix is not
// "which occurrence of this path" but "the first candidate that does not collide with an id
// already used" (`A, A, A-2` → `a, a-2, a-2-2`). A collision made the pipeline's Map silently
// overwrite the earlier section, corrupting the distill source, manifest hashes and the eval
// population.

const MAX_SLUG_LENGTH = 60;

export interface HeadingRef {
  level: number;
  heading: string;
}

/** Turns one heading text into a slug. Each run of non-letter/non-digit characters collapses to a
 * single hyphen. */
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

/** Returns base when it is not in used; otherwise the first of `base-2`, `base-3`, ... that is
 * not in used. The chosen value is added to used. */
export function disambiguate(base: string, used: Set<string>): string {
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${String(n)}`;
  used.add(candidate);
  return candidate;
}

/**
 * Assigns stable section ids to headings listed in document order.
 * - An id is the path of the ancestors' **final ids** joined with "/" (e.g.
 *   "installation/prerequisites"). If an ancestor received a duplicate suffix, its children build on
 *   it ("overview-2/steps"), so the id alone tells which ancestor a section belongs to.
 * - When a level is skipped (H3 right after H1, etc.), the missing ancestor slot is filled with
 *   "section".
 * - When a candidate collides with an id already used, the first free "-2", "-3", ... suffix is
 *   appended (F2); the result is always entirely unique.
 */
export function assignSectionIds(headings: readonly HeadingRef[]): string[] {
  const pathIds: string[] = []; // final id of the ancestor at each depth (with suffix, not the bare slug)
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

/** Strips the extension from the last segment ("readme.md" → "readme"). A name starting with a
 * dot (".env") is left alone. */
function stripExtension(name: string): string {
  return name.replace(/(?<=.)\.[^.]+$/u, "");
}

/**
 * The prefix to put in front of each file's section ids when there are several sources (F2). Using
 * the basename alone lets the same name in different folders (`a/readme.md`, `b/readme.md`)
 * collide, so the **relative path** below the directory common to all paths is slugified instead
 * (`a-readme`, `b-readme`). If slugs still collide (`A.md`, `a.md`), the same suffix rule makes
 * them unique. With at most one path, returns an empty array: a single document gets no prefix
 * (DESIGN §5.1). Order follows the input.
 */
export function namespacePrefixes(paths: readonly string[]): string[] {
  if (paths.length <= 1) return [];
  const split = paths.map((p) => p.split(PATH_SEPARATORS).filter((s) => s !== ""));
  const first = split[0] ?? [];
  let common = 0;
  // A file itself can never be part of the common prefix, so the shortest path keeps its last segment.
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
