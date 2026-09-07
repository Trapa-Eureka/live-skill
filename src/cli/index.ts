#!/usr/bin/env node
// CLI 진입점 — 로직 없음(CLAUDE.md 컨벤션: cli/는 조립만). 명령 정의는 program.ts, 실제 IO는 adapters/, 실제
// 파이프라인·게이트 판단은 core/에 있다. 여기선 .env를 읽고 오류 경계(G1)를 두른 채 프로그램을 실행할 뿐이다.
import { describeTopLevelError } from "./errorBoundary.js";
import { buildProgram } from "./program.js";

// Node 22.12+는 .env를 직접 읽을 수 있다 — 없거나 지원 안 하면 조용히 넘어간다(guardrail 7: .env는 커밋 안 함).
try {
  process.loadEnvFile();
} catch {
  /* .env 없음 — 무시 */
}

// G1: 여기까지 올라오는 예외는 설정 오류(종료 1)거나 버그(종료 2) — 스택 대신 한 줄과 수정 방법.
try {
  await buildProgram().parseAsync(process.argv);
} catch (e) {
  const failure = describeTopLevelError(e);
  console.error(failure.message);
  process.exitCode = failure.exitCode;
}
