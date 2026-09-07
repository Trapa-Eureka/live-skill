// Tag convention for the 5 LLM roles (TESTING §1: outline, distill, qaGen, answerer, grader).
// core/prompts.ts attaches the tag and mocks/scriptedLlm.ts identifies the role from it (TESTING §2,
// "identify by the system prompt tag"). Pure.
export const PROMPT_ROLES = ["outline", "distill", "qaGen", "answerer", "grader"] as const;
export type PromptRole = (typeof PROMPT_ROLES)[number];

const ROLE_TAG_RE = /^\[live-skill:(outline|distill|qaGen|answerer|grader)\]/u;

export function promptRoleTag(role: PromptRole): string {
  return `[live-skill:${role}]`;
}

/** Reads the role tag at the start of a system prompt. undefined when there is no tag or the role is
 * unknown. */
export function detectPromptRole(system: string): PromptRole | undefined {
  const match = ROLE_TAG_RE.exec(system);
  const role = match?.[1];
  return role === undefined ? undefined : (role as PromptRole);
}
