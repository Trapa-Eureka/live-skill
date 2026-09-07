# 002 — Security Review

Review date: 2026-09-06  
Target: /Volumes/DevWork/work/live-skill  
Base commit: 537a42ce4e3d8d0fc6a657a52f329c6368afdb32  
Scope: all source, the CLI, extractors, the LLM adapter, Zod schemas, tests, configuration, the lockfile, CI, and related Markdown. Issues that overlap with the earlier 001_CODE_REVIEW.md are recorded again here with the focus on the security attack conditions and impact.

## Findings Summary

Critical 0 / High 6 / Medium 6 / Low 1 — 13 findings in total.

This project is a local CLI with no server authentication, sessions, or database. The severities below assume a situation in which an attacker can influence the source document, an imported skill directory, or the model response, and the user runs the CLI with their own OS permissions and API key. A user with permission to change local configuration already controls the execution policy; that is not classified here as a remote authentication bypass or as obtaining OS administrator privileges.

The level of verification is stated separately for each item. In-memory reproductions with a mock LLM prove defects in trust boundaries and control flow; they do not prove the rate at which real Claude accepts attack instructions, nor that an external agent would successfully execute a command.

## Critical

None confirmed. Remote code execution, OS privilege escalation, and theft of a real API key were not reproduced.

## High

### SEC-001 — Escaping the output root through the model-provided slug

- Files: /Volumes/DevWork/work/live-skill/src/core/schemas.ts lines 15–18; /Volumes/DevWork/work/live-skill/src/adapters/fsTargets.ts lines 122–129; /Volumes/DevWork/work/live-skill/src/cli/compile.ts lines 74–79.
- Attack condition: the attacker can induce or manipulate the slug in the outline response.
- Problem: the slug is only checked to be a non-empty string and is joined directly into the default skill path and the temporary path. Relative path separators and parent-directory segments are allowed.
- Evidence: in the in-memory reproduction from the previous review, ../../outside resolved to /Users/a1234/outside. The temporary path also escaped into a parent directory. This review confirmed that the code is unchanged.
- Impact: SKILL.md, chapters, and the manifest can be created outside the designated skill root. The failure-output path uses force: true, so there is a risk of overwriting a file that has the same name as an existing output. Writes are limited to the running user's permissions and to file names chosen by the generator; overwriting arbitrary executables or RCE was not demonstrated.
- Recommended fix: apply a single-segment slug schema rather than a path, rejecting /, backslashes, and parent-directory segments. Independently boundary-check the final path of the default target. Create failure outputs under a trusted fixed prefix with mkdtemp, and never build a temporary path from a model string.
- Related guardrail: 5. Duplicates 001 in 001_CODE_REVIEW.md.

### SEC-002 — Reading and writing external files through symbolic links

- Files: /Volumes/DevWork/work/live-skill/src/adapters/fsTargets.ts lines 34–43, 58–72, 85–110.
- Attack condition: the attacker can place a link in the input, output, or imported skill directory. Overwriting the output may require --force or a race between the check and the write.
- Problem: the write boundary is string-based, and the actual write follows links. Input traversal also follows links via stat and readFile.
- Evidence: static data-flow confirmation. No attack that actually reads or overwrites a personal file was executed.
- Impact: files can be written to another directory through a link that appears to be inside the output. If an input link with a supported extension such as .md points at a readable external text file, its content can be extracted as the source and sent to the LLM API. This also affects the file isolation of guardrail 2.
- Recommended fix: reject symbolic links and anything that is not a regular file by default. If they are allowed, check that the real path is inside an approved root. Apply file opening, target locking, and staged replacement that also account for path-swap attacks after the check. Do not treat a realpath check alone as having resolved the race condition.
- Related guardrails: 2, 5, 7. Related to 002, 012, and 014 in the previous review.

### SEC-003 — Untrusted model output is promoted to system instructions and into the installed skill

