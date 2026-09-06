# MARKET — 활용 분야·경쟁 구도·규모 분석

작성: 2026-09-06 (docs 분석 세션, npm 배포 준비의 사전 조사) · 이 문서는 SPEC.md의 "확정" 스펙을 대체하지 않는다 — SPEC §1·§5를 뒷받침하는 시장 조사 기록.

## 1. 이 작업의 의의

- **Agent Skills가 실제 인프라 표준 위에 있다.** Anthropic이 2025-12-18 공개한 오픈 스펙(agentskills.io)을 2026-03 기준 Gemini CLI·JetBrains Junie·AWS Kiro·Block Goose 등 32개 툴이 채택했다. "문서를 스킬로 바꾼다"는 카테고리 자체의 존속 리스크는 낮다.
- **그러나 검증층이 있는 도구가 없다.** 아래 §2에서 조사한 6개 이상의 동일 카테고리 도구는 전부 "결정론적 1회 변환기"다. 산출된 스킬이 원문 질문에 실제로 옳게 답하는지 실측하는 도구는 발견되지 않았다. live-skill의 품질 게이트(SPEC §1 방어력 순서 2번)가 이 카테고리에서 처음으로 신뢰를 정량화하는 계층이 된다는 것이 이 프로젝트의 핵심 의의다.
- **경쟁이 이미 붐볐다는 것 자체가 카테고리 검증**이다. 대표 주자 book-to-skill의 원조 구현(Python, virgiliojr94)이 GitHub 12,000+★를 확보했고, 그 외에도 doc2skill·skill-compiler 등이 npm에 각자 자리를 잡았다 — 수요는 실재하며, 남은 것은 차별화(검증)다.

## 2. 경쟁 구도 (2026-09-06, npm 레지스트리·GitHub 실측)

| 이름 | 형태 | 실측 지표 | 하는 일 | 의미 검증층 |
|---|---|---|---|---|
| book-to-skill (원조) | GitHub, Python, MIT | 12,000+★, 1,389 forks | 기술서적/PDF → Claude Code 스킬 | 없음 |
| book-to-skill (npm) | npm, AncoderAI/doc2skill 배포 | — | Codex/Claude Code/Copilot CLI/Amp용 설치기 (원조와 별개 재구현) | 없음 |
| doc2skill | npm v0.7.0, MIT | 4개 버전 게시 | 웹페이지/PDF → 스킬, "1초 변환" 표방 | 없음 |
| skill-compiler (AgentCompiler) | npm v0.3.0, MIT | leviathofnoesia | 문서 → 압축 AGENTS.md 인덱스, Vercel 리서치 인용 | 없음 |
| agent-compiler | GitHub/npx, AntJanus | — | 스킬/커맨드를 CLAUDE.md·AGENTS.md에 임베드 | 없음 |
| skills.sh / skillpm / antfu/skills-npm / npm `skills` | 패키지 매니저 계층 | — | `npx skills add` 식 스킬 설치·유통(컴파일이 아님) | 해당 없음(다른 계층) |

**시사점**: 조사한 도구 중 산출물의 정답률을 원문 기준으로 채점·게이트하는 사례는 0건. SPEC §1의 "방어력 순서 2(품질 게이트) > 1·3" 가설이 이번 시장 조사로 재확인됐다(SPEC §1에 반영).

패키지 매니저 계층(skills.sh 등)은 SPEC §4가 명시한 v0.4 비목표("스킬 마켓 배포 자동화")와 인접 영역이므로, 그 시점에 `npx skills add` 호환 게시를 재검토할 근거로 남긴다.

## 3. 활용 가능 분야

SPEC §5 대표 시나리오(기술 매뉴얼, SOP 폴더, 규정 문서)를 확장하면:

- **사내 지식**: 제조·장비 매뉴얼, SOP, 온보딩 문서
- **규제·컴플라이언스**: 정책·규정 PDF 묶음 (v0.2 워처로 개정 추적과 자연 결합)
- **개발자 문서**: SDK/API 레퍼런스, 내부 아키텍처 문서 — 이 카테고리는 이미 AGENTS.md형 경쟁(skill-compiler)이 존재해 레드오션에 가까움
- **고객지원 지식베이스**: FAQ·트러블슈팅 가이드
- **교육·트레이닝 자료**, **오픈소스 프로젝트 심화 문서**
- **(자매 레포) PH 로컬 비즈니스 규정** — SPEC이 명시한 4번 레이어의 첫 콘텐츠 상품

**전제 조건**: 텍스트 추출이 가능한 소스만 v0.1 대상이다(스캔 이미지 PDF·OCR 필요 문서는 SPEC §4 비목표). 이 전제를 벗어나는 분야(예: 손글씨 문서, 스캔본 위주 법률 아카이브)는 v0.2 이후로 미룬다.

## 4. 규모 — 기능이 감당하는 범위

| 축 | 현재 설계상 한계 (DESIGN·SPEC 근거) |
|---|---|
| 입력 형식 | 텍스트형 PDF·DOCX·MD/TXT·HTML (DESIGN §1) |
| 입력 단위 | 파일 1개~폴더/글롭 일괄 (SPEC §3.1) |
| 산출 토큰 예산 | SKILL.md ~4,000 / 챕터당 ~1,000 / glossary ~1,500 / patterns ~2,000 / cheatsheet ~1,000 (DESIGN §3, config로 조정 가능) |
| 거대 문서 처리 | 예산 초과 시 분할 제안 후 중단 — 우회 없음 (TESTING §4) |
| 비용 상한 | 컴파일당 MAX_LLM_CALLS=300 기본(DESIGN §7), 게이트 호출 = 섹션수 × k(기본 3) × 3역할 |
| 언어 | 유니코드 혼합(영/한/타갈로그) 처리 검증 fixture 존재(TESTING §2) — 다국어 실사용 가능성 있으나 용어집 다국어화는 SPEC §4 비목표 |
| 처리 규모 타깃(v0.1) | 단일 문서~수십 섹션급 매뉴얼 (SPEC §5: 200쪽 매뉴얼, MD 30개 폴더) |
| 처리 규모 확장(로드맵) | 수백 문서·구독형 자동 갱신은 v0.2 워처 이후(SPEC §7), MCP 실시간 서빙은 v0.3 |

**결론**: v0.1은 "개인·소규모 팀이 수동으로 한 번에 컴파일하는" 규모에 최적화되어 있고, 조직 전체 지식베이스의 상시 구독형 파이프라인은 v0.2~v0.3에서 완성된다. 이 단계적 확장 자체가 SPEC의 "book-to-skill = 스냅샷, live-skill = 구독" 포지셔닝과 일치한다.

## 5. 참고 링크

- Agent Skills 스펙: https://github.com/anthropics/skills , https://agentskills.io/specification
- book-to-skill(원조): https://github.com/virgiliojr94/book-to-skill
- doc2skill: https://github.com/xkun1/doc2skill
- AgentCompiler(skill-compiler): https://github.com/leviathofnoesia/AgentCompiler
- agent-compiler: https://github.com/antjanus/agent-compiler

## 6. 다음 재조사 시점

경쟁 구도는 빠르게 바뀌는 영역이다(수개월 새 다수 도구 등장). T11(공개 준비) 착수 직전, 그리고 v0.2 착수 전에 이 문서를 다시 갱신할 것을 권장.
