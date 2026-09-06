// 설정 — 예산·게이트 임계치·k(섹션당 질문 수)·LLM 호출 상한(DESIGN §7). env 병합은 이 파일이 결정론으로
// 처리한다: 실제 .env 파일 읽기(IO)는 adapters/ 몫, 여기서는 이미 병합된 env 레코드를 받아 파싱만 한다.
import { z } from "zod";
import { DEFAULT_THRESHOLD, GATE_THRESHOLD_FLOOR } from "./gateVerdict.js";

const DEFAULT_BUDGETS = {
  skillMd: 4000,
  chapter: 1000,
  glossary: 1500,
  patterns: 2000,
  cheatsheet: 1000,
} as const;

const budgetsSchema = z
  .object({
    skillMd: z.number().int().positive().default(DEFAULT_BUDGETS.skillMd),
    chapter: z.number().int().positive().default(DEFAULT_BUDGETS.chapter),
    glossary: z.number().int().positive().default(DEFAULT_BUDGETS.glossary),
    patterns: z.number().int().positive().default(DEFAULT_BUDGETS.patterns),
    cheatsheet: z.number().int().positive().default(DEFAULT_BUDGETS.cheatsheet),
  })
  .default(DEFAULT_BUDGETS);

const configSchema = z.object({
  anthropicApiKey: z.string().min(1).optional(),
  model: z.string().min(1).default("claude-sonnet-4-5"),
  // B4(DESIGN §7): 하한은 정책이다 — 0으로 두면 질문 0개·정답 0개도 unverified 표시 없이 "통과"하던 구멍.
  gateThreshold: z
    .number()
    .min(GATE_THRESHOLD_FLOOR, {
      message: `GATE_THRESHOLD must be at least ${String(GATE_THRESHOLD_FLOOR)} (product policy, DESIGN §7). Fix: set it between ${String(GATE_THRESHOLD_FLOOR)} and 1, or remove it to use the default ${String(DEFAULT_THRESHOLD)}.`,
    })
    .max(1, {
      message: `GATE_THRESHOLD must be at most 1. Fix: set it between ${String(GATE_THRESHOLD_FLOOR)} and 1, or remove it to use the default ${String(DEFAULT_THRESHOLD)}.`,
    })
    .default(DEFAULT_THRESHOLD),
  qaPerSection: z.number().int().positive().default(3),
  maxLlmCalls: z.number().int().positive().default(300),
  budgets: budgetsSchema,
});

export type Budgets = z.infer<typeof budgetsSchema>;
export type Config = z.infer<typeof configSchema>;

/** loadConfig가 받는 최소 env 형태 — DESIGN §7의 5개 변수(.env.example과 일치). */
export interface EnvLike {
  ANTHROPIC_API_KEY?: string | undefined;
  MODEL?: string | undefined;
  GATE_THRESHOLD?: string | undefined;
  QA_PER_SECTION?: string | undefined;
  MAX_LLM_CALLS?: string | undefined;
}

/**
 * env 문자열을 숫자로 변환한다. 값이 없으면(undefined/빈 문자열) undefined를 돌려줘 zod 기본값이 적용되게
 * 하고, 값이 있는데 숫자가 아니면 원인+수정 방법을 담은 에러를 즉시 던진다(CLAUDE.md 컨벤션) — 잘못 설정한
 * 값을 조용히 기본값으로 덮어버리면 사용자가 오설정을 알아챌 수 없다.
 */
function parseNumberEnv(name: string, raw: string | undefined): number | undefined {
  // 공백만 있는 값도 미설정이다 — Number("  ")는 0이라 GATE_THRESHOLD가 조용히 0이 되던 구멍(B4).
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(
      `${name} must be a number, got "${trimmed}". Fix: set ${name} to a valid number in .env, or remove it to use the default.`,
    );
  }
  return n;
}

/** 빈 문자열·공백만 있는 값도 "미설정"으로 취급해 undefined로 정규화한다(parseNumberEnv와 동일 규약). */
function emptyToUndefined(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** env 레코드를 검증된 Config로 파싱한다. 범위를 벗어난 값(예: GATE_THRESHOLD=0.3 또는 1.5)은 원인+수정
 * 방법을 담은 일반 Error로 거부한다 — zod 원시 오류를 CLI 사용자에게 그대로 보이지 않기 위해. */
export function loadConfig(env: EnvLike): Config {
  const result = configSchema.safeParse({
    anthropicApiKey: emptyToUndefined(env.ANTHROPIC_API_KEY),
    model: emptyToUndefined(env.MODEL),
    gateThreshold: parseNumberEnv("GATE_THRESHOLD", env.GATE_THRESHOLD),
    qaPerSection: parseNumberEnv("QA_PER_SECTION", env.QA_PER_SECTION),
    maxLlmCalls: parseNumberEnv("MAX_LLM_CALLS", env.MAX_LLM_CALLS),
  });
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid configuration — ${detail}`);
  }
  return result.data;
}
