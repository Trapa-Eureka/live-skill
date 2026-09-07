# WORKFLOW — the AI-native rules that run this repo

Basis: Clare Liguori (AWS), "From AI-Assisted to AI-Native: Building a Frontier Development Team"
(https://youtu.be/Ry0WHNxDbYA, AWS blog: https://aws.amazon.com/blogs/machine-learning/how-frontier-teams-are-reinventing-ai-native-development/)
The operating principles are the same as in sheet_mcp/retail-mcp/lang_ai_agent/message. Only the common summary plus **what is specific to this repo** is written here.

## 0. Role Definition (the three frontier behaviors)

| Behavior | In this repo |
|---|---|
| Hands-off Coding (1–2%) | Jin only edits and reviews SPEC/DESIGN, runs the real-LLM smoke, and approves npm publication |
| Infrequent Interaction | Machine-verifiable completion criteria for every task → run to completion without intervention during the session |
| Minimized Idle Time | Lanes A/B/C in parallel after T1. The backlogs of five repos are run as a single worktree queue |

## 1. Five Habits → Rules (common summary)

1. **Agent Context** — tribal knowledge lives only in CLAUDE.md/docs. Biweekly pruning plus a log.
2. **Slow Down to Speed Up** — up-front investment in strict TS and interface boundaries (extraction, LLM, assembly, and gate all separated). "Engineering now for the future (v0.2)", such as section id stability, is this repo's version of this habit.
3. **Feed, Don't Babysit** — assignment is a single TASKS template; self-verification = `npm run check`.
   ```bash
   git worktree add ../live-skill-t4 -b t4 && cd ../live-skill-t4 && claude
   ```
4. **Explicit Intent** — changes to the output file structure, gate rules, or manifest schema land as a DESIGN diff before the code.
5. **Shift Left** — all 5 LLM roles are replaced by ScriptedLlm scripts, so even the gate's discriminating power is proven with local determinism. The real LLM is used only in smoke.

## 2. live-skill Specifics

- **The gate is the product**: the 5 "gate discriminating power" tests (corruption-injection detection) are the evidence for the product hypothesis — changes that make them pass by deleting, relaxing, or lowering the threshold are rejected. The correct direction for fixing a gate failure is improving distillation or prompts.
- **Watching answerer isolation**: in review, catch any diff that leaks the source or unselected chapters into the answerer context. If isolation breaks, the pass rate goes up and the product dies.
- **Copyright rule**: fixtures/samples are self-authored documents only. Any influx of real book or article text is rejected immediately. Demos also use self-authored samples.
- **Do not fit tests to the code**: if golden snapshots or gate cases wobble, the cause is the code or the script. The same directional discipline as retail-mcp's formula principle.
- **Relationship to book-to-skill**: reference only the standard compatibility of the output structure; referring to or porting its code is prohibited (independent implementation is both product strategy and license hygiene).

## 3. Daily Operating Routine

1. Check which tasks can start → assign worktrees per lane (queue shared by the five repos)
2. Do not intervene during execution — use that time to refine the v0.2 (watcher) and ph-skill-pack documents
3. Completion report → re-run `npm run check` → review the diff → merge → update status
4. Biweekly: prune CLAUDE.md, tidy TASKS

## 4. Limits of Autonomy (what humans hold)

- Running the real-LLM smoke (cost) and finalizing the gate threshold and k defaults
- npm publish and the final name decision
- Approval of changes to gate rules and output structure
- When to start ph-skill-pack (sibling repo) and its source selection
