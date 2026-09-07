#!/usr/bin/env node
// Real-LLM smoke, human-only (TESTING §5, CLAUDE.md guardrail 3: real LLM calls are allowed only in
// npm run smoke).
//   npm run smoke [-- <document path>]   # defaults to samples/manual.pdf
// The logic lives in src/cli/smoke.ts (runSmoke); this file only assembles the real adapters, on the
// same principle as src/cli/index.ts. tests/smoke.test.ts does not run this file; it drives runSmoke
// with a ScriptedLlm instead (dry structural test).
import { join } from "node:path";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { readSourceFile } from "../src/adapters/fsTargets.js";
import { ClaudeLlmProvider } from "../src/adapters/llmProvider.js";
import { runSmoke } from "../src/cli/smoke.js";
import { loadConfig } from "../src/core/index.js";

try {
  process.loadEnvFile();
} catch {
  /* no .env, ignore */
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.error(
    "ANTHROPIC_API_KEY is not set. Fix: copy .env.example to .env and fill in the key.",
  );
  process.exit(1);
}

const config = loadConfig(process.env);
const path = process.argv[2] ?? join(process.cwd(), "samples", "manual.pdf");

process.exitCode = await runSmoke(
  { path },
  {
    out: (line) => {
      console.log(line);
    },
    readSourceFile,
    extractors: createExtractors(),
    llm: new ClaudeLlmProvider({ apiKey, model: config.model }),
    clock: { now: () => new Date() },
    config,
  },
);
