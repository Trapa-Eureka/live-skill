// Output integrity (DESIGN §5 E3): compares the set of files the manifest hashed against the files
// currently in the skill directory. Pure computation: the adapter (readSkillDir) reads the files and
// this module only receives {path, content}[]. The gate verdict is valid only for the files that were
// hashed, so on a mismatch report withholds the verdict and eval does not call the LLM.
import { sha256Hex } from "./hash.js";
import type { Manifest } from "./types.js";
import type { SkillFile } from "./validator.js";

export interface OutputIntegrity {
  /** ok: everything matches. stale: a file the manifest lists is missing or differs. tampered: a file the manifest does not know about exists (takes precedence). */
  status: "ok" | "stale" | "tampered";
  /** Files listed in the manifest but absent on disk. */
  missing: string[];
  /** Files on disk whose content hash differs from the manifest. */
  modified: string[];
  /** Files on disk that the manifest does not know about (excluding manifest.json itself and dot files). */
  unexpected: string[];
}

/** manifest.json itself and dot files dropped by the OS or tooling (.DS_Store etc.) are not outputs. */
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
