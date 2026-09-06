# TASKS — live-skill v0.1 백로그

## 사용법

- 한 에이전트 세션 = 한 태스크. 프롬프트 템플릿:
  > `docs/SPEC.md`, `docs/DESIGN.md`, `docs/TESTING.md`를 읽고 **T6**을 수행해. 완료 기준을 전부 충족하고 `npm run check`가 통과할 때까지 스스로 수정해. 끝나면 변경 파일과 검증 결과를 요약해.
- 완료 기준은 전부 기계 판정 가능. 완료 시 상태 `DONE(날짜)` + 커밋(`T{n}: 요약`).
- 병렬 레인: T1 완료 후 **A(T2), B(T3), C(T4)** 는 서로 다른 worktree 에이전트로 동시 진행 가능. T6이 허브, T7 이후 직렬.

의존 그래프: `T0 → T1 → {A: T2, B: T3, C: T4} → T5(T4) → T6(T2~T5) → T7(T3,T6) → T8(T6,T7) → T9(T8) → T10(T9) → T11`

---

### T0 — 프로젝트 스캐폴딩 · 상태: TODO
- 목표: TS strict + ESLint + Prettier + Vitest + 스크립트(`check/test/typecheck/lint/cli/smoke`), package.json `bin` 설정(npx 실행 전제), `.env.example`, `.gitignore`.
- 완료 기준: [ ] `npm run check` 통과 [ ] 더미 테스트 1개 [ ] `npm run cli -- --help` 동작 [ ] git init + 첫 커밋

### T1 — 도메인 타입 + config · 상태: TODO · 의존: T0
- 목표: `core/types.ts`(DESIGN §2 전체 — SkillPlan/DistilledChapter/GoldenQA/GateReport/Manifest), config zod(예산·임계치·k·상한, env 병합), 섹션 id 슬러그 규칙(헤딩 경로 기반, 안정성).
- 완료 기준: [ ] 전 스키마 라운드트립 테스트 [ ] 슬러그 안정성 테스트(같은 문서 재추출 → 같은 id) [ ] check 통과

### T2 (레인 A) — 추출기 4종 + 자작 픽스처 · 상태: TODO · 의존: T1
- 목표: pdf-parse·mammoth·MD/TXT·HTML(cheerio) 추출기(섹션 헤딩 구조화, message 규약 동일 시그니처) + `fixtures/docs/` 자작 3종·엣지 문서·`samples/manual.pdf` 제작.
- 완료 기준: [ ] 형식별 구조 추출 테스트 [ ] 저작권 텍스트 부재(자작 확인 주석) [ ] check 통과

### T3 (레인 B) — LlmProvider + ScriptedLlm · 상태: TODO · 의존: T1
- 목표: `LlmProvider` 인터페이스 + Claude 어댑터(주입 fetch, MODEL env) + `ScriptedLlm`(역할 라우팅·순차 재생·assert_exhausted) + `script()` 빌더 + 프롬프트 5종(outline/distill/qaGen/answer/grade — 원문 용어 보존·앵커 필수·보수 채점 명시).
- 완료 기준: [ ] 대본 소진·역할 불일치 명확 실패 테스트 [ ] 목 fetch 요청 형태 테스트 [ ] check 통과

### T4 (레인 C) — Assembler (결정론 조립) · 상태: TODO · 의존: T1
- 목표: DistilledChapter[] → 5파일 산출(DESIGN §3 템플릿), 토큰 예산 계산, unverified 표시 삽입 로직.
- 완료 기준: [ ] 고정 입력 스냅샷 일치 [ ] 예산 계산 단위 테스트 [ ] LLM 의존 0 (import 검사) [ ] check 통과

### T5 — Validator (구조 검증) · 상태: TODO · 의존: T4
- 목표: 예산·프런트매터·챕터 링크·앵커 비율 검사, `validate` 명령용 리포트 타입.
- 완료 기준: [ ] TESTING §3 validator 4항목 검출 테스트 [ ] LLM 0회 보장 [ ] check 통과

### T6 — 컴파일 파이프라인 + manifest · 상태: TODO · 의존: T2, T3, T4, T5
- 목표: extract→outline→distill→assemble→validate 오케스트레이션, Manifest 기록(소스·섹션 해시), 비용 상한 산식, `--force`/out 경계.
- 완료 기준: [ ] 정상 대본 e2e(게이트 제외) 통과 [ ] manifest 결정론(TESTING §3) [ ] 상한·덮어쓰기·경계 케이스(TESTING §4 파이프라인 항목) [ ] check 통과

### T7 — 품질 게이트 · 상태: TODO · 의존: T3, T6
- 목표: qaGen(앵커 실존 검사·재생성 1회) → answerer 격리 시뮬레이터(SKILL.md→챕터 선택→선택 파일만 로드, 로드 이력 기록) → 이중 채점 → 판정·GateReport.
- 완료 기준: [ ] **TESTING §4 "게이트 판별력" 5항목 전부** (훼손 주입 검출 포함) [ ] **격리 2항목 전부** [ ] check 통과

### T8 — CLI 4종 · 상태: TODO · 의존: T6, T7
- 목표: `compile/validate/eval/report` (DESIGN §6), 종료코드 규약, 게이트 미달 시 임시 디렉터리 보존.
- 완료 기준: [ ] TESTING §4 CLI 관련 항목(eval 재사용·report·종료코드) [ ] cli는 조립만(로직 없음) [ ] check 통과

### T9 — e2e-mock + 커버리지 · 상태: TODO · 의존: T8
- 목표: SPEC §5 시나리오 1·2를 CLI 레벨 e2e-mock으로(통과 케이스 + 약한 챕터 리포트 케이스), 커버리지 리포트.
- 완료 기준: [ ] 시나리오 2종 통과 [ ] core ≥ 90% 리포트 첨부 [ ] check 통과

### T10 — 스모크 · 상태: TODO · 의존: T9
- 목표: `scripts/smoke.ts` — 실 Claude로 samples/manual.pdf 컴파일 + 게이트 리포트 출력, 비용(호출 수·토큰) 요약 출력.
- 완료 기준: [ ] dry 구조(대본)로 스크립트 자체 테스트 [ ] 사람 실행 절차 README 5줄 이내 [ ] check 통과

### T11 — 공개 준비 · 상태: TODO · 의존: T10
- 목표: npm 패키지명 가용성 조사(live-skill + 후보 2개, SPEC §8 기록), 영어 README 초안(내부 docs 한국어 유지), GHA `ci.yml`(npm run check), 60초 데모 시나리오(자작 샘플 사용).
- 완료 기준: [ ] 이름 조사 결과 기록 [ ] ci.yml 문법 검증 [ ] 데모 시나리오 문서화 [ ] check 통과

---

## v0.2 대기열 (착수 금지 — SPEC 로드맵 참조)

- `watch`/`update` 증분 재컴파일(manifest 해시 diff) / URL·드라이브 소스 / ph-skill-pack(자매 레포) 착수 / EPUB / `serve`(MCP)는 v0.3
