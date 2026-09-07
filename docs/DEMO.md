# DEMO — 60-Second Demo Scenario

Written: 2026-09-06 (T11). Purpose: a script for recording. Uses self-authored samples only (guardrail 4) — `samples/manual.pdf` (the manual for the fictional device "SkillSync X200 (Fixture)"; it is the same file used by the real-LLM smoke in `docs/TESTING.md` §5, so the result is already verified).

**Prerequisites**: `npm install` completed, a real `ANTHROPIC_API_KEY` filled in `.env` (incurs cost — WORKFLOW §4, requires human approval). A terminal width of 100 columns or more is recommended.

## Timeline

| Time | Screen | Narration/caption |
|---|---|---|
| 0:00–0:08 | Empty terminal; briefly flip through the 4-page manual `samples/manual.pdf` in a viewer | "From this one document, we build a verified agent skill." |
| 0:08–0:10 | Switch to the terminal | Type `npm run cli -- compile samples/manual.pdf --out ./demo-skill` |
| 0:10–0:30 | Running (real LLM calls — extraction → outline → distillation → **quality gate**) | "It doesn't just compile. It automatically grades whether the skill it built actually answers questions about the source correctly." |
| 0:30–0:38 | Output: `Compiled: ./demo-skill` + gate report (`PASSED`, passRate, correct count per chapter) | "This is the heart of the project: if the pass rate is low, it never gets deployed in the first place." |
| 0:38–0:46 | `ls demo-skill` → `SKILL.md`, `chapters/`, `glossary.md`, `patterns.md`, `cheatsheet.md`, `manifest.json` | "The output follows the Agent Skills standard exactly, so Claude Code reads it right away." |
| 0:46–0:54 | `npm run cli -- report ./demo-skill` (the same report again, in a form a person can read) | "The gate result stays in `manifest.json`, so you can come back to it any time." |
| 0:54–1:00 | Logo / GitHub link card | "live-skill — not just generation, verified generation." |

## Commands to Run (copy as is)

```bash
npm run cli -- compile samples/manual.pdf --out ./demo-skill
ls demo-skill
npm run cli -- report ./demo-skill
rm -rf ./demo-skill   # clean up after recording — nothing is written outside --out (guardrail 5)
```

## If You Want to Add a Weak-Chapter Case (optional, +20 seconds)

Scenario 2 in `tests/e2e.test.ts` (SOP folder, one chapter deliberately wrong) is an automated test that already reproduces this flow with ScriptedLlm. To show the same picture with a real LLM, prepare a folder of two or more self-authored SOP documents, compile it, and show the temporary directory path and the report (the `Failed questions` list) that are printed when the gate falls short. This document takes only the passing case as the default 60-second scenario — the failure case is the extended version, added when you want to show that "the gate really does filter".

## References

- Report format and pass threshold: `docs/DESIGN.md` §4, §9
- Real-LLM verification history of this sample: `docs/TESTING.md` §5 (`npm run smoke`)
