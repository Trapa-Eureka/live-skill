# TESTING — live-skill

목적: 실 LLM 없이 컴파일 배관과 **게이트의 판별력**을 로컬 결정론으로 증명한다. "게이트가 나쁜 스킬을 실제로 잡아내는가"가 이 제품의 가설이므로, 그 증명이 테스트 스위트의 중심이다.

## 1. 원칙

- 테스트 네트워크·실 LLM 호출 0건. LLM 5역할(outline·distill·qaGen·answerer·grader)은 전부 `ScriptedLlm` 대본으로.
- 조립·구조검증·manifest·앵커 검사는 결정론이므로 스냅샷·해시로 못박는다.
- 픽스처·샘플은 **자체 제작 문서만** (저작권 텍스트 금지 — CLAUDE.md 가드레일 4).
- `npm run check` = typecheck + lint + test, 수 초 내. 실 LLM은 `npm run smoke`에만.

## 2. 목·픽스처 구성

| 구성요소 | 내용 |
|---|---|
| `ScriptedLlm` | 역할 라우팅 대본(system 프롬프트 태그로 판별) + 순차 재생 + `assert_exhausted`. 소진·불일치 시 명확 실패 |
| `script()` 빌더 | `script().outline({...}).distill("ch01", ...).qa(...).answer(...).grade("correct")` 식 조립 |
| `FixtureExtractor` | 확장자→고정 ExtractedDoc. 실 추출기(pdf-parse/mammoth)는 자체 제작 샘플 파일로 별도 단위 테스트 |
| fixtures/docs/ | 자작 샘플 3종: `manual/`(기술 매뉴얼풍, 12섹션), `regulation/`(규정풍, 조항 구조), `mixed-unicode/`(영·한·타갈로그 혼합) + 빈 문서, 예산 초과용 거대 문서 |
| `FixedClock` | manifest 타임스탬프 결정론 |

## 3. 골든 케이스 (결정론 층)

- assembler: 고정 DistilledChapter 입력 → 산출 5파일 스냅샷 일치, 토큰 예산 계산 검증
- 앵커 검사: `anchorQuote`가 원문에 없는 QA 문항 → 폐기·재생성 1회 → 그래도 유효 문항이 0개인 섹션은 **미검증**(`qa_generation_failed`, 게이트 통과 불가), 부족분은 `coverage`에 기록(B2 — 예전 "문항 제외"는 가드레일 1과 충돌해 폐기)
- manifest: 같은 입력 2회 컴파일 → sections 해시·chapterFile 매핑 동일 / 섹션 id 안정성(헤딩 경로 슬러그) 검증
- validator: 예산 초과 챕터, 깨진 링크, 앵커 없는 문장 비율 경고 각각 검출

## 4. 필수 엣지 케이스 체크리스트

**게이트 판별력 (제품 가설 증명 — 삭제·완화 금지)**
- [ ] 정상 대본: 훼손 없는 증류 + 정답 answer 대본 → passRate 1.0, 배포됨
- [ ] **챕터 누락 주입**: 한 챕터를 조립에서 제거 → 해당 섹션 QA가 `not_found`로 실패 → 임계치 미달 → 미배포 + 약한 챕터 지목
- [ ] **오답 증류 주입**: 챕터 본문의 핵심 수치를 반전 → grader 대본이 앵커 모순 검출 → 미배포
- [ ] 임계치 경계: 90% 정확히 → 통과 / 1문항 차 미달 → 실패 (부동소수 처리)
- [ ] `--no-gate` → 배포되지만 SKILL.md에 unverified 표시, manifest.gate = skipped
- [ ] **문항 생성 실패 주입(B2)**: 한 챕터의 qaGen이 두 번 다 실패 → 나머지 문항이 전부 정답이어도 미통과 + `qa_generation_failed` 기록 + `coverage.generated = 0`

**answerer 격리**
- [ ] answerer 컨텍스트에 원문·미선택 챕터가 포함되면 테스트 실패 (주입 페이로드 검사)
- [ ] 로드 이력이 리포트에 기록됨

**파이프라인·CLI**
- [ ] 빈 문서 → 수정 방법 담긴 거절 / 미지원 형식(.xlsx) → 지원 형식 안내
- [ ] 거대 문서 예산 초과 → 분할 제안·중단 (우회 없음)
- [ ] MAX_LLM_CALLS 상한: 대본 호출 수가 상한 산식과 일치(비용 누수 가드)
- [ ] GATE_THRESHOLD 하한(B4): `0`·`0.49` → 설정 오류(원인+수정 방법), 공백만 있는 값 → 기본 0.9 / 질문 0개 → threshold와 무관하게 미통과
- [ ] `--force` 없이 기존 스킬 디렉터리 덮어쓰기 거부 / `--out` 밖 쓰기 시도 없음
- [ ] `eval`이 manifest의 기존 QA 재사용 경로로 동작
- [ ] 유니코드 혼합 샘플: 앵커 문자열 검사·조립 무결성
- [ ] 게이트 미달 시 종료코드 1, `report`가 마지막 리포트 출력
- [ ] manifest 의미 검증(B6): `passed=true`인데 `passRate=0`, `correct>asked`, 집계 불일치, 실패 qaId가 로드 이력에 없음, `chapterFile ∉ outputs`, 비ISO `createdAt`, 비16진수 해시 → `readManifest` 거부(사람 말 메시지) / 컴파일이 쓴 실제 manifest는 그대로 통과

**실 추출기 (샘플 파일)**
- [ ] 자작 PDF/DOCX/MD/HTML 각 1건: 섹션 헤딩 구조 추출 정확성

## 5. 수동 스모크 (사람 전용 — scripts/smoke.ts)

`npm run smoke`: 실 Claude로 `samples/manual.pdf` 1건 컴파일 → 게이트 리포트 출력 → 사람이 통과율·약한 챕터 타당성 확인, 임계치·k 튜닝 메모를 SPEC §8에 반영.

## 6. 커버리지

- `src/core/` 90% 이상 (T9 리포트). 어댑터·CLI는 스모크 보완.
