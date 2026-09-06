// 스킬 산출물을 실제 디스크에 쓴다 — --force/out 경계(가드레일 5, DESIGN §5.1). core/pipeline.ts는
// AssembledFile[]만 돌려주고 여기서 실제 IO를 한다. §6 T8 결정: 타깃 디렉터리 해석·임시 디렉터리·
// 스킬 디렉터리 읽기(validate/eval/report용)도 여기(어댑터)가 맡는다 — core는 여전히 IO 0.
// A2(DESIGN §6): 사용자가 직접 넘긴 루트(입력 경로·outDir)는 그대로 믿되 realpath로 고정하고, 그 아래에서는
// 심볼릭 링크와 일반 파일이 아닌 항목을 거부한다. 파일은 O_NOFOLLOW로 열어 lstat 검사와 open 사이에
// 링크로 바뀐 경우까지 막는다(중간 디렉터리 교체 경쟁은 A3의 staging 교체가 이어받는다).
import { homedir, tmpdir } from "node:os";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import {
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  manifestSchema,
  type AssembledFile,
  type Manifest,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";
import type { SkillFile } from "../core/validator.js";

export type FsTargetErrorKind =
  "already_exists" | "escapes_out_dir" | "unsafe_slug" | "symlink_refused" | "not_regular_file";

export class FsTargetError extends Error {
  readonly kind: FsTargetErrorKind;
  constructor(kind: FsTargetErrorKind, message: string) {
    super(message);
    this.name = "FsTargetError";
    this.kind = kind;
  }
}

// O_NOFOLLOW는 POSIX 전용 — 없는 플랫폼(Windows)에선 0이라 일반 open과 같아진다.
const O_NOFOLLOW = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;

function hasErrnoCode(e: unknown, code: string): boolean {
  return e instanceof Error && "code" in e && e.code === code;
}

function symlinkRefused(path: string, root: string): FsTargetError {
  return new FsTargetError(
    "symlink_refused",
    `refusing "${path}" — it is a symbolic link inside "${root}", and links are not followed below a root (they could point anywhere on disk). Fix: replace the link with a real file/directory, or pass the link target itself as the path.`,
  );
}

function notRegularFile(path: string): FsTargetError {
  return new FsTargetError(
    "not_regular_file",
    `refusing "${path}" — it is not a regular file or directory. Fix: remove it from the input, or point at a folder that contains only documents.`,
  );
}

/** 경로가 디스크에 있고 내용(파일 1개 이상)이 있으면 true. 없으면(ENOENT) false. */
async function dirHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch (e) {
    if (hasErrnoCode(e, "ENOENT")) return false;
    throw e;
  }
}

/** outDir 밖으로 나가는 상대 경로("../.." 등)를 문자열 수준에서 거부한다(가드레일 5) — 첫 방어선. */
function assertRelativeWithin(outDir: string, relativePath: string): void {
  const target = normalize(join(outDir, relativePath));
  const rel = relative(outDir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new FsTargetError(
      "escapes_out_dir",
      `refusing to write "${relativePath}" — it resolves outside the output directory "${outDir}".`,
    );
  }
}

/** realpath 기준으로 target이 root 안인지 — 링크를 못 잡았거나 검사 뒤 바뀐 경우의 두 번째 방어선. */
async function assertRealpathWithin(root: string, target: string): Promise<void> {
  const real = await realpath(target);
  const rel = relative(root, real);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new FsTargetError(
      "escapes_out_dir",
      `refusing "${target}" — it really resolves to "${real}", outside "${root}".`,
    );
  }
}

/** root 아래 상대 경로의 각 구성요소를 lstat으로 본다 — 링크면 거부, 아직 없으면 통과(이제 만들 것이다). */
async function assertNoSymlinkBelow(root: string, relativePath: string): Promise<void> {
  const parts = normalize(relativePath)
    .split(sep)
    .filter((p) => p !== "" && p !== ".");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw symlinkRefused(current, root);
    } catch (e) {
      if (hasErrnoCode(e, "ENOENT")) return;
      throw e;
    }
  }
}

/** 마지막 경로 구성요소가 링크면 ELOOP로 실패하는 open — 검사와 열기 사이의 교체까지 막는다. */
async function openNoFollow(path: string, flags: number) {
  try {
    return await open(path, flags | O_NOFOLLOW);
  } catch (e) {
    if (hasErrnoCode(e, "ELOOP")) throw symlinkRefused(path, dirname(path));
    throw e;
  }
}

