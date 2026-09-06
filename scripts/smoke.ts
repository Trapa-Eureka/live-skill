#!/usr/bin/env node
// 실 LLM 스모크 — 사람 전용(TESTING §5, CLAUDE.md 가드레일 3: 실 LLM 호출은 npm run smoke에만 허용).
//   npm run smoke [-- <문서 경로>]   # 기본은 samples/manual.pdf
// 로직은 src/cli/smoke.ts(runSmoke)에 있다 — 여긴 src/cli/index.ts와 같은 원칙으로 실 어댑터 조립만
// 한다. tests/smoke.test.ts는 이 파일이 아니라 runSmoke를 ScriptedLlm으로 대신 돌린다(dry 구조 테스트).
import { join } from "node:path";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { readSourceFile } from "../src/adapters/fsTargets.js";
import { ClaudeLlmProvider } from "../src/adapters/llmProvider.js";
import { runSmoke } from "../src/cli/smoke.js";
import { loadConfig } from "../src/core/index.js";

try {
  process.loadEnvFile();
} catch {
  /* .env 없음 — 무시 */
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.error(
    "ANTHROPIC_API_KEY가 설정되지 않았습니다. 수정 방법: .env.example을 .env로 복사하고 키를 채우세요.",
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
