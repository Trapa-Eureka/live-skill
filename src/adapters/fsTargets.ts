// Writes skill output to the real disk, enforcing the --force/out boundary (guardrail 5, DESIGN
// §5.1). core/pipeline.ts only returns AssembledFile[]; the actual IO happens here. §6 T8 decision:
// resolving the target directory, the temp directory, and reading a skill directory back (for
// validate/eval/report) also live here in the adapter, so core still does zero IO.
// A2 (DESIGN §6): roots the user passed directly (input paths, outDir) are trusted as-is but pinned
// with realpath; below them, symbolic links and anything that is not a regular file are refused.
// Files are opened with O_NOFOLLOW so that a path swapped for a link between the lstat check and
// the open is blocked as well (races that replace an intermediate directory are handled by the A3
// staging swap).
// D3 (DESIGN §6): before reading, inputs are checked against the file-count and per-file/total byte
// caps using lstat sizes; while reading, the fstat size is re-checked and exactly that many bytes
// are read, with bounded concurrency.
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
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import {
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  manifestSchema,
  mapConcurrent,
  type AssembledFile,
  type Manifest,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";
import type { SkillFile } from "../core/validator.js";

export type FsTargetErrorKind =
  | "already_exists"
  | "escapes_out_dir"
  | "unsafe_slug"
  | "symlink_refused"
  | "not_regular_file"
  | "too_many_files"
  | "file_too_large"
  | "input_too_large";

/** Input size caps (DESIGN §6 D3): a memory-bomb guard far more generous than the token cap. These
 * are constants, not env. */
export interface InputLimits {
  /** Maximum number of input files. */
  maxFiles: number;
  /** Maximum bytes of a single file. */
  maxFileBytes: number;
  /** Maximum total bytes across all input files. */
  maxTotalBytes: number;
}

const MIB = 1024 * 1024;
export const INPUT_LIMITS: InputLimits = {
  maxFiles: 500,
  maxFileBytes: 25 * MIB,
  maxTotalBytes: 100 * MIB,
};
/** Number of input files opened and read concurrently (D3). */
export const INPUT_READ_CONCURRENCY = 4;

function mib(bytes: number): string {
  return `${String(Math.round((bytes / MIB) * 10) / 10)} MiB`;
}

export class FsTargetError extends Error {
  readonly kind: FsTargetErrorKind;
  constructor(kind: FsTargetErrorKind, message: string) {
    super(message);
    this.name = "FsTargetError";
    this.kind = kind;
  }
}

// O_NOFOLLOW is POSIX-only; on platforms without it (Windows) it is 0, which makes this a plain open.
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

function tooManyFiles(max: number): FsTargetError {
  return new FsTargetError(
    "too_many_files",
    `refusing the input — it has more than ${String(max)} files (stopped counting at ${String(max + 1)}). Fix: point at a smaller folder, or split the documents into several skills.`,
  );
}

function fileTooLarge(path: string, size: number, max: number): FsTargetError {
  return new FsTargetError(
    "file_too_large",
    `refusing "${path}" — it is ${mib(size)}, over the per-file limit of ${mib(max)}. Fix: remove it from the input, or split it into smaller documents.`,
  );
}

function inputTooLarge(files: number, total: number, max: number): FsTargetError {
  return new FsTargetError(
    "input_too_large",
    `refusing the input — the first ${String(files)} files already total ${mib(total)}, over the limit of ${mib(max)}. Fix: point at a smaller folder, or split the documents into several skills.`,
  );
}

/** True when the path exists on disk and has content (at least one entry); false when it is missing
 * (ENOENT). */
async function dirHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch (e) {
    if (hasErrnoCode(e, "ENOENT")) return false;
    throw e;
  }
}

/** Rejects, at the string level, a relative path that leaves outDir ("../.." etc.) (guardrail 5).
 * The first line of defence. */
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

/** Checks by realpath that target is inside root: the second line of defence, for a link that was
 * missed or that appeared after the check. */
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

/** lstats each component of the relative path under root: a link is refused, a component that does
 * not exist yet passes (it is about to be created). */
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

/** An open that fails with ELOOP when the last path component is a link, which also blocks a swap
 * between the check and the open. */
async function openNoFollow(path: string, flags: number) {
  try {
    return await open(path, flags | O_NOFOLLOW);
  } catch (e) {
    if (hasErrnoCode(e, "ELOOP")) throw symlinkRefused(path, dirname(path));
    throw e;
  }
}

/** Reads exactly the size seen at fstat time: if the file grows meanwhile, no more than size is read
 * (if it shrinks, only what was read is returned). Buffer.alloc uses a dedicated ArrayBuffer (no
 * pool sharing), so the caller can use it as a Uint8Array without copying. */
async function readExactly(handle: FileHandle, size: number): Promise<Buffer> {
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buf, offset, size - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === size ? buf : buf.subarray(0, offset);
}

/** Opens with no-follow (A2), confirms via fstat that it is a regular file within the size cap (D3),
 * then reads exactly that much. */
