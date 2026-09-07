# TESTING — live-skill

Purpose: prove the compile plumbing and the **discriminating power of the gate** with local determinism, without a real LLM. "Does the gate actually catch bad skills?" is this product's hypothesis, so that proof is the center of the test suite.

## 1. Principles

- Zero network and real-LLM calls in tests. All 5 LLM roles (outline, distill, qaGen, answerer, grader) run entirely on `ScriptedLlm` scripts.
- Assembly, structural validation, manifest, and anchor checks are deterministic, so they are pinned down with snapshots and hashes.
- Fixtures and samples are **self-authored documents only** (no copyrighted text — CLAUDE.md guardrail 4).
- `npm run check` = typecheck + lint + test, within seconds. The real LLM is used only in `npm run smoke`.

## 2. Mock and Fixture Setup

| Component | Content |
|---|---|
| `ScriptedLlm` | Role-routed scripts (the role is identified by a tag in the system prompt) + sequential playback + `assert_exhausted`. Fails clearly on exhaustion or mismatch |
| `script()` builder | Assembled in the style of `script().outline({...}).distill("ch01", ...).qa(...).answer(...).grade("correct")` |
| `FixtureExtractor` | Extension → fixed ExtractedDoc. The real extractors (pdf-parse/mammoth) are unit-tested separately with self-authored sample files |
| fixtures/docs/ | 3 self-authored samples: `manual/` (technical-manual style, 12 sections), `regulation/` (regulation style, clause structure), `mixed-unicode/` (mixed English/Korean/Tagalog) + an empty document and a huge document for the budget-overrun case |
| `FixedClock` | Determinism of manifest timestamps |

## 3. Golden Cases (deterministic layer)

- assembler: fixed DistilledChapter input → the 5 output files match their snapshots; token budget calculation verified
- Anchor check: a QA item whose `anchorQuote` is not in the source → discard and regenerate once → a section that still has 0 valid items is **unverified** (`qa_generation_failed`, cannot pass the gate); the shortfall is recorded in `coverage` (B2 — the earlier "exclude the item" behavior conflicted with guardrail 1 and was dropped)
- manifest: compiling the same input twice → identical section hashes and chapterFile mapping / section id stability (heading-path slugs) verified
- validator: detects over-budget chapters, broken links, and the warning for the ratio of sentences without anchors, each separately

## 4. Mandatory Edge-Case Checklist

**Gate discriminating power (proof of the product hypothesis — do not delete or relax)**
- [ ] Normal script: uncorrupted distillation + correct-answer script → passRate 1.0, deployed
- [ ] **Missing-chapter injection**: remove one chapter from assembly → that section's QA fails with `not_found` → below threshold → not deployed + weak chapter named
- [ ] **Wrong-answer distillation injection**: invert a key figure in a chapter body → the grader script detects the anchor contradiction → not deployed
- [ ] Threshold boundary: exactly 90% → pass / one item short → fail (floating-point handling)
- [ ] `--no-gate` → deployed, but SKILL.md carries the unverified marker and manifest.gate = skipped
- [ ] **Question-generation failure injection (B2)**: qaGen for one chapter fails both times → not passed even if every remaining item is correct + `qa_generation_failed` recorded + `coverage.generated = 0`

**answerer isolation**
- [ ] The test fails if the answerer context contains the source or unselected chapters (inspection of the injected payload)
- [ ] The load history is recorded in the report

**Pipeline and CLI**
- [ ] Empty document → a rejection that includes how to fix it / unsupported format (.xlsx) → guidance listing the supported formats
- [ ] Huge document exceeding the budget → split suggestion and abort (no bypass)
- [ ] MAX_LLM_CALLS cap: the number of script calls matches the cap formula (cost-leak guard)
- [ ] GATE_THRESHOLD lower bound (B4): `0` and `0.49` → configuration error (cause + fix); a whitespace-only value → default 0.9 / 0 questions → not passed regardless of the threshold
- [ ] Refuses to overwrite an existing skill directory without `--force` / no write attempts outside `--out`
- [ ] `eval` works through the path that reuses the existing QA in the manifest
- [ ] Mixed-Unicode sample: anchor string check and assembly integrity
- [ ] Exit code 1 when the gate fails; `report` prints the last report
- [ ] Manifest semantic validation (B6): `passed=true` with `passRate=0`, `correct>asked`, aggregate mismatch, a failed qaId absent from the load history, `chapterFile ∉ outputs`, non-ISO `createdAt`, non-hex hash → `readManifest` rejects (with a human-readable message) / the actual manifest written by compile passes unchanged

**Real extractors (sample files)**
- [ ] One self-authored PDF/DOCX/MD/HTML each: accuracy of section heading structure extraction

## 5. Manual Smoke (humans only — scripts/smoke.ts)

`npm run smoke`: compile `samples/manual.pdf` once with the real Claude → print the gate report → a human checks the pass rate and the plausibility of the weak chapters, and records threshold/k tuning notes in SPEC §8.

## 6. Coverage

- `src/core/` 90% or higher (T9 report). Adapters and CLI are supplemented by the smoke run.
