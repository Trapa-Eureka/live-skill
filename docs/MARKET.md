# MARKET — Application Areas, Competitive Landscape, and Scale Analysis

Written: 2026-09-06 (docs analysis session, preliminary research for npm publication). This document does not replace the "final" spec in SPEC.md — it is the market research record that supports SPEC §1 and §5.

## 1. Why This Work Matters

- **Agent Skills sits on top of a real infrastructure standard.** The open spec Anthropic published on 2025-12-18 (agentskills.io) had been adopted by 32 tools as of 2026-03, including Gemini CLI, JetBrains Junie, AWS Kiro, and Block Goose. The survival risk of the "turn documents into skills" category itself is low.
- **But no tool has a verification layer.** All 6+ tools in the same category surveyed in §2 below are "deterministic one-shot converters". No tool was found that actually measures whether the produced skill answers questions about the source correctly. The core significance of this project is that live-skill's quality gate (number 2 in the SPEC §1 defensibility order) becomes the first layer in this category to quantify trust.
- **The fact that the competition is already crowded is itself category validation.** The original implementation of the leading representative, book-to-skill (Python, virgiliojr94), has secured 12,000+ GitHub stars, and doc2skill, skill-compiler, and others have each found their place on npm — demand is real, and what remains is differentiation (verification).

## 2. Competitive Landscape (2026-09-06, measured on the npm registry and GitHub)

| Name | Form | Measured metrics | What it does | Semantic verification layer |
|---|---|---|---|---|
| book-to-skill (original) | GitHub, Python, MIT | 12,000+ stars, 1,389 forks | Technical books/PDF → Claude Code skills | None |
| book-to-skill (npm) | npm, published by AncoderAI/doc2skill | — | Installer for Codex/Claude Code/Copilot CLI/Amp (a reimplementation separate from the original) | None |
| doc2skill | npm v0.7.0, MIT | 4 versions published | Web pages/PDF → skills, advertises "1-second conversion" | None |
| skill-compiler (AgentCompiler) | npm v0.3.0, MIT | leviathofnoesia | Documents → compressed AGENTS.md index, cites Vercel research | None |
| agent-compiler | GitHub/npx, AntJanus | — | Embeds skills/commands into CLAUDE.md and AGENTS.md | None |
| skills.sh / skillpm / antfu/skills-npm / npm `skills` | Package-manager layer | — | Skill installation and distribution in the style of `npx skills add` (not compilation) | N/A (different layer) |

**Implication**: among the tools surveyed, 0 cases grade and gate the output's accuracy against the source. The SPEC §1 hypothesis "defensibility order 2 (quality gate) > 1 and 3" was reconfirmed by this market research (reflected in SPEC §1).

The package-manager layer (skills.sh and others) is adjacent to the v0.4 non-goal that SPEC §4 specifies ("skill-market publishing automation"), so it is kept on record as grounds for revisiting `npx skills add`-compatible publishing at that point.

## 3. Applicable Areas

Extending the SPEC §5 representative scenarios (technical manual, SOP folder, regulatory documents):

- **Internal knowledge**: manufacturing and equipment manuals, SOPs, onboarding documents
- **Regulation and compliance**: bundles of policy and regulation PDFs (combines naturally with revision tracking through the v0.2 watcher)
- **Developer documentation**: SDK/API references, internal architecture documents — this category already has AGENTS.md-style competition (skill-compiler), so it is close to a red ocean
- **Customer-support knowledge bases**: FAQs, troubleshooting guides
- **Education and training materials**, **in-depth documentation for open-source projects**
- **(Sibling repo) PH local business regulations** — the first content product of layer 4 as specified by the SPEC

**Precondition**: only sources from which text can be extracted are in scope for v0.1 (scanned-image PDFs and documents that require OCR are SPEC §4 non-goals). Areas outside this precondition (e.g., handwritten documents, legal archives consisting mostly of scans) are deferred to v0.2 or later.

## 4. Scale — What the Features Can Handle

| Axis | Current design limit (based on DESIGN and SPEC) |
|---|---|
| Input formats | Text-based PDF, DOCX, MD/TXT, HTML (DESIGN §1) |
| Input unit | From a single file to a folder/glob batch (SPEC §3.1) |
| Output token budget | SKILL.md ~4,000 / ~1,000 per chapter / glossary ~1,500 / patterns ~2,000 / cheatsheet ~1,000 (DESIGN §3, adjustable through config) |
| Huge document handling | On budget overrun, suggest splitting and abort — no bypass (TESTING §4) |
| Cost cap | MAX_LLM_CALLS=300 per compile by default (DESIGN §7); gate calls = number of sections × k (default 3) × 3 roles |
| Language | A fixture exists that verifies mixed-Unicode (English/Korean/Tagalog) handling (TESTING §2) — multilingual real-world use is possible, but a multilingual glossary is a SPEC §4 non-goal |
| Processing scale target (v0.1) | From a single document up to a manual with dozens of sections (SPEC §5: 200-page manual, folder of 30 MD files) |
| Processing scale expansion (roadmap) | Hundreds of documents and subscription-style automatic updates come after the v0.2 watcher (SPEC §7); MCP real-time serving in v0.3 |

**Conclusion**: v0.1 is optimized for the scale of "an individual or small team compiling manually in one go"; an always-on subscription pipeline for an organization-wide knowledge base is completed in v0.2–v0.3. This staged expansion itself matches the SPEC's positioning of "book-to-skill = snapshot, live-skill = subscription".

## 5. Reference Links

- Agent Skills spec: https://github.com/anthropics/skills , https://agentskills.io/specification
- book-to-skill (original): https://github.com/virgiliojr94/book-to-skill
- doc2skill: https://github.com/xkun1/doc2skill
- AgentCompiler (skill-compiler): https://github.com/leviathofnoesia/AgentCompiler
- agent-compiler: https://github.com/antjanus/agent-compiler

## 6. When to Re-survey

The competitive landscape is a fast-moving area (many tools appeared within a few months). Updating this document again is recommended immediately before starting T11 (public release preparation), and again before starting v0.2.