async function readFileNoFollow(
  path: string,
  maxBytes: number = INPUT_LIMITS.maxFileBytes,
): Promise<Buffer> {
  const handle = await openNoFollow(path, constants.O_RDONLY);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw notRegularFile(path);
    if (info.size > maxBytes) throw fileTooLarge(path, info.size, maxBytes);
    return await readExactly(handle, info.size);
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
  /** When true, overwrites an existing directory even if it has content. Default false (guardrail 5). */
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

/** Pins outDir to its real path. If it exists, realpath (for a link, the directory the link points at
 * is what gets replaced; the link itself stays). If not, creates the parent and returns the parent's
 * realpath + basename. */
async function resolveOutRoot(outDir: string): Promise<string> {
  try {
    return await realpath(outDir);
  } catch (e) {
    if (!hasErrnoCode(e, "ENOENT")) throw e;
    await mkdir(dirname(outDir), { recursive: true });
    return join(await realpath(dirname(outDir)), basename(outDir));
  }
}

/** Whether rename failed because the existing directory is not empty. */
function isRenameOverNonEmpty(e: unknown): boolean {
  return hasErrnoCode(e, "ENOTEMPTY") || hasErrnoCode(e, "EEXIST") || hasErrnoCode(e, "EPERM");
}

/** Moves the finished staging directory into target's place (DESIGN §6 A3). The renames happen under
 * the same parent, so each step is atomic. */
async function swapIntoPlace(staging: string, target: string, force: boolean): Promise<void> {
  let old: string | undefined;
  if (force && (await pathExists(target))) {
    // Move the previous generation aside as a whole. The name is a path that does not exist, so
    // the rename works anywhere.
    old = join(
      dirname(target),
      `.${basename(target)}.live-skill-old-${randomBytes(6).toString("hex")}`,
    );
    await rename(target, old);
  }
  try {
    try {
      // An empty existing directory is replaced in place; a non-empty one fails with ENOTEMPTY.
      await rename(staging, target);
    } catch (e) {
      if (!isRenameOverNonEmpty(e)) throw e;
      // The platform may refuse to replace it even though it is empty (Windows): remove it only when
      // empty, then retry once.
      const entries = await readdir(target).catch(() => undefined);
      if (entries === undefined) throw e; // not even a directory: the original error is more accurate
      if (entries.length > 0) throw alreadyExists(target);
      await rmdir(target);
      await rename(staging, target);
    }
  } catch (e) {
    // Restore the previous generation (best effort).
    if (old !== undefined) await rename(old, target).catch(() => undefined);
    throw e;
  }
  if (old !== undefined) await rm(old, { recursive: true, force: true });
}

/** Writes AssembledFile[] plus the Manifest to outDir. Without force, an existing non-empty directory
 * is refused. A3: every output is first written to a staging directory under the same parent, then
 * swapped in with rename as a whole, so outDir is always either the entire previous generation or
 * the entire new one (no partial writes, stale files, or check-then-write races). Nothing is written
 * inside the existing tree, so the A2 link checks only need to cover the staging directory. */
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

  // 1) All string-level boundary checks first: if any path points outside, the disk is not touched.
  for (const f of all) assertRelativeWithin(outDir, f.path);

  // 2) Early refusal, for a friendly message. The rename below is the final verdict: if the directory
  //    fills up in between, ENOTEMPTY catches it.
  if (!force && (await dirHasContent(outDir))) throw alreadyExists(outDir);

  // 3) Stage under the same parent as the real target (rename is atomic only on the same filesystem).
  const target = await resolveOutRoot(outDir);
  const staging = await mkdtemp(join(dirname(target), `.${basename(target)}.live-skill-staging-`));

  try {
    // 4) Write everything to staging: the same no-follow writes as A2.
    for (const f of all) {
      await assertNoSymlinkBelow(staging, f.path);
      const dest = join(staging, normalize(f.path));
      await mkdir(dirname(dest), { recursive: true });
      await assertRealpathWithin(staging, dirname(dest));
      await writeFileNoFollow(dest, f.content);
    }
    // 5) Swap in as a whole.
    await swapIntoPlace(staging, target, force);
  } catch (e) {
    // On success staging is already gone; force keeps this quiet.
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
}

/** Reads one source file from disk into the SourceFile shape core/pipeline.ts accepts. Links are
 * refused (A2) and a file over the per-file cap is refused (D3); pass the real paths returned by
 * collectInputFiles as they are. The returned Buffer is a Uint8Array, so it is used without a copy. */
export async function readSourceFile(
  path: string,
  limits: InputLimits = INPUT_LIMITS,
): Promise<SourceFile> {
  const bytes = await readFileNoFollow(path, limits.maxFileBytes);
  return { path, bytes };
}

export interface ReadSourceFilesOptions {
  limits?: InputLimits;
  concurrency?: number;
}

/** Reads several source files with bounded concurrency (D3). Even though collectInputFiles already
 * filtered by lstat, files may have changed since, so the count and the per-file and running byte
 * totals are enforced again on what is actually read. Results keep input order. */
export async function readSourceFiles(
  paths: readonly string[],
  opts: ReadSourceFilesOptions = {},
): Promise<SourceFile[]> {
  const limits = opts.limits ?? INPUT_LIMITS;
  if (paths.length > limits.maxFiles) throw tooManyFiles(limits.maxFiles);
  let total = 0;
  let read = 0;
  return mapConcurrent(paths, opts.concurrency ?? INPUT_READ_CONCURRENCY, async (path) => {
    const src = await readSourceFile(path, limits);
    total += src.bytes.byteLength;
    read += 1;
    if (total > limits.maxTotalBytes) throw inputTooLarge(read, total, limits.maxTotalBytes);
    return src;
  });
}

const IGNORED_DIRS = new Set([".git", "node_modules"]);

/** A file path is returned as-is; a folder is walked recursively for every file path inside it
 * (DESIGN §6 T8: shell globs are expanded by the shell).
 * A2: each path the user passed is trusted as-is (it may be a link) and pinned with realpath. Below
 * it, links and non-regular files are refused, so link cycles cannot occur either. Every returned
 * path is a real path.
 * D3: while walking, the file count and the per-file and running byte totals are tracked from lstat
 * sizes, and the walk stops the moment a cap is exceeded. No file is opened (refusal before
 * reading). */
export async function collectInputFiles(
  paths: readonly string[],
  limits: InputLimits = INPUT_LIMITS,
): Promise<string[]> {
  const out: string[] = [];
  let total = 0;
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
    if (out.length >= limits.maxFiles) throw tooManyFiles(limits.maxFiles);
    if (info.size > limits.maxFileBytes) throw fileTooLarge(p, info.size, limits.maxFileBytes);
    total += info.size;
    if (total > limits.maxTotalBytes)
      throw inputTooLarge(out.length + 1, total, limits.maxTotalBytes);
    out.push(p);
  }
  for (const p of paths) {
    const root = await realpath(p);
    await walk(root, root);
  }
  return out;
}

