# SPEC — live-skill v0.1

Written: 2026-09-06. Status: final (when anything changes, update this document first).

## 1. Background and Competitive Landscape

As Agent Skills (the Agent Skills standard, published by Anthropic on 2025-12-18, spec at agentskills.io) became established as a format for transferring knowledge, the "compile documents into skills" category opened up, and its leading representative, book-to-skill (Python, MIT, 12,000+ GitHub stars), proved the market. A re-survey on 2026-09-06 found that tools in the same category, such as doc2skill, skill-compiler (AgentCompiler), and agent-compiler, were already registered on npm in numbers, so the category was more crowded than expected. However, every tool surveyed is a **one-shot compile of a static source**: when the source changes, a person has to fold it back in by hand, and there is no semantic-level verification layer that checks whether the produced skill actually answers questions about the source correctly. The detailed competitor list, application areas, and scale analysis are in `docs/MARKET.md`.

live-skill is a **separate new product** (informed by those tools but sharing no code; TS/npm) that makes those two gaps the axes of the product.

**Defensibility order (agreed)**: 4 (domain packs, sibling repo) > 2 (quality gate) > 1 and 3 (watcher and MCP: these are features, hence imitable, and serve a first-mover effect). Therefore v0.1 completes layer 2 first, to establish the identity of "a compiler you can trust". None of the competing tools surveyed has a semantic verification layer, so the market research reconfirmed the basis for this order (`docs/MARKET.md` §2).

## 2. Layer Structure and Version Mapping

| Layer | Content | Version |
|---|---|---|
| 0 Compile | Document/folder → SKILL.md + chapters + glossary + patterns + cheatsheet | v0.1 |
| 2 Quality gate | Automatic golden Q&A extraction → answer using the skill alone → grade → deploy only when the threshold is met | v0.1 |
| 1 Automatic recompile | Source watcher + manifest-hash-based incremental update ("subscription") | v0.2 |
| 3 Dual serving | Expose the same output through an MCP server as well (`serve`) | v0.3 |
| (4) PH skill pack | The first content product produced with this engine — **sibling repo**, out of scope for this repo | in parallel with v0.2 |

## 3. v0.1 Goals

1. **Compile**: `live-skill compile <file|folder|glob>` → produces a skill in the Agent Skills standard. Formats: text-based PDF, DOCX, MD/TXT, HTML. Target directories: `~/.claude/skills/` (default), `~/.agents/skills/`, or any `--out`.
2. **Quality gate (on by default)**: generate golden Q&A per section (quoting a source anchor is mandatory) → answer with an **answerer simulator that loads only the produced skill files** (reproducing the SKILL.md index → progressive loading of the relevant chapters) → grade by rubric plus anchor match → deploy if pass rate ≥ threshold (default 90%); otherwise do not deploy, and return a report that names the weak chapters. `--no-gate` exists, but the output is left marked "unverified".
3. **manifest**: record per-source-section content hashes, the mapping to output files, and the gate result in `manifest.json` — the seed for incremental recompilation in v0.2.
4. **Reproducibility**: same input + same distillation result → same assembled output (assembler determinism). Built-in cost guard (caps on call count and tokens).
5. Auxiliary commands: `validate` (structural validation only), `eval` (re-grade an existing skill), `report` (print the last gate report).

## 4. v0.1 Non-Goals

- Watcher, incremental recompilation, URL subscription — v0.2 (prepared only through the manifest design)
- MCP serving — v0.3 / EPUB, MOBI, scanned OCR — after v0.2 / multilingual glossary — later
- PH skill pack content — sibling repo / skill-market publishing automation (npx skills add-compatible publishing) — v0.4
- Reusing book-to-skill code — not done (standard compatibility of the output structure only)

## 5. Representative Scenarios

1. **Technical manual → skill**: a 200-page internal equipment manual PDF → compile → gate passes at 94% → Claude Code answers questions about that equipment with chapter evidence.
2. **SOP folder → team skill**: a folder of 30 Markdown files → a single skill → the gate report identifies 2 weak chapters → the source is strengthened and recompiled.
3. **Regulatory documents → skill (precursor of the pack)**: a bundle of public regulation PDFs → skill → the manual version of the flow that in v0.2 becomes revision detection and automatic update.

## 6. Success Criteria (v0.1 completion verdict)

- Compile 3 self-authored samples (manual-style, regulation-style, mixed Unicode) → the e2e-mock that produces gate reports passes.
- **Proof of gate validity**: a test passes in which the gate catches deliberately corrupted distillation (missing chapter, injected wrong answer) as falling below the threshold — this test is the evidence for the product hypothesis.
- Recompiling the same input yields identical manifest hashes (assembly determinism).
- `npm run check` passes; `src/core/` coverage 90% or higher. One real-LLM smoke run (sample manual) with its gate report reviewed.

## 7. Roadmap

| Version | Content | Prerequisite |
|---|---|---|
| v0.1 | Compile + quality gate + manifest + 4 CLI commands | — |
| v0.2 | `watch`/`update` (incremental recompile), URL and drive sources, start of ph-skill-pack | v0.1 verified |
| v0.3 | `serve` (MCP dual serving), EPUB | — |
| v0.4 | npm publish, skills add-compatible publishing, English README and demo, GHA CI | name finalized |

## 8. Open Items

- [x] npm package name availability survey completed (2026-09-06, T11): re-checked `live-skill` and `live-skills`, both still unregistered (as of 2026-09-06); as the second candidate, additionally surveyed `skill-gate` (reflects the quality-gate differentiator directly in the name; confirmed unregistered) — this satisfies the "two candidates" the SPEC required. `skillgate` (no hyphen) is already registered and was excluded from the candidates. **The final decision is made by a human immediately before the actual `npm publish`** (WORKFLOW §4, `docs/PUBLISHING.md` §3-1) — npm names are first come, first served, so a re-check is needed at that point. Details: `docs/PUBLISHING.md` §0. **Finalized 2026-09-07: `live-skills`** (human decision; a re-check immediately before publishing confirmed both `live-skill` and `live-skills` unregistered). `package.json.name`, `bin`, and the CLI display name are all `live-skills`; the GitHub repository name stays `live-skill`.
- [x] Gate default threshold 90% and questions per section k=3 — human decision on 2026-09-07: the current defaults are confirmed as they are, without a real-LLM smoke run (which costs money). Tuning will be revisited once gate reports from real use have accumulated (the lower bound of 0.5 is DESIGN §7 B4). The same day, a human ran the real smoke 4 times (3 failures caused by the outline JSON envelope, the `§` marker, and sentence-level anchors → DESIGN §4 L2, L3, L4 fixes), after which `samples/manual.pdf` passed at 11/12 (91.7%) with the defaults unchanged — the measured basis for keeping the defaults.
- [ ] Weighting of the dual grader (rubric LLM + anchor string match)
- [ ] Target directory priority (claude/agents/copilot) and whether to auto-detect
