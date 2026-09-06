# DESIGN — live-skill v0.1

이 문서가 구현의 진실의 원천이다. 산출 구조·게이트 규칙·manifest 스키마 변경은 문서 수정이 먼저다.

## 1. 아키텍처

```
CLI (compile / validate / eval / report)
  │
  ▼
core/pipeline.ts
  extract ─► outline ─► distill ─► assemble ─► validate(구조) ─► gate(의미) ─► emit + manifest
     │          │          │           │            │                │
  Extractors  LlmProvider LlmProvider  결정론 템플릿   결정론 검사      qaGen(LLM) → answerer(격리) → grader(LLM+앵커)
```

- **LLM이 개입하는 단계는 outline·distill·qaGen·answerer·grader 뿐.** 조립·구조검증·manifest는 결정론.
- 두 소비자(파일 스킬, v0.3 MCP)는 같은 산출물을 읽는다 — 서빙층이 늘어도 컴파일 코어는 불변.

## 2. 핵심 인터페이스 (core/types.ts)

**T1 결정(2026-09-06)**: `DocumentExtractor.extract()`는 예외 대신 `Result<ExtractedDoc, ExtractError>`를 반환한다 — `../msg-agent`에서 이미 검증된 패턴(`docs/PUBLISHING.md` §1)이고, TESTING §4의 "빈 문서/미지원 형식 → 수정 방법 담긴 거절"을 타입 수준에서 강제한다. `Result<T, E>`·`ok`/`err`는 `core/result.ts`. `ChapterPlan`(아웃라인 단계가 만드는, 배포 전 챕터 계획)은 기존 문서에서 참조만 되고 정의가 빠져 있어 이번에 명시한다.

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface Section { id: string; heading: string; level: number; text: string }
export interface ExtractedDoc { sections: Section[] }            // message 레포와 동일 규약(섹션 구조화)
export type ExtractError =
  | { kind: "empty_text" }
  | { kind: "corrupt"; detail: string }
  | { kind: "unsupported"; mime: string; name: string };
export interface DocumentExtractor { supports(mime: string, name: string): boolean; extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> }
export interface LlmProvider { complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string> }
export interface Clock { now(): Date }

