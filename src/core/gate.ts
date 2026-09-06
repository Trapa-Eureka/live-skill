// 품질 게이트 — 제품의 심장(DESIGN §4). qaGen(앵커 검사·재생성 1회) → answerer 격리 시뮬레이터
// (SKILL.md만 보고 챕터 선택 → 선택된 챕터만 로드 → 답변) → grader(이중 채점, 한 번의 호출) → 판정.
// CLAUDE.md 가드레일 1·2: 임계치 완화 금지, answerer에 원문·미선택 챕터를 절대 주입하지 않는다.
import {
  answerPrompt,
  chapterSelectionPrompt,
  gradePrompt,
  parseGradeVerdict,
  qaGenPrompt,
} from "./prompts.js";
import type {
  GateFailureReason,
  GateReport,
  GoldenQA,
  LlmProvider,
  Manifest,
  Section,
} from "./types.js";
import { isChapterFilePath } from "./schemas.js";
import type { SkillFile } from "./validator.js";
import { z } from "zod";

export const DEFAULT_K = 3;
export const DEFAULT_THRESHOLD = 0.9;

export interface GateChapter {
  file: string;
  sectionIds: readonly string[];
}

export interface GateInput {
  /** {path, content}만 있으면 된다 — assembler의 AssembledFile도, 디스크에서 읽은 SkillFile(eval, T8)도
   * 그대로 들어맞는다. answerer는 이 중 SKILL.md와 선택된 챕터 파일"만" 읽는다. */
  files: readonly SkillFile[];
  /** 챕터 파일 순서·소속 섹션 — qaGen 대상 선정과 perChapter 집계에 쓴다. */
  chapters: readonly GateChapter[];
  /** qaGen이 참조하는 원문 섹션(파이프라인이 병합한 전체 목록). */
  sections: readonly Section[];
}

export interface GateDeps {
  llm: LlmProvider;
  /** 섹션당 골든 Q&A 개수, 기본 3(DESIGN §4). */
  k?: number;
  /** 통과 임계치, 기본 0.9(DESIGN §4) — 완화 금지(CLAUDE.md 가드레일 1). */
  threshold?: number;
}

/** manifest.sections를 chapterFile 기준으로 묶어 GateChapter[]로 되돌린다 — `eval`(T8, DESIGN §6)이
 * SkillPlan 없이 manifest만으로 게이트를 다시 돌릴 때 쓴다. 파일명 사전순으로 정렬해 결정론을 지킨다. */
export function chaptersFromManifest(manifest: Manifest): GateChapter[] {
  const byFile = new Map<string, string[]>();
  for (const s of manifest.sections) {
    const ids = byFile.get(s.chapterFile) ?? [];
    ids.push(s.id);
    byFile.set(s.chapterFile, ids);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, sectionIds]) => ({ file, sectionIds }));
}

/** manifest가 가리키는 챕터 파일 중 실제 스킬 디렉터리에 없는 것(B3) — `eval`이 LLM을 부르기 전에 확인한다.
 * 다른 디렉터리의 manifest를 갖다 붙였거나 챕터가 지워진 경우를 조용히 not_found 실패로 만들지 않기 위함. */
export function missingChapterFiles(
  chapters: readonly GateChapter[],
  files: readonly SkillFile[],
): string[] {
  const onDisk = new Set(files.map((f) => f.path));
  return chapters.map((c) => c.file).filter((file) => !onDisk.has(file));
}

/** 게이트가 예상 소비할 LLM 호출 수 상한선(DESIGN §4 T7 결정). 조기 종료가 있으면 실제는 이보다 적다. */
export function estimateGateCalls(sectionCount: number, k: number): number {
  return sectionCount * 1 + sectionCount * k * 3;
}

const qaGenItemSchema = z.object({
  question: z.string().min(1),
  refAnswer: z.string().min(1),
  anchorQuote: z.string().min(1),
});
const qaGenResponseSchema = z.object({ items: z.array(qaGenItemSchema) });

function parseQaGenItems(
  raw: string,
): { question: string; refAnswer: string; anchorQuote: string }[] {
  try {
    return qaGenResponseSchema.parse(JSON.parse(raw) as unknown).items;
  } catch {
    return []; // 파싱 실패 = 문항 0개 — 재생성 루프가 자연스럽게 다시 시도한다
  }
}

/** 섹션 하나에 대해 k개의 골든 Q&A를 만든다. anchorQuote가 원문에 없는 문항은 폐기 후 1회만 재생성한다
 * (DESIGN §4-1) — 재생성으로도 못 채우면 그만큼 적게 반환한다(문항 제외, TESTING §3). */
