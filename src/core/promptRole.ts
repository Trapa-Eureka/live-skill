// LLM 5역할 태그 규약(TESTING §1: outline·distill·qaGen·answerer·grader) — core/prompts.ts가 태그를 붙이고,
// mocks/scriptedLlm.ts가 이 태그로 역할을 판별한다(TESTING §2 "system 프롬프트 태그로 판별"). 순수.
export const PROMPT_ROLES = ["outline", "distill", "qaGen", "answerer", "grader"] as const;
export type PromptRole = (typeof PROMPT_ROLES)[number];

const ROLE_TAG_RE = /^\[live-skill:(outline|distill|qaGen|answerer|grader)\]/u;

export function promptRoleTag(role: PromptRole): string {
  return `[live-skill:${role}]`;
}

/** system 프롬프트 맨 앞의 역할 태그를 읽는다. 태그가 없거나 알 수 없는 역할이면 undefined. */
export function detectPromptRole(system: string): PromptRole | undefined {
  const match = ROLE_TAG_RE.exec(system);
  const role = match?.[1];
  return role === undefined ? undefined : (role as PromptRole);
}
