// 프롬프트 템플릿 — 문구가 사는 유일한 곳(DESIGN §4~§5). 순수: 도메인 데이터를 받아 LlmProvider.complete()
// 요청 객체를 만들 뿐, 어댑터·IO에 의존하지 않는다. 다섯 역할(outline·distill·qaGen·answerer·grader) 전부
// system 맨 앞에 promptRole.ts의 태그를 붙인다 — ScriptedLlm이 이 태그로 라우팅한다(TESTING §2).
import { promptRoleTag } from "./promptRole.js";
import type { ChapterPlan, ExtractedDoc, Section } from "./types.js";

export interface LlmRequest {
  system: string;
  prompt: string;
  maxTokens: number;
}

const COMMON_RULES = [
  "원문의 전문 용어·고유명사는 번역하거나 순화하지 말고 원문 그대로 유지한다.",
  "지어내지 않는다 — 원문에 없는 사실을 추가하지 않는다.",
].join(" ");

function sectionExcerpt(section: Section, maxChars = 400): string {
  const text =
    section.text.length > maxChars ? `${section.text.slice(0, maxChars)}…` : section.text;
  return `[§${section.id}] (level ${String(section.level)}) ${section.heading || "(제목 없음)"}\n${text}`;
}

/** outline — 원문 섹션들을 챕터로 묶는 계획(SkillPlan, DESIGN §2)을 JSON으로 요청한다. */
export function outlinePrompt(doc: ExtractedDoc): LlmRequest {
  const system = [
    promptRoleTag("outline"),
    "당신은 기술 문서를 에이전트 스킬로 컴파일하는 아웃라인 설계자다.",
    "주어진 섹션들을 의미 있는 챕터로 묶어라 — 원문의 섹션 순서와 계층을 존중하되, 너무 잘게 쪼개지 않는다.",
    COMMON_RULES,
    '다음 JSON 스키마로만 답하라(설명·코드펜스 없이): {"slug": string, "title": string, "chapters": [{"id": string, "file": string, "title": string, "sectionIds": string[]}]}',
    '"file"은 "chapters/chNN-슬러그.md" 형식으로 챕터 등장 순서대로 번호를 매긴다(DESIGN §3).',
    "모든 sectionId는 입력에 주어진 섹션 id 중에서만 고르고, 각 섹션은 정확히 하나의 챕터에만 속해야 한다.",
  ].join("\n");
  const prompt = doc.sections.map((s) => sectionExcerpt(s)).join("\n\n");
  return { system, prompt, maxTokens: 2000 };
}

/** distill — 챕터 하나에 묶인 원문 섹션들을 증류한 마크다운 본문을 요청한다(요약이 아니라 구조 추출). */
export function distillPrompt(
  chapter: ChapterPlan,
  sections: readonly Section[],
  budgetTokens = 1000,
): LlmRequest {
  const system = [
    promptRoleTag("distill"),
    `당신은 "${chapter.title}" 챕터를 증류하는 기술 저술가다.`,
    "요약이 아니라 구조 추출이다: 프레임워크·규칙·절차·안티패턴을 뽑아라.",
    COMMON_RULES,
    "모든 주장·수치·절차 뒤에는 근거가 된 섹션의 앵커 각주 [§sectionId]를 붙인다 — 앵커 없는 문장은 검증할 수 없다(DESIGN §3).",
    "본문 안에서 다음 표기가 있으면(없어도 무방) assembler가 별도 파일로 모은다(DESIGN §3 T4 결정) — 표기가 아닌 문장에는 절대 쓰지 않는다:",
    "- 용어 정의: 줄 맨 앞에 `**용어** — 정의` (원문 용어 그대로, glossary.md로 모인다)",
    "- 재사용 가능한 기법·절차·안티패턴: 줄 맨 앞에 `- [PATTERN] ...` / `- [PROCEDURE] ...` / `- [ANTI-PATTERN] ...` (patterns.md로 모인다)",
    "- 즉답 가능한 결정 규칙: 줄 맨 앞에 `- [RULE] ...` (cheatsheet.md로 모인다)",
    `결과는 약 ${String(budgetTokens)} 토큰 이내의 마크다운 본문만 출력한다(설명·코드펜스 없이).`,
  ].join("\n");
  const prompt = sections.map((s) => sectionExcerpt(s, 2000)).join("\n\n");
  return { system, prompt, maxTokens: Math.ceil(budgetTokens * 1.5) };
}

export interface QaGenItem {
  question: string;
  refAnswer: string;
  anchorQuote: string;
}

