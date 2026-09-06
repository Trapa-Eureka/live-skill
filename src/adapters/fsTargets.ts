// 스킬 산출물을 실제 디스크에 쓴다 — --force/out 경계(가드레일 5, DESIGN §5.1). core/pipeline.ts는
// AssembledFile[]만 돌려주고 여기서 실제 IO를 한다. §6 T8 결정: 타깃 디렉터리 해석·임시 디렉터리·
// 스킬 디렉터리 읽기(validate/eval/report용)도 여기(어댑터)가 맡는다 — core는 여전히 IO 0.
import { homedir, tmpdir } from "node:os";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { manifestSchema, type AssembledFile, type Manifest } from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";
import type { SkillFile } from "../core/validator.js";

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

const IGNORED_DIRS = new Set([".git", "node_modules"]);

/** 파일이면 그대로, 폴더면 재귀적으로 안의 모든 파일 경로를 모은다(DESIGN §6 T8 — 셸 글롭은 셸이 편다). */
export async function collectInputFiles(paths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string): Promise<void> {
    const info = await stat(p);
    if (info.isDirectory()) {
      const entries = await readdir(p);
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry)) continue;
        await walk(join(p, entry));
      }
    } else {
      out.push(p);
    }
  }
  for (const p of paths) await walk(p);
  return out;
}

/** 스킬 디렉터리 안의 모든 파일을 {path(상대), content}로 읽는다(validate/eval/report가 쓴다). */
export async function readSkillDir(dir: string): Promise<SkillFile[]> {
  const absolutePaths = await collectInputFiles([dir]);
  const files: SkillFile[] = [];
  for (const abs of absolutePaths) {
    const rel = relative(dir, abs).split(sep).join("/"); // 항상 "/" — AssembledFile 경로 규약과 맞춘다
    const content = await readFile(abs, "utf-8");
    files.push({ path: rel, content });
  }
  return files;
}

/** dir/manifest.json을 읽어 검증된 Manifest로 돌려준다. 없거나 스키마에 안 맞으면 던진다. */
export async function readManifest(dir: string): Promise<Manifest> {
  const raw = await readFile(join(dir, "manifest.json"), "utf-8");
  return manifestSchema.parse(JSON.parse(raw) as unknown);
}

/** `--out` 없이 `--target`만 줬을 때의 기본 타깃(DESIGN §6 T8 결정). */
export function resolveTargetDir(target: "claude" | "agents", slug: string): string {
  const base = target === "agents" ? ".agents" : ".claude";
  return join(homedir(), base, "skills", slug);
}

/** 게이트 미달 시 산출물을 남기는 임시 디렉터리(DESIGN §6 T8 결정, 완료 기준) — 매번 새 경로라 --force 불필요. */
export function tempSkillDir(slug: string, timestamp: string): string {
  return join(tmpdir(), `live-skill-${slug}-${timestamp}`);
}
