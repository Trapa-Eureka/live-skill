# CLAUDE.md — live-skill steering

An npm CLI that compiles documents into verified agent skills. v0.1 = compile + quality gate. The spec is `docs/SPEC.md`, the design is `docs/DESIGN.md`. **This repository is a public portfolio: keep everything at delivery quality.**

## Stack

- Node.js 22.12+ (I2, 2026-09-07: the minimum required by commander 15 and pdf-parse; the earlier "20+" was outside what the dependencies support), TypeScript **strict** (including `noUncheckedIndexedAccess`), distributed as an npm CLI (`bin`)
- Extraction: `pdf-parse` (text PDFs), `mammoth` (DOCX), direct UTF-8 read (MD/TXT), `cheerio` + conversion (HTML); same extractor signature convention as the message repo (portable)
- LLM: own `LlmProvider` interface; Claude by default (`ANTHROPIC_API_KEY`), model string from env
- Output: Agent Skills standard (SKILL.md + supporting files), deterministic template assembly
- Verification: Vitest + ESLint + Prettier; schemas with `zod`

## Commands

```bash
npm run check      # typecheck + lint + test in one go: the mandatory gate for finishing a task
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run cli -- <compile|validate|eval|report> ...   # CLI via tsx
npm run smoke      # compile + gate one sample with the real LLM (human only)
```

## Source layout

```
src/
  core/        # pure logic: outline/distill planning, assembler (templates), validator (structure), gate (evaluation harness), manifest; no external IO
  adapters/    # extractors/, llmProvider (claude), fsTargets (claude/agents/copilot skill directories)
  mocks/       # ScriptedLlm (script playback), FixtureExtractor, FixedClock
  cli/         # compile.ts, validate.ts, eval.ts, report.ts: assembly only
samples/       # self-authored sample documents (smoke, demo)
tests/  fixtures/docs/  scripts/
```

## Conventions

- The source of truth for the skill output structure, token budgets, and gate rules is `docs/DESIGN.md` §3–§5. When code and docs disagree, the docs win.
- All external IO (extraction, LLM, file writes, clock) sits behind interfaces. `core/` does pure computation and planning only.
- No `any`. LLM responses, CLI arguments, and the manifest are parsed with `zod` at the boundary.
- Assembly (assembler) and structural validation (validator) are **deterministic, with no LLM**; the LLM is used only for distillation, question generation, and grading.
- Error messages state the cause and how to fix it.
- Commit messages: `T{n}: summary`, **written in English** (since 2026-09-06; earlier commits were rewritten retroactively).
- **Everything is English** (since 2026-09-07): no Korean in the comments, strings, CLI messages, LLM prompts, output templates, or test names of `src/`, `tests/`, `scripts/`, `fixtures/`, the config files, `docs/`, or this file. The only exceptions are **test input data** that exercises CJK handling (each with an English comment saying why) and `README.ko.md`, the Korean-language README. The prompts instruct the model to write its output in the source document's language (DESIGN §4 L1).

## Guardrails (never violate)

1. **Never weaken the quality gate**: no change that lowers a threshold or excludes failing cases to get a pass. The right response to a gate failure is better distillation or returning the report. Thresholds and rules change only through SPEC/DESIGN edits.
2. **Answerer isolation**: the gate's answer simulator uses only the compiled output (the loaded files) as context. No shortcuts that smuggle in the source text or the whole skill; an isolation breach makes the gate meaningless.
3. **Zero network or real-LLM calls in tests.** ScriptedLlm and fixtures only. The real LLM is used only by `npm run smoke`.
4. **Fixtures and samples are self-authored documents only.** Never put copyrighted text (real books, articles, and so on) into fixtures/samples.
5. File writes only inside the designated out directory (the skill target or `--out`). Overwriting an existing skill is refused without `--force`.
6. **Respect the cost caps**: when a compile would exceed the LLM call count or token budget (config), suggest splitting the input or stop with guidance. No bypass flag.
7. Secrets only in `.env` (`.env.example` is committed). Never dump keys or large amounts of source text into logs.

## Way of working

- One session = one task from `docs/TASKS.md`. Self-correct until every completion criterion is met and `npm run check` passes. Ask only when the spec is ambiguous.
- On completion, summarize the changed files and the verification results, then stop.
- When a task is done, commit (in English) → push → PR → squash merge into `main` proceeds automatically without approval; afterwards both local checkouts (the current worktree and `/Volumes/DevWork/work/live-skill`) are synchronized with GitHub immediately. **Starting the next task always requires the user's consent first** (agreed 2026-09-06).

## Pruning log

Reviewed every two weeks; stale rules are deleted (`docs/WORKFLOW.md`).

- 2026-09-06: first version.
- 2026-09-06: commit messages switched to English (3 existing commits rewritten); per-task automatic push/PR/merge, plus the rule that the next task starts only after approval.
- 2026-09-07: the entire source tree switched to English (comments, strings, prompts, templates, tests; 87 files at once); "source is English only" convention added.
- 2026-09-07: `docs/` and this file switched to English as well; the convention now covers the whole repository except `README.ko.md`.
