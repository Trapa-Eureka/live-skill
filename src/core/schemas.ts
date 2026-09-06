// zod 스키마 — LLM 응답·manifest 파일 IO 경계에서만 쓴다(CLAUDE.md 컨벤션: "LLM 응답·CLI 인자·manifest는
// 경계에서 zod 파싱"). DistilledChapter는 LLM의 원본 markdown 본문 + 결정론적 앵커 추출 결과라 별도 스키마가
// 필요 없다.
import { z } from "zod";
import { GATE_THRESHOLD_FLOOR, PASS_EPSILON, decidePassed } from "./gateVerdict.js";
import { MULTI_LINE_PATTERN, SINGLE_LINE_PATTERN } from "./modelText.js";

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

// C1(DESIGN §4): 모델 출력 필드의 길이·제어문자 제한 — 제목은 프롬프트 데이터 블록과 SKILL.md에, id는 manifest에,
// QA 문구는 프롬프트·manifest에 그대로 실린다. 개행이 낀 "한 줄 필드"나 제어문자는 형식을 깨는 통로라 경계에서 막는다.
export const MAX_TITLE_CHARS = 200;
export const MAX_ID_CHARS = 200;
export const MAX_QA_FIELD_CHARS = 2000;
const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(SINGLE_LINE_PATTERN, "must be a single line without control characters");
const multiLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(MULTI_LINE_PATTERN, "control characters other than newline/tab are not allowed");

/** ChapterPlan — outline(SkillPlan)의 챕터 하나. */
export const chapterPlanSchema = z.object({
  id: singleLine(MAX_ID_CHARS),
  file: z.string().min(1),
  title: singleLine(MAX_TITLE_CHARS),
  sectionIds: z.array(singleLine(MAX_ID_CHARS)).min(1),
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
  title: singleLine(MAX_TITLE_CHARS),
  chapters: z.array(chapterPlanSchema).min(1),
});

/** 챕터 파일 경로 형식 — assembler의 `chapterFilePath()`가 만드는 형태만(B3, 가드레일 2): `chapters/` 바로
 * 아래의 슬러그 문자 + `.md`. `manifest.json`·`SKILL.md`·상위 경로·하위 디렉터리는 여기서 걸러진다 — answerer가
 * 로드할 수 있는 파일의 형식적 경계를 manifest가 아니라 코드가 쥔다. */
export const CHAPTER_FILE_PATTERN = /^chapters\/[\p{L}\p{N}-]+\.md$/u;
export const chapterFileSchema = z
  .string()
  .regex(CHAPTER_FILE_PATTERN, "chapterFile must look like chapters/<slug>.md");
export function isChapterFilePath(path: string): boolean {
  return CHAPTER_FILE_PATTERN.test(path);
}

/** qaGen 단계 LLM 응답 한 항목(id 없음) — gate.ts가 파싱하고 id를 붙인다. */
export const qaGenItemSchema = z.object({
  question: multiLine(MAX_QA_FIELD_CHARS),
  refAnswer: multiLine(MAX_QA_FIELD_CHARS),
  anchorQuote: multiLine(MAX_QA_FIELD_CHARS),
});
export const qaGenResponseSchema = z.object({ items: z.array(qaGenItemSchema) });

/** GoldenQA — 검증된 골든 Q&A(manifest.goldenQa). */
export const goldenQaSchema = qaGenItemSchema.extend({
  id: singleLine(MAX_ID_CHARS),
  sectionId: singleLine(MAX_ID_CHARS),
});

export const gateFailureReasonSchema = z.enum([
  "wrong",
  "not_found",
  "anchor_missing",
  "qa_generation_failed",
]);

/** GateReport — 품질 게이트 최종 리포트, manifest.gate에 내장된다. 형식 검사 뒤 의미 검사(B6, AUD-011):
 * 집계가 서로 맞고, `passed`가 gateVerdict의 판정 규칙과 일치하며, 실패 목록이 로드 이력·coverage와 대응해야
 * 한다 — 조작된 manifest가 `passed=true, passRate=0` 같은 모순으로 report/eval을 속이지 못하게. */
