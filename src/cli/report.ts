// report 명령 — 마지막 GateReport 출력(DESIGN §6). skillDir을 생략하면 현재 디렉터리("."). 조립만.
import { formatGateReport, formatSkippedGate, type Manifest } from "../core/index.js";

export interface ReportDeps {
  out: (line: string) => void;
  readManifest: (dir: string) => Promise<Manifest>;
}

export async function runReport(skillDir: string | undefined, deps: ReportDeps): Promise<number> {
  const dir = skillDir ?? ".";
  let manifest: Manifest;
  try {
    manifest = await deps.readManifest(dir);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(
      `"${dir}"에서 manifest.json을 읽을 수 없습니다. 수정 방법: 먼저 compile을 실행하거나 경로를 확인하세요. (${detail})`,
    );
    return 1;
  }
  deps.out("passed" in manifest.gate ? formatGateReport(manifest.gate) : formatSkippedGate());
  return 0;
}
