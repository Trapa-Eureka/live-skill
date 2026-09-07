// report command: prints the last GateReport (DESIGN §6). When skillDir is omitted, the current
// directory (".") is used. Assembly only.
// E3: the manifest alone is not trusted. The current files are read and their hashes compared; on a
// mismatch the verdict is withheld and the command ends with STALE/TAMPERED.
import {
  checkOutputs,
  formatGateReport,
  formatOutputIntegrity,
  formatSkippedGate,
  type Manifest,
} from "../core/index.js";
import type { SkillFile } from "../core/validator.js";

export interface ReportDeps {
  out: (line: string) => void;
  readManifest: (dir: string) => Promise<Manifest>;
  readSkillDir: (dir: string) => Promise<SkillFile[]>;
}

export async function runReport(skillDir: string | undefined, deps: ReportDeps): Promise<number> {
  const dir = skillDir ?? ".";
  let manifest: Manifest;
  let files: SkillFile[];
  try {
    manifest = await deps.readManifest(dir);
    files = await deps.readSkillDir(dir);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(
      `Cannot read manifest.json in "${dir}". Fix: run compile first, or check the path. (${detail})`,
    );
    return 1;
  }
  const integrity = checkOutputs(manifest, files);
  if (integrity.status !== "ok") {
    deps.out(formatOutputIntegrity(integrity));
    return 1;
  }
  deps.out("passed" in manifest.gate ? formatGateReport(manifest.gate) : formatSkippedGate());
  return 0;
}
