// 게이트/검증 리포트를 사람이 읽을 텍스트로 바꾼다 — 순수 문자열 포맷팅, 외부 IO 없음. `report`/`validate`/
// `compile`/`eval` CLI가 전부 이 함수들만 호출한다("cli는 조립만", DESIGN §6).
import type { PipelineError } from "./pipeline.js";
import type { GateReport } from "./types.js";
import type { ValidationReport } from "./validator.js";

export function formatGateReport(report: GateReport): string {
  const lines: string[] = [
    `게이트: ${report.passed ? "PASSED" : "FAILED"} (passRate ${(report.passRate * 100).toFixed(1)}% / 임계치 ${(report.threshold * 100).toFixed(0)}%)`,
    "",
    "챕터별:",
  ];
  for (const c of report.perChapter) {
    lines.push(`  - ${c.file}: ${String(c.correct)}/${String(c.asked)} 정답`);
  }
  // B2: 문항을 하나도 못 만든 섹션은 미검증 — 통과율과 무관하게 통과 불가. 부족분은 참고 정보.
  const uncovered = report.coverage.filter((c) => c.generated === 0);
  if (uncovered.length > 0) {
    lines.push("", "미검증 섹션(문항 생성 실패 — 통과 불가):");
    for (const c of uncovered) lines.push(`  - ${c.sectionId}`);
  }
  const short = report.coverage.filter((c) => c.generated > 0 && c.generated < c.requested);
  if (short.length > 0) {
    lines.push("", "문항 부족(생성/요청):");
    for (const c of short) {
      lines.push(`  - ${c.sectionId}: ${String(c.generated)}/${String(c.requested)}`);
    }
  }
  if (report.failures.length > 0) {
    lines.push("", "실패 문항:");
    for (const f of report.failures) lines.push(`  - ${f.qaId}: ${f.reason}`);
  }
  return lines.join("\n");
}

export function formatSkippedGate(): string {
  return "게이트: SKIPPED (--no-gate) — 산출물은 unverified 표시로 배포됐습니다.";
}

/** 파이프라인 실패 한 줄 + (구조 검증 실패면) 어느 파일이 왜 걸렸는지 리포트까지(E1). compile·smoke 공용. */
export function formatCompileFailure(error: PipelineError): string {
  const head = `컴파일 실패: ${error.message}`;
  if (error.kind !== "validation_failed") return head;
  return `${head}\n${formatValidationReport(error.report)}`;
}

export function formatValidationReport(report: ValidationReport): string {
  const lines: string[] = [`검증: ${report.passed ? "PASSED" : "FAILED"}`];
  if (report.issues.length === 0) {
    lines.push("문제 없음.");
    return lines.join("\n");
  }
  lines.push("");
  for (const issue of report.issues) {
    lines.push(
      `  [${issue.severity.toUpperCase()}] ${issue.file} (${issue.code}): ${issue.message}`,
    );
  }
  return lines.join("\n");
}