export async function generateGoldenQa(
  section: Section,
  k: number,
  llm: LlmProvider,
): Promise<GoldenQA[]> {
  const valid: GoldenQA[] = [];
  for (let attempt = 0; attempt < 2 && valid.length < k; attempt++) {
    const need = k - valid.length;
    const raw = await llm.complete(qaGenPrompt(section, need));
    for (const item of parseQaGenItems(raw)) {
      if (valid.length >= k) break;
      if (!section.text.includes(item.anchorQuote)) continue; // 원문에 없는 인용 — 이번 라운드에서 폐기
      valid.push({
        id: `${section.id}-q${String(valid.length + 1)}`,
        sectionId: section.id,
        question: item.question,
        refAnswer: item.refAnswer,
        anchorQuote: item.anchorQuote,
      });
    }
  }
  return valid;
}

interface QaOutcome {
  qaId: string;
  chapterFile: string;
  correct: boolean;
  failureReason?: GateFailureReason | undefined;
  selectedFile: string;
  loadedFiles: string[];
}

/** 골든 Q&A 하나를 answerer 격리 시뮬레이터로 평가한다. 실패 지점에서 즉시 멈춘다(DESIGN §4 T7 결정 순서). */
async function evaluateQa(
  qa: GoldenQA,
  chapterFile: string,
  chapterFiles: ReadonlySet<string>,
  filesByPath: ReadonlyMap<string, SkillFile>,
  skillMdContent: string,
  llm: LlmProvider,
): Promise<QaOutcome> {
  const selectionRaw = await llm.complete(chapterSelectionPrompt(skillMdContent, qa.question));
  const selectedFile = selectionRaw.trim();

  // 유효한 선택이려면 (a) 실제로 계획된 챕터 경로여야 하고 (b) 조립 산출물에 그 파일이 실제로 있어야 한다 —
  // (b)가 "챕터 누락 주입" 테스트가 잡아내는 지점: SKILL.md 인덱스는 여전히 그 챕터를 가리키지만 실제
  // 파일이 조립 결과에서 빠졌다면, 격리 시뮬레이터는 아무것도 로드할 수 없다(가드레일 2 — 원문으로 대신
  // 채우지 않는다).
  const selectedFileContent = filesByPath.get(selectedFile);
  if (!chapterFiles.has(selectedFile) || selectedFileContent === undefined) {
    return {
      qaId: qa.id,
      chapterFile,
      correct: false,
      failureReason: "not_found",
      selectedFile,
      loadedFiles: [],
    };
  }

  const selectedContent = selectedFileContent.content;
  if (!selectedContent.includes(qa.anchorQuote)) {
    return {
      qaId: qa.id,
      chapterFile,
      correct: false,
      failureReason: "anchor_missing",
      selectedFile,
      loadedFiles: [selectedFile],
    };
  }

  // 격리(가드레일 2): 여기서 answerer에게 주는 건 SKILL.md + 선택된 챕터 "단 하나"뿐이다.
  const loadedContext = `${skillMdContent}\n\n---\n\n${selectedContent}`;
  const answer = await llm.complete(answerPrompt(loadedContext, qa.question));
  const verdictRaw = await llm.complete(gradePrompt(qa, answer));
  const verdict = parseGradeVerdict(verdictRaw);

  return {
    qaId: qa.id,
    chapterFile,
    correct: verdict === "correct",
    failureReason: verdict === "correct" ? undefined : "wrong",
    selectedFile,
    loadedFiles: [selectedFile],
  };
}

export interface EvaluateInput {
  files: readonly SkillFile[];
  chapters: readonly GateChapter[];
  /** 섹션당 요청한 문항 수(coverage.requested). 기본 DEFAULT_K — eval 재사용 경로는 그때의 config 값을 준다. */
  qaPerSection?: number;
}

/**
 * 이미 만들어진 골든 QA 목록을 채점만 한다(qaGen 생략) — DESIGN §4/§6 T8 결정. `eval` 명령이 원문 없이
 * manifest의 QA를 재사용할 때 쓴다. threshold는 기본 0.9(가드레일 1: 완화 금지).
 */
