// report 명령 — 마지막 GateReport 출력(DESIGN §6). skillDir을 생략하면 현재 디렉터리("."). 조립만.
// E3: manifest만 믿지 않는다 — 현재 파일을 읽어 해시를 대조하고, 어긋나면 판정을 보여주지 않고 STALE/TAMPERED로 끝난다.
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
      `"${dir}"에서 manifest.json을 읽을 수 없습니다. 수정 방법: 먼저 compile을 실행하거나 경로를 확인하세요. (${detail})`,
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
