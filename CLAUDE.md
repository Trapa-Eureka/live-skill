# CLAUDE.md — live-skill 스티어링

문서를 검증된 에이전트 스킬로 컴파일하는 npm CLI. v0.1 = 컴파일 + 품질 게이트. 스펙은 `docs/SPEC.md`, 설계는 `docs/DESIGN.md`. **공개 포트폴리오가 될 레포이므로 납품 수준 품질 유지.**

## 스택

- Node.js 20+, TypeScript **strict** (`noUncheckedIndexedAccess` 포함), npm CLI(`bin`) 배포 전제
- 추출: `pdf-parse`(텍스트형 PDF), `mammoth`(DOCX), UTF-8 직독(MD/TXT), `cheerio`+변환(HTML) — message 레포의 추출기 시그니처와 동일 규약(이식 가능)
- LLM: 자체 `LlmProvider` 인터페이스 — Claude 기본(`ANTHROPIC_API_KEY`), 모델 문자열 env
- 산출: Agent Skills 표준(SKILL.md + 보조 파일), 결정론 템플릿 조립
- 검증: Vitest + ESLint + Prettier, 스키마 `zod`

## 명령어

```bash
npm run check      # typecheck + lint + test 일괄 — 태스크 완료의 필수 게이트
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run cli -- <compile|validate|eval|report> ...   # tsx 경유 CLI
npm run smoke      # 실 LLM로 샘플 1건 컴파일+게이트 (사람 전용)
```

## 소스 레이아웃

```
src/
  core/        # 순수 로직: outline/distill 계획, assembler(템플릿), validator(구조), gate(평가 하니스), manifest — 외부 IO 없음
  adapters/    # extractors/, llmProvider(claude), fsTargets(claude·agents·copilot 스킬 디렉터리)
  mocks/       # ScriptedLlm(대본 재생), FixtureExtractor, FixedClock
  cli/         # compile.ts, validate.ts, eval.ts, report.ts — 조립만
samples/       # 자체 제작 샘플 문서 (스모크·데모용)
tests/  fixtures/docs/  scripts/
```

## 컨벤션

- 스킬 산출 구조·토큰 예산·게이트 규칙의 진실의 원천은 `docs/DESIGN.md` §3~§5. 코드와 다르면 문서 기준.
- 모든 외부 IO(추출·LLM·파일 쓰기·시계)는 인터페이스 뒤에. `core/`는 순수 계산과 계획만.
- `any` 금지. LLM 응답·CLI 인자·manifest는 경계에서 `zod` 파싱.
- 조립(assembler)과 구조 검증(validator)은 **LLM 없이 결정론** — LLM은 증류·질문 생성·채점에만.
- 에러 메시지는 원인 + 수정 방법까지.
- 커밋 메시지: `T{n}: 요약`.

## 가드레일 (위반 금지)

1. **품질 게이트 완화 금지**: 임계치를 낮추거나 실패 케이스를 제외해서 통과시키는 수정은 금지. 게이트 실패의 올바른 대응은 증류 개선 또는 리포트 반환이다. 임계치·규칙 변경은 SPEC/DESIGN 수정으로만.
2. **answerer 격리**: 게이트의 답변 시뮬레이터는 컴파일 산출물(로드한 파일)만 컨텍스트로 쓴다. 원문·전체 스킬을 몰래 주입하는 지름길 금지 — 격리 위반은 게이트를 무의미하게 만든다.
3. 테스트에서 **네트워크·실 LLM 호출 0건**. ScriptedLlm·픽스처만. 실 LLM은 `npm run smoke`에만.
4. **픽스처·샘플은 자체 제작 문서만**. 실제 서적·기사 등 저작권 텍스트를 fixtures/samples에 넣지 않는다.
5. 파일 쓰기는 지정된 out 디렉터리(스킬 타깃 또는 `--out`) 안에서만. 기존 스킬 덮어쓰기는 `--force` 없이는 거부.
6. **비용 상한 존중**: 컴파일당 LLM 호출 수·토큰 예산(config) 초과 시 분할 제안 또는 중단 안내. 우회 플래그 금지.
7. 시크릿은 `.env`만(`.env.example` 커밋). 로그에 키·원문 대량 덤프 금지.

## 작업 방식

- 한 세션 = `docs/TASKS.md`의 한 태스크. 완료 기준 전부 충족 + `npm run check` 통과까지 자가 수정 루프. 스펙 모호로 막힐 때만 질문.
- 완료 시 변경 파일·검증 결과 요약 후 종료.

## 프루닝 로그

격주 검토, 낡은 규칙 삭제 (`docs/WORKFLOW.md`).

- 2026-09-06: 최초 작성.
