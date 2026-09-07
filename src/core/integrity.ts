// 산출물 무결성(DESIGN §5 E3) — manifest가 해시한 파일 집합과 스킬 디렉터리의 현재 파일을 대조한다. 순수 계산:
// 파일 읽기는 어댑터(readSkillDir)가 하고 여기는 {path, content}[]만 받는다. 게이트 판정은 해시한 그 파일들에만
// 유효하므로, 어긋나면 report는 판정을 보여주지 않고 eval은 LLM을 부르지 않는다.
import { sha256Hex } from "./hash.js";
import type { Manifest } from "./types.js";
import type { SkillFile } from "./validator.js";

export interface OutputIntegrity {
  /** ok: 전부 일치. stale: manifest가 적은 파일이 없거나 내용이 다르다. tampered: manifest가 모르는 파일이 있다(우선). */
  status: "ok" | "stale" | "tampered";
  /** manifest에는 있는데 디스크에 없는 파일. */
  missing: string[];
  /** 디스크에 있지만 내용 해시가 manifest와 다른 파일. */
  modified: string[];
  /** 디스크에 있는데 manifest가 모르는 파일(manifest.json 자신과 점 파일 제외). */
  unexpected: string[];
}

/** manifest.json 자신과 OS·도구가 흘리는 점 파일(.DS_Store 등)은 산출물이 아니다. */
function isForeignButHarmless(path: string): boolean {
  if (path === "manifest.json") return true;
  const base = path.split("/").pop() ?? path;
  return base.startsWith(".");
}

export function checkOutputs(manifest: Manifest, files: readonly SkillFile[]): OutputIntegrity {
  const onDisk = new Map(files.map((f) => [f.path, f.content]));
  const missing: string[] = [];
  const modified: string[] = [];
  for (const { path, sha256 } of manifest.outputHashes) {
    const content = onDisk.get(path);
    if (content === undefined) missing.push(path);
    else if (sha256Hex(content) !== sha256) modified.push(path);
  }
  const listed = new Set(manifest.outputHashes.map((h) => h.path));
  const unexpected = files
    .map((f) => f.path)
    .filter((p) => !listed.has(p) && !isForeignButHarmless(p))
    .sort();
  const status =
    unexpected.length > 0 ? "tampered" : missing.length + modified.length > 0 ? "stale" : "ok";
  return { status, missing, modified, unexpected };
}
