// 게이트/검증 리포트를 사람이 읽을 텍스트로 바꾼다 — 순수 문자열 포맷팅, 외부 IO 없음. `report`/`validate`/
// `compile`/`eval` CLI가 전부 이 함수들만 호출한다("cli는 조립만", DESIGN §6).
import type { OutputIntegrity } from "./integrity.js";
import type { LlmErrorKind, LlmProviderError } from "./llmError.js";
import { sanitizeExternalText } from "./modelText.js";
import type { PipelineError } from "./pipeline.js";
import type { PopulationMatch } from "./sources.js";
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

/** 산출물 무결성 실패를 사람 말로(E3) — 어떤 파일이 어떻게 어긋났는지와 수정 방법. status가 ok면 빈 문자열. */
export function formatOutputIntegrity(r: OutputIntegrity): string {
  if (r.status === "ok") return "";
  const lines: string[] =
    r.status === "stale"
      ? [
          "산출물 무결성: STALE — manifest가 검증한 파일과 현재 파일이 다릅니다. 게이트 판정은 현재 파일에 적용되지 않습니다.",
        ]
      : [
          "산출물 무결성: TAMPERED — manifest가 모르는 파일이 스킬 디렉터리에 있습니다. 게이트는 그 파일을 검증한 적이 없습니다.",
        ];
  const section = (title: string, items: readonly string[]): void => {
    if (items.length === 0) return;
    lines.push(`  ${title}:`);
    for (const item of items) lines.push(`    - ${item}`);
  };
  section("수정된 파일", r.modified);
  section("없는 파일", r.missing);
  section("manifest에 없는 파일", r.unexpected);
  lines.push(
    r.status === "stale"
      ? "수정 방법: `compile --force`로 다시 컴파일하거나, 파일을 컴파일 당시 상태로 되돌리세요."
      : "수정 방법: 그 파일을 스킬 디렉터리에서 치우거나, `compile --force`로 다시 컴파일하세요.",
  );
  return lines.join("\n");
}

const MAX_LISTED_IDS = 5;

function listIds(ids: readonly string[]): string {
  const head = ids.slice(0, MAX_LISTED_IDS).join(", ");
  return ids.length > MAX_LISTED_IDS
    ? `${head} … 외 ${String(ids.length - MAX_LISTED_IDS)}개`
    : head;
}

/** eval --source의 원문 모집단이 manifest와 맞지 않을 때(F3) — 어떤 id가 어느 쪽에만 있는지와 수정 방법. */
export function formatSourceMismatch(m: PopulationMatch): string {
  const lines = [
    "--source의 원문이 이 manifest와 맞지 않습니다 — 챕터 배정을 적용할 수 없어 재채점을 중단합니다.",
  ];
  if (m.missing.length > 0) {
    lines.push(
      `  manifest에는 있는데 원문에서 안 나온 섹션 ${String(m.missing.length)}개: ${listIds(m.missing)}`,
    );
  }
  if (m.unknown.length > 0) {
    lines.push(
      `  원문에는 있는데 manifest에 없는 섹션 ${String(m.unknown.length)}개: ${listIds(m.unknown)}`,
    );
  }
  lines.push(
    "수정 방법: 컴파일에 쓴 파일들을 같은 폴더 구조로 넘기세요(다중 소스는 공통 상위 폴더 기준 접두어가 붙습니다). 원문이 정말 바뀌었다면 `compile --force`로 다시 컴파일하세요.",
  );
  return lines.join("\n");
}

/** 본문만 바뀐 섹션은 참고 사항 — 문항은 현재 원문으로 새로 만든다. 없으면 빈 문자열. */
export function formatChangedSections(m: PopulationMatch): string {
  if (m.changed.length === 0) return "";
  return `참고: 컴파일 이후 본문이 바뀐 섹션 ${String(m.changed.length)}개(${listIds(m.changed)}) — 문항은 현재 원문으로 새로 만듭니다.`;
}

export function formatSkippedGate(): string {
  return "게이트: SKIPPED (--no-gate) — 산출물은 unverified 표시로 배포됐습니다.";
}

const LLM_ERROR_KO: Record<LlmErrorKind, { what: string; fix: string }> = {
  auth: { what: "인증 실패", fix: ".env의 ANTHROPIC_API_KEY를 확인하세요(.env.example 참고)." },
  rate_limit: {
    what: "요청 한도 초과(rate limit)",
    fix: "잠시 뒤 같은 명령을 다시 실행하세요. 호출 수를 줄이려면 QA_PER_SECTION을 낮추세요.",
  },
  network: { what: "네트워크 오류", fix: "네트워크·프록시를 확인하고 다시 실행하세요." },
  server: { what: "제공자 서버 오류", fix: "제공자 장애입니다 — 잠시 뒤 다시 실행하세요." },
  bad_response: {
    what: "응답 형식 이상",
    fix: "다시 실행하세요. 반복되면 MODEL을 바꿔 보세요.",
  },
  refusal: {
    what: "모델 거부",
    fix: "모델이 이 내용을 거부했습니다 — 원문을 검토하세요(재시도하지 않습니다).",
  },
  unknown: {
    what: "알 수 없는 오류",
    fix: "다시 실행하세요. 반복되면 아래 메시지와 함께 이슈로 제보해 주세요.",
  },
};

export interface LlmFailureInfo {
  kind: LlmErrorKind;
  retryable: boolean;
  /** 이미 sanitizeExternalText를 거친 문구, 또는 원문(여기서 다시 다듬는다). */
  detail: string;
}

/** LLM 실패를 사람 말로(G1): 어느 단계에서 무엇이, 재시도 가능한지, 그때까지 호출 수, 수정 방법. 키·원문은 싣지 않는다. */
export function formatLlmFailure(stage: string, info: LlmFailureInfo, calls: number): string {
  const ko = LLM_ERROR_KO[info.kind];
  const detail = sanitizeExternalText(info.detail);
  const lines = [
    `${stage} 중 LLM 호출 실패: ${ko.what}(${info.kind}, ${info.retryable ? "재시도 가능" : "재시도 불가"}) — 그때까지 LLM 호출 ${String(calls)}회, 아무것도 쓰지 않았습니다.`,
    `수정 방법: ${ko.fix}`,
  ];
  if (detail !== "" && detail !== info.kind) lines.push(`제공자 메시지: ${detail}`);
  return lines.join("\n");
}

/** LlmProviderError 인스턴스에서 바로(eval처럼 파이프라인 밖에서 잡은 경우). */
export function formatLlmProviderError(stage: string, e: LlmProviderError, calls: number): string {
  return formatLlmFailure(
    stage,
    { kind: e.kind, retryable: e.retryable, detail: e.message },
    calls,
  );
}

const STAGE_KO: Record<string, string> = { outline: "아웃라인", distill: "증류", gate: "게이트" };

/** 파이프라인 실패 한 줄 + (구조 검증 실패면) 어느 파일이 왜 걸렸는지 리포트까지(E1), (LLM 실패면) 단계·종류·
 * 재시도 가능 여부·호출 수·수정 방법(G1). compile·smoke 공용. */
export function formatCompileFailure(error: PipelineError): string {
  if (error.kind === "llm_failed") {
    return `컴파일 실패 — ${formatLlmFailure(STAGE_KO[error.stage] ?? error.stage, error.error, error.calls)}`;
  }
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
