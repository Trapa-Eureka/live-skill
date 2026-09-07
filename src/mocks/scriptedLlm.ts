// ScriptedLlm — 실 LLM 호출 없이 파이프라인을 검증하는 목(TESTING §1~§2). system 프롬프트의 역할 태그로
// 라우팅하고(core/promptRole.ts), 역할별로 순차 재생한다. 대본 소진·역할 불일치는 명확한 에러로 실패한다.
import type { LlmProvider, PromptRole, SkillPlan } from "../core/index.js";
import { PROMPT_ROLES, detectPromptRole } from "../core/index.js";

export class ScriptExhaustedError extends Error {
  constructor(role: PromptRole, label?: string) {
    super(
      `ScriptedLlm: script exhausted for role "${role}"` +
        (label === undefined ? "" : ` (expected next: "${label}")`) +
        " — no more scripted responses queued for this role",
    );
    this.name = "ScriptExhaustedError";
  }
}

export class UnknownRoleError extends Error {
  constructor(system: string) {
    super(
      `ScriptedLlm: no known role tag at the start of the system prompt: ${JSON.stringify(system.slice(0, 80))}`,
    );
    this.name = "UnknownRoleError";
  }
}

interface ScriptEntry {
  label?: string | undefined;
  value: string;
  /** 있으면 이 차례에 응답 대신 이 오류로 거부한다(G1 — provider 실패 주입). */
  error?: Error | undefined;
}

export interface RecordedCall {
  role: PromptRole;
  system: string;
  prompt: string;
  maxTokens: number;
}

type Queues = Record<PromptRole, ScriptEntry[]>;

function emptyQueues(): Queues {
  return { outline: [], distill: [], qaGen: [], answerer: [], grader: [] };
}

export class ScriptedLlm implements LlmProvider {
  private readonly queues: Queues;
  readonly calls: RecordedCall[] = [];

  constructor(queues: Queues) {
    // 얕은 복사 — 소비해도 호출자가 만든 원본 배열을 건드리지 않는다.
    this.queues = emptyQueues();
    for (const role of PROMPT_ROLES) this.queues[role] = [...queues[role]];
  }

  complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const role = detectPromptRole(req.system);
    if (role === undefined) return Promise.reject(new UnknownRoleError(req.system));
    this.calls.push({ role, ...req });
    const entry = this.queues[role].shift();
    if (entry === undefined) return Promise.reject(new ScriptExhaustedError(role));
    if (entry.error !== undefined) return Promise.reject(entry.error);
    return Promise.resolve(entry.value);
  }

  /** 모든 역할의 대본이 소진됐는지 확인한다 — 남아 있으면 테스트가 실제 호출보다 더 많은 대본을 준 것이다. */
  assertExhausted(): void {
    const leftover = PROMPT_ROLES.map((role) => [role, this.queues[role]] as const).filter(
      ([, entries]) => entries.length > 0,
    );
    if (leftover.length === 0) return;
    const detail = leftover
      .map(
        ([role, entries]) =>
          `${role}: ${String(entries.length)} unused (${entries.map((e) => e.label ?? "?").join(", ")})`,
      )
      .join("; ");
    throw new Error(`ScriptedLlm.assertExhausted: unused scripted responses remain — ${detail}`);
  }
}

/** ScriptedLlm을 순서대로 채우는 빌더 — TESTING §2: script().outline({...}).distill("ch01", "...")… */
export class ScriptBuilder {
  private readonly queues: Queues = emptyQueues();

  outline(plan: SkillPlan, label?: string): this {
    this.queues.outline.push({ label, value: JSON.stringify(plan) });
    return this;
  }

  /** 이미 완성된 원시 JSON 문자열을 그대로 대본에 넣는다(스키마를 깨뜨리는 잘못된 응답을 흉내낼 때 씀). */
  outlineRaw(raw: string, label?: string): this {
    this.queues.outline.push({ label, value: raw });
    return this;
  }

  distill(label: string, body: string): this {
    this.queues.distill.push({ label, value: body });
    return this;
  }

  qa(items: { question: string; refAnswer: string; anchorQuote: string }[], label?: string): this {
    this.queues.qaGen.push({ label, value: JSON.stringify({ items }) });
    return this;
  }

  /** qaGen 큐에 원시 문자열을 그대로 넣는다(스키마를 깨뜨리는 잘못된 응답을 흉내낼 때 씀). */
  qaRaw(raw: string, label?: string): this {
    this.queues.qaGen.push({ label, value: raw });
    return this;
  }

  selectChapter(file: string, label?: string): this {
    this.queues.answerer.push({ label, value: file });
    return this;
  }

  answer(text: string, label?: string): this {
    this.queues.answerer.push({ label, value: text });
    return this;
  }

  grade(verdict: "correct" | "wrong", label?: string): this {
    this.queues.grader.push({ label, value: verdict.toUpperCase() });
    return this;
  }

  /** 해당 역할의 다음 차례에 응답 대신 error로 거부한다 — provider 실패(rate limit 등)를 흉내낼 때(G1). */
  fail(role: PromptRole, error: Error, label?: string): this {
    this.queues[role].push({ label: label ?? `fail:${error.name}`, value: "", error });
    return this;
  }

  build(): ScriptedLlm {
    return new ScriptedLlm(this.queues);
  }
}

export function script(): ScriptBuilder {
  return new ScriptBuilder();
}