export async function evaluateGoldenQa(
  qas: readonly GoldenQA[],
  input: EvaluateInput,
  llm: LlmProvider,
  threshold = DEFAULT_THRESHOLD,
): Promise<GateReport> {
  // B3(가드레일 2): answerer가 로드할 수 있는 파일은 "코드가 정한 챕터 형식(chapters/<slug>.md)이면서 챕터 목록에
  // 있는 것"뿐이다. manifest.json(정답이 들어 있다)·원문·부속 파일은 챕터 목록에 끼어 있어도 절대 로드하지
  // 않는다 — 외부 manifest가 목록을 정하더라도 형식 경계는 코드가 쥔다. SKILL.md만 인덱스로 따로 준다.
  const chapterFileSet = new Set(input.chapters.map((c) => c.file).filter(isChapterFilePath));
  const filesByPath = new Map(
    input.files.filter((f) => chapterFileSet.has(f.path)).map((f) => [f.path, f]),
  );
  const skillMd = input.files.find((f) => f.path === "SKILL.md")?.content ?? "";
  const chapterFileBySectionId = new Map<string, string>();
  for (const chapter of input.chapters) {
    for (const sectionId of chapter.sectionIds) chapterFileBySectionId.set(sectionId, chapter.file);
  }

  const outcomes: QaOutcome[] = [];
  for (const qa of qas) {
    const chapterFile = chapterFileBySectionId.get(qa.sectionId) ?? "";
    outcomes.push(await evaluateQa(qa, chapterFile, chapterFileSet, filesByPath, skillMd, llm));
  }

  const perChapter = input.chapters.map((c) => {
    const forChapter = outcomes.filter((o) => o.chapterFile === c.file);
    return {
      file: c.file,
      asked: forChapter.length,
      correct: forChapter.filter((o) => o.correct).length,
    };
  });

  // B2(DESIGN §4): 모집단(챕터별 sectionIds) 섹션마다 유효 문항 수를 센다. 하나도 못 만든 섹션은 "미검증"이라
  // 나머지가 전부 정답이어도 통과할 수 없다 — 분모에서 빼는 대신(가드레일 1 위반) 별도 필요조건으로 둔다.
  const requested = input.qaPerSection ?? DEFAULT_K;
  const generatedBySection = new Map<string, number>();
  for (const qa of qas) {
    generatedBySection.set(qa.sectionId, (generatedBySection.get(qa.sectionId) ?? 0) + 1);
  }
  const coverage = input.chapters.flatMap((c) =>
    c.sectionIds.map((sectionId) => ({
      sectionId,
      requested,
      generated: generatedBySection.get(sectionId) ?? 0,
    })),
  );
  const uncovered = coverage.filter((c) => c.generated === 0);

  const failures = [
    ...outcomes
      .filter((o) => !o.correct)
      .map((o) => ({ qaId: o.qaId, reason: o.failureReason ?? ("wrong" as const) })),
    // 문항이 아니라 섹션의 실패 — q1..qk 앞의 "0번 문항"으로 표기한다(DESIGN §2).
    ...uncovered.map((c) => ({
      qaId: `${c.sectionId}-q0`,
      reason: "qa_generation_failed" as const,
    })),
  ];

  const loadHistory = outcomes.map((o) => ({
    qaId: o.qaId,
    selectedFile: o.selectedFile,
    loadedFiles: o.loadedFiles,
  }));

  const asked = outcomes.length;
  const correct = outcomes.filter((o) => o.correct).length;
  // 질문이 하나도 없으면 보수적으로 미통과 처리 — 검증된 게 아무것도 없다.
  const passRate = asked === 0 ? 0 : correct / asked;

  // 부동소수 오차 방지: 수학적으로 임계치와 같은 비율(예: 9/10 = 0.9)이 이진 부동소수 반올림 때문에
  // 근소하게 못 미치는 것으로 계산되는 사고를 막는다 — 임계치 자체를 낮추는 것과는 다르다(가드레일 1).
  const EPSILON = 1e-9;
  return {
    passRate,
    threshold,
    passed: passRate >= threshold - EPSILON && uncovered.length === 0,
    perChapter,
    failures,
    loadHistory,
    coverage,
  };
}

export interface GateOutcome {
  report: GateReport;
  /** 생성된 골든 QA 원본 — manifest.goldenQa로 저장해 eval이 나중에 재사용한다(DESIGN §6 T8 결정). */
  goldenQa: GoldenQA[];
}

/** DESIGN §4의 전체 게이트: 섹션마다 qaGen으로 문항을 만들고, evaluateGoldenQa에 위임해 채점한다. */
export async function runGate(input: GateInput, deps: GateDeps): Promise<GateOutcome> {
  const k = deps.k ?? DEFAULT_K;
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));

  const goldenQa: GoldenQA[] = [];
  for (const chapter of input.chapters) {
    for (const sectionId of chapter.sectionIds) {
      const section = sectionById.get(sectionId);
      if (section === undefined) continue; // 파이프라인 불일치 방어 — 정상 흐름에선 항상 존재
      goldenQa.push(...(await generateGoldenQa(section, k, deps.llm)));
    }
  }

  const report = await evaluateGoldenQa(
    goldenQa,
    { files: input.files, chapters: input.chapters, qaPerSection: k },
    deps.llm,
    deps.threshold ?? DEFAULT_THRESHOLD,
  );
  return { report, goldenQa };
}