export interface ChapterPlan { id: string; file: string; title: string; sectionIds: string[] }   // 아웃라인이 원문 섹션을 챕터로 묶은 계획
export interface SkillPlan { slug: string; title: string; chapters: ChapterPlan[] }   // outline 결과 (zod 파싱)
export interface DistilledChapter { id: string; file: string; body: string; anchors: string[] }
export interface GoldenQA { id: string; sectionId: string; question: string; refAnswer: string; anchorQuote: string }
export interface GateReport {
  passRate: number; threshold: number; passed: boolean;
  perChapter: { file: string; asked: number; correct: number }[];
  failures: { qaId: string; reason: "wrong" | "not_found" | "anchor_missing" }[];
  loadHistory: { qaId: string; selectedFile: string; loadedFiles: string[] }[];   // T7 결정: answerer 격리 감사 로그(§4-2, 완료 기준 "로드 이력") — selectedFile은 LLM이 실제로 답한 원시 문자열(존재하지 않는 경로여도 그대로 기록), loadedFiles는 그중 실제로 읽어 들인 파일(선택이 무효면 빈 배열)
}
export interface Manifest {
  version: 1; createdAt: string; sourceFiles: { path: string; sha256: string }[];
  sections: { id: string; sha256: string; chapterFile: string }[];   // v0.2 증분의 키
  outputs: string[]; gate: GateReport | { skipped: true };
  goldenQa: GoldenQA[];   // T8 결정(§6): eval이 원문 없이 재사용할 골든 QA 원본. 게이트 스킵 시 빈 배열.
}
```

섹션 id는 헤딩 경로 기반 슬러그(`core/sectionId.ts`)로 부모 헤딩 경로를 이어붙여 만든다 — 같은 문서를 다시 추출해도 같은 id가 나와야 한다(§5). 동일 경로가 중복되면 등장 순서로 `-2`, `-3`… 접미사를 붙여 구분한다.

## 3. 스킬 산출 구조 (assembler — 결정론 템플릿)

Agent Skills 표준 호환. 파일별 토큰 예산은 config 기본값이며 validator가 강제한다.

| 파일 | 내용 | 예산(기본) |
|---|---|---|
| `SKILL.md` | 핵심 멘탈 모델 + 챕터 인덱스(파일·주제·로딩 힌트) + `unverified` 표시(게이트 스킵 시) | ~4,000 tok |
| `chapters/chNN-*.md` | 챕터별 증류 본문 + 원문 앵커 각주(`[§sectionId]`) | ~1,000 tok/개 |
| `glossary.md` | 핵심 용어 — **원문 용어 그대로**, 챕터 참조 | ~1,500 tok |
| `patterns.md` | 기법·절차·안티패턴 | ~2,000 tok |
| `cheatsheet.md` | 결정 표·즉답 규칙 | ~1,000 tok |

증류 프롬프트 원칙: 요약이 아니라 구조 추출(프레임워크·규칙·절차·안티패턴), 원문 용어 보존, 모든 주장에 `[§앵커]` 부착. 앵커 없는 문장은 validator가 경고, 게이트에서 불리해진다.

**T4 결정(2026-09-06) — glossary/patterns/cheatsheet의 내용 출처**: assembler는 LLM 의존 0(완료 기준)이므로 이 세 파일을 위한 별도 LLM 호출은 만들지 않는다. 대신 `distill` 프롬프트(core/prompts.ts)가 챕터 본문(`DistilledChapter.body`) 안에 아래 인라인 표기를 쓰도록 요청하고, assembler가 **모든 챕터 본문을 결정론으로 정규식 스캔**해 세 파일을 조립한다 — 새 LLM 역할을 추가하지 않고 기존 distill 결과 하나로 충당한다:

| 표기 | 위치 | 쓰임 |
|---|---|---|
| `**용어** — 정의` | 줄 시작 | glossary.md — 용어별로 최초 정의를 취하고, 등장한 모든 챕터를 참조로 남긴다 |
| `- [PATTERN] 내용` / `- [ANTI-PATTERN] 내용` / `- [PROCEDURE] 내용` | 줄 시작 | patterns.md — 종류별로 묶어 챕터 참조와 함께 나열 |
| `- [RULE] 내용` | 줄 시작 | cheatsheet.md — 즉답 규칙으로 나열 |

표기가 없는 챕터는 세 파일에 기여하지 않을 뿐, 챕터 자체는 정상 조립된다. 챕터 본문에서 표기 줄을 제거하지 않는다 — 챕터를 단독으로 읽어도 맥락이 끊기지 않게.

**챕터 파일명은 outline이 제안한 `file`을 신뢰하지 않고 assembler가 다시 계산한다** — `chapters/chNN-슬러그.md`(`core/sectionId.ts`의 `slugifyHeading` 재사용, 챕터 순서 기반 NN). SPEC §6의 "같은 입력 재컴파일 시 manifest 해시 동일" 요구를 LLM의 파일명 제안 흔들림과 무관하게 만족시키기 위함.

**SKILL.md의 "핵심 멘탈 모델"은 v0.1에서 별도 LLM 요약이 아니라 챕터 인덱스 자체**(제목·파일·소속 원문 섹션)로 대신한다 — SkillPlan에 별도 개요 필드가 없고, 이를 위해 새 LLM 역할을 만들지 않는다. 더 나은 개요가 필요해지면 v0.2에서 outline 프롬프트에 필드를 추가하는 방향으로 재검토.

### 3.1 Validator 규칙 (T5 결정, 2026-09-06)

`core/validator.ts`가 검사한다 — 결정론, LLM 0회. `AssembledFile[]`과 형태만 같은 `{path, content}[]`를 받아 디스크에서 읽은 기존 스킬 디렉터리(`validate <skillDir>` 명령)도 그대로 검사할 수 있게 한다 — 파일 읽기 자체는 어댑터(T8) 몫.

| 검사 | 판정 | 규칙 |
|---|---|---|
| 예산 초과 | **error** | 파일마다 `estimateTokens(content)`를 경로로 판별한 예산(§3 표, `Config.budgets`)과 비교. `chapters/*.md`는 파일마다 개별로. 초과 시 강제 실패(§3 "validator가 강제한다") |
| 프런트매터 | **error** | `SKILL.md`가 없거나, `---`로 시작하는 YAML 프런트매터에 `name`·`description` 필드가 없으면 실패 |
| 챕터 링크 | **error** | `SKILL.md` 본문에서 역따옴표로 감싼 `chapters/*.md` 경로를 전부 뽑아, 실제로 주어진 파일 목록에 그 경로가 있는지 확인 — 없으면 깨진 링크 |
| 앵커 비율 | **warning** | 챕터 파일마다 헤딩·빈 줄을 뺀 실질 줄 중 `[§`를 포함하지 않는 비율을 계산, 기본 50% 초과 시 경고(§3 "앵커 없는 문장은 validator가 경고") — 게이트 실패 원인은 아니지만 리포트에 남는다 |

`ValidationReport.passed`는 error가 하나도 없을 때만 true — warning은 통과를 막지 않는다.

## 4. 품질 게이트 (core/gate.ts) — 제품의 심장

1. **qaGen**: 섹션당 k개(기본 3) 골든 Q&A 생성. 각 항목은 원문 인용(`anchorQuote`) 필수 — 인용이 원문에 실존하는지 문자열 검사(결정론)로 확인, 불합격 문항은 폐기 후 재생성 1회. 재생성 후에도 실패하면 그 문항은 제외(집계에도 안 들어간다).
2. **answerer (격리 시뮬레이터)**: 실제 에이전트의 점진 로딩을 재현한다 — 컨텍스트에 `SKILL.md`만 주고 챕터 선택을 시키고, 선택된 챕터 파일만 추가 로드해 답하게 한다. **원문·미선택 챕터는 절대 주입하지 않는다** (CLAUDE.md 가드레일 2). 로드 이력은 리포트에 기록(`GateReport.loadHistory`, §2).
3. **grader**: 이중 채점 — (a) 루브릭 LLM 채점(정답 요지 일치) AND (b) 답변이 refAnswer의 앵커 사실과 모순되지 않는지. 판정은 보수적으로: 불확실하면 오답 처리.
4. **판정**: passRate ≥ threshold(기본 0.9) → 배포. 미달 → 산출물은 임시 디렉터리에 남기고 약한 챕터 지목 리포트 반환(`report` 명령으로 재열람).

**T7 결정(2026-09-06) — 문항별 처리 순서와 `GateFailureReason` 매핑**: 골든 QA 하나마다 아래 순서로 진행하고, 실패하면 그 시점에서 멈춘다(뒤 단계는 부르지 않는다 — 비용도 아끼고 원인도 명확해진다):

1. `chapterSelectionPrompt`로 챕터 선택 → 선택된 파일이 실제로 조립된 챕터 목록에 없으면 **`not_found`**(챕터 누락 주입 테스트가 정확히 이 경로를 잡는다).
2. 선택된 챕터 파일의 본문에 `anchorQuote`가 실제로 있는지 확인(결정론, 문자열 포함 검사) → 없으면 **`anchor_missing`**(distill이 증류하며 그 사실을 놓치거나 바꿔 썼다는 신호 — qaGen 시점 검사와 별개로, "조립된 산출물"에도 앵커가 살아있는지 한 번 더 본다). 그레이더는 부르지 않는다.
3. 위 둘을 통과하면 `answerPrompt`로 선택된 챕터 **하나만** 로드해 답변 생성 → `gradePrompt`(이중 채점을 한 번의 호출로 묻는다, `core/prompts.ts` T3 결정)로 채점 → WRONG이면 **`wrong`**.

**비용 가드(정정)**: DESIGN 초안의 산식은 answerer가 1회 호출이라고 가정했지만, T3에서 answerer는 항상 2회(선택 1 + 답변 1)로 확정됐다. 정확한 게이트 호출 수 = **섹션수×1(qaGen, 섹션당 한 번에 k개) + 섹션수×k×3(선택+답변+채점, 단 `not_found`/`anchor_missing`으로 조기 종료되면 그만큼 덜 든다 — 이 산식은 상한선)**. `core/pipeline.ts`(T6)는 outline 응답으로 챕터·섹션 수를 안 직후, distill을 시작하기 전에 **컴파일 호출 수 + 이 게이트 상한선**을 합쳐 `MAX_LLM_CALLS`와 비교한다(§5.1 갱신) — k 자동 축소 제안은 v0.2로 미루고, v0.1은 초과 시 즉시 중단 안내로 충분하다(우회 없음, 가드레일 6).

**T8 결정 — `runGate`를 생성/평가로 분리**: `eval` 명령(§6)이 원문 없이 기존 골든 QA를 재사용해 재채점하려면, "이미 만들어진 QA를 채점만 하는" 경로가 core/gate.ts에 따로 있어야 한다. 그래서 `evaluateGoldenQa(qas, chapters, files, llm)`(qaGen 생략, 2~4단계만)를 export하고, `runGate()`는 이제 섹션마다 `generateGoldenQa`로 문항을 만든 뒤 `evaluateGoldenQa`에 위임해 `{ report: GateReport, goldenQa: GoldenQA[] }`를 반환한다(기존엔 `GateReport`만 반환했다) — 생성된 QA 자체를 manifest에 남기기 위함(§2 `Manifest.goldenQa`).

## 5. Manifest와 v0.2 준비

- 모든 컴파일은 `manifest.json`을 스킬 디렉터리에 남긴다 (§2 스키마).
- v0.2 `update`는 소스 재해시 → 변한 섹션만 distill·해당 챕터만 재조립·해당 문항만 재평가하는 설계가 되도록, **섹션 id는 안정적**(헤딩 경로 기반 슬러그)이어야 한다. v0.1에서 이 안정성까지 구현·테스트한다.

### 5.1 파이프라인 (`core/pipeline.ts`) — T6 결정 (2026-09-06), T7이 게이트 연결(2026-09-06)

`extract → outline → distill → assemble → validate → gate`를 오케스트레이션한다.

- **소스 여러 개일 때 섹션 id 충돌 방지**: 폴더 컴파일(SPEC §5 시나리오 2, 마크다운 30개)처럼 소스 파일이 2개 이상이면, 각 파일의 섹션 id 앞에 그 파일명 기반 슬러그를 붙인다(`{파일슬러그}/{sectionId}`) — 서로 다른 파일에 같은 이름의 섹션(둘 다 "Overview" 등)이 있어도 manifest에서 충돌하지 않게. 소스가 1개면 접두어를 붙이지 않는다(단일 문서 시나리오의 id를 불필요하게 바꾸지 않기 위해).
- **비용 상한(MAX_LLM_CALLS, T7이 게이트 비용 포함하도록 갱신)**: outline 응답으로 챕터·섹션 수를 알게 된 직후, distill을 시작하기 전에 `1(outline) + 챕터 수(distill) + 게이트 상한선(§4 T7 결정 산식)`의 합을 `config.maxLlmCalls`와 비교한다. 넘으면 즉시 중단하고 문서를 나누거나 상한을 올리라는 안내와 함께 실패한다(우회 플래그 없음, 가드레일 6). `--no-gate`(파이프라인 `gate: "skip"`)면 게이트 상한선은 0으로 친다.
- **거대 입력 가드**: outline을 부르기 전에, 추출된 전체 섹션 텍스트의 `estimateTokens` 합이 `MAX_INPUT_TOKENS`(기본 30,000 — 산출 예산 합계의 몇 배 수준으로 넉넉히 잡은 상수)를 넘으면 LLM 호출 0회로 즉시 거절하고 문서를 나눠서 다시 컴파일하라고 안내한다.
- **앵커 추출**: distill 응답(마크다운 본문) 안의 `[§sectionId]`를 정규식으로 스캔해 `DistilledChapter.anchors`를 만든다 — 결정론, LLM에게 별도로 묻지 않는다.
- **게이트 연결(T7)**: assemble을 `verified:false`로 한 번 조립해 게이트(§4)에 넘긴다(게이트의 answerer는 이 조립본의 SKILL.md·챕터 파일을 읽는다). 게이트가 끝나면 `verified: report.passed`로 **다시 조립**(순수 함수라 한 번 더 불러도 비용이 없다)해 최종 SKILL.md의 unverified 표시를 정확하게 맞춘다. `gate: "skip"`이면 이 단계 전체를 건너뛰고 `manifest.gate = { skipped: true }`, `verified:false`로 고정(기존 T6 동작 그대로).
- **출력 쓰기는 파이프라인 밖**: `core/pipeline.ts`는 `AssembledFile[]` + `Manifest`만 반환한다. 실제 디스크 쓰기(`--force`/out 경계 포함)는 `adapters/fsTargets.ts`가 한다 — core는 여전히 외부 IO가 없다.
- **T8 결정**: `CompileResult`에 `slug: string`(outline이 만든 `plan.slug`)을 추가한다 — `--out` 없이 `--target`만 줬을 때 CLI가 타깃 경로(`~/.claude/skills/<slug>` 등)를 계산하려면 컴파일이 끝난 뒤에야 나오는 이 값이 필요하다(§6).

## 6. CLI (src/cli/)

| 명령 | 동작 |
|---|---|
| `compile <path...> [--out DIR] [--target claude\|agents] [--no-gate] [--force]` | 전체 파이프라인. 게이트 미달 시 종료코드 1 + 리포트 |
| `validate <skillDir>` | 구조 검증만(예산·프런트매터·링크·앵커) — LLM 0회 |
| `eval <skillDir> [--source path...]` | 기존 스킬 재채점(원문 제공 시 qa 재생성, 아니면 manifest의 qa 재사용) |
| `report [skillDir]` | 마지막 GateReport 사람용 출력 |

각 명령은 `src/cli/{compile,validate,eval,report}.ts`가 `run<Command>(deps)` 형태로 구현하고(msg-agent 규약과 동일 — 모든 IO를 deps로 주입해 실제 fs/네트워크 없이 테스트한다), `src/cli/index.ts`는 commander 옵션을 이 함수들에 연결만 한다("cli는 조립만", 완료 기준).

**T8 결정(2026-09-06)**:

- **입력 경로 확장**: `<path...>`의 각 인자가 폴더면 재귀적으로 안의 모든 파일을 모은다(`node_modules`·`.git` 등 숨김 디렉터리는 건너뜀). 셸 글롭(`*.md`)은 셸이 이미 펼쳐서 넘겨주므로 CLI가 별도로 패턴을 해석하지 않는다.
- **`--target`/`--out` 해석**: `--out DIR`이 있으면 그대로 쓴다. 없으면 `--target`(기본 `claude`)에 따라 `~/.claude/skills/<slug>` 또는 `~/.agents/skills/<slug>`. `<slug>`는 outline이 만든 값이라 컴파일이 끝나야 알 수 있다 — 그래서 `compile()`의 반환값(`CompileResult`)에 `slug`를 추가했다(§5.1 갱신).
- **게이트 미달 시 임시 디렉터리 보존(완료 기준)**: 게이트를 돌렸는데 미달이면, 최종 타깃이 아니라 `os.tmpdir()`/`live-skill-<slug>-<타임스탬프>`에 산출물+manifest를 쓰고(항상 새 디렉터리라 `--force` 문제 없음) 종료코드 1과 함께 그 경로·리포트 요약을 출력한다. 통과(또는 `--no-gate`)면 정상적으로 최종 타깃에 쓰고 종료코드 0.
- **`report [skillDir]`의 "마지막"**: 별도 전역 상태 파일 없이, 주어진(또는 생략 시 현재 디렉터리 `.`) `skillDir/manifest.json`을 읽어 그 안의 `gate` 필드를 출력한다 — manifest는 그 스킬의 가장 최근 컴파일/게이트 결과 하나만 담으므로 "마지막"은 자연히 그 파일 자체가 된다.
- **`eval`의 재사용 경로**: `--source` 없이 호출하면 `manifest.goldenQa`(§2 갱신)를 그대로 재사용해 `core/gate.ts`의 `evaluateGoldenQa()`(qaGen 생략, chapter 선택→앵커 확인→답변→채점만)를 돌린다 — 원문도 추출기도 필요 없다. `--source`가 있으면 그 경로를 재추출해 섹션을 얻고(섹션 id 안정성 덕분에 manifest의 챕터별 sectionIds와 다시 맞출 수 있다, §5), `runGate()`로 qaGen부터 새로 한다. 두 경로 다 manifest를 덮어쓰지 않는다 — `eval`은 읽기 전용 진단이다.
- **`validate`/`report`/`eval`(재사용 경로)는 LLM 0회 또는 0~섹션 단위 최소 호출**: `validate`는 완전히 LLM 없이 동작(완료 기준). `eval` 재사용 경로도 qaGen을 생략하니 게이트 전체보다 호출이 훨씬 적다.

## 7. 환경변수·설정 (.env.example로 커밋)

```
ANTHROPIC_API_KEY=
MODEL=claude-sonnet-4-5      # LlmProvider 모델 문자열
GATE_THRESHOLD=0.9
QA_PER_SECTION=3
MAX_LLM_CALLS=300            # 컴파일 1회 상한
```

## 8. 디렉터리 구조 (목표)

```
live-skill/
  CLAUDE.md  README.md  package.json(bin)  .env.example
  docs/  samples/  fixtures/docs/  scripts/smoke.ts
  src/{core,adapters,mocks,cli}/
  tests/
```
