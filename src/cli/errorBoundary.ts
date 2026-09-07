// CLI 최상위 오류 경계(G1, DESIGN §6). run<Command>()가 처리하는 실패(입력·검증·게이트·LLM·상한)는 거기서 메시지와
// 종료코드 1로 끝난다. 여기까지 올라오는 것은 두 종류뿐이다: 사용자 설정 오류(ConfigError → 종료 1)와 예상하지 못한
// 내부 오류(버그 — 종료 2, 이슈 제보 안내). 어느 쪽이든 스택 트레이스 대신 다듬은 한 줄을 보인다.
import { ConfigError, sanitizeExternalText } from "../core/index.js";

export interface TopLevelFailure {
  message: string;
  exitCode: 1 | 2;
}

export function describeTopLevelError(e: unknown): TopLevelFailure {
  if (e instanceof ConfigError) {
    return { message: `설정 오류: ${sanitizeExternalText(e.message, 500)}`, exitCode: 1 };
  }
  const detail =
    e instanceof Error
      ? `${e.name}: ${sanitizeExternalText(e.message, 300)}`
      : sanitizeExternalText(String(e), 300);
  return {
    message: `내부 오류(예상하지 못한 실패): ${detail}. 수정 방법: 같은 명령을 다시 실행해 보고, 반복되면 이 메시지와 함께 이슈로 제보해 주세요.`,
    exitCode: 2,
  };
}
