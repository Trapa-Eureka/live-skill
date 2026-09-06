// 스킬 산출물을 실제 디스크에 쓴다 — --force/out 경계(가드레일 5, DESIGN §5.1). core/pipeline.ts는
// AssembledFile[]만 돌려주고 여기서 실제 IO를 한다. §6 T8 결정: 타깃 디렉터리 해석·임시 디렉터리·
// 스킬 디렉터리 읽기(validate/eval/report용)도 여기(어댑터)가 맡는다 — core는 여전히 IO 0.
// A2(DESIGN §6): 사용자가 직접 넘긴 루트(입력 경로·outDir)는 그대로 믿되 realpath로 고정하고, 그 아래에서는
// 심볼릭 링크와 일반 파일이 아닌 항목을 거부한다. 파일은 O_NOFOLLOW로 열어 lstat 검사와 open 사이에
// 링크로 바뀐 경우까지 막는다(중간 디렉터리 교체 경쟁은 A3의 staging 교체가 이어받는다).
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
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

function alreadyExists(dir: string): FsTargetError {
  return new FsTargetError(
    "already_exists",
    `"${dir}" already exists and is not empty. Fix: pass --force to overwrite, or choose a different --out directory.`,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (hasErrnoCode(e, "ENOENT")) return false;
    throw e;
  }
}

/** outDir을 실제 경로로 고정한다. 있으면 realpath(링크면 링크가 가리키는 디렉터리가 교체 대상 — 링크는 남는다),
 * 없으면 부모를 만들고 부모의 realpath + basename. */
async function resolveOutRoot(outDir: string): Promise<string> {
  try {
    return await realpath(outDir);
  } catch (e) {
    if (!hasErrnoCode(e, "ENOENT")) throw e;
    await mkdir(dirname(outDir), { recursive: true });
    return join(await realpath(dirname(outDir)), basename(outDir));
  }
}

/** rename이 "비어 있지 않은 기존 디렉터리" 때문에 실패했는지. */
function isRenameOverNonEmpty(e: unknown): boolean {
  return hasErrnoCode(e, "ENOTEMPTY") || hasErrnoCode(e, "EEXIST") || hasErrnoCode(e, "EPERM");
}

/** 완성된 staging을 target 자리로 올린다(DESIGN §6 A3). 같은 부모 아래의 rename이라 각 단계가 원자적이다. */
async function swapIntoPlace(staging: string, target: string, force: boolean): Promise<void> {
  let old: string | undefined;
  if (force && (await pathExists(target))) {
    // 이전 세대를 통째로 비켜 놓는다 — 이름은 만들지 않은(존재하지 않는) 경로라 어디서든 rename이 된다.
    old = join(
      dirname(target),
      `.${basename(target)}.live-skill-old-${randomBytes(6).toString("hex")}`,
    );
    await rename(target, old);
  }
  try {
    try {
      await rename(staging, target); // 비어 있는 기존 디렉터리는 그대로 대체된다; 내용이 있으면 ENOTEMPTY
    } catch (e) {
      if (!isRenameOverNonEmpty(e)) throw e;
      // 비어 있는데도 플랫폼이 대체를 거부했을 수 있다(Windows) — 비어 있을 때만 지우고 한 번 더.
      const entries = await readdir(target).catch(() => undefined);
      if (entries === undefined) throw e; // 디렉터리조차 아니다 — 원래 오류가 더 정확하다
      if (entries.length > 0) throw alreadyExists(target);
      await rmdir(target);
      await rename(staging, target);
    }
  } catch (e) {
    if (old !== undefined) await rename(old, target).catch(() => undefined); // 이전 세대 복구(최선)
    throw e;
  }
  if (old !== undefined) await rm(old, { recursive: true, force: true });
}

/** AssembledFile[] + Manifest를 outDir에 쓴다. force 없이 기존 비어있지 않은 디렉터리는 거부한다.
 * A3: 산출물 전부를 같은 부모 아래 staging 디렉터리에 먼저 쓰고 rename으로 통째로 교체한다 — outDir은
 * 언제나 이전 세대 전체 아니면 새 세대 전체다(부분 쓰기·stale 파일·검사-쓰기 경쟁 없음). 기존 트리 안에는
 * 아무것도 쓰지 않으므로 A2의 링크 문제도 staging 안에서만 검사하면 된다. */
export async function writeSkill(
  outDir: string,
  files: readonly AssembledFile[],
  manifest: Manifest,
  opts: WriteSkillOptions = {},
): Promise<void> {
  const force = opts.force ?? false;
  const manifestFile: AssembledFile = {
    path: "manifest.json",
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    estimatedTokens: 0,
  };
  const all = [...files, manifestFile];

  // 1) 문자열 경계 검사를 전부 먼저 — 하나라도 밖을 가리키면 디스크를 건드리지 않는다.
  for (const f of all) assertRelativeWithin(outDir, f.path);

  // 2) 이른 거부(친절한 메시지용). 최종 판정은 아래 rename이 한다 — 그 사이에 채워져도 ENOTEMPTY로 잡힌다.
  if (!force && (await dirHasContent(outDir))) throw alreadyExists(outDir);

  // 3) 실제 교체 대상과 같은 부모 아래 staging(같은 파일시스템이어야 rename이 원자적이다).
  const target = await resolveOutRoot(outDir);
  const staging = await mkdtemp(join(dirname(target), `.${basename(target)}.live-skill-staging-`));

  try {
    // 4) 전부 staging에 쓴다 — A2와 같은 no-follow 쓰기.
    for (const f of all) {
      await assertNoSymlinkBelow(staging, f.path);
      const dest = join(staging, normalize(f.path));
      await mkdir(dirname(dest), { recursive: true });
      await assertRealpathWithin(staging, dirname(dest));
      await writeFileNoFollow(dest, f.content);
    }
    // 5) 통째로 교체.
    await swapIntoPlace(staging, target, force);
  } catch (e) {
    await rm(staging, { recursive: true, force: true }); // 성공했으면 이미 없다 — force라 조용히 지나간다
    throw e;
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
