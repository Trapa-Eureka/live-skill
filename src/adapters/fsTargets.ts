// 스킬 산출물을 실제 디스크에 쓴다 — --force/out 경계(가드레일 5, DESIGN §5.1). core/pipeline.ts는
// AssembledFile[]만 돌려주고 여기서 실제 IO를 한다.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import type { AssembledFile, Manifest } from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";

export type FsTargetErrorKind = "already_exists" | "escapes_out_dir";

export class FsTargetError extends Error {
  readonly kind: FsTargetErrorKind;
  constructor(kind: FsTargetErrorKind, message: string) {
    super(message);
    this.name = "FsTargetError";
    this.kind = kind;
  }
}

/** 경로가 디스크에 있고 내용(파일 1개 이상)이 있으면 true. 없으면(ENOENT) false. */
async function dirHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return false;
    throw e;
  }
}

/** outDir 밖으로 나가는 경로("../.." 등)를 거부하고, 정규화된 절대 경로를 돌려준다(가드레일 5). */
function resolveWithinOutDir(outDir: string, relativePath: string): string {
  const target = normalize(join(outDir, relativePath));
  const rel = relative(outDir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new FsTargetError(
      "escapes_out_dir",
      `refusing to write "${relativePath}" — it resolves outside the output directory "${outDir}".`,
    );
  }
  return target;
}

export interface WriteSkillOptions {
  /** true면 기존 디렉터리에 내용이 있어도 덮어쓴다. 기본 false(가드레일 5). */
  force?: boolean;
}

/** AssembledFile[] + Manifest를 outDir에 쓴다. force 없이 기존 비어있지 않은 디렉터리는 거부한다. */
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
  for (const f of [...files, manifestFile]) {
    const target = resolveWithinOutDir(outDir, f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content, "utf-8");
  }
}

/** 소스 파일 하나를 디스크에서 읽어 core/pipeline.ts가 받는 SourceFile 형태로 만든다. */
export async function readSourceFile(path: string): Promise<SourceFile> {
  const bytes = await readFile(path);
  return { path, bytes: new Uint8Array(bytes) };
}
