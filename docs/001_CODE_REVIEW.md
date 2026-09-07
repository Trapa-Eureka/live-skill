# 001 — Comprehensive Code Review

Review date: 2026-09-06  
Review scope: all of `/Volumes/DevWork/work/live-skill` (`src/`, tests, scripts, configuration, lock file, related Markdown documents and fixtures)  
Review lens: correctness, complexity, performance, error handling, type safety, maintainability, unnecessary code, concurrency and race conditions

## Summary

- Critical: 0
- High: 6
- Medium: 11
- Low: 2
- Total: 19

During the review, the main defects were confirmed through in-memory reproductions that write no files. The gate passed even when a source section was dropped from the outline; with `MAX_LLM_CALLS=6`, 7 calls were actually made; and the CLI treated an output that failed structural validation as a success. An `eval` run given multiple files as the source could not evaluate a single question because of a section ID mismatch.

## Critical

None found.

## High

### 001. An LLM-returned slug can escape the output directory

- File: `src/adapters/fsTargets.ts`
- Lines: 122–129
- Related file: `src/core/schemas.ts` 15–18
- Problem: `slug` is validated only as a non-empty string and then joined directly into a filesystem path. A value such as `../../outside` resolves outside the skill target or the temporary directory.
- Impact: LLM output or a manipulated plan can write outputs to an unintended location. The gate-failure path even uses `force: true`, so existing files may be overwritten as well.
- Recommendation: Restrict the slug to a safe single-path-component format and reject `/`, `\\`, `.`, `..`, and absolute paths. After joining, verify again that the final path lies inside the permitted target directory.

### 002. The output boundary check does not block symbolic links

- File: `src/adapters/fsTargets.ts`
- Lines: 34–43, 69–72
- Problem: `resolveWithinOutDir()` only checks that the path is relative as a string. The subsequent `mkdir()` and `writeFile()` may follow an existing symbolic link.
- Impact: If `chapters/` or an individual file inside the output directory points to an external path, files outside the output folder can be overwritten, especially in a `--force` run.
- Recommendation: Check each path component with `lstat()` for links, and even where links are allowed, verify against `realpath()` that the target lies inside the output root. Where possible, use an atomic file-creation method that does not follow links.

### 003. A skill that fails structural validation is still deployed as a success

- File: `src/core/pipeline.ts`
- Lines: 233–254
- Related file: `src/cli/compile.ts` 71–93
- Problem: The `validateSkill()` result is only computed and returned; the CLI never checks `validation.passed`.
- Impact: Even with a token budget overrun, invalid frontmatter, or broken links, the files may be written and exit code 0 returned. Even when the structural error is obvious, the semantic gate runs first and wastes LLM cost.
- Recommendation: Run structural validation before the semantic gate and abort compile deployment when there is an error. Enforce structural validation even under `--no-gate` and print the report to the user.

### 004. Source text dropped from the outline also disappears from the evaluation

- File: `src/core/pipeline.ts`
- Lines: 159–169, 185–193
- Related file: `src/core/gate.ts` 250–258
- Problem: There is no check that the outline's `sectionIds` contain every input section exactly once. Nonexistent section IDs, duplicate assignments, and duplicate chapter IDs are all accepted.
- Impact: If the model drops a difficult source section, that content vanishes from distillation, the manifest, QA generation, and the gate alike. An incomplete skill can pass at 100%, which breaks the product's core quality guarantee.
- Recommendation: Immediately after parsing the outline, compare the input sections with the plan's section IDs as a set and by frequency. Enforce that every input section is assigned exactly once, that no unknown IDs are present, and that chapter IDs are unique.

### 005. Distillation discards everything after the first 2,000 characters of each section

- File: `src/core/prompts.ts`
- Lines: 18–21, 57
- Problem: `distillPrompt()` truncates each section with `sectionExcerpt(s, 2000)` before passing it to the model.
- Impact: Even when the whole input fits within the permitted token budget, rules, figures, and procedures near the end of a section never reach the distillation model. QA generation, on the other hand, uses the full source text, so the result is information loss or unavoidable gate failures.
- Recommendation: Pass the full section text whenever it fits within the input budget. When it does not, use an explicit chunking, partial-distillation, and merge strategy and notify the user of any omission.

