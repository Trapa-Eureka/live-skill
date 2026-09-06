// 입력 읽기 실패를 사람 말로(compile·eval 공용). 어댑터가 의도적으로 거부한 경우(FsTargetError — 링크·크기
// 상한 등)는 메시지에 원인+수정 방법이 이미 있으니 그대로 보이고, 그 외(ENOENT 등)는 경로 확인 안내를 붙인다.
import { FsTargetError } from "../adapters/fsTargets.js";

export function describeInputFailure(e: unknown): string {
  if (e instanceof FsTargetError) return `입력을 거부했습니다: ${e.message}`;
  const detail = e instanceof Error ? e.message : "unknown error";
  return `입력 경로를 읽을 수 없습니다. 수정 방법: 경로를 확인하세요. (${detail})`;
}
