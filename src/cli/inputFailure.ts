// Input read failures in plain words (shared by compile and eval). When the adapter rejected the
// input on purpose (FsTargetError: links, size caps, etc.) the message already carries the cause and
// the fix, so it is shown as is; anything else (ENOENT etc.) gets a path-check hint.
import { FsTargetError } from "../adapters/fsTargets.js";

export function describeInputFailure(e: unknown): string {
  if (e instanceof FsTargetError) return `Input rejected: ${e.message}`;
  const detail = e instanceof Error ? e.message : "unknown error";
  return `Cannot read the input path. Fix: check the path. (${detail})`;
}