### 006. Section ID collisions overwrite different source texts

- File: `src/core/sectionId.ts`
- Lines: 42–45
- Related file: `src/core/pipeline.ts` 76–78, 185
- Problem: Duplicate-ID suffixes are not checked against existing heading slugs. For example, `A`, `A`, `A-2` become `a`, `a-2`, `a-2`. With multiple files, only the basename is used as the namespace, so identical file names in different folders collide.
- Impact: When the `Map` is built, the earlier section is overwritten, so the source text to distill, the manifest hash, and the evaluation target are all wrong.
- Recommendation: Generate collision-free candidates iteratively against the full set of already-generated IDs. For the multi-source namespace, use the path relative to the input root or a stable path hash instead of the basename.

## Medium

### 007. Question-regeneration calls are missing from the cost-cap calculation

- File: `src/core/gate.ts`
- Lines: 63–64, 92–94
- Related document: `docs/DESIGN.md` §4
- Problem: The cost estimate counts one qaGen call per section, but `generateGoldenQa()` makes up to 2 calls.
- Impact: Actual calls can exceed the configured `MAX_LLM_CALLS`. In the reproduction, a run with a cap of 6 succeeded after 7 calls.
- Recommendation: Fix the estimation formula to the worst case including regeneration, and beyond the estimate, enforce the cap with a shared counter immediately before each actual call. Update the formula in the design document as well.

### 008. `eval --source` does not work for a skill compiled from multiple source files

- File: `src/cli/eval.ts`
- Lines: 69–87
- Problem: compile prefixes multi-source section IDs with a file namespace, but the eval re-extraction path uses the original IDs unchanged.
- Impact: The manifest's `x/a` and `y/a` do not match the re-extracted `a`, so no QA is generated and the gate fails with 0 questions.
- Recommendation: Extract the multi-source normalization and namespace logic into a shared function used identically by compile and eval. Report source text that does not match the manifest as an explicit error.

### 009. Ordinary titles produce invalid YAML frontmatter

- File: `src/core/assembler.ts`
- Lines: 136–140
- Related file: `src/core/validator.ts` 84–86
- Problem: The title and slug are inserted directly without YAML escaping. For example, `description: Guide: Setup` is not a safe YAML scalar. The validator only checks that the key strings are present.
- Impact: The project's own validator passes, but real Agent Skills consumers may fail to parse the metadata.
- Recommendation: Generate the frontmatter with a YAML serializer, and have the validator actually parse the YAML and check the type and validity of `name` and `description`.

### 010. HTML table content and generic-container body text are dropped

- File: `src/adapters/extractors/html.ts`
- Lines: 22–35
- Problem: Only `h1`–`h6`, `p`, `li`, `blockquote`, and `pre` are selected, discarding the direct text of `td`, `th`, and plain `div` elements.
- Impact: In documents whose rules and figures live in tables, important information silently disappears. The missing information never enters QA generation either, so the gate may not detect it.
- Recommendation: Walk the DOM in document order, preserving body text, table rows and cells, code blocks, and list structure. Use a single traversal that avoids duplicating nested elements.

### 011. Markdown headings without a surrounding blank line are not recognized

- File: `src/core/sections.ts`
- Lines: 59–65
- Problem: The heading regex is applied only to whole blocks split on blank lines. Valid Markdown such as `# Title\nBody.\n## Sub\nDetail.` becomes a single untitled section.
- Impact: The section hierarchy, stable IDs, outline, and QA scope all change. Merging into one large section also amplifies the 2,000-character distillation truncation problem.
- Recommendation: Use a Markdown parser or a line-by-line state machine to recognize ATX headings. Make sure `#` inside code fences is not treated as a heading.

### 012. Concurrent writes can bypass the `--force` protection

- File: `src/adapters/fsTargets.ts`
- Lines: 58–72
- Problem: The directory-content check and the file write form a separated TOCTOU flow.
- Impact: If two processes start against the same output target at the same time, both pass the pre-check and then interleave their files and manifests.
- Recommendation: Use a per-target exclusive lock, write everything to a staging directory on the same filesystem, and then swap it atomically with the final directory.

### 013. Old chapter files remain after a `--force` recompile