/** qaGen — 섹션 하나당 k개의 골든 Q&A를 요청한다. anchorQuote는 원문에 실존해야 한다(호출자가 검사, DESIGN §4-1). */
export function qaGenPrompt(section: Section, k: number): LlmRequest {
  const system = [
    promptRoleTag("qaGen"),
    `당신은 문서 검증용 골든 질문-답변을 만드는 채점 설계자다. 정확히 ${String(k)}개를 만들어라.`,
    "각 질문은 이 섹션의 내용만으로 답할 수 있어야 하고, refAnswer는 정답 요지를, anchorQuote는 그 정답의 근거가 되는 원문 문구를 원문 그대로(글자 하나까지) 인용해야 한다.",
    "anchorQuote를 지어내거나 바꿔 쓰면 안 된다 — 반드시 아래 원문에서 연속된 부분 문자열이어야 한다.",
    '다음 JSON 스키마로만 답하라(설명·코드펜스 없이): {"items": [{"question": string, "refAnswer": string, "anchorQuote": string}]}',
  ].join("\n");
  const prompt = `[§${section.id}] ${section.heading || "(제목 없음)"}\n${section.text}`;
  return { system, prompt, maxTokens: 200 * k + 200 };
}

/** answerer 1단계 — SKILL.md 인덱스만 보고 답에 필요한 챕터 파일을 고르게 한다(원문·다른 챕터는 안 준다, 가드레일 2). */
export function chapterSelectionPrompt(skillMdIndex: string, question: string): LlmRequest {
  const system = [
    promptRoleTag("answerer"),
    "당신은 에이전트 스킬의 인덱스만 보고 필요한 챕터를 고르는 에이전트다.",
    "아래는 스킬의 SKILL.md 전문이다 — 챕터 파일 목록과 각 챕터의 주제가 담겨 있다.",
    "질문에 답하는 데 필요한 챕터 파일 경로 하나를 정확히 골라라.",
    "다른 설명 없이 챕터 파일 경로 한 줄만 출력한다(예: chapters/ch01-installation.md).",
  ].join("\n");
  const prompt = `${skillMdIndex}\n\n질문: ${question}`;
  return { system, prompt, maxTokens: 100 };
}

/** answerer 2단계 — SKILL.md + 선택된 챕터 파일만 주고 답하게 한다(격리, 가드레일 2). */
export function answerPrompt(loadedContext: string, question: string): LlmRequest {
  const system = [
    promptRoleTag("answerer"),
    "당신은 로드된 스킬 파일만으로 질문에 답하는 에이전트다.",
    "아래에 주어진 내용에서만 답을 찾는다 — 여기 없는 내용은 모른다고 답한다.",
    "답변만 간결히 출력한다(설명 없이).",
  ].join("\n");
  const prompt = `${loadedContext}\n\n질문: ${question}`;
  return { system, prompt, maxTokens: 500 };
}

/** grader — 이중 채점(루브릭 일치 AND 앵커 무모순)을 한 번에 묻는다. 불확실하면 WRONG(보수 채점, DESIGN §4-3). */
export function gradePrompt(
  qa: { question: string; refAnswer: string; anchorQuote: string },
  candidateAnswer: string,
): LlmRequest {
  const system = [
    promptRoleTag("grader"),
    "당신은 보수적인 채점자다. 두 조건을 모두 만족해야 CORRECT다:",
    "(a) 후보 답변이 참조 답변의 요지와 일치한다.",
    "(b) 후보 답변이 원문 인용(앵커)의 사실과 모순되지 않는다.",
    "조금이라도 불확실하면 WRONG으로 판정한다 — 관대하게 봐주지 않는다.",
    "다른 설명 없이 CORRECT 또는 WRONG 한 단어만 출력한다.",
  ].join("\n");
  const prompt = [
    `질문: ${qa.question}`,
    `참조 답변: ${qa.refAnswer}`,
    `원문 인용(앵커): ${qa.anchorQuote}`,
    `후보 답변: ${candidateAnswer}`,
  ].join("\n");
  return { system, prompt, maxTokens: 20 };
}

/** grader의 원시 출력을 판정으로 바꾼다 — 응답 **전체**가 CORRECT 한 단어여야 정답이다(B5, 보수 채점).
 * 예전엔 접두사만 봐서 "CORRECT? No, WRONG." 같은 모순 응답이 정답으로 집계됐다. 앞뒤 공백·마크다운 강조·따옴표·
 * 마침표만 벗기고("**CORRECT**", "Correct.") 나머지는 전부 WRONG — 설명이 붙었거나 두 단어가 다 있으면 판정
 * 불가로 보고 통과시키지 않는다(가드레일 1). */
export function parseGradeVerdict(raw: string): "correct" | "wrong" {
  const normalized = raw
    .trim()
    .replace(/^[\s*_`"'“”‘’]+/u, "")
    .replace(/[\s*_`"'“”‘’.!]+$/u, "")
    .toUpperCase();
  return normalized === "CORRECT" ? "correct" : "wrong";
}
