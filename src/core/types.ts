// 도메인 타입 — DESIGN.md §2가 진실의 원천. 코드와 문서가 어긋나면 문서를 먼저 고친다(CLAUDE.md 컨벤션).
// 이 파일은 순수 타입 선언만 담는다 — 외부 IO 없음(CLAUDE.md 컨벤션: core/는 순수 계산과 계획만).
import type { Result } from "./result.js";

/** 추출된 문서의 한 섹션. id는 헤딩 경로 기반 슬러그(core/sectionId.ts)로, 안정적이어야 한다(DESIGN §5). */
export interface Section {
  id: string;
  heading: string;
  level: number;
  text: string;
}

/** 추출기 산출물. message 레포와 동일 규약(섹션 구조화). */
export interface ExtractedDoc {
  sections: Section[];
}

/** 추출 실패 사유 — CLI/파이프라인이 원인+수정 방법을 담은 메시지로 번역한다(CLAUDE.md 컨벤션). */
export type ExtractError =
  | { kind: "empty_text" }
  | { kind: "corrupt"; detail: string }
  | { kind: "unsupported"; mime: string; name: string };

/** 형식별 추출기(T2에서 구현). extract()는 예외 대신 Result를 반환한다(DESIGN §2 T1 결정). */
export interface DocumentExtractor {
  supports(mime: string, name: string): boolean;
  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>>;
}

/** LLM 어댑터 경계(T3에서 구현). outline·distill·qaGen·answerer·grader 5역할이 이 인터페이스만 쓴다. */
export interface LlmProvider {
  complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}

/** manifest 타임스탬프 등에 쓰는 시계 경계 — 테스트에서는 FixedClock으로 대체(mocks/). */
export interface Clock {
  now(): Date;
}

/** 아웃라인 단계가 원문 섹션들을 하나의 챕터로 묶은 계획 (배포 전, 증류 이전). */
export interface ChapterPlan {
  id: string;
  file: string;
  title: string;
  sectionIds: string[];
}

/** outline 단계 결과 — LLM 응답이므로 경계에서 zod 파싱(core/schemas.ts skillPlanSchema). */
export interface SkillPlan {
  slug: string;
  title: string;
  chapters: ChapterPlan[];
}

/** distill 단계 결과 — 챕터 하나의 증류 본문. anchors는 body 안 `[§sectionId]` 각주에서 결정론적으로 추출. */
export interface DistilledChapter {
  id: string;
  file: string;
  body: string;
  anchors: string[];
}

/** qaGen 단계가 만드는 골든 Q&A 한 항목 — LLM 응답이므로 경계에서 zod 파싱(core/schemas.ts goldenQaSchema). */
export interface GoldenQA {
  id: string;
  sectionId: string;
  question: string;
  refAnswer: string;
  anchorQuote: string;
}

/** 게이트 판정 사유 — GateReport.failures[].reason. */
export type GateFailureReason = "wrong" | "not_found" | "anchor_missing";

/** 품질 게이트 최종 리포트 (core/gate.ts, T7). manifest에 내장되므로 경계에서 zod 파싱. */
export interface GateReport {
  passRate: number;
  threshold: number;
  passed: boolean;
  perChapter: { file: string; asked: number; correct: number }[];
  failures: { qaId: string; reason: GateFailureReason }[];
  /** answerer 격리 감사 로그(DESIGN §2 T7 결정) — selectedFile은 LLM이 실제로 답한 원시 문자열(무효한
   * 경로여도 그대로), loadedFiles는 실제로 읽어 들인 파일(선택이 무효하면 빈 배열). */
  loadHistory: { qaId: string; selectedFile: string; loadedFiles: string[] }[];
}

/** 컴파일 산출 manifest — 스킬 디렉터리에 기록, v0.2 증분 재컴파일의 키(DESIGN §5). 파일 IO 경계이므로 zod 파싱. */
export interface Manifest {
  version: 1;
  createdAt: string;
  sourceFiles: { path: string; sha256: string }[];
  sections: { id: string; sha256: string; chapterFile: string }[];
  outputs: string[];
  gate: GateReport | { skipped: true };
}
