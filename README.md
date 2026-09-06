# live-skill

Compile documents, folders, or docsets into **verified** [Agent Skills](https://agentskills.io) — and back that verification with a semantic quality gate, not just a template pass.

**One-line positioning:** *book-to-skill is a snapshot; live-skill is a subscription — verified generation, not just generation.*

[한국어 문서](README.ko.md) · [License: MIT](LICENSE)

## Why this exists

Turning documents into [Agent Skills](https://agentskills.io) is an established category now — several tools already do the mechanical conversion (PDF/DOCX/Markdown/HTML → `SKILL.md` + supporting files). None of the ones we surveyed check whether the result is actually *correct*: whether an agent that loads only the compiled skill can answer real questions about the source material.

live-skill's compiler is built around a **quality gate**: after compiling, it generates golden question/answer pairs from your source sections, answers each one using *only* the compiled skill files (the same way an agent would load them — index first, then the relevant chapter), grades the answers against the source, and refuses to ship the skill if the pass rate falls under a threshold (90% by default). A failing run doesn't get silently deployed — it's written to a temp directory with a report pointing at exactly which chapter is weak.

## What's here (v0.1)

| Layer | What it does | Status |
|---|---|---|
| Compile | Document/folder → Agent Skills standard output (`SKILL.md` index + chapters + glossary + patterns + cheatsheet), deterministic assembly | v0.1 |
| Quality gate | Golden Q&A extraction → isolated answer simulation → grading → pass/fail threshold | v0.1 |
| Auto recompile | Source watcher + manifest-hash incremental updates ("subscription") | v0.2 (planned) |
| Dual serving | Same output also served as an MCP server | v0.3 (planned) |

Supported input formats: text PDF, DOCX, Markdown/TXT, HTML. Scanned/image PDFs (OCR) are out of scope for v0.1.

## Quickstart

```bash
npm install
cp .env.example .env              # fill in ANTHROPIC_API_KEY
npm run cli -- compile ./samples/manual.pdf --out ./my-skill
npm run cli -- validate ./my-skill     # structure check only, no LLM calls
npm run cli -- report ./my-skill       # print the last quality-gate report
npm run cli -- eval ./my-skill         # re-grade an existing skill
```

`compile` writes the skill to `--out` (or `~/.claude/skills/<slug>` / `~/.agents/skills/<slug>` by default) only if the quality gate passes. On failure it preserves the output in a temp directory instead, alongside a report naming the weak chapter(s).

## 60-second demo

See [`docs/DEMO.md`](docs/DEMO.md) for the full recorded-demo script (self-authored sample only). Short version:

```bash
npm run cli -- compile samples/manual.pdf --out ./demo-skill
npm run cli -- report ./demo-skill
```

## Real-LLM smoke test (human only, costs money)

```bash
npm run smoke   # compiles samples/manual.pdf with real Claude, prints the gate report + a call/token cost summary
```

Everything else — `npm run check` (typecheck + lint + test) — runs entirely against a scripted mock LLM. Zero network calls in the automated test suite; see `docs/TESTING.md`.

## Documentation

The internal design/spec/task docs under `docs/` are written in Korean (this is a solo project developed with an AI pairing workflow documented there) — but the interfaces are all TypeScript with English identifiers, and the code itself is the more precise reference for how any of this works. Start with `docs/SPEC.md` (product spec) and `docs/DESIGN.md` (technical design) if you want the full picture.

## Status

v0.1 (compile + quality gate + CLI) is implemented and tested; not yet published to npm. See `docs/SPEC.md` §7 for the roadmap.

## License

MIT — see [LICENSE](LICENSE).
