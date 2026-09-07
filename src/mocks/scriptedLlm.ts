// ScriptedLlm: a mock that verifies the pipeline without real LLM calls (TESTING §1-§2). Routes on
// the role tag of the system prompt (core/promptRole.ts) and replays per role in order. Script
// exhaustion and role mismatch fail with clear errors.
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
  /** When set, this turn rejects with this error instead of responding (G1: provider failure
   * injection). */
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
    // Shallow copy: consuming entries must not touch the caller's original arrays.
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

  /** Checks that every role's script is exhausted; leftovers mean the test scripted more responses
   * than the actual calls. */
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

/** Builder that fills a ScriptedLlm in order (TESTING §2): script().outline({...}).distill("ch01", "...")… */
export class ScriptBuilder {
  private readonly queues: Queues = emptyQueues();

  outline(plan: SkillPlan, label?: string): this {
    this.queues.outline.push({ label, value: JSON.stringify(plan) });
    return this;
  }

  /** Puts a pre-built raw JSON string into the script as-is (for mimicking a malformed response that
   * breaks the schema). */
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

  /** Puts a raw string into the qaGen queue as-is (for mimicking a malformed response that breaks the
   * schema). */
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

  /** Rejects the role's next turn with error instead of a response; mimics a provider failure such as
   * a rate limit (G1). */
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
