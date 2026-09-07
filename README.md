# live-skills

Compile documents, folders, or docsets into **verified** [Agent Skills](https://agentskills.io) — and back that verification with a semantic quality gate, not just a template pass.

**One-line positioning:** *book-to-skill is a snapshot; live-skills is a subscription — verified generation, not just generation.*

[한국어 문서](README.ko.md) · [License: MIT](LICENSE) · [npm](https://www.npmjs.com/package/live-skills) · [Changelog](CHANGELOG.md)

## Features

- **Compile documents into Agent Skills.** Text PDF, DOCX, Markdown/TXT, and HTML — a single file, a folder, or a glob — become one skill in the [Agent Skills](https://agentskills.io) layout: a `SKILL.md` index, one chapter file per topic with source anchors (`[§section-id]`) after every claim, plus `glossary.md`, `patterns.md`, and `cheatsheet.md` collected from the chapters. Assembly is deterministic: the same input and the same distillation always produce byte-identical files.
- **Quality gate before anything ships.** Golden question/answer pairs are generated from your source sections, each pinned to a verbatim quote. An isolated answerer then answers every question using only the compiled skill files (index first, then one chapter, exactly the way an agent loads a skill), a conservative grader scores the answers against the source, and the skill is deployed only if the pass rate meets the threshold (0.9 by default, never below 0.5). A failing skill is kept in a temporary directory with a report naming the weak chapters.
- **Verifiable output.** `manifest.json` records the source-section hashes, the chapter mapping, the golden Q&A, the gate report, and the hash of every output file, so `report` and `eval` can tell a stale or tampered skill from a fresh one.
- **`validate`, `report`, `eval`.** Check a skill's structure without any LLM call, print the last gate report, or re-grade an existing skill (against the stored questions, or against changed sources).
- **Cost and safety limits built in.** A per-compile cap on LLM calls (`MAX_LLM_CALLS`), input-size limits, parser timeouts, and a hard input-token ceiling; the compiler stops and tells you to split the input instead of silently truncating it. Untrusted text is passed to the model only inside data blocks the prompts refuse to treat as instructions; output is written only inside the target directory, and an existing skill is never overwritten without `--force`.
- **Speaks the document's language.** Prompts instruct the model to write titles, chapters, and questions in the language of the source, keeping its terminology verbatim.
- **Claude by default, mockable everywhere.** The LLM sits behind a small provider interface; the whole test suite runs against a scripted mock with zero network calls.

## Why this exists

Turning documents into [Agent Skills](https://agentskills.io) is an established category now — several tools already do the mechanical conversion (PDF/DOCX/Markdown/HTML → `SKILL.md` + supporting files). None of the ones we surveyed check whether the result is actually *correct*: whether an agent that loads only the compiled skill can answer real questions about the source material.

The live-skills compiler is built around a **quality gate**: after compiling, it generates golden question/answer pairs from your source sections, answers each one using *only* the compiled skill files (the same way an agent would load them — index first, then the relevant chapter), grades the answers against the source, and refuses to ship the skill if the pass rate falls under a threshold (90% by default). A failing run doesn't get silently deployed — it's written to a temp directory with a report pointing at exactly which chapter is weak.

## What's here (v0.1)

| Layer | What it does | Status |
|---|---|---|
| Compile | Document/folder → Agent Skills standard output (`SKILL.md` index + chapters + glossary + patterns + cheatsheet), deterministic assembly | v0.1 |
| Quality gate | Golden Q&A extraction → isolated answer simulation → grading → pass/fail threshold | v0.1 |
| Auto recompile | Source watcher + manifest-hash incremental updates ("subscription") | v0.2 (planned) |
| Dual serving | Same output also served as an MCP server | v0.3 (planned) |

Supported input formats: text PDF, DOCX, Markdown/TXT, HTML. Scanned/image PDFs (OCR) are out of scope for v0.1.

Requires Node.js 22.12 or newer (the floor set by the runtime dependencies; CI runs 22 and 24).

## Install and use

```bash
npm install -g live-skills            # or run it ad hoc: npx live-skills <command>
export ANTHROPIC_API_KEY=...          # or put it in a .env file in the working directory
live-skills compile ./manual.pdf --out ./my-skill   # compile + quality gate
live-skills validate ./my-skill       # structure check only, no LLM calls
live-skills report ./my-skill         # print the last quality-gate report
live-skills eval ./my-skill           # re-grade an existing skill
```

The npm package is `live-skills`; the GitHub repository is `Trapa-Eureka/live-skill`. Only `compile`, `eval`, and the smoke script call the LLM and need the API key.

## Quickstart from a clone

```bash
npm install
cp .env.example .env              # fill in ANTHROPIC_API_KEY
npm run cli -- compile ./samples/manual.pdf --out ./my-skill
npm run cli -- validate ./my-skill     # structure check only, no LLM calls
npm run cli -- report ./my-skill       # print the last quality-gate report
npm run cli -- eval ./my-skill         # re-grade an existing skill
```

`compile` writes the skill to `--out` (or `~/.claude/skills/<slug>` / `~/.agents/skills/<slug>` by default) only if the quality gate passes. On failure it preserves the output in a temp directory instead, alongside a report naming the weak chapter(s).

## Real-LLM smoke test (human only, costs money)

```bash
npm run smoke   # compiles samples/manual.pdf with real Claude, prints the gate report + a call/token cost summary
```

Everything else — `npm run check` (typecheck + lint + test) — runs entirely against a scripted mock LLM. Zero network calls in the automated test suite; see `docs/TESTING.md`.

## Documentation

The design, spec, task, and review documents under `docs/` are the working records of a solo project developed with an AI pairing workflow (documented in `docs/WORKFLOW.md`). Start with `docs/SPEC.md` (product spec) and `docs/DESIGN.md` (technical design, including the dated decision records) for the full picture; the code itself is the most precise reference for how any of this works. A Korean-language README is available as [README.ko.md](README.ko.md).

## Where live-skills can be used

Any body of text you have the rights to compile can become a skill; the gate then tells you how faithfully the skill reproduces it. The groups below expand to concrete examples. Two boundaries apply everywhere: v0.1 reads text-extractable sources only (no OCR), and the gate verifies fidelity to *your* document, not the correctness of the document itself.

<details>
<summary><b>Engineering and developer documentation</b> — API references, architecture records, runbooks</summary>

- SDK and API references, so a coding agent answers with the exact parameter names, defaults, and limits your docs state.
- Architecture decision records and design documents, giving an agent the "why" behind the codebase, with the record it came from.
- Runbooks, on-call playbooks, and incident post-mortems: step-by-step procedures land in `patterns.md`, decision rules in `cheatsheet.md`.
- Internal coding standards and review checklists that an agent can apply consistently.
</details>

<details>
<summary><b>Manufacturing, field service, and equipment</b> — manuals, maintenance procedures, safety notes</summary>

- Equipment and device manuals (the bundled sample is a fictional bench-top controller): installation limits, calibration steps, LED and error-code meanings.
- Maintenance and repair procedures, where a rewritten value ("five seconds", "500 mA", an address range) is exactly what the anchor check refuses to let slip.
- Safety instructions and lockout procedures that must survive distillation verbatim.
</details>

<details>
<summary><b>Operations and standard operating procedures</b> — SOP folders, onboarding, checklists</summary>

- A folder of SOPs compiled into one team skill; the per-chapter report shows which procedure is described too weakly to answer questions about.
- Onboarding and role handbooks, so a new hire's assistant answers from the current policy, not from a stale copy.
- Process checklists and approval rules that become quick-answer rules in `cheatsheet.md`.
</details>

<details>
<summary><b>Regulation, compliance, and policy</b> — policy bundles, regulatory PDFs, standards</summary>

- Internal policies (security, data handling, expenses) compiled with anchors back to the clause they come from.
- Bundles of public regulations or standards you are allowed to redistribute internally, with revision tracking planned for the v0.2 watcher.
- Audit and certification requirements, where "which section says so" matters as much as the answer.
</details>

<details>
<summary><b>Customer support and product help</b> — help centers, FAQs, troubleshooting guides</summary>

- Help-center articles and FAQs, so a support agent answers only from approved content and the gate proves it can.
- Troubleshooting guides whose symptom → action pairs become procedures and rules.
- Release notes and known-issue lists that change often and are cheap to recompile.
</details>

<details>
<summary><b>Education and training</b> — course materials, training manuals, lab protocols</summary>

- Course notes and training manuals you authored or license, turned into a tutor skill that cites the section it teaches from.
- Laboratory and workshop protocols where the golden Q&A doubles as a self-check of the material.
- Certification study guides compiled per module, with the gate report highlighting the thin ones.
</details>

<details>
<summary><b>Small business and local regulations</b> — tax filing, permits, licensing</summary>

- Filing calendars, permit requirements, and fee schedules for a specific jurisdiction, packaged as a skill a small-business assistant can rely on (the planned first content product of this engine targets Philippine business regulations).
- Franchise and supplier manuals distributed to many operators who each need the same verified answers.
</details>

<details>
<summary><b>Open-source projects and personal knowledge</b> — project docs, research notes, meeting minutes</summary>

- In-depth documentation of an open-source project compiled into a contributor skill, kept honest by the gate as the docs evolve.
- Personal research notes, reading summaries, and meeting minutes you wrote yourself, made queryable without losing the anchors.
</details>

## Status

Current release: [`live-skills` 0.1.2](https://www.npmjs.com/package/live-skills) (2026-09-07). v0.1 — compile, quality gate, and the four CLI commands — is implemented, reviewed (code, security, security architecture), and verified with a real-LLM run of the bundled sample. Next: v0.2 (source watcher and incremental recompilation) and v0.3 (MCP serving); see `CHANGELOG.md` and `docs/SPEC.md` §7.

## License

MIT — see [LICENSE](LICENSE).
