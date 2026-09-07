# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-07

First public release, published to npm as `live-skills`.

### Added

- `compile`: turns text PDF, DOCX, Markdown/TXT, and HTML sources (files, folders, globs) into an Agent Skills-standard skill: `SKILL.md` index, chapters with source anchors, `glossary.md`, `patterns.md`, `cheatsheet.md`, and a `manifest.json` with source and output hashes.
- Quality gate: golden question/answer pairs are generated from the source sections, answered using only the compiled skill files (index first, then one chapter), and graded conservatively against the source. The skill is deployed only when the pass rate meets the threshold (0.9 by default, floor 0.5); otherwise it is kept in a temporary directory with a report naming the weak chapters.
- `validate` (structure check, no LLM calls), `report` (prints the last gate report), and `eval` (re-grades an existing skill, optionally against changed sources).
- Cost and safety limits: `MAX_LLM_CALLS` enforced during the run, input size limits, parser timeouts, prompt data/instruction boundaries, and stale/tampered detection for compiled output.
- Claude as the default LLM provider via `ANTHROPIC_API_KEY`; the automated test suite runs against a scripted mock LLM with no network access.

[0.1.0]: https://github.com/Trapa-Eureka/live-skill/releases/tag/v0.1.0