- Files: /Volumes/DevWork/work/live-skill/src/core/prompts.ts lines 45–57, 68–76, 94–123; /Volumes/DevWork/work/live-skill/src/core/schemas.ts lines 7–18; /Volumes/DevWork/work/live-skill/src/core/assembler.ts lines 136–153, 215–220.
- Attack condition: instructions in the source document can steer the outline/distill responses.
- Problem: chapter.title is inserted directly into the system prompt. Titles have no newline or length limit, and the source, QA, and candidate answers are concatenated into subsequent prompts without any distinction marking them as untrusted data. The distill body remains as-is in the installed skill.
- Evidence: reproduced a chapter.title containing a hypothetical SYSTEM_OVERRIDE_MARKER landing in the system field of the distill request. Whether the model actually follows it was not tested with a real LLM.
- Impact: low-trust document and model text may be treated as high-priority instructions. Even if the QA on a few legitimate facts passes, that does not mean malicious instructions hidden in the skill are safe. The execution impact in a downstream agent depends on that agent's permissions.
- Recommended fix: keep the system text as a trusted constant and pass titles and documents as separate structured data fields. State explicitly for each role the boundary that instructions inside data must not be executed, and validate field size and format as well. Evaluate compiled outputs for instruction safety separately from knowledge accuracy, and establish a review/quarantine boundary for the automatic installation of untrusted sources. Do not claim complete defense from prompt wording or string filters alone.
- Related guardrails: 1, 2.

### SEC-004 — The model can narrow the scope of source text evaluated and bypass the gate

- Files: /Volumes/DevWork/work/live-skill/src/core/pipeline.ts lines 159–193, 236–241; /Volumes/DevWork/work/live-skill/src/core/gate.ts lines 250–258; /Volumes/DevWork/work/live-skill/src/core/schemas.ts lines 7–19.
- Attack condition: an incomplete or manipulated outline response.
- Problem: the full set of input sections is not reconciled against the plan's assignment list. The gate evaluates only the sectionIds the model chose and skips unknown IDs.
- Evidence: the previous review included only one of two source sections in the plan and reproduced a gate pass plus the omission of the remaining section from the manifest.
- Impact: if an attacker excludes hard-to-verify content or important constraints from the plan, the whole skill can be deployed as verified on the accuracy of a small subset alone.
- Recommended fix: keep a list of source sections, independent of the model's plan, as the evaluation population. Validate at the boundary that every substantive section is assigned exactly once, that IDs exist and are unique, and that chapter IDs are unique. Handle what may be excluded, such as empty headings, by an explicit deterministic policy rather than model discretion.
- Related guardrail: 1. Related to 004 and 006 in the previous review.

### SEC-005 — QA-generation failures are excluded from the denominator, so unevaluated chapters pass too

- Files: /Volumes/DevWork/work/live-skill/src/core/gate.ts lines 74–107, 223–237, 252–265.
- Related documents: /Volumes/DevWork/work/live-skill/docs/DESIGN.md line 100; /Volumes/DevWork/work/live-skill/docs/TESTING.md line 25; /Volumes/DevWork/work/live-skill/CLAUDE.md line 47.
- Attack condition: qaGen for a particular section returns an empty array, malformed JSON, or an invalid quotation twice. This also happens through ordinary model failure, without any prompt attack.
- Problem: questions whose regeneration failed are excluded from the tally, and no minimum section/chapter coverage is enforced.
- Evidence: with two chapters, mock responses were arranged so that only A answered one question correctly while B failed QA generation twice. The result was passRate=1, passed=true, B asked=0, failures=[].
- Impact: a skill containing unverified content is deployed as if fully verified. The failed questions do not appear in the report's failure list either.
- Recommended fix: record QA-generation failure as an independent verification failure or an unverified state, and forbid a verified deployment when the required section coverage is not met. Rather than manipulating those questions into arbitrary wrong answers, display the generation-failure reason and the coverage separately.
- Related guardrail: 1. The implementation follows the exclusion rule in DESIGN, so this is not a simple implementation mismatch but a conflict between the design and the higher-level guardrail. The policies of both documents must be reconciled together before fixing.