async function readFileNoFollow(path: string): Promise<Buffer> {
  const handle = await openNoFollow(path, constants.O_RDONLY);
  try {
    if (!(await handle.stat()).isFile()) throw notRegularFile(path);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function writeFileNoFollow(path: string, content: string): Promise<void> {
  const handle = await openNoFollow(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
  );
  try {
    await handle.writeFile(content, "utf-8");
  } finally {
    await handle.close();
  }
}

export interface WriteSkillOptions {
  /** true면 기존 디렉터리에 내용이 있어도 덮어쓴다. 기본 false(가드레일 5). */
  force?: boolean;
}

/** AssembledFile[] + Manifest를 outDir에 쓴다. force 없이 기존 비어있지 않은 디렉터리는 거부한다.
 * outDir 아래의 링크는 따라가지 않는다(A2) — 링크를 통해 outDir 밖의 파일을 덮어쓰는 길을 막는다. */
export async function writeSkill(
  outDir: string,
  files: readonly AssembledFile[],
  manifest: Manifest,
  opts: WriteSkillOptions = {},
): Promise<void> {
  if (!(opts.force ?? false) && (await dirHasContent(outDir))) {
    throw new FsTargetError(
      "already_exists",
      `"${outDir}" already exists and is not empty. Fix: pass --force to overwrite, or choose a different --out directory.`,
    );
  }
  const manifestFile: AssembledFile = {
    path: "manifest.json",
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    estimatedTokens: 0,
  };
  const all = [...files, manifestFile];

  // 1) 문자열 경계 검사를 전부 먼저 — 하나라도 밖을 가리키면 outDir조차 만들지 않는다.
  for (const f of all) assertRelativeWithin(outDir, f.path);

  // 2) 루트 확정: outDir 자체는 호출자(사용자 --out·A1 해석기)가 정한 값이라 링크여도 믿고, realpath로 고정.
  await mkdir(outDir, { recursive: true });
  const outReal = await realpath(outDir);

  // 3) 파일마다: 링크 검사 → 디렉터리 생성 → realpath 경계 재확인 → O_NOFOLLOW로 쓰기.
  for (const f of all) {
    await assertNoSymlinkBelow(outReal, f.path);
    const target = join(outReal, normalize(f.path));
    await mkdir(dirname(target), { recursive: true });
    await assertRealpathWithin(outReal, dirname(target));
    await writeFileNoFollow(target, f.content);
  }
}

/** 소스 파일 하나를 디스크에서 읽어 core/pipeline.ts가 받는 SourceFile 형태로 만든다. 링크는 거부한다(A2) —
 * collectInputFiles가 돌려준 실제 경로를 그대로 넘기면 된다. */
export async function readSourceFile(path: string): Promise<SourceFile> {
  const bytes = await readFileNoFollow(path);
  return { path, bytes: new Uint8Array(bytes) };
}

const IGNORED_DIRS = new Set([".git", "node_modules"]);

/** 파일이면 그대로, 폴더면 재귀적으로 안의 모든 파일 경로를 모은다(DESIGN §6 T8 — 셸 글롭은 셸이 편다).
 * A2: 사용자가 넘긴 각 경로는 그대로 믿고(링크여도 됨) realpath로 고정한다. 그 아래에서는 링크·비정규
 * 파일을 거부하므로 링크 순환도 생길 수 없다. 돌려주는 경로는 전부 실제 경로다. */
export async function collectInputFiles(paths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string, root: string): Promise<void> {
    const info = await lstat(p);
    if (info.isSymbolicLink()) throw symlinkRefused(p, root);
    if (info.isDirectory()) {
      await assertRealpathWithin(root, p);
      for (const entry of await readdir(p)) {
        if (IGNORED_DIRS.has(entry)) continue;
        await walk(join(p, entry), root);
      }
      return;
    }
    if (!info.isFile()) throw notRegularFile(p);
    out.push(p);
  }
  for (const p of paths) {
    const root = await realpath(p);
    await walk(root, root);
  }
  return out;
}

/** 스킬 디렉터리 안의 모든 파일을 {path(상대), content}로 읽는다(validate/eval/report가 쓴다). */
export async function readSkillDir(dir: string): Promise<SkillFile[]> {
  const root = await realpath(dir);
  const absolutePaths = await collectInputFiles([root]);
  const files: SkillFile[] = [];
  for (const abs of absolutePaths) {
    const rel = relative(root, abs).split(sep).join("/"); // 항상 "/" — AssembledFile 경로 규약과 맞춘다
    const content = (await readFileNoFollow(abs)).toString("utf-8");
    files.push({ path: rel, content });
  }
  return files;
}

/** dir/manifest.json을 읽어 검증된 Manifest로 돌려준다. 없거나 스키마에 안 맞거나 링크면 던진다. */
export async function readManifest(dir: string): Promise<Manifest> {
  const raw = (await readFileNoFollow(join(dir, "manifest.json"))).toString("utf-8");
  return manifestSchema.parse(JSON.parse(raw) as unknown);
}

/** slug는 outline(LLM)이 준 값이라 스키마(core/schemas.ts)를 통과했더라도 여기서 다시 검사한다 — 어댑터는
 * 경로를 실제로 만드는 마지막 관문이다(DESIGN §6 A1, 가드레일 5). */
function assertSafeSlug(slug: string): void {
  if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new FsTargetError(
      "unsafe_slug",
      `refusing slug ${JSON.stringify(slug)} — it must be lowercase letters, digits and single hyphens (max ${String(SLUG_MAX_LENGTH)} chars), and it decides a directory name. Fix: re-run compile; if it repeats, the outline model is returning a bad slug.`,
    );
  }
}

/** 결합한 경로가 root 바로 아래의 한 단계 하위인지 확인한다 — slug 검사와 별개인 두 번째 방어선. */
function assertDirectChildOf(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.includes(sep)) {
    throw new FsTargetError(
      "escapes_out_dir",
      `refusing "${target}" — it resolves outside the skill root "${root}".`,
    );
  }
}

/** `--out` 없이 `--target`만 줬을 때의 기본 타깃(DESIGN §6 T8 결정). slug 형식과 루트 경계를 검사한다(A1). */
export function resolveTargetDir(target: "claude" | "agents", slug: string): string {
  assertSafeSlug(slug);
  const root = join(homedir(), target === "agents" ? ".agents" : ".claude", "skills");
  const dir = normalize(join(root, slug));
  assertDirectChildOf(root, dir);
  return dir;
}

/** 게이트 미달 시 산출물을 남기는 임시 디렉터리(DESIGN §6 T8·A1) — mkdtemp가 신뢰된 접두사로 새로 만든
 * 빈 디렉터리라 --force가 필요 없고, 무작위 접미사가 유일성을 보장한다. */
export async function tempSkillDir(slug: string): Promise<string> {
  assertSafeSlug(slug);
  const root = tmpdir();
  const dir = await mkdtemp(join(root, `live-skill-${slug}-`));
  assertDirectChildOf(root, dir);
  return dir;
}