export const gateReportSchema = z
  .object({
    passRate: z.number().min(0).max(1),
    threshold: z.number().min(GATE_THRESHOLD_FLOOR).max(1), // 정책 하한(B4) — 하한 아래 임계치로 "통과"한 리포트는 무효
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
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    r.perChapter.forEach((c, i) => {
      if (c.correct > c.asked) {
        issue(`correct (${String(c.correct)}) exceeds asked (${String(c.asked)})`, [
          "perChapter",
          i,
        ]);
      }
    });
    if (!unique(r.perChapter.map((c) => c.file)))
      issue("chapter files must be unique", ["perChapter"]);

    const asked = r.perChapter.reduce((n, c) => n + c.asked, 0);
    const correct = r.perChapter.reduce((n, c) => n + c.correct, 0);
    const loadIds = r.loadHistory.map((l) => l.qaId);
    if (!unique(loadIds)) issue("qaIds must be unique", ["loadHistory"]);
    if (asked !== r.loadHistory.length) {
      issue(
        `perChapter asked total (${String(asked)}) must equal the number of loadHistory entries (${String(r.loadHistory.length)})`,
        ["loadHistory"],
      );
    }

    const failIds = r.failures.map((f) => f.qaId);
    if (!unique(failIds)) issue("qaIds must be unique", ["failures"]);
    const graded = r.failures.filter((f) => f.reason !== "qa_generation_failed");
    const loadSet = new Set(loadIds);
    for (const f of graded) {
      if (!loadSet.has(f.qaId)) issue(`failure ${f.qaId} has no loadHistory entry`, ["failures"]);
    }
    if (correct !== asked - graded.length) {
      issue(
        `perChapter correct total (${String(correct)}) must equal asked (${String(asked)}) minus graded failures (${String(graded.length)})`,
        ["perChapter"],
      );
    }

    const expectedRate = asked === 0 ? 0 : correct / asked;
    if (Math.abs(r.passRate - expectedRate) > PASS_EPSILON) {
      issue(
        `passRate ${String(r.passRate)} does not match correct/asked = ${String(expectedRate)}`,
        ["passRate"],
      );
    }

    if (!unique(r.coverage.map((c) => c.sectionId)))
      issue("sectionIds must be unique", ["coverage"]);
    r.coverage.forEach((c, i) => {
      if (c.generated > c.requested) {
        issue(`generated (${String(c.generated)}) exceeds requested (${String(c.requested)})`, [
          "coverage",
          i,
        ]);
      }
    });
    const uncovered = r.coverage.filter((c) => c.generated === 0);
    const expectedGenFail = new Set(uncovered.map((c) => `${c.sectionId}-q0`));
    const actualGenFail = new Set(
      r.failures.filter((f) => f.reason === "qa_generation_failed").map((f) => f.qaId),
    );
    if (!sameSet(expectedGenFail, actualGenFail)) {
      issue(
        "qa_generation_failed failures must correspond exactly to coverage entries with generated 0 (qaId <sectionId>-q0)",
        ["failures"],
      );
    }

    const expectedPassed = decidePassed({
      asked,
      passRate: r.passRate,
      threshold: r.threshold,
      uncoveredSections: uncovered.length,
    });
    if (r.passed !== expectedPassed) {
      issue(
        `passed=${String(r.passed)} contradicts the verdict rule (asked ${String(asked)}, passRate ${String(r.passRate)}, threshold ${String(r.threshold)}, unverified sections ${String(uncovered.length)} → ${String(expectedPassed)})`,
        ["passed"],
      );
    }
  });

/** 소문자 16진수 64자 — core/hash.ts sha256Hex의 출력 형식 그대로(B6). */
export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "must be a 64-character lowercase hex SHA-256");

/** Manifest — 컴파일 산출 manifest.json, 파일 IO 경계에서 파싱한다. 의미 검사(B6): 섹션·산출물·골든 QA·
 * 게이트 리포트가 서로를 정확히 가리켜야 한다(chapterFile ∈ outputs, loadHistory ⊆ goldenQa, coverage = 섹션 집합,
 * perChapter = 챕터 파일 집합). */
export const manifestSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    sourceFiles: z.array(z.object({ path: z.string().min(1), sha256: sha256Schema })),
    sections: z.array(
      z.object({
        id: z.string().min(1),
        sha256: sha256Schema,
        chapterFile: chapterFileSchema,
      }),
    ),
    outputs: z.array(z.string().min(1)),
    gate: z.union([gateReportSchema, z.object({ skipped: z.literal(true) })]),
    goldenQa: z.array(goldenQaSchema),
  })
  .superRefine((m, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    if (!unique(m.outputs)) issue("outputs must be unique", ["outputs"]);
    if (!unique(m.sections.map((s) => s.id))) issue("section ids must be unique", ["sections"]);
    const outputSet = new Set(m.outputs);
    m.sections.forEach((s, i) => {
      if (!outputSet.has(s.chapterFile)) {
        issue(`chapterFile "${s.chapterFile}" is not listed in outputs`, [
          "sections",
          i,
          "chapterFile",
        ]);
      }
    });

    const sectionIds = new Set(m.sections.map((s) => s.id));
    if (!unique(m.goldenQa.map((q) => q.id))) issue("qa ids must be unique", ["goldenQa"]);
    m.goldenQa.forEach((q, i) => {
      if (!sectionIds.has(q.sectionId)) {
        issue(`sectionId "${q.sectionId}" is not a manifest section`, ["goldenQa", i, "sectionId"]);
      }
    });

    if (!("passed" in m.gate)) return;
    const gate = m.gate;
    const qaIds = new Set(m.goldenQa.map((q) => q.id));
    gate.loadHistory.forEach((l, i) => {
      if (!qaIds.has(l.qaId)) {
        issue(`qaId "${l.qaId}" is not in goldenQa`, ["gate", "loadHistory", i]);
      }
    });
    if (!sameSet(sectionIds, new Set(gate.coverage.map((c) => c.sectionId)))) {
      issue("gate.coverage must have exactly one entry per manifest section", ["gate", "coverage"]);
    }
    if (
      !sameSet(
        new Set(m.sections.map((s) => s.chapterFile)),
        new Set(gate.perChapter.map((c) => c.file)),
      )
    ) {
      issue("gate.perChapter must have exactly one entry per distinct chapterFile", [
        "gate",
        "perChapter",
      ]);
    }
  });