### SEC-006 — A manipulated manifest lets the reference-answer store file serve as an answerer chapter

- Files: /Volumes/DevWork/work/live-skill/src/core/schemas.ts lines 60–73; /Volumes/DevWork/work/live-skill/src/core/gate.ts lines 50–59, 128–161; /Volumes/DevWork/work/live-skill/src/cli/eval.ts lines 35–54.
- Attack condition: the user runs eval on a skill directory received from outside or modified.
- Problem: manifest.sections[].chapterFile is an arbitrary string. chaptersFromManifest turns this value into the allowed chapter list, and readSkillDir reads every file, including the manifest.
- Evidence: a manifest with chapterFile='manifest.json' passed Zod validation. When the mock selection response returned manifest.json, a SECRET_REFERENCE_MARKER placed only in goldenQa.refAnswer was included in the answerer request. loadHistory also recorded manifest.json as loaded.
- Impact: evaluation reference answers and other QA flow into the answerer, neutralizing guardrail 2. Other sensitive files in the directory can also be designated as chapters. Combined with SEC-002, the likelihood of out-of-scope text flowing in also grows.
- Recommended fix: allow only genuinely approved regular files under chapters/*.md as chapters. Exclude manifest.json, the source, and the QA store at the file-loader stage, and check consistency between the schema, the file list, and the output list. The QA in an external manifest is not itself a trusted reference answer either, so its provenance must be verified or it must be regenerated from a trusted source.
- Related guardrails: 2, 1.

## Medium

### SEC-007 — Environment variables can make a 0% pass rate or zero questions pass as verified

- Files: /Volumes/DevWork/work/live-skill/src/core/config.ts lines 23–29, 49–57, 66–72; /Volumes/DevWork/work/live-skill/src/core/gate.ts lines 223–234; /Volumes/DevWork/work/live-skill/src/cli/index.ts lines 23–28.
- Attack condition: the attacker can influence the execution environment or the .env in the current directory. It may also be a deliberate policy change by the owner of the local configuration, so this is not treated as remote privilege escalation.
- Problem: GATE_THRESHOLD=0 is allowed, and empty QA with passRate=0 also passes. A whitespace string also becomes 0 via Number().
- Evidence: after loadConfig({GATE_THRESHOLD:'0'}), an evaluation with zero questions gave passed=true.
- Impact: unlike --no-gate, an unverified pass is possible without any skipped/unverified marking. This conflicts with the default policy of guardrail 1.
- Recommended fix: enforce the minimum threshold permitted by policy and fail zero questions regardless of the threshold. Handle whitespace values explicitly. If a policy change is needed, separate it into an explicit, recorded setting so that the level of verification does not silently change through environment variables alone.
- Related guardrail: 1. The permitted range of environment configuration in DESIGN should be tidied up as well.

### SEC-008 — Actual call and token budgets are not enforced, allowing cost exhaustion

- Files: /Volumes/DevWork/work/live-skill/src/core/gate.ts lines 63–64, 92–94; /Volumes/DevWork/work/live-skill/src/core/pipeline.ts lines 171–193; /Volumes/DevWork/work/live-skill/src/cli/eval.ts lines 47–54, 85–87; /Volumes/DevWork/work/live-skill/src/core/schemas.ts lines 22–28, 73.
- Attack condition: QA regeneration occurs, or an external manifest contains many QA items.
- Problem: the compile estimate omits regeneration, and there is no call-cap counter during execution. eval does not check config.maxLlmCalls. There is no cap on the manifest QA array or its fields either.
- Evidence: the previous review reproduced 7 calls with the cap set to 6. The absence of a cap check on the eval path was confirmed statically.
- Impact: more billable calls than expected may be made with the user's API key, or the run may fail because of excessive request size.
- Recommended fix: enforce total call count, request tokens, and time caps immediately before each call in a common LLM wrapper shared by compile/eval. Deduct retries from the same budget, and limit the number of QA items and string lengths.
- Related guardrail: 6. Since there is no public HTTP service, the absence of per-IP rate limiting is not treated as a separate vulnerability.

### SEC-009 — Structural validation results are not wired to block deployment

- Files: /Volumes/DevWork/work/live-skill/src/core/pipeline.ts lines 224–254; /Volumes/DevWork/work/live-skill/src/cli/compile.ts lines 71–93; /Volumes/DevWork/work/live-skill/src/core/assembler.ts lines 136–140; /Volumes/DevWork/work/live-skill/src/core/validator.ts lines 57–86.
- Attack condition: the model returns a body exceeding the budget, or metadata containing special characters.
- Problem: the CLI ignores validation. YAML values are not escaped either; only key presence is checked.
- Evidence: in the previous review, a 1,501-token chapter against a 1,000-token budget was passed to the write function with exit code 0. Raw YAML for the title Guide: Setup also passed the project's own validation.
- Impact: the deterministic boundary that should stop malicious or abnormal model output does not operate at the deployment stage. Enforcing structural validation does not, however, also block prompt attacks.
- Recommended fix: block on structural validation errors before the gate, and validate the final output too. Generate metadata with a serializer and perform real YAML parsing and value validation.
- Related guardrails: 1, 6. Duplicates 003 and 009 in the previous review.

### SEC-010 — Abnormal grader output is treated as correct on a CORRECT prefix alone

- Files: /Volumes/DevWork/work/live-skill/src/core/prompts.ts lines 105–129; /Volumes/DevWork/work/live-skill/src/core/gate.ts lines 162–169.
- Attack condition: the model returns an explanatory or contradictory answer, or injected instructions in the candidate answer influence the grader output.
- Problem: the /^\s*correct\b/ check looks only at the beginning to decide correctness.
- Evidence: 'CORRECT? No, WRONG.' was parsed as correct.
- Impact: uncertain or malformed verdicts are counted as correct, weakening the conservative-grading principle of guardrail 1.
- Recommended fix: validate an enum over the normalized full string, or a strict structured response, and treat everything else as failure/undetermined. Separate the candidate answer as data rather than as instructions to the grader.
- Related guardrail: 1.

### SEC-011 — Memory and time limits for parsing untrusted documents are insufficient

- Files: /Volumes/DevWork/work/live-skill/src/cli/compile.ts lines 46–51; /Volumes/DevWork/work/live-skill/src/adapters/fsTargets.ts lines 77–99; /Volumes/DevWork/work/live-skill/src/adapters/extractors/limits.ts lines 8–22; /Volumes/DevWork/work/live-skill/src/adapters/extractors/docx.ts lines 95–105, 126–139.
- Attack condition: the user is handed and runs a large folder or file, a cyclic link, or a document that is expensive to parse.
- Problem: there is no per-file or total byte limit before extraction, and reading is done in one batch. The Promise.race timeout does not cancel the parser and cannot interrupt synchronous CPU occupation. The DOCX check relies on metadata and the internal _data field after the ZIP has been loaded.
- Evidence: static review. No actual zip bomb or memory-exhaustion attack was executed, and no specific ZIP bypass is claimed to have been confirmed.
- Impact: reduced process availability, memory exhaustion, prolonged CPU occupation, and delayed termination.
- Recommended fix: limit size, count, and file type before reading, and use bounded concurrency. Run parsers in a terminable worker/subprocess with memory and wall-clock limits. In addition to the ZIP metadata check, apply a cumulative cap on the bytes actually decompressed.
- Related guardrail: 6. The PDF page limit, DOCX entry/size limits, and the skipping of image reads exist, but they are no substitute for full resource isolation.

### SEC-012 — The publish-time secret file check misreads the npm output format

- Files: /Volumes/DevWork/work/live-skill/scripts/check-tarball.sh lines 5–14; /Volumes/DevWork/work/live-skill/package.json lines 13–15, 28–29.
- Attack condition: a root .env-family file gets included, for example through a change to the publish file configuration, or reading the scan target fails.
- Problem: in the human-readable npm notice output the file name is preceded by a prefix and a size, but the regex only looks for a file name at the start of the line or immediately after /. A grep error can also proceed through the conditional as if nothing was detected.
- Evidence: a synthetic 'npm notice 100B .env.production' line did not match the current regex. No real secret file was created or published.
- Impact: the check can miss a real secret file entering the published package. files=['dist'] currently prevents a root .env from being published, so an immediate leak was not confirmed.
- Recommended fix: parse files[].path from npm pack --dry-run --json and check the paths. Scan every actually included file for secret patterns, and treat read/command errors as publish failures. Add tests for root and nested paths.
- Related guardrail: 7; supply-chain and publish protection.

## Low

### SEC-013 — .env variant files are missing from the Git ignore rules

- File: /Volumes/DevWork/work/live-skill/.gitignore lines 9–11.
- Attack condition: a developer keeps credentials in a file such as .env.production or .env.staging.
- Problem: only .env and .env.local are excluded.
- Evidence: git check-ignore excluded only .env.local; production/staging were not excluded.
- Impact: a credentials file could be committed by mistake during git add. There is currently no evidence that a real key has been committed.
- Recommended fix: exclude .env and .env.*, and manage only .env.example as the exception. Apply commit-time and CI secret detection as additional defenses.
- Related guardrail: 7.

## Focused Assessment of Guardrails 1, 2, and 4

| Guardrail | Verdict | Basis |
| --- | --- | --- |
| 1: No relaxing the quality gate | Bypasses and a design conflict confirmed | SEC-004, 005, 007, 010. Excluding question-generation failures is stated explicitly at DESIGN line 100, so the document policy itself is also subject to correction. |
| 2: answerer isolation | The basic restriction exists on the normal compile path, but a bypass was confirmed in eval | gate.ts lines 135–161 use only the allowlist and the selected files. However, the external manifest defines the allowlist, which makes SEC-006 possible. |
| 4: self-authored fixtures and samples | No evidence of violation within the review scope | Consistent with the self-authored notes in fixtures, the fictional product and organization names, the directly generated content in scripts/fixtures/generate.ts, and the PDF/DOCX extraction results. Comments alone do not legally prove ownership of the rights. |

Guardrail 4 is a provenance rule for development fixtures; it does not mean every input an operator processes is trustworthy. The note at src/adapters/extractors/html.ts lines 14–15, "assumes self-authored documents", must not be extended into a security trust assumption. The attack-reproduction strings in this review are synthetic data; no real documents, keys, or personal data were used.

## Results by Requested Area

| Area | Result and limitations |
| --- | --- |
| Authentication and authorization | There is no HTTP login, user roles, or sessions. The CLI uses the running user's OS permissions and applies Anthropic API key authentication. The absence of a separate login is not treated as a vulnerability. |
| API key and environment variables | The key is passed via the SDK's apiKey; no code was found that puts the key directly into a prompt. baseURL is fixed HTTPS, logLevel is off, and the SDK's automatic retries default to 0. Environment-based policy bypass and the missing .env ignore rules are SEC-007 and 013. |
| Input, Zod, and model output | Basic type checks exist, but path, count, length, cross-reference, and coverage validation are lacking. See SEC-001, 003, 004, 006, 008, 009. A successful Zod parse is not a guarantee of content safety. |
| SQL and DB | No DB driver, SQL execution, or ORM access path was found. No SQL injection surface. |
| XSS and CSRF | With no web server, browser rendering, or cookie-based authentication flow, no XSS/CSRF execution path in the project itself was identified. Rendering the generated Markdown in another service is that renderer's security boundary. |
| SSRF and redirects | The only explicit remote call is the fixed Anthropic API path. No application path was found that fetches a document URL or receives a redirect URL and makes a request to it. Not every internal network behavior of the dependencies was dynamically instrumented. |
| External APIs | Sending part or all of the source to the API according to role is product behavior. Input link escape and eval accepting wrong files can widen this transmission scope. SEC-002, 006. |
| File upload | No HTTP upload endpoint. The corresponding risks of local untrusted file input and parsing are SEC-002 and 011. |
| Command and code execution | No execution path in src that passes model output to shell/eval/child_process was found. The possibility that a skill's instructions are executed in a downstream agent is distinguished from direct RCE in this CLI. |
| Rate limiting and cost | There is no public request endpoint. The incomplete cost limiting of a single run is SEC-008. |
| Privilege escalation | Obtaining admin/root privileges was not confirmed. Promotion of model data to system instructions and escape from the output root are SEC-003 and 001 respectively. |
| Sensitive logging | SDK debug logging is off, and the normal CLI prints a summary rather than the full source. llmProvider.ts lines 18–30 preserve external error messages verbatim, and index.ts line 124 does not handle top-level errors. An actual secret leak was not reproduced, but there is room to apply error summarization/redaction and control-character handling. |
| Supply chain | See the npm audit results and the CI/lockfile review below. |
| LLM prompt injection | SEC-003 and the trust-boundary defects in the grader and QA. Passing on accuracy rate does not mean the absence of malicious instructions. |

## Dependency, Supply-Chain, and Secret Checks

- On 2026-09-06, npm audit --package-lock-only --ignore-scripts --json was run against the npm security registry. Result: 0 known vulnerabilities, metadata.dependencies.total=297. No install, update, or audit fix was performed. The network was used only for the npm audit lookup; there were no real LLM calls.
- This result covers the advisories registered in the registry at the time of the lookup and does not guarantee the absence of malicious packages or undisclosed vulnerabilities.
- Every resolved entry in package-lock.json was a https://registry.npmjs.org/ path, and there were no entries that had resolved but no integrity.
- .github/workflows/ci.yml lines 16–17 set contents: read, and the Actions at lines 37–38 are pinned to full commit SHAs. Installation is from the lockfile via npm ci. CI runs on PRs and pushes to main, and there is no pull_request_target.
- CI has no explicit vulnerability verdict threshold or dedicated secret-detection step. The default audit output of npm ci alone does not guarantee that a release is blocked, so a continuous security gate could be added. This alone is not a claim of a current supply-chain compromise.
- A limited pattern check for Anthropic/OpenAI keys and private-key headers was run over the 95 tracked files, with 0 matching files. No actual key values or the user's environment were printed. Not every secret format, past Git history, or untracked file was checked.
- The mismatch between the Node >=20 declaration in package.json and the versions required by Commander/Vitest is recorded in the existing general review as 016. The compatibility issue is not reclassified as a confirmed CVE.

## Verification Method and Limitations

- The security-relevant source and documents at the current commit were read and cross-checked against the results of the previous full code review.
- The actual source was transformed and loaded in memory, and the following were reproduced with a mock LLM: the title flowing into the system field, a pass after an entire chapter's QA was missing, a pass with zero questions/threshold 0, the refAnswer from manifest.json flowing into the answerer, and acceptance of a contradictory CORRECT prefix.
- The cost-cap overrun, output-path escape, and ignored structural validation were based on the reproduction results of the immediately preceding review together with confirmation that the code is the same.
- Reading or overwriting real personal files through malicious links, running a zip bomb, real-LLM attacks, an actual publish, and credential-transmission tests were not performed.
- The target folder had no node_modules, so the full npm run check was not run. The reproductions used the installed TypeScript/Zod from a separate workspace. npm audit queried the target folder's lockfile.
- No code was modified. Only this report is newly saved as docs/002_SECURITY_REVIEW.md. The previous 001_CODE_REVIEW.md is preserved.
