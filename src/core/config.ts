// Configuration: budgets, gate threshold, k (questions per section), LLM call cap (DESIGN §7).
// This file handles env merging deterministically: reading the actual .env file (IO) belongs to
// adapters/; here we receive the already-merged env record and only parse it.
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
  // B4 (DESIGN §7): the floor is policy. Set to 0, a gate with zero questions and zero correct
  // answers used to "pass" without the unverified marker.
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

/** User configuration (env) error. The CLI top-level boundary reports it as a "configuration
 * error" (G1). The message is cause + fix. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Budgets = z.infer<typeof budgetsSchema>;
export type Config = z.infer<typeof configSchema>;

/** The minimal env shape loadConfig accepts: the 5 variables of DESIGN §7 (matches .env.example). */
export interface EnvLike {
  ANTHROPIC_API_KEY?: string | undefined;
  MODEL?: string | undefined;
  GATE_THRESHOLD?: string | undefined;
  QA_PER_SECTION?: string | undefined;
  MAX_LLM_CALLS?: string | undefined;
}

/**
 * Converts an env string to a number. When the value is absent (undefined/empty string) it returns
 * undefined so the zod default applies; when a value is present but not numeric it throws a
 * cause + fix error immediately (CLAUDE.md convention). Silently replacing a misconfigured value
 * with the default would hide the misconfiguration from the user.
 */
function parseNumberEnv(name: string, raw: string | undefined): number | undefined {
  // A whitespace-only value counts as unset too: Number("  ") is 0, which used to make
  // GATE_THRESHOLD silently 0 (B4).
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new ConfigError(
      `${name} must be a number, got "${trimmed}". Fix: set ${name} to a valid number in .env, or remove it to use the default.`,
    );
  }
  return n;
}

/** Normalizes empty and whitespace-only values to undefined, treating them as "unset" (same
 * convention as parseNumberEnv). */
function emptyToUndefined(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** Parses an env record into a validated Config. Out-of-range values (e.g. GATE_THRESHOLD=0.3 or
 * 1.5) are rejected with a plain Error carrying cause + fix, so raw zod errors never reach the CLI
 * user. */
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
    throw new ConfigError(`invalid configuration — ${detail}`);
  }
  return result.data;
}
