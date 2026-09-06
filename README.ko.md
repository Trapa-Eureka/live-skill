# live-skill

[English README](README.md)

문서·폴더·URL을 **검증된 에이전트 스킬로 컴파일하고, 소스가 바뀌면 자동으로 갱신하는** TS/npm 스킬 컴파일러.

한 줄 포지셔닝: **"book-to-skill = 스냅샷, live-skill = 구독. 생성이 아니라 검증된 생성."**

네 개의 층으로 구성된다 (0은 전제, 1~3이 차별화):

- **0 컴파일(기본기)** — 문서 → Agent Skills 표준 산출물(SKILL.md 인덱스 + 챕터 + 용어집 + 패턴 + 치트시트). book-to-skill이 하는 일과 동급이며, 제품 성립의 전제.
- **2 품질 게이트 (v0.1)** — 컴파일 시 원문에서 골든 Q&A를 추출하고, **생성된 스킬 파일만으로** 그 질문에 옳게 답해야 배포를 통과. 스킬 생태계에 없는 신뢰 계층이자 이 제품의 심장.
- **1 자동 재컴파일 (v0.2)** — 소스(폴더·URL·드라이브) 워처가 변경분을 감지해 해당 섹션만 증분 재컴파일. v0.1부터 manifest에 소스 해시를 남겨 이 층의 씨앗을 심는다.
- **3 이중 서빙 (v0.3)** — 같은 산출물을 스킬 폴더(파일)로도, MCP 서버(도구)로도 서빙.

**4번(PH 비즈니스 스킬 팩)은 이 레포의 기능이 아니라, 이 엔진으로 찍어내는 첫 콘텐츠 상품**이다 — 자매 레포(가칭 ph-skill-pack)로 분리하며 v0.2부터 병행한다. 엔진은 글로벌 공개 포트폴리오, 팩은 PH 로컬 수익원.

## 문서 맵

| 문서 | 내용 | 읽는 시점 |
|---|---|---|
| `CLAUDE.md` | 에이전트 스티어링 — 스택, 명령어, 규칙, 가드레일 | 모든 에이전트 세션 시작 시 (자동 로드) |
| `docs/SPEC.md` | 제품 스펙 — 경쟁 구도, 방어력 순서, 목표/비목표, 로드맵 | 기능 논의·범위 판단 전 |
| `docs/DESIGN.md` | 기술 설계 — 파이프라인, 스킬 산출 구조, 품질 게이트, manifest | 구현 전 필독 |
| `docs/TESTING.md` | 테스트 전략 — 가짜 LLM 대본, 게이트 검증, 픽스처 규칙 | 테스트 작성 전 |
| `docs/TASKS.md` | 태스크 백로그 — 에이전트 실행 단위, 완료 기준 | 작업 배정 시 |
| `docs/WORKFLOW.md` | AI-native 개발 규칙 (공통 + 이 레포 특이사항) | 최초 1회 + 운영 중 참조 |
| `docs/MARKET.md` | 활용 분야·경쟁 구도·규모 분석 | 포지셔닝·범위 재확인 시 |
| `docs/PUBLISHING.md` | npm 배포 실행 체크리스트 (T11 확장판) | 공개 배포 착수 전 |
| `docs/DEMO.md` | 60초 데모 녹화 스크립트 (T11) | 데모·발표 준비 시 |

## 개발 방식

앞선 네 레포와 동일: **문서 → 에이전트 구현 → 검증**. 사람(Jin)은 스펙·리뷰·실 LLM 스모크·npm 공개 승인, 구현은 Claude Code가 `docs/TASKS.md` 단위로. 공통 게이트는 `npm run check`.

## 퀵스타트

```bash
npm install
npm run check                          # typecheck + lint + test — 공통 게이트
npm run cli -- compile ./samples/manual.pdf --out ./my-skill  # 컴파일 + 품질 게이트 실행
npm run cli -- validate ./my-skill     # 구조 검증만(LLM 0회)
npm run cli -- report ./my-skill       # 마지막 게이트 리포트 출력
npm run cli -- eval ./my-skill         # 기존 스킬 재평가
```

## 실 LLM 스모크 (사람 전용, `docs/TESTING.md` §5)

`.env`에 `ANTHROPIC_API_KEY`를 채운 뒤 `npm run smoke`를 실행하면 실 Claude로 `samples/manual.pdf`를 컴파일해 게이트 리포트와 비용(호출 수·추정 토큰) 요약을 출력한다(파일은 쓰지 않는다, 진단 전용). 통과율·약한 챕터가 타당한지 확인하고, 임계치·k 튜닝이 필요하면 SPEC §8에 메모를 남긴다.

## 상태

- 2026-09-06: 문서 단계 (코드 미작성). T0부터 시작.
- 2026-09-06: npm 배포 사전 분석 완료 — 경쟁 구도·활용 분야·규모(`docs/MARKET.md`), 배포 실행 체크리스트(`docs/PUBLISHING.md`) 신규 작성, `LICENSE`(MIT 초안)·`.gitignore` 추가. 패키지명 `live-skill` npm 가용 확인(SPEC §8). 코드는 여전히 미작성 — T0부터 순서대로 진행 필요.
- 2026-09-06: 형제 레포(`../msg-agent`, `../retail-mcp`) 실전 선례를 TASKS.md T0·T1·T2·T11에 교차 참조 — 같은 스택의 검증된 scaffolding·추출기 구현, npm 배포 시 실제로 걸렸던 함정(REL-001~008) 반영. T0 착수 시 처음부터 설계하지 않고 이식하는 경로가 열림.
- 2026-09-06: **T0~T10 완료** — 스캐폴딩, 도메인 타입·config, 추출기 4종, LlmProvider+ScriptedLlm, Assembler, Validator, 컴파일 파이프라인+manifest, 품질 게이트(게이트 판별력 테스트 5종 포함), CLI 4종(compile/validate/eval/report), CLI 레벨 e2e-mock, 실 LLM 스모크 스크립트까지 전부 구현·테스트·머지됨. v0.1 목표(SPEC §3) 코드 구현은 T11(공개 준비) 하나만 남았다.
- 이름 메모: 폴더/작업명은 live-skill, npm 패키지명 최종 확정은 실제 배포 직전(WORKFLOW §4, `docs/PUBLISHING.md` §3-1)에 사람이 결정 — 조사 결과는 SPEC §8·`docs/PUBLISHING.md` 참조.