/** Reads every file in a skill directory as {path (relative), content}; used by validate, eval and
 * report. */
export async function readSkillDir(dir: string): Promise<SkillFile[]> {
  const root = await realpath(dir);
  const absolutePaths = await collectInputFiles([root]);
  const files: SkillFile[] = [];
  for (const abs of absolutePaths) {
    // Always "/", matching the AssembledFile path convention.
    const rel = relative(root, abs).split(sep).join("/");
    const content = (await readFileNoFollow(abs)).toString("utf-8");
    files.push({ path: rel, content });
  }
  return files;
}

/** Reads dir/manifest.json and returns it as a validated Manifest. Throws when it is missing, does
 * not match the schema, or is a link. */
export async function readManifest(dir: string): Promise<Manifest> {
  const raw = (await readFileNoFollow(join(dir, "manifest.json"))).toString("utf-8");
  const result = manifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!result.success) {
    // B6: a manifest that is off not only in shape but in meaning (aggregate mismatch, verdict rules,
    // cross-references) is refused here, closing the path by which a tampered or corrupted manifest
    // could inject a false PASSED into report/eval. The first few issues are put in plain words
    // instead of a raw zod dump.
    const detail = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.map(String).join(".") || "manifest"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `manifest.json in "${dir}" is not a valid live-skill manifest — ${detail}. Fix: re-run compile; if the file was edited by hand, restore it from the compile output.`,
    );
  }
  return result.data;
}

/** The slug comes from the outline (LLM), so even though it passed the schema (core/schemas.ts) it is
 * checked again here: the adapter is the last gate that actually creates the path (DESIGN §6 A1,
 * guardrail 5). */
function assertSafeSlug(slug: string): void {
  if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new FsTargetError(
      "unsafe_slug",
      `refusing slug ${JSON.stringify(slug)} — it must be lowercase letters, digits and single hyphens (max ${String(SLUG_MAX_LENGTH)} chars), and it decides a directory name. Fix: re-run compile; if it repeats, the outline model is returning a bad slug.`,
    );
  }
}

/** Confirms the joined path is a direct child of root: a second line of defence, independent of the
 * slug check. */
function assertDirectChildOf(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.includes(sep)) {
    throw new FsTargetError(
      "escapes_out_dir",
      `refusing "${target}" — it resolves outside the skill root "${root}".`,
    );
  }
}

/** The default target when `--target` is given without `--out` (DESIGN §6 T8 decision). Checks the
 * slug format and the root boundary (A1). */
export function resolveTargetDir(target: "claude" | "agents", slug: string): string {
  assertSafeSlug(slug);
  const root = join(homedir(), target === "agents" ? ".agents" : ".claude", "skills");
  const dir = normalize(join(root, slug));
  assertDirectChildOf(root, dir);
  return dir;
}

/** Temp directory that keeps the output when the gate fails (DESIGN §6 T8, A1). mkdtemp creates a
 * fresh, empty directory under a trusted prefix, so --force is not needed, and the random suffix
 * guarantees uniqueness. */
export async function tempSkillDir(slug: string): Promise<string> {
  assertSafeSlug(slug);
  const root = tmpdir();
  const dir = await mkdtemp(join(root, `live-skill-${slug}-`));
  assertDirectChildOf(root, dir);
  return dir;
}
