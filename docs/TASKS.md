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
- 완료 기준: [x] dry 구조(대본)로 스크립트 자체 테스트 — `tests/smoke.test.ts`가 실 `samples/manual.pdf`를 실 추출기로 읽되 `runSmoke`에 ScriptedLlm을 주입해 통과·미달·경로 오류·미지원 형식 4가지를 검증(실 네트워크 0건, 가드레일 3) [x] 사람 실행 절차 README 5줄 이내(README "실 LLM 스모크" 절) [x] check 통과(21 files·181 tests)

### T11 — 공개 준비 · 상태: DONE(2026-09-06) · 의존: T10
- 목표: npm 패키지명 가용성 조사(live-skill + 후보 2개, SPEC §8 기록), 영어 README 초안(내부 docs 한국어 유지), GHA `ci.yml`(npm run check), 60초 데모 시나리오(자작 샘플 사용).
- 사전 조사 완료(2026-09-06, docs 분석 세션 — 코드 착수 전): 이름 가용성 1차 확인은 SPEC §8, npm 배포 실행 순서 전체는 `docs/PUBLISHING.md`, 경쟁 구도·활용 분야는 `docs/MARKET.md`에 선반영. `LICENSE`(MIT 초안)·`.gitignore`도 이때 추가됨. 후보 2 확정·영어 README·ci.yml·데모 시나리오는 여전히 TODO — 이 세션은 코드를 작성하지 않았다(T0 선행 필요).
- 실전 선례(2026-09-06 확인, 같은 저자 npm 배포 완료/진행 레포): `../retail-mcp/docs/004_NPM_RELEASE_PACKAGING_REVIEW.md`·`008_TEST_AND_RELEASE_GATE_REVIEW.md`에 8단계 릴리스 게이트와 실제로 걸렸던 함정(`private:true` 방치, `bin`/`main` 누락, tarball에 dist 대신 소스만 포함, 파일 화이트리스트 없어 97개 파일 유출, 조직 스코프 없는 이름의 재사용 불확실성 → `@shiz_son/<name>` 전환)이 기록돼 있다. `../msg-agent/scripts/check-tarball.sh`는 이 레포 규모에 맞는 경량 시크릿 스캔 스크립트로 바로 이식 가능. `docs/PUBLISHING.md` §1·§3에 이 교훈을 이미 반영해 뒀다.
- 완료(2026-09-06, PR #15): **이름 조사** — `live-skill`·`live-skills` 재조회로 여전히 미등록 확인, 두 번째 후보로 `skill-gate`(게이트 차별점을 이름에 반영, 미등록 확인 — `skillgate`는 이미 등록돼 있어 제외) 추가해 SPEC §8 "후보 2개" 요건 충족. 최종 확정은 실제 배포 직전으로 계속 유보(WORKFLOW §4, 위임 불가). **영어 README** — `README.md`를 영어로 교체(공개 시 GitHub/npm이 보여주는 기본 문서), 기존 한국어 내용은 `README.ko.md`로 옮기고 서로 상호 링크. `docs/`는 CLAUDE.md 방침대로 한국어 유지. **`ci.yml`** — `.github/workflows/ci.yml` 신설(Node 20/22 매트릭스로 `npm ci`→`check`→`build`→`check:tarball`, 액션 전부 커밋 SHA 고정 — retail-mcp의 공급망 교훈 반영, 이 레포 규모에 안 맞는 커버리지 필수 게이트·SBOM·서비스 컨테이너는 붙이지 않음). `actionlint`(brew, 1.7.12)로 문법·스키마 검증 통과(0 findings). **데모 시나리오** — `docs/DEMO.md`(타임라인 표 + 그대로 복사할 명령, `samples/manual.pdf` 사용) 신설, 영어 README에 축약판 링크.
- 완료 기준: [x] 이름 조사 결과 기록(SPEC §8, `docs/PUBLISHING.md` §0) [x] ci.yml 문법 검증(`actionlint` 0 findings) [x] 데모 시나리오 문서화(`docs/DEMO.md`) [x] check 통과(21 files·181 tests, 코드 변경 없음 — 문서·CI·README만)

---

## v0.1 검수 수정 태스크 (2026-09-06 — `docs/001_CODE_REVIEW.md`·`002_SECURITY_REVIEW.md`·`003_SECURITY_ARCHITECTURE_AUDIT.md` 반영)

세 리뷰(기준 커밋 `537a42c`, 원 발견 52건)를 중복 제거해 **조치 단위 30개**로 재구성했다. Critical 0 / High 10 / Medium 15 / Low 5. 원본 ID(`001-NNN`, `SEC-NNN`, `AUD-NNN`)는 근거 추적용.

**진행 규칙(2026-09-06 합의)**: 한 태스크 = 한 PR. 완료 시 커밋(영어, `R-{id}: 요약`)→푸시→PR→`main` 스쿼시 머지→양쪽 워크트리 동기화까지 자동, **다음 태스크 착수는 사용자 동의 후**. B·C·D1·E3처럼 게이트 규칙·manifest 스키마를 바꾸는 태스크는 CLAUDE.md 컨벤션대로 `DESIGN.md` diff가 코드보다 먼저다 — 이들은 가드레일 1을 완화하는 게 아니라 지금 조용히 새는 구멍을 막는 방향이다.

권장 순서는 003 §9를 따른다: A(파일시스템) → B(게이트) → C(프롬프트) → D(비용) → E(구조 검증) → F(추출 정확성) → G(오류) → H(CI·배포) → I(정합성). 의존: D2→D1, E3→A3(둘 다 `writeSkill`/manifest outputs), F3→F2(namespace 함수 공용화), B6→B3(manifest 스키마).

### A. 파일시스템 경계 — High

#### A1 — LLM slug 경로 탈출 차단 · 상태: DONE(2026-09-06) · 원본: 001-001, SEC-001, AUD-001
- 목표: `skillPlanSchema.slug`를 단일 경로 구성요소(소문자·숫자·하이픈)로 제한하고 `/`·`\`·`.`·`..`·절대 경로를 거부. `resolveTargetDir`/`tempSkillDir` 결과가 고정 루트 안인지 결합 후 재검증. 임시 디렉터리는 신뢰된 접두사 + `mkdtemp`.
- 완료(2026-09-06, PR #17): 두 겹 방어 — (1) `core/schemas.ts`의 `slugSchema`(`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤64자)로 outline 단계에서 `outline_invalid`; (2) `adapters/fsTargets.ts`가 스키마와 무관하게 `resolveTargetDir`/`tempSkillDir`에서 같은 형식을 재검사(`unsafe_slug`)하고 결합 경로가 루트의 직계 하위인지 확인(`escapes_out_dir`). `tempSkillDir`는 `mkdtemp`로 빈 디렉터리를 새로 만들어 돌려주므로 게이트 미달 경로의 `force: true` 특례와 `timestamp` 의존성을 제거. DESIGN §2·§6 갱신.
- 완료 기준: [x] `../../outside` slug → `outline_invalid` 거부 테스트(pipeline) [x] 타깃·임시 경로 경계 테스트(fsTargets 8종 × 2 + schemas 14종) [x] check 통과(219 tests)

