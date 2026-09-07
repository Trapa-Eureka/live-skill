# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-09-07

Documentation-only release so the npm page matches the repository README.

### Changed

- README restructured: a Features section, a "Where live-skills can be used" section organized by field (collapsible groups), the 60-second demo section removed, and the Status section reduced to the essentials. The Korean README mirrors the same structure. No code changes.

## [0.1.1] - 2026-09-07

Patch release: the first real-LLM runs after 0.1.0 exposed three defects that made `compile` fail on real input (DESIGN §4 L2–L4). 0.1.0 fails at the outline step; upgrade.

### Fixed

- Outline and qaGen responses wrapped in a ```json code fence or surrounded by a sentence are now parsed (the envelope is stripped; the strict schema check is unchanged).
- Section ids copied with the `§` marker from the prompt header (`§overview`, `[§overview]`) are normalized to the bare id before the coverage check, and the outline prompt asks for bare ids.
- Golden-question anchors are now the shortest fact-bearing span (a value with its unit, an identifier, a named step) instead of whole sentences, and the distillation prompt keeps figures, units, addresses, identifiers, commands, and component names verbatim, so distilled chapters no longer fail the verbatim anchor check merely by paraphrasing.
- `outline_invalid` failures name the reason (`not valid JSON (…)` or `schema: <path>: <rule>`) instead of a bare "doesn't match the expected schema".

## [0.1.0] - 2026-09-07

First public release, published to npm as `live-skills`.

### Added

- `compile`: turns text PDF, DOCX, Markdown/TXT, and HTML sources (files, folders, globs) into an Agent Skills-standard skill: `SKILL.md` index, chapters with source anchors, `glossary.md`, `patterns.md`, `cheatsheet.md`, and a `manifest.json` with source and output hashes.
- Quality gate: golden question/answer pairs are generated from the source sections, answered using only the compiled skill files (index first, then one chapter), and graded conservatively against the source. The skill is deployed only when the pass rate meets the threshold (0.9 by default, floor 0.5); otherwise it is kept in a temporary directory with a report naming the weak chapters.
- `validate` (structure check, no LLM calls), `report` (prints the last gate report), and `eval` (re-grades an existing skill, optionally against changed sources).
- Cost and safety limits: `MAX_LLM_CALLS` enforced during the run, input size limits, parser timeouts, prompt data/instruction boundaries, and stale/tampered detection for compiled output.
- Claude as the default LLM provider via `ANTHROPIC_API_KEY`; the automated test suite runs against a scripted mock LLM with no network access.

[0.1.2]: https://github.com/Trapa-Eureka/live-skill/releases/tag/v0.1.2
[0.1.1]: https://github.com/Trapa-Eureka/live-skill/releases/tag/v0.1.1
[0.1.0]: https://github.com/Trapa-Eureka/live-skill/releases/tag/v0.1.0