- File: `src/adapters/fsTargets.ts`
- Lines: 69–73
- Problem: Only the new outputs are overwritten; files from the previous compile's outputs that are absent from the new manifest are not removed.
- Impact: When chapter names or counts change, stale content remains. `readSkillDir()` reads those files too, so validation and evaluation inputs can be contaminated.
- Recommendation: Compare the previous manifest's managed files with the new outputs and remove stale outputs, or complete a staging directory and swap the whole thing atomically.

### 014. Directory traversal follows symbolic-link cycles

- File: `src/adapters/fsTargets.ts`
- Lines: 87–99
- Problem: `stat()` follows links, and the real paths visited are not recorded.
- Impact: A link pointing to an ancestor directory can cause repeated traversal or path-length errors, and files outside the specified input scope can be included.
- Recommendation: Exclude links by default using `lstat()`, or apply a `realpath()`-based visited set together with an input-root boundary check.

### 015. All files are loaded into memory concurrently before the input size limit applies

- File: `src/cli/compile.ts`
- Lines: 46–51
- Related file: `src/adapters/fsTargets.ts` 77–79
- Problem: The entire input is read at once with `Promise.all(readFile)`, with no limit on file count or byte size, and a `Uint8Array` copy is added on top.
- Impact: A large folder can use excessive memory or kill the process before the token budget check is ever reached.
- Recommendation: Check stat-based per-file and total byte limits first, then read with bounded concurrency. Clean up the type boundary so Buffers are not copied unnecessarily.

### 016. The declared Node support range does not match the actual dependencies

- File: `package.json`
- Lines: 7–8
- Related files: the `commander` and `vitest` entries in `package-lock.json`, and `.github/workflows/ci.yml` 31–32
- Problem: The project declares Node `>=20` and CI also runs Node 20, but Commander 15 requires Node `>=22.12.0` and Vitest 5 does not support Node 20.
- Impact: Install warnings, CLI startup failures, or CI failures can occur in an environment documented as supported.
- Recommendation: Either pin dependencies to Node 20-compatible versions or raise the minimum to `>=22.12.0`, and align the package metadata, README, CLAUDE.md, and CI matrix together.

### 017. LLM errors propagate outside the CLI's user-facing error handling

- File: `src/cli/compile.ts`
- Lines: 58–64
- Related file: `src/cli/index.ts` 124
- Problem: `LlmProviderError`s such as authentication, network, rate-limit, and truncated-response errors are handled neither at the compile call nor at the top-level `parseAsync()`.
- Impact: A mid-run failure can end in a stack trace and a generic error instead of a user-friendly cause and fix.
- Recommendation: Add a common CLI error boundary that converts `LlmProviderError.kind`, whether it is retryable, and the failed stage into a human-readable message and exit code.

## Low

### 018. An invalid `--target` value is silently treated as Claude

- File: `src/cli/index.ts`
- Lines: 65
- Problem: Every value other than `agents` is converted to `claude`.
- Impact: A typo in the option does not become an explicit error and installs into an unintended skill directory.
- Recommendation: Allow only `claude|agents` via Commander's choices or the project's own zod enum, and reject everything else before execution.

### 019. The task status document conflicts with the implementation state

- File: `docs/TASKS.md`
- Lines: 20–52
- Related files: `docs/PUBLISHING.md` 11, `README.ko.md` 53–57
- Problem: T1–T8 are marked TODO and the publishing document says the code has not been started, yet the corresponding implementation and tests exist. The README states T0–T10 are done with T11 remaining, whereas TASKS marks everything through T11 as done.
- Impact: New contributors or agents may redo work that is already finished or misjudge the current release state.
- Recommendation: Designate a single source of truth for the current state and synchronize the completion status. Move historical status records into a separate dated changelog or snapshot section.

## Verification record

- All of `src/`, plus the tests, scripts, configuration and lock files, and related Markdown documents were reviewed.
- The PDF and DOCX fixtures were checked through the real extractors.
- Syntax checks were run on 60 TypeScript files with no syntax diagnostics.
- The target directory had no `node_modules`, so the full `npm run check` could not be run. Only syntax checks and in-memory reproductions were performed, using a TypeScript runtime available in a separate workspace.
- No code or existing documents were changed. Only this review report file was newly added.