#### A2 — 심볼릭 링크·입력 순회 경계 · 상태: DONE(2026-09-06) · 원본: 001-002/014, SEC-002, AUD-002
- 목표: `collectInputFiles`는 `lstat`으로 링크·비정규 파일을 기본 거부하고 방문 집합으로 사이클 방지. `writeSkill`/`readSkillDir`은 각 경로 구성요소를 `lstat`으로 검사해 링크를 따라 밖으로 쓰거나 읽지 않고, `realpath` 기준으로 출력 루트 내부인지 검증.
- 완료(2026-09-06, PR #18): 신뢰 경계 = "사용자가 직접 넘긴 루트"(입력 경로·outDir은 링크여도 믿고 `realpath`로 고정). 그 아래에서 `collectInputFiles`는 `lstat`으로 링크(`symlink_refused`)·비정규 파일(`not_regular_file`)을 거부하므로 링크를 따라가지 않아 순환 자체가 불가능(방문 집합 대신), 디렉터리마다 `realpath` 루트 경계 재확인. `writeSkill`은 파일별 구성요소 `lstat` → 생성 디렉터리 `realpath` 경계 → `O_NOFOLLOW` open으로 쓰기. `readSourceFile`/`readSkillDir`/`readManifest`도 no-follow 읽기. 한계(중간 디렉터리 교체 경쟁·Windows)는 DESIGN §6 A2에 기록, A3가 이어받음.
- 완료 기준: [x] 링크 사이클 입력에서 종료 테스트(`in/loop → ..` 즉시 거부) [x] 출력 내 외부 링크 → 거부 테스트(링크된 하위 디렉터리·링크된 파일, `--force`여도 외부 무손상) [x] check 통과(228 tests)

#### A3 — 원자적 staging 쓰기 · 상태: DONE(2026-09-07) · 원본: 001-012/013, AUD-007
- 목표: 같은 파일시스템의 staging 디렉터리에 전체 산출물을 쓴 뒤 `rename`으로 교체(TOCTOU·부분 쓰기 해소). 이전 세대의 stale 파일 제거. 실패 시 이전 완전한 세대 보존.
- 완료(2026-09-07, PR #19): `writeSkill`이 outDir의 realpath와 **같은 부모 아래** `mkdtemp(".<name>.live-skill-staging-")`에 전부 쓰고(A2 no-follow 쓰기 그대로) `rename`으로 통째로 교체. `--force`면 기존 세대를 `.<name>.live-skill-old-<random>`으로 비켜 놓은 뒤 올리고 지움(실패 시 되돌림); `--force` 없으면 `rename` 자체가 판정(`ENOTEMPTY` → `already_exists`, 검사-쓰기 TOCTOU 해소). outDir이 링크면 링크 대상 디렉터리를 교체해 링크는 보존. 어느 단계든 실패하면 staging 삭제·이전 세대 무손상. A2의 "outDir 안 링크 거부"는 "링크와 함께 교체되고 대상은 무손상"으로 의미가 바뀌어 테스트 갱신. 한계(force 교체 중 짧은 ENOENT 창, 잠금 없음, Windows 미검증)는 DESIGN §6 A3에 기록.
- 완료 기준: [x] 중간 쓰기 실패 시 이전 산출물 무손상 테스트(3번째 파일 EISDIR 주입 → v1 전체·manifest 보존·staging/old 잔해 0) [x] `--force` 재컴파일 후 stale 챕터 없음 테스트 [x] check 통과(233 tests)

### B. 품질 게이트 우회 (가드레일 1 직결) — High

#### B1 — outline 커버리지 검증 · 상태: DONE(2026-09-07) · 원본: 001-004, SEC-004, AUD-004
- 목표: outline 파싱 직후 입력 섹션 전체와 계획을 대조 — 모든 실질 섹션 정확히 1회 배정, 알 수 없는 ID·중복 chapter ID 거부(`outline_invalid`). "실질 섹션"(본문 없는 헤딩 등 제외 대상)은 모델 재량이 아닌 결정론 정책으로 DESIGN §5.1에 명시.
- 완료(2026-09-07, PR #20): `core/outlineCoverage.ts` 신설 — `isSubstantiveSection`(본문 `trim() !== ""`)으로 파이프라인이 모집단을 먼저 확정해 outline에 그것만 보여주고, 파싱 직후 `checkOutlineCoverage`가 누락·미지 id·섹션 중복 배정·chapter id 중복 네 가지를 한 번에 모아 `outline_invalid`(detail 포함)로 끝낸다 — distill·게이트 비용 전. `normalizeText`가 HTML 주석(`<!-- … -->`)을 지워 주석만 있던 선두 "유령 섹션"이 모집단에 끼지 않는다(자체 제작 픽스처의 가드레일 4 주석). e2e 대본은 갱신 없이 정책과 일치했고, smoke 미달 대본은 일부 섹션만 넣던 것을 4섹션 전부로 고쳐 마지막 문항 오답(3/4=75%)으로 미달을 만들도록 바꿈.
- 완료 기준: [x] DESIGN §5.1 정책 갱신 [x] 누락·중복·미지 ID 각각 거부 테스트(+chapter id 중복, 컨테이너 섹션 미제공/참조 시 거부; 단위 7종 + pipeline 6종) [x] 기존 e2e·pipeline 대본을 정책에 맞게 갱신(smoke 미달 대본·주석 제거 테스트) [x] check 통과(22 files·248 tests)

#### B2 — qaGen 실패 커버리지 · 상태: DONE(2026-09-07) · 원본: SEC-005, AUD-005
- 목표: 재생성으로도 유효 QA를 못 만든 섹션을 분모에서 빼지 않고 `qa_generation_failed` 실패 사유로 기록, 섹션 커버리지 미달이면 verified 배포 금지. DESIGN §4의 "문항 제외" 정책과 TESTING §3을 함께 수정.
- 완료(2026-09-07, PR #21): 정책을 "제외"에서 "미검증"으로 — `GateReport.coverage[{sectionId, requested, generated}]`를 추가하고 `evaluateGoldenQa`가 모집단(챕터별 sectionIds)마다 유효 문항 수를 세어, `generated === 0`인 섹션은 `failures`에 `{ qaId: "<sectionId>-q0", reason: "qa_generation_failed" }`로 올리고 `passed`의 별도 필요조건으로 삼는다(passRate는 여전히 실제로 물은 문항 기준 — 못 만든 문항을 오답으로 꾸미지 않음). `eval` 재사용 경로도 같은 함수를 타므로 manifest에서 QA가 빠진 섹션은 통과 불가(`requested`는 그때의 `config.qaPerSection`). `report` 출력에 "미검증 섹션"·"문항 부족" 절 추가. `generateGoldenQa`의 계약(0..k, 재생성 1회)은 그대로.
- 완료 기준: [x] DESIGN §2·§4·TESTING §3·§4 정책 갱신 [x] 두 챕터 중 하나 qaGen 2회 실패 → `passed=false` + 실패 목록 기록 테스트(+ 부족분만 있으면 통과, eval 재사용 경로에서 QA 없는 섹션 거부) [x] 판별력 테스트 5종 유지(6종째로 추가) [x] check 통과(22 files·253 tests)

#### B3 — manifest 챕터 허용 목록 · 상태: DONE(2026-09-07) · 원본: SEC-006, AUD-006
- 목표: `manifest.sections[].chapterFile`을 `chapters/*.md` 패턴으로 스키마 제한. gate 로더는 `chapters/` 아래 일반 파일만 로드하고 `manifest.json`·기타 파일은 answerer 컨텍스트에서 원천 제외. `readSkillDir` 결과와 `outputs` 상호 대조.
- 완료(2026-09-07, PR #22): 세 겹 — (1) 스키마 `chapterFileSchema`(`^chapters/[\p{L}\p{N}-]+\.md$`, assembler `chapterFilePath()`가 만드는 유일한 형태)로 `readManifest` 단계에서 `manifest.json`·`SKILL.md`·`chapters/../x`·하위 디렉터리 거부; (2) `evaluateGoldenQa`는 스키마를 믿지 않고 챕터 목록 중 형식에 맞는 파일만 허용 집합으로 삼아 그 집합의 파일만 로드 가능 — 나머지는 선택해도 `not_found`, 로드 이력 빈 배열, SKILL.md만 인덱스로 별도 제공; (3) `eval`은 LLM 전에 `missingChapterFiles`로 manifest 챕터의 실제 존재를 확인해 없으면 원인·수정 방법과 종료코드 1. outputs와의 상호 참조 검증은 B6(스키마 superRefine)에서.
- 완료 기준: [x] `chapterFile: "manifest.json"` manifest → 거부 테스트(거부 10종·허용 3종 + assembler 산출 경로 호환) [x] 격리 테스트(조작된 챕터 목록이 manifest.json을 가리켜도 not_found·answer 미호출·모든 프롬프트에 refAnswer 마커 부재; 디스크에 있어도 목록에 없는 챕터는 not_found) [x] check 통과(22 files·271 tests)

#### B4 — threshold 하한·질문 0개 실패 · 상태: DONE(2026-09-07) · 원본: SEC-007, AUD-008
- 목표: 질문 0개는 threshold와 무관하게 실패. `GATE_THRESHOLD`의 정책 하한을 DESIGN §7에 명시하고 config가 강제(공백 문자열은 미설정 처리, 범위 밖은 설정 오류).
- 완료(2026-09-07, PR #23): 하한 **0.5**(`GATE_THRESHOLD_FLOOR`, core/gate.ts — 사용자 제안값 동의) — `loadConfig`가 `[0.5, 1]` 밖의 값을 원인+수정 방법 담은 일반 Error로 거부(zod 원시 오류를 감싸 필드명 포함), `evaluateGoldenQa`도 `assertGateThreshold`로 재검사해 경계 우회 호출자 차단. `passed`에 `asked > 0` 명시 조건(모집단이 빈 극단 케이스까지). env의 공백만 있는 값은 `trim` 후 미설정 처리(`Number("  ")===0` 구멍). `.env.example`·DESIGN §7 주석에 범위 명시. 하한 값 변경은 코드가 아니라 DESIGN §7·가드레일 1 검토가 먼저라고 문서화.
- 완료 기준: [x] DESIGN §7 갱신(+TESTING §4 체크리스트) [x] `GATE_THRESHOLD=0` → 설정 오류 테스트(0·0.49·-1 거부, 0.5·0.9·1 허용, 공백 → 기본값, 메시지에 필드명·Fix) [x] 0문항 → `passed=false` 테스트(빈 모집단·runGate 섹션 0개·하한 미만 threshold 거부) [x] check 통과(22 files·282 tests)

#### B5 — grader 엄격 파싱 · 상태: DONE(2026-09-07) · 원본: SEC-010, AUD-013
- 목표: 응답 전체를 정규화해 정확히 `CORRECT`/`WRONG`만 인정, 그 외(모순·설명 포함)는 보수적으로 wrong.
- 완료(2026-09-07, PR #24): `parseGradeVerdict`가 응답 전체를 정규화(앞뒤 공백·마크다운 강조·따옴표·마침표 제거, 대소문자 무시)한 값이 정확히 `CORRECT`일 때만 정답 — 설명이 붙었거나 두 단어가 다 있으면 판정 불가 = wrong. DESIGN §4-3에 기록. 후보 답변의 데이터/지시 분리는 C1에서.
- 완료 기준: [x] `CORRECT? No, WRONG.` → wrong 테스트(+ 모순·설명·INCORRECT 등 8종 wrong, 장식만 붙은 5종 correct) [x] check 통과(22 files·290 tests)

#### B6 — manifest·GateReport 의미 검증 · 상태: DONE(2026-09-07) · 원본: AUD-011 · 의존: B3
- 목표: `manifestSchema.superRefine`으로 `correct ≤ asked`, 챕터 합계 = 전체, `passRate` 재계산 일치, `passed ⇔ passRate ≥ threshold`, failures/loadHistory의 qaId가 goldenQa에 존재, `createdAt` ISO, sha256 16진수, `sections[].chapterFile ∈ outputs` 검증.
- 완료(2026-09-07, PR #25): 판정 규칙을 `core/gateVerdict.ts`(`decidePassed`·하한·EPSILON)로 뽑아 gate.ts와 schemas.ts가 **같은 함수**를 쓰게 함 — 파일의 `passed`는 코드의 판정으로 재계산한 값과 같아야 통과. GateReport 내부(챕터별 `correct ≤ asked`, 유일성, `Σasked = loadHistory`, `Σcorrect = Σasked − 채점 실패`, passRate 재계산, 채점 실패 ⊆ loadHistory, `qa_generation_failed` ⇔ `generated 0`, `generated ≤ requested`, threshold ∈ [0.5, 1])과 Manifest 수준(ISO `createdAt`, 소문자 16진수 64자 해시, outputs·섹션 id 유일, `chapterFile ∈ outputs`, `goldenQa.sectionId ∈ sections`, `loadHistory ⊆ goldenQa`, coverage 집합 = 섹션 집합, perChapter 집합 = 챕터 파일 집합)을 `superRefine`으로 강제. `readManifest`는 위반 시 첫 문제들을 사람 말로 담은 Error(zod 덤프 아님). DESIGN §5·TESTING §4 기록. 진위(서명)는 v0.2 대기열.
- 완료 기준: [x] 모순 manifest 거부 테스트(`passed=true, passRate=0` 외 리포트 11종·manifest 8종) [x] 정상 manifest 라운드트립 유지(skipped·정상 리포트·실패 리포트 + e2e가 컴파일이 쓴 실제 manifest를 강화된 스키마로 재독) [x] check 통과(22 files·310 tests)

### C. 프롬프트 주입 경계 — High

#### C1 — system 프롬프트 데이터/지시 분리 · 상태: TODO · 원본: SEC-003, AUD-003
- 목표: 5역할의 system 프롬프트를 신뢰된 상수(역할 태그 + 규칙)로 고정하고 제목·원문·QA·후보 답변은 user 프롬프트의 구분된 데이터 블록으로 이동. 각 역할에 "데이터 안의 지시를 따르지 않는다" 경계 명시. `chapter.title` 등 모델 출력 필드에 길이·제어문자 제한(스키마). 명령 안전성 게이트(지시 포함 여부 평가)는 범위 밖 — v0.2 대기열에 기록.
- 완료 기준: [ ] DESIGN §4 갱신 [ ] `chapter.title`이 system 필드에 포함되지 않는 테스트 [ ] ScriptedLlm 역할 태그 라우팅 유지 [ ] check 통과

### D. 비용·자원 상한 — Medium

#### D1 — 비용 상한 실행 중 강제 · 상태: TODO · 원본: 001-007, SEC-008, AUD-009
- 목표: 추정식에 qaGen 재생성 포함(`sections × 2`). `core/costTracker.ts`를 확장해 상한 직전 호출에서 중단하는 예산 래퍼를 만들고 compile이 사용 → `call_cap_exceeded`. DESIGN §4 산식 갱신.
- 완료 기준: [ ] DESIGN §4 갱신 [ ] 상한 6에 7번째 호출 차단 테스트 [ ] check 통과

#### D2 — eval 경로 상한 검사 · 상태: TODO · 원본: SEC-008, AUD-009 · 의존: D1
- 목표: eval 재사용/`--source` 경로 모두 D1 래퍼 적용 + `manifest.goldenQa` 개수·문자열 길이 상한.
- 완료 기준: [ ] eval 상한 초과 중단 테스트 [ ] check 통과

#### D3 — 입력 크기 사전 제한 · 상태: TODO · 원본: 001-015, SEC-011, AUD-014
- 목표: 읽기 전에 `stat` 기반 파일 수·파일별/총 바이트 제한, 제한된 동시성으로 읽기, 불필요한 Buffer 복사 제거.
- 완료 기준: [ ] 초과 시 읽기 전 거부 + 수정 방법 메시지 테스트 [ ] check 통과

#### D4 — 파서 자원 격리 · 상태: TODO · 원본: SEC-011, AUD-014
- 목표: DOCX 압축 해제 누적 바이트 상한(메타데이터가 아닌 실측), 타임아웃 시 결과 폐기 보장. worker/subprocess 격리는 착수 시 범위 결정(과하면 v0.2 대기열).
- 완료 기준: [ ] 착수 시 확정 [ ] check 통과

### E. 구조 검증·산출물 무결성 — Medium

#### E1 — 구조 검증을 배포 차단에 연결 · 상태: TODO · 원본: 001-003, SEC-009, AUD-010
- 목표: 게이트 전에 `validateSkill` error면 중단(LLM 비용 절약), `--no-gate`에서도 강제, 최종 조립본 재검증. 리포트를 사용자에게 출력.
- 완료 기준: [ ] 예산 초과 챕터 → 종료코드 1·미배포·LLM 게이트 미호출 테스트 [ ] check 통과

#### E2 — YAML frontmatter 직렬화·파싱 · 상태: TODO · 원본: 001-009, SEC-009, AUD-010
- 목표: frontmatter 값을 YAML 규칙으로 이스케이프해 생성하고, validator는 실제 YAML 파싱으로 `name`/`description` 타입·값 검사.
- 완료 기준: [ ] `Guide: Setup` 제목 라운드트립 테스트 [ ] check 통과

#### E3 — report 변조·손상 탐지 · 상태: TODO · 원본: AUD-012 · 의존: A3
- 목표: manifest `outputs`에 파일별 sha256 추가(스키마 갱신), `report`/`eval`이 현재 파일과 대조해 불일치면 STALE/TAMPERED로 실패.
- 완료 기준: [ ] DESIGN §5 갱신 [ ] 챕터 수정 후 report → STALE 테스트 [ ] check 통과

### F. 추출·증류 정확성 (001 고유) — High/Medium

#### F1 — distill 2,000자 잘림 제거 · 상태: TODO · 원본: 001-005 · High
- 목표: 입력 예산 내에서는 섹션 전문을 전달. 초과 시 명시적 청크 분할·병합 또는 사용자 경고.
- 완료 기준: [ ] 2,000자 초과 섹션의 뒷부분이 distill 프롬프트에 포함되는 테스트 [ ] check 통과

#### F2 — 섹션 ID 충돌 · 상태: TODO · 원본: 001-006 · High
- 목표: 최종 ID 집합 기준으로 충돌 없는 접미사 생성(`A, A, A-2` → 3개 고유). 다중 소스 namespace를 basename 대신 입력 루트 상대 경로(또는 안정 해시) 기반으로.
- 완료 기준: [ ] `A, A, A-2` 고유 ID 테스트 [ ] 다른 폴더 같은 파일명 충돌 없음 테스트 [ ] check 통과

#### F3 — eval namespace 공용화 · 상태: TODO · 원본: 001-008 · 의존: F2
- 목표: `namespaceSections`를 공용 함수로 분리해 compile/eval 동일 적용. manifest와 매칭되지 않는 원문은 명시적 오류.
- 완료 기준: [ ] 다중 소스 스킬 `eval --source`가 QA를 생성하는 테스트 [ ] check 통과

#### F4 — HTML 표·컨테이너 텍스트 · 상태: TODO · 원본: 001-010
- 목표: DOM 단일 순회로 `td`/`th`·일반 `div` 직접 텍스트·코드·목록 구조 보존(중복 없이).
- 완료 기준: [ ] 표 픽스처(자작) 텍스트 추출 테스트 [ ] check 통과

#### F5 — Markdown 헤딩 인식 · 상태: TODO · 원본: 001-011
- 목표: 줄 단위 ATX 헤딩 인식(빈 줄 불필요), 코드 펜스 내부 `#` 제외.
- 완료 기준: [ ] 빈 줄 없는 헤딩 케이스 테스트 [ ] 코드 펜스 내 `#` 무시 테스트 [ ] check 통과

### G. 오류 처리·관측성 — Medium

#### G1 — CLI 공통 오류 경계 · 상태: TODO · 원본: 001-017, AUD-015
- 목표: compile/eval/smoke 공통 오류 경계 — `LlmProviderError.kind`·retryable·실패 단계를 사용자 메시지+종료코드로, 그 시점까지의 비용 요약 유지. 외부 오류 문구는 길이 제한·제어문자 정규화, 키·원문 미출력.
- 완료 기준: [ ] `rate_limit` 주입 시 메시지+비용 요약 출력 테스트(3경로) [ ] check 통과

### H. CI·배포 파이프라인 — Medium/Low

#### H1 — main 브랜치 보호 · 상태: TODO · 원본: AUD-016 · **코드 아님**
- 목표: 공개 전환/플랜 허용 시 ruleset(PR 필수·필수 CI·force push 금지). 그 전까지는 `docs/PUBLISHING.md` §4 사람 결정 항목에 편입하고 수동 통제를 기록.
- 완료 기준: [ ] PUBLISHING §3·§4 반영

#### H2 — tarball 설치 스모크 · 상태: TODO · 원본: AUD-017
- 목표: `npm pack` → 임시 디렉터리 `npm install --omit=dev <tgz>` → `live-skill --help` 실행 스크립트를 `prepublishOnly`·CI에 추가.
- 완료 기준: [ ] 로컬·CI 통과 [ ] check 통과

#### H3 — check-tarball.sh 구조화 · 상태: TODO · 원본: SEC-012, AUD-018
- 목표: `npm pack --dry-run --json`의 `files[].path`를 검사, 명령·읽기 오류는 실패 처리.
- 완료 기준: [ ] 합성 `.env.production` 항목 검출 확인 [ ] check 통과

#### H4 — .gitignore env 변형 · 상태: TODO · 원본: SEC-013, AUD-018
- 목표: `.env*` 제외 + `!.env.example`.
- 완료 기준: [ ] `git check-ignore .env.production .env.staging` 확인 [ ] `.env.example` 추적 유지

### I. 저수준·문서 정합성 — Low

#### I1 — `--target` 값 검증 · 상태: TODO · 원본: 001-018
- 목표: `claude|agents` 외 값은 실행 전 명시적 오류(commander `choices`).
- 완료 기준: [ ] 오탈자 → 종료코드≠0 + 메시지 테스트 [ ] check 통과

#### I2 — Node 지원 범위 정합 · 상태: TODO · 원본: 001-016, AUD-019
- 목표: 의존성(commander 15 `>=22.12`, vitest 5)이 지원하는 최소 버전으로 `engines`·CI matrix·README·CLAUDE.md를 맞추거나 Node 20 호환 버전을 고정 — 착수 시 사용자에게 방향 확인(CLAUDE.md "Node.js 20+" 변경 여부).
- 완료 기준: [ ] engines·CI·문서 일치 [ ] check 통과

#### I3 — 상태 문서 정합성 · 상태: TODO · 원본: 001-019, AUD-020
- 목표: T1~T8 상태 마커 DONE 반영, `docs/PUBLISHING.md` §0·§2의 "코드 미착수" 문구 갱신, README 상태 동기화. 과거 기록은 날짜 붙은 상태 로그로 유지.
- 완료 기준: [ ] TASKS·PUBLISHING·README 상태 일치 [ ] check 통과

---

## v0.2 대기열 (착수 금지 — SPEC 로드맵 참조)

- `watch`/`update` 증분 재컴파일(manifest 해시 diff) / URL·드라이브 소스 / ph-skill-pack(자매 레포) 착수 / EPUB / `serve`(MCP)는 v0.3
- 검수 후속(2026-09-06): 명령 안전성 게이트(지식 정확성과 별도로 스킬 본문의 지시 포함 여부 평가 — C1 범위 밖, AUD-003) / 파서 worker·subprocess 격리(D4에서 과하다고 판단 시, AUD-014) / manifest 서명·신뢰 저장소(AUD-011)
