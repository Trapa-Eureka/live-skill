// zod 스키마 — LLM 응답·manifest 파일 IO 경계에서만 쓴다(CLAUDE.md 컨벤션: "LLM 응답·CLI 인자·manifest는
// 경계에서 zod 파싱"). DistilledChapter는 LLM의 원본 markdown 본문 + 결정론적 앵커 추출 결과라 별도 스키마가
// 필요 없다.
import { z } from "zod";

/** ChapterPlan — outline(SkillPlan)의 챕터 하나. */
export const chapterPlanSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  title: z.string().min(1),
  sectionIds: z.array(z.string().min(1)).min(1),
});

/** slug 형식 — 소문자·숫자·하이픈 단일 경로 구성요소(DESIGN §2, A1). `/`·`.`·`..`·절대 경로가 여기서 걸러진다.
 * Agent Skills 표준의 name 규칙(소문자·숫자·하이픈, 64자 이하)과 같다. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SLUG_MAX_LENGTH = 64;
export const slugSchema = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .regex(SLUG_PATTERN, "slug must be lowercase letters, digits and single hyphens only");

/** SkillPlan — outline 단계 LLM 응답. */
export const skillPlanSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  chapters: z.array(chapterPlanSchema).min(1),
});

/** GoldenQA — qaGen 단계 LLM 응답 한 항목. */
export const goldenQaSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  question: z.string().min(1),
  refAnswer: z.string().min(1),
  anchorQuote: z.string().min(1),
});

export const gateFailureReasonSchema = z.enum([
  "wrong",
  "not_found",
  "anchor_missing",
  "qa_generation_failed",
]);

/** GateReport — 품질 게이트 최종 리포트, manifest.gate에 내장된다. */
export const gateReportSchema = z.object({
  passRate: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  passed: z.boolean(),
  perChapter: z.array(
    z.object({
      file: z.string().min(1),
      asked: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
    }),
  ),
  failures: z.array(
    z.object({
      qaId: z.string().min(1),
      reason: gateFailureReasonSchema,
    }),
  ),
  loadHistory: z.array(
    z.object({
      qaId: z.string().min(1),
      selectedFile: z.string(),
      loadedFiles: z.array(z.string()),
    }),
  ),
  coverage: z.array(
    z.object({
      sectionId: z.string().min(1),
      requested: z.number().int().nonnegative(),
      generated: z.number().int().nonnegative(),
    }),
  ),
});

/** Manifest — 컴파일 산출 manifest.json, 파일 IO 경계에서 파싱한다. */
export const manifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().min(1),
  sourceFiles: z.array(z.object({ path: z.string().min(1), sha256: z.string().length(64) })),
  sections: z.array(
    z.object({
      id: z.string().min(1),
      sha256: z.string().length(64),
      chapterFile: z.string().min(1),
    }),
  ),
  outputs: z.array(z.string().min(1)),
  gate: z.union([gateReportSchema, z.object({ skipped: z.literal(true) })]),
  goldenQa: z.array(goldenQaSchema),
});
