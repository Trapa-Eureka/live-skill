// 설정 — 예산·게이트 임계치·k(섹션당 질문 수)·LLM 호출 상한(DESIGN §7). env 병합은 이 파일이 결정론으로
// 처리한다: 실제 .env 파일 읽기(IO)는 adapters/ 몫, 여기서는 이미 병합된 env 레코드를 받아 파싱만 한다.
import { z } from "zod";

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
  gateThreshold: z.number().min(0).max(1).default(0.9),
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
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(
      `${name} must be a number, got "${raw}". Fix: set ${name} to a valid number in .env, or remove it to use the default.`,
    );
  }
  return n;
}

/** 빈 문자열도 "미설정"으로 취급해 undefined로 정규화한다(숫자 필드의 parseNumberEnv와 동일 규약). */
function emptyToUndefined(raw: string | undefined): string | undefined {
  return raw === undefined || raw === "" ? undefined : raw;
}

/** env 레코드를 검증된 Config로 파싱한다. 범위를 벗어난 값(예: GATE_THRESHOLD=1.5)은 zod가 거부한다. */
export function loadConfig(env: EnvLike): Config {
  return configSchema.parse({
    anthropicApiKey: emptyToUndefined(env.ANTHROPIC_API_KEY),
    model: emptyToUndefined(env.MODEL),
    gateThreshold: parseNumberEnv("GATE_THRESHOLD", env.GATE_THRESHOLD),
    qaPerSection: parseNumberEnv("QA_PER_SECTION", env.QA_PER_SECTION),
    maxLlmCalls: parseNumberEnv("MAX_LLM_CALLS", env.MAX_LLM_CALLS),
  });
}
