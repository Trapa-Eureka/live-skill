// sha256 — manifest 해시(DESIGN §2)에 쓴다. 이미 메모리에 있는 바이트/문자열에 대한 순수 계산이라
// core에 둔다(실제 파일 IO는 adapters/fsTargets.ts 몫).
import { createHash } from "node:crypto";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
