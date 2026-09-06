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
}
export interface Manifest {
  version: 1; createdAt: string; sourceFiles: { path: string; sha256: string }[];
  sections: { id: string; sha256: string; chapterFile: string }[];   // v0.2 증분의 키
  outputs: string[]; gate: GateReport | { skipped: true };
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

## 4. 품질 게이트 (core/gate.ts) — 제품의 심장

1. **qaGen**: 섹션당 k개(기본 3) 골든 Q&A 생성. 각 항목은 원문 인용(`anchorQuote`) 필수 — 인용이 원문에 실존하는지 문자열 검사(결정론)로 확인, 불합격 문항은 폐기 후 재생성 1회.
2. **answerer (격리 시뮬레이터)**: 실제 에이전트의 점진 로딩을 재현한다 — 컨텍스트에 `SKILL.md`만 주고 챕터 선택을 시키고, 선택된 챕터 파일만 추가 로드해 답하게 한다. **원문·미선택 챕터는 절대 주입하지 않는다** (CLAUDE.md 가드레일 2). 로드 이력은 리포트에 기록.
3. **grader**: 이중 채점 — (a) 루브릭 LLM 채점(정답 요지 일치) AND (b) 답변이 refAnswer의 앵커 사실과 모순되지 않는지. 판정은 보수적으로: 불확실하면 오답 처리.
4. **판정**: passRate ≥ threshold(기본 0.9) → 배포. 미달 → 산출물은 임시 디렉터리에 남기고 약한 챕터 지목 리포트 반환(`report` 명령으로 재열람).

비용 가드: 게이트 총 호출 수 = 섹션수×k×(1 qaGen + 1 answer + 1 grade) 상한을 config로, 초과 예상 시 사전 고지 후 k 자동 축소 제안.

## 5. Manifest와 v0.2 준비

- 모든 컴파일은 `manifest.json`을 스킬 디렉터리에 남긴다 (§2 스키마).
- v0.2 `update`는 소스 재해시 → 변한 섹션만 distill·해당 챕터만 재조립·해당 문항만 재평가하는 설계가 되도록, **섹션 id는 안정적**(헤딩 경로 기반 슬러그)이어야 한다. v0.1에서 이 안정성까지 구현·테스트한다.

## 6. CLI (src/cli/)

| 명령 | 동작 |
|---|---|
| `compile <path...> [--out DIR] [--target claude\|agents] [--no-gate] [--force]` | 전체 파이프라인. 게이트 미달 시 종료코드 1 + 리포트 |
| `validate <skillDir>` | 구조 검증만(예산·프런트매터·링크·앵커) — LLM 0회 |
| `eval <skillDir> [--source path...]` | 기존 스킬 재채점(원문 제공 시 qa 재생성, 아니면 manifest의 qa 재사용) |
| `report [skillDir]` | 마지막 GateReport 사람용 출력 |

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
