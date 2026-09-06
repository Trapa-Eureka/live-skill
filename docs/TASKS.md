# TASKS — live-skill v0.1 백로그

## 사용법

- 한 에이전트 세션 = 한 태스크. 프롬프트 템플릿:
  > `docs/SPEC.md`, `docs/DESIGN.md`, `docs/TESTING.md`를 읽고 **T6**을 수행해. 완료 기준을 전부 충족하고 `npm run check`가 통과할 때까지 스스로 수정해. 끝나면 변경 파일과 검증 결과를 요약해.
- 완료 기준은 전부 기계 판정 가능. 완료 시 상태 `DONE(날짜)` + 커밋(`T{n}: 요약`).
- 병렬 레인: T1 완료 후 **A(T2), B(T3), C(T4)** 는 서로 다른 worktree 에이전트로 동시 진행 가능. T6이 허브, T7 이후 직렬.

의존 그래프: `T0 → T1 → {A: T2, B: T3, C: T4} → T5(T4) → T6(T2~T5) → T7(T3,T6) → T8(T6,T7) → T9(T8) → T10(T9) → T11`

---

### T0 — 프로젝트 스캐폴딩 · 상태: DONE(2026-09-06)
- 목표: TS strict + ESLint + Prettier + Vitest + 스크립트(`check/test/typecheck/lint/cli/smoke`), package.json `bin` 설정(npx 실행 전제), `.env.example`, `.gitignore`.
- 참고 자료(2026-09-06 확인, 같은 저자 실전 레포): `../msg-agent`가 이 스택(TS strict+`noUncheckedIndexedAccess`, ESLint flat config+`typescript-eslint` strictTypeChecked, Prettier, Vitest+coverage 임계치, `tsx` 기반 cli/smoke, `check`/`prepublishOnly` 스크립트)을 npm 배포 수준까지 이미 구현해 뒀다 — `package.json`·`tsconfig.json`·`eslint.config.js`·`vitest.config.ts`를 이식하고 이 레포에 안 맞는 의존성(grammy·franc 등 메시징 전용)만 제거하는 편이 처음부터 설계하는 것보다 빠르고 검증됨. `.gitignore`·`LICENSE`(MIT, 저작권자 `Trapa-Eureka`)는 docs 분석 세션에서 이미 루트에 추가됨. 상세: `docs/PUBLISHING.md` §1.
- 완료(2026-09-06, PR #2): `package.json`(`bin: live-skill`)·`tsconfig(.build).json`·`eslint.config.js`·`vitest.config.ts`·`.env.example`를 msg-agent 이식으로 작성, `src/cli/index.ts`(commander, compile/validate/eval/report 4종 스텁)·`src/version.ts`·`scripts/check-tarball.sh`(msg-agent 이식)·`scripts/smoke.ts`(T10 전까지 스텁) 추가.
- 완료 기준: [x] `npm run check` 통과 [x] 더미 테스트 1개(`tests/version.test.ts`) [x] `npm run cli -- --help` 동작 [x] git init + 첫 커밋

### T1 — 도메인 타입 + config · 상태: TODO · 의존: T0
- 목표: `core/types.ts`(DESIGN §2 전체 — SkillPlan/DistilledChapter/GoldenQA/GateReport/Manifest), config zod(예산·임계치·k·상한, env 병합), 섹션 id 슬러그 규칙(헤딩 경로 기반, 안정성).
- 설계 참고(2026-09-06 확인): `../msg-agent/src/core/index.ts`의 `DocumentExtractor.extract()`는 예외 대신 `Result<ExtractedDoc, ExtractError>`를 반환한다 — TESTING §4 "빈 문서/미지원 형식 → 수정 방법 담긴 거절" 요구를 결정론적으로 표현하기 좋은 패턴. DESIGN §2의 `extract(): Promise<ExtractedDoc>`를 이 형태로 조정할지 이 태스크에서 결정하고, 채택 시 DESIGN.md를 코드보다 먼저 갱신(CLAUDE.md 컨벤션).
- 완료 기준: [ ] 전 스키마 라운드트립 테스트 [ ] 슬러그 안정성 테스트(같은 문서 재추출 → 같은 id) [ ] check 통과

### T2 (레인 A) — 추출기 4종 + 자작 픽스처 · 상태: TODO · 의존: T1
- 목표: pdf-parse·mammoth·MD/TXT·HTML(cheerio) 추출기(섹션 헤딩 구조화, message 규약 동일 시그니처) + `fixtures/docs/` 자작 3종·엣지 문서·`samples/manual.pdf` 제작.
- 참고 구현(2026-09-06 확인): `../msg-agent/src/adapters/extractors/`(`pdf.ts`·`docx.ts`·`text.ts`·`route.ts`·`limits.ts`·`index.ts`)가 CLAUDE.md가 말하는 "message 레포의 추출기 시그니처와 동일 규약"의 실체 — pdf-parse·mammoth를 그대로 쓰고 있어 직접 이식 가능(HTML/cheerio 추출기는 live-skill 신규 작성, 참고 구현 없음).
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

### T9 — e2e-mock + 커버리지 · 상태: DONE(2026-09-06) · 의존: T8
- 목표: SPEC §5 시나리오 1·2를 CLI 레벨 e2e-mock으로(통과 케이스 + 약한 챕터 리포트 케이스), 커버리지 리포트.
- 완료(2026-09-06, PR #13): `tests/e2e.test.ts` 신설 — T6의 `pipeline.test.ts`가 이미 검증한 "실 추출기 + core `compile()`" 조합보다 한 계층 위, `run<Command>()` + `adapters/fsTargets.ts`의 진짜 함수(collectInputFiles/readSourceFile/writeSkill/readSkillDir/readManifest/resolveTargetDir/tempSkillDir)까지 실제로 연결해 CLI 레벨에서 검증한다. mock은 ScriptedLlm 하나뿐(가드레일 3). 자체 제작 픽스처 3종 추가: `fixtures/docs/e2e-scenario1-manual.md`(시나리오 1 — 3섹션 2챕터 전 정답 → `--out` 스크래치 디렉터리에 실제로 쓰고 그 디렉터리를 다시 `validate`/`report`로 재확인, 게이트 통과), `e2e-scenario2-sop-{a,b}.md`(시나리오 2 — 2개 파일 폴더, 한 챕터만 grader가 의도적으로 WRONG 처리 → 게이트 미달 → 실 `tempSkillDir()`가 고른 os.tmpdir() 경로에 보존된 산출물을 다시 읽어 `perChapter`/`failures`가 정확히 그 챕터를 지목하는지 확인). DESIGN §6에 T9 결정 기록.
- 완료 기준: [x] 시나리오 2종 통과 [x] core ≥ 90% 리포트 첨부(stmt 97.83%/branch 89.22%/func 98.13%/line 99.31%, `npm run test:coverage`) [x] check 통과(19 files·175 tests)

### T10 — 스모크 · 상태: DONE(2026-09-06) · 의존: T9
- 목표: `scripts/smoke.ts` — 실 Claude로 samples/manual.pdf 컴파일 + 게이트 리포트 출력, 비용(호출 수·토큰) 요약 출력.
- 완료(2026-09-06, PR #14): `src/cli/index.ts`와 같은 원칙으로 로직(`src/cli/smoke.ts`의 `runSmoke(opts, deps)`)과 조립(`scripts/smoke.ts`)을 분리 — `compile()`을 직접 호출해 게이트 리포트만 출력하고 파일은 쓰지 않는다(진단 전용). `core/costTracker.ts`(`trackCost()`)는 `LlmProvider`를 감싸 호출 수·`estimateTokens()` 기반 추정 토큰을 센다 — `LlmProvider`/`ScriptedLlm` 인터페이스는 그대로 두고 순수 위임+카운팅만 추가(DESIGN §9).
- 완료 기준: [x] dry 구조(대본)로 스크립트 자체 테스트 — `tests/smoke.test.ts`가 실 `samples/manual.pdf`를 실 추출기로 읽되 `runSmoke`에 ScriptedLlm을 주입해 통과·미달·경로 오류·미지원 형식 4가지를 검증(실 네트워크 0건, 가드레일 3) [x] 사람 실행 절차 README 5줄 이내(README "실 LLM 스모크" 절) [x] check 통과(20 files·181 tests)

### T11 — 공개 준비 · 상태: TODO · 의존: T10
- 목표: npm 패키지명 가용성 조사(live-skill + 후보 2개, SPEC §8 기록), 영어 README 초안(내부 docs 한국어 유지), GHA `ci.yml`(npm run check), 60초 데모 시나리오(자작 샘플 사용).
- 사전 조사 완료(2026-09-06, docs 분석 세션 — 코드 착수 전): 이름 가용성 1차 확인은 SPEC §8, npm 배포 실행 순서 전체는 `docs/PUBLISHING.md`, 경쟁 구도·활용 분야는 `docs/MARKET.md`에 선반영. `LICENSE`(MIT 초안)·`.gitignore`도 이때 추가됨. 후보 2 확정·영어 README·ci.yml·데모 시나리오는 여전히 TODO — 이 세션은 코드를 작성하지 않았다(T0 선행 필요).
- 실전 선례(2026-09-06 확인, 같은 저자 npm 배포 완료/진행 레포): `../retail-mcp/docs/004_NPM_RELEASE_PACKAGING_REVIEW.md`·`008_TEST_AND_RELEASE_GATE_REVIEW.md`에 8단계 릴리스 게이트와 실제로 걸렸던 함정(`private:true` 방치, `bin`/`main` 누락, tarball에 dist 대신 소스만 포함, 파일 화이트리스트 없어 97개 파일 유출, 조직 스코프 없는 이름의 재사용 불확실성 → `@shiz_son/<name>` 전환)이 기록돼 있다. `../msg-agent/scripts/check-tarball.sh`는 이 레포 규모에 맞는 경량 시크릿 스캔 스크립트로 바로 이식 가능. `docs/PUBLISHING.md` §1·§3에 이 교훈을 이미 반영해 뒀다.
- 완료 기준: [ ] 이름 조사 결과 기록 [ ] ci.yml 문법 검증 [ ] 데모 시나리오 문서화 [ ] check 통과

---

## v0.2 대기열 (착수 금지 — SPEC 로드맵 참조)

- `watch`/`update` 증분 재컴파일(manifest 해시 diff) / URL·드라이브 소스 / ph-skill-pack(자매 레포) 착수 / EPUB / `serve`(MCP)는 v0.3
