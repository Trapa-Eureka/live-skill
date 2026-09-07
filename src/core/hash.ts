// sha256 for manifest hashes (DESIGN §2). Pure computation over bytes/strings already in memory,
// so it lives in core (actual file IO belongs to adapters/fsTargets.ts).
import { createHash } from "node:crypto";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
