# 003 — Full Security and Architecture Audit

검토일: 2026-09-06  
대상 저장소: `/Volumes/DevWork/work/live-skill`  
기준 커밋: `537a42ce4e3d8d0fc6a657a52f329c6368afdb32`

## 1. 감사 범위와 판단 기준

저장소 전체의 애플리케이션 보안, 아키텍처, 의존성 및 공급망, 비밀정보, 인증·인가, 설정, CI/CD, 데이터 저장, 외부 연동, LLM 신뢰 경계, 프롬프트 주입, 민감정보 유출, 로깅·모니터링 및 운영 배포 위험을 검토했다.

이 프로젝트는 로컬 npm CLI다. 웹 서버, 사용자 계정, 세션, 데이터베이스, HTTP 업로드 endpoint가 없다. 따라서 서버형 인증 우회, SQL injection, CSRF와 같은 항목은 적용 대상이 아니다. 위험도는 공격자가 입력 문서, 외부에서 받은 스킬 디렉터리 또는 LLM 출력을 조작할 수 있고 사용자가 자신의 OS 권한과 Anthropic API 키로 CLI를 실행하는 상황을 기준으로 책정했다.

이 보고서는 앞선 `001_CODE_REVIEW.md`와 `002_SECURITY_REVIEW.md`의 결과를 보존하면서 아키텍처 및 운영 배포 관점까지 통합한 감사 결과다.

## 2. 요약

- Critical: 0건
- High: 7건
- Medium: 10건
- Low: 3건
- 합계: 20건

우선 조치가 필요한 위험은 다음 네 영역에 집중된다.

1. 비신뢰 LLM 출력이 파일시스템 경로와 설치되는 스킬 콘텐츠를 결정한다.
2. 검증 모집단과 기준 데이터도 LLM 또는 외부 manifest가 결정해 품질 게이트를 우회할 수 있다.
3. answerer의 파일 허용 목록이 외부 manifest에서 유도돼 격리가 깨질 수 있다.
4. 출력 쓰기, 무결성 확인, CI 강제 및 배포 검증이 원자적·강제적이지 않다.

## 3. Critical

확인된 사항 없음. 원격 코드 실행, 관리자 권한 상승, 실제 API 키 탈취 또는 SQL/database 침해를 재현하지 않았다.

## 4. High

### AUD-001 — LLM slug를 통해 스킬 출력 루트를 벗어날 수 있음

- 영향 파일: `src/core/schemas.ts` 15–19행, `src/adapters/fsTargets.ts` 121–129행, `src/cli/compile.ts` 71–79행.
- 증거: `skillPlanSchema`는 slug를 비어 있지 않은 문자열로만 검사한다. 이전 재현에서 `../../outside`가 기본 스킬 루트 밖의 경로로 해석됐고 임시 경로도 탈출했다.
- 공격/실패 시나리오: 악성 문서가 outline 모델을 유도해 상위 경로가 포함된 slug를 반환한다. CLI는 이를 기본 타깃 또는 게이트 실패 임시 경로에 결합해 실행 사용자 권한으로 루트 밖에 산출물을 쓴다.
- 영향: 의도하지 않은 디렉터리에 `SKILL.md`, 챕터 및 manifest를 생성한다. 게이트 실패 시 `force: true`가 사용돼 기존 산출물 이름의 파일을 덮어쓸 가능성도 있다.
- 권장 조치: slug를 단일 안전 경로 구성요소로 제한하고 경로 구분자, `.`, `..`, 절대 경로를 거부한다. 모델 출력과 무관하게 최종 경로가 고정 루트 내부인지 검사한다. 임시 디렉터리는 `mkdtemp`와 신뢰된 접두사로 생성한다.
- 연관: 가드레일 5, `002_SECURITY_REVIEW.md` SEC-001.

### AUD-002 — 심볼릭 링크와 검사-쓰기 경쟁으로 외부 파일을 읽거나 쓸 수 있음

- 영향 파일: `src/adapters/fsTargets.ts` 22–43, 58–72, 82–110행.
- 증거: 경계 검사는 문자열 `relative()` 결과만 사용하고, 순회는 `stat()`, 읽기와 쓰기는 링크를 따라가는 API를 사용한다. 존재 검사와 쓰기도 분리돼 있다.
- 공격/실패 시나리오: 공격자가 입력/출력 디렉터리에 외부 경로를 가리키는 링크를 놓거나 검사 직후 경로를 바꾼다. 지원 확장자의 링크는 외부 텍스트를 읽어 LLM에 전송할 수 있고 출력 링크는 외부 파일 쓰기로 이어질 수 있다.
- 영향: 로컬 기밀의 외부 API 전송, 출력 루트 밖 파일 변경, 순환 링크로 인한 가용성 저하.
- 권장 조치: 기본적으로 링크와 일반 파일이 아닌 입력을 거부한다. 승인된 루트의 `realpath`와 대상의 실제 경로를 검증하고 방문 집합을 유지한다. 출력은 잠긴 staging 디렉터리에서 완성한 뒤 원자적으로 교체하며 링크를 따라가지 않는 파일 열기 방식을 사용한다.
- 연관: 가드레일 2·5·7, `002_SECURITY_REVIEW.md` SEC-002.

### AUD-003 — 비신뢰 문서와 모델 출력이 LLM system 지시와 설치 스킬로 승격됨

- 영향 파일: `src/core/prompts.ts` 39–58, 68–76, 81–123행, `src/core/assembler.ts` 131–163, 204–221행, `src/core/schemas.ts` 7–19행.
- 증거: 모델이 만든 `chapter.title`이 다음 distill 요청의 system 문자열에 직접 삽입된다. 합성한 개행 포함 marker가 system 필드에 들어가는 것을 재현했다. distill 본문은 검열 또는 명령 안전성 검사 없이 설치되는 스킬에 기록된다.
- 공격/실패 시나리오: 문서의 프롬프트 주입이 outline 제목과 distill 콘텐츠를 조작한다. 정상 사실에 대한 QA는 통과시키면서 downstream 에이전트용 악성 지시를 스킬 본문에 포함시킨다.
- 영향: 품질 게이트가 지식 정확성만 측정하므로 악성 명령을 포함한 스킬이 verified 상태로 설치될 수 있다. 실제 후속 피해는 스킬을 사용하는 에이전트의 권한에 달린다.
- 권장 조치: system 프롬프트는 신뢰된 상수로 유지하고 모든 문서·제목·QA·후보 답변은 명시적인 데이터 영역으로 전달한다. 각 역할에 데이터 내 지시를 따르지 않는다는 경계를 추가하고 필드 길이와 제어문자를 제한한다. 지식 정확성 게이트와 별도로 명령 안전성 분석 및 사람 검토가 끝난 후 설치하는 흐름을 둔다.
- 연관: 가드레일 1·2, `002_SECURITY_REVIEW.md` SEC-003.

### AUD-004 — 모델이 검증 모집단을 축소해 불완전한 스킬을 통과시킬 수 있음

- 영향 파일: `src/core/pipeline.ts` 157–193, 235–241행, `src/core/gate.ts` 247–258행, `src/core/schemas.ts` 7–19행.
- 증거: 아웃라인의 section ID를 입력 전체와 비교하지 않는다. 이전 재현에서 원문 두 섹션 중 하나만 계획에 넣어도 게이트가 통과하고 누락 섹션은 manifest에도 남지 않았다.
- 공격/실패 시나리오: 주입된 문서나 불안정한 모델이 어려운 섹션, 금지사항 또는 안전 제약을 아웃라인에서 제외한다.
- 영향: 평가하기 쉬운 일부 콘텐츠만으로 100% 통과해 전체 스킬이 verified로 표시된다.
- 권장 조치: 원문 섹션 전체를 모델과 독립적인 평가 모집단으로 유지한다. 모든 섹션의 정확히 한 번 배정, 알 수 없는 ID 부재, chapter ID와 section ID의 유일성을 결정론적으로 강제한다.
- 연관: 가드레일 1, `002_SECURITY_REVIEW.md` SEC-004.

### AUD-005 — QA 생성 실패를 제외해 미평가 챕터도 verified 처리됨

- 영향 파일: `src/core/gate.ts` 74–107, 223–237, 247–267행.
- 영향 문서: `docs/DESIGN.md` 100행, `docs/TESTING.md` 25행, `CLAUDE.md` 47행.
- 증거: 두 챕터 중 하나만 1문항 정답이고 다른 챕터의 QA 생성이 두 번 실패하도록 모의했을 때 `passRate=1`, `passed=true`, 실패 챕터는 `asked=0`이었다.
- 공격/실패 시나리오: 특정 섹션의 주입 문구가 qaGen을 깨뜨리거나 모델이 잘못된 JSON/인용을 반복 반환한다.
- 영향: 검증되지 않은 영역이 분모와 실패 목록에서 사라져 가드레일 1을 우회한다.
- 권장 조치: 요구된 QA 수와 실제 유효 QA 수를 별도 기록하고, 섹션·챕터 최소 커버리지 미달을 검증 실패로 처리한다. 생성 실패를 `qa_generation_failed` 같은 명시적 원인으로 보고한다. 현재 DESIGN의 “문항 제외” 정책도 상위 가드레일과 맞게 수정한다.
- 연관: 가드레일 1, `002_SECURITY_REVIEW.md` SEC-005.

### AUD-006 — 외부 manifest가 answerer의 파일 허용 목록과 정답 데이터를 동시에 통제함

- 영향 파일: `src/core/schemas.ts` 59–74행, `src/core/gate.ts` 48–59, 120–161행, `src/cli/eval.ts` 32–54행, `src/adapters/fsTargets.ts` 103–118행.
- 증거: `chapterFile: "manifest.json"`이 Zod 검증을 통과한다. 이 manifest로 eval을 수행하는 모의 재현에서 `goldenQa.refAnswer`에만 존재한 marker가 answerer 컨텍스트에 유입됐고 `manifest.json`이 loadedFiles에 기록됐다.
- 공격/실패 시나리오: 외부에서 받은 스킬 디렉터리가 manifest의 chapterFile과 golden QA를 조작한다. answerer가 정답을 포함한 manifest 자체를 챕터로 읽는다.
- 영향: answerer 격리와 평가 독립성이 무너지고 조작된 스킬이 통과할 수 있다. 디렉터리의 다른 텍스트 파일 또는 링크와 결합하면 민감정보도 모델에 전달될 수 있다.
- 권장 조치: 허용 파일은 코드가 결정한 `chapters/*.md` 일반 파일로 제한한다. manifest, QA 저장소, 원문 및 임의 부속 파일을 평가 로더에서 제외한다. manifest의 상호 참조·outputs·실제 파일 목록을 검증하고, 외부 QA는 신뢰된 서명이나 제공된 원문으로 재생성하기 전에는 평가 기준으로 사용하지 않는다.
- 연관: 가드레일 1·2, `002_SECURITY_REVIEW.md` SEC-006.

### AUD-007 — 출력이 원자적이지 않아 통과한 스킬 디렉터리가 혼합·부분 상태로 남을 수 있음

- 영향 파일: `src/adapters/fsTargets.ts` 51–73행, `src/cli/compile.ts` 71–92행, `src/cli/report.ts` 9–22행.
- 증거: 파일을 순차적으로 최종 경로에 직접 쓴다. 모의 파일시스템에서 두 번째 파일 쓰기를 실패시켰을 때 첫 번째 파일은 이미 갱신됐고 manifest는 기록되지 않았다. `--force`는 이전 산출물 중 새 outputs에 없는 파일도 정리하지 않는다.
- 공격/실패 시나리오: 디스크 부족, 프로세스 종료 또는 동시 컴파일로 일부 새 파일과 일부 이전 파일이 섞인다. 이전 manifest가 남아 있으면 `report`는 과거 PASSED를 그대로 출력할 수 있다.
- 영향: 실제 스킬 콘텐츠와 표시된 검증 결과가 달라지고, 운영자는 손상된 결과를 검증 완료로 오인한다.
- 권장 조치: 동일 파일시스템 staging 디렉터리에 전체 산출물을 쓰고 내용 해시와 구조를 확인한 뒤 원자적으로 교체한다. manifest는 산출 파일별 해시를 포함하고 최종 커밋 지표 역할을 하게 한다. 실패 시 이전 완전한 세대를 유지하며 동시 실행 잠금을 추가한다.

## 5. Medium

### AUD-008 — 환경변수 하나로 질문 0개를 정상 통과시킬 수 있음

- 영향 파일: `src/core/config.ts` 23–29, 49–73행, `src/core/gate.ts` 223–234행, `src/cli/index.ts` 23–28행.
- 증거: `GATE_THRESHOLD=0`을 설정하고 QA 0개를 평가하면 `passRate=0`, `passed=true`가 됐다.
- 공격/실패 시나리오: 현재 디렉터리의 비신뢰 `.env` 또는 실행 환경 설정이 검증 기준을 0으로 낮춘다.
- 영향: `--no-gate`와 달리 unverified 표시 없이 무검증 통과한다.
- 권장 조치: 질문 0개는 threshold와 관계없이 실패시킨다. 제품 정책상 최소 threshold를 강제하고 실제 적용 설정을 manifest와 리포트에 기록한다. 공백 문자열은 0이 아닌 미설정 또는 오류로 처리한다.
- 연관: 가드레일 1.

### AUD-009 — 호출 수와 토큰 예산이 모든 경로에서 강제되지 않음

- 영향 파일: `src/core/gate.ts` 62–64, 86–107행, `src/core/pipeline.ts` 171–193행, `src/cli/eval.ts` 47–54, 85–87행, `src/core/costTracker.ts` 17–32행.
- 증거: qaGen 재시도는 compile 추정식에 빠져 있다. 이전 재현에서 상한 6회 설정에 실제 7회 호출했다. eval에는 `maxLlmCalls` 검사가 없고 cost tracker는 smoke에서 측정만 하며 중단시키지 않는다.
- 공격/실패 시나리오: 많은 QA가 들어 있는 외부 manifest 또는 반복 생성 실패로 API 호출과 입력 토큰이 예상보다 증가한다.
- 영향: 비용 소진, rate limit, 긴 실행시간 및 운영 실패.
- 권장 조치: compile/eval/smoke 공통 LLM 예산 래퍼에서 각 호출 직전에 실제 누적 호출, 요청·응답 토큰, 벽시계 시간을 검사한다. 재시도도 같은 예산에서 차감하고 manifest 배열·문자열 크기에 상한을 둔다.
- 연관: 가드레일 6.

### AUD-010 — 구조 validator가 배포 차단에 연결되지 않고 metadata를 실제로 파싱하지 않음

- 영향 파일: `src/core/pipeline.ts` 224–254행, `src/cli/compile.ts` 71–93행, `src/core/assembler.ts` 136–140행, `src/core/validator.ts` 57–95행.
- 증거: 이전 재현에서 1,000토큰 제한에 1,501토큰인 챕터가 쓰기 단계에 전달되고 종료코드 0이 됐다. `Guide: Setup` 제목의 안전하지 않은 YAML도 키 존재 검사만 통과했다.
- 공격/실패 시나리오: 모델이 예산 초과 콘텐츠나 YAML 문법을 깨는 제목을 반환하지만 CLI는 이를 설치한다.
- 영향: 배포물 소비 실패, 자원 정책 무시, 결정론 검증 경계 약화.
- 권장 조치: 의미 게이트 전에 구조 오류를 차단하고 최종 산출물을 다시 검증한다. YAML serializer와 실제 parser를 사용해 필수 필드 타입, 값 및 허용 키를 검사한다.

### AUD-011 — manifest와 GateReport의 의미적 무결성을 검증하지 않음

- 영향 파일: `src/core/schemas.ts` 32–74행, `src/core/types.ts` 75–96행, `src/cli/report.ts` 9–22행.
- 증거: `passed=true`, `passRate=0`, `asked=1`, `correct=50`처럼 상호 모순된 보고서가 Zod 스키마를 통과했다. `createdAt`도 임의 문자열이며 해시는 길이만 검사한다.
- 공격/실패 시나리오: 외부 스킬 디렉터리의 manifest를 조작해 report와 eval에 거짓 상태를 주입한다.
- 영향: 운영자가 신뢰할 수 없는 PASSED 결과를 공식 결과로 오인하고, 잘못된 QA 및 파일 매핑으로 평가한다.
- 권장 조치: `superRefine` 등으로 `correct <= asked`, 전체 집계 일치, passRate 계산, passed/threshold 일치, failures/loadHistory/QA ID 대응, ISO timestamp, 16진수 SHA-256 및 outputs/file mapping을 검증한다. 진위가 필요한 경우 manifest 서명 또는 신뢰 저장소를 사용한다.

### AUD-012 — report는 현재 산출물의 변경·손상을 탐지하지 않고 과거 결과만 표시함

- 영향 파일: `src/cli/report.ts` 9–22행, `src/core/types.ts` 87–96행, `src/core/pipeline.ts` 244–252행.
- 증거: report는 manifest만 읽고 현재 파일을 로드하거나 해시를 대조하지 않는다. manifest의 outputs에는 콘텐츠 해시가 없다.
- 공격/실패 시나리오: 컴파일 이후 챕터 파일이 수정·삭제되거나 부분 쓰기 후 이전 manifest가 남는다.
- 영향: 실제 산출물이 더 이상 검증한 콘텐츠가 아닌데도 마지막 PASSED를 출력한다.
- 권장 조치: manifest에 모든 산출물의 SHA-256과 컴파일 세대 ID를 저장한다. report 실행 시 파일 존재, 경로, 해시 및 manifest 자체의 신뢰성을 검사하고 불일치하면 STALE/TAMPERED로 실패한다.

### AUD-013 — grader의 비정상 출력이 CORRECT 접두사만으로 정답 처리됨

- 영향 파일: `src/core/prompts.ts` 105–129행, `src/core/gate.ts` 159–169행.
- 증거: `CORRECT? No, WRONG.`이 `correct`로 파싱됐다.
- 공격/실패 시나리오: 후보 답변의 주입 문구 또는 모델 불안정성으로 설명·모순이 포함된 판정이 반환된다.
- 영향: 불확실한 결과가 정답으로 집계돼 보수 채점 원칙을 약화한다.
- 권장 조치: 전체 응답을 엄격한 enum 또는 구조화 출력 스키마로 검증하고 정확히 허용된 값 이외는 실패 또는 미판정으로 처리한다.
- 연관: 가드레일 1.

### AUD-014 — 비신뢰 문서 파싱의 자원 격리가 부족함

- 영향 파일: `src/cli/compile.ts` 43–52행, `src/adapters/fsTargets.ts` 76–100행, `src/adapters/extractors/limits.ts` 8–23행, `src/adapters/extractors/docx.ts` 91–105, 126–145행.
- 증거: 파일 수·전체 바이트 제한 없이 모든 입력을 `Promise.all`로 읽는다. `Promise.race` 타임아웃은 파서를 취소하지 않으며 동기 CPU 점유도 멈추지 않는다. DOCX 검사는 ZIP을 로드한 후 비공개 `_data.uncompressedSize`에 의존한다.
- 공격/실패 시나리오: 매우 큰 폴더, 압축 폭탄, 순환 링크 또는 병리적 PDF/DOCX를 처리한다.
- 영향: 메모리 고갈, CPU 점유, 장시간 백그라운드 파싱 및 프로세스 종료.
- 권장 조치: 읽기 전 파일 수·개별/총 바이트·확장자를 제한하고 제한된 동시성을 사용한다. 파서는 종료 가능한 worker/subprocess에서 메모리·시간 제한과 함께 실행한다. 실제 압축 해제 누적 바이트를 측정한다.

### AUD-015 — LLM 실패 시 오류 처리와 비용 관측이 끊김

- 영향 파일: `src/cli/compile.ts` 58–64행, `src/cli/eval.ts` 47–54, 85–90행, `src/cli/smoke.ts` 40–62행, `src/cli/index.ts` 124행, `src/core/llmError.ts` 1–15행.
- 증거: 합성 `rate_limit` 오류를 smoke에 주입했을 때 예외가 밖으로 전파됐고 출력과 비용 요약은 0줄이었다.
- 공격/실패 시나리오: 인증 실패, rate limit, timeout 또는 외부 API 장애가 중간 단계에서 발생한다.
- 영향: 실패 단계, 재시도 가능성, 누적 비용을 알 수 없고 자동화가 비일관적인 오류 출력을 받는다.
- 권장 조치: CLI 공통 오류 경계를 두고 단계, 분류, retryable 여부, 호출·토큰 요약 및 안전한 correlation ID를 기록한다. API 원문 오류는 redaction과 제어문자 정규화를 거쳐 제한된 길이만 출력한다. 키와 원문은 로그에 남기지 않는다.

### AUD-016 — CI 성공이 main에 강제되지 않음

- 영향 파일: `.github/workflows/ci.yml` 9–45행, 저장소 GitHub branch 설정.
- 증거: GitHub API에서 저장소는 private, default branch는 main, `main.protected=false`였다. rulesets 조회는 현재 private 플랜 제한으로 403이었다. 현재 커밋의 push CI는 Node 20·22 모두 `npm ci`, check, build, tarball 검사에 성공했다.
- 공격/실패 시나리오: push 권한이 있는 사용자가 PR 또는 성공한 CI 없이 main에 직접 변경을 반영한다.
- 영향: 테스트·빌드·보안 검사가 존재해도 실제 릴리스 기준으로 강제되지 않는다.
- 권장 조치: 가능한 플랜/공개 전환 후 main 보호 또는 ruleset을 활성화해 PR, 필수 CI, stale review 해제, force push 및 삭제 금지를 강제한다. 그 전에는 릴리스 워크플로에서 정확한 커밋의 성공한 CI를 검증하는 수동 통제를 문서화한다.

### AUD-017 — 릴리스 산출물의 설치·실행 및 provenance가 자동 검증되지 않음

- 영향 파일: `package.json` 10–29행, `scripts/check-tarball.sh` 1–15행, `.github/workflows/ci.yml` 42–45행, `docs/PUBLISHING.md` 3절.
- 증거: CI는 dry-run tarball 목록 검사까지만 수행한다. 생성된 tarball을 깨끗한 디렉터리에 `--omit=dev`로 설치해 `--help`를 실행하거나 package contents를 기계적으로 검증하지 않는다. provenance/release workflow는 문서상 권장 사항이다.
- 공격/실패 시나리오: source 테스트는 통과하지만 배포된 dist가 누락·오염되거나 런타임 의존성/실행 권한 문제로 npx가 실패한다.
- 영향: 배포 후에야 장애를 발견하며 패키지 출처·빌드 연결성을 검증하기 어렵다.
- 권장 조치: `npm pack --json`으로 허용 파일 목록을 검증하고, tarball fresh install + CLI smoke를 CI와 prepublish에 추가한다. 배포는 태그·보호된 environment·OIDC provenance를 사용하고 장기 NPM_TOKEN을 최소화한다.

## 6. Low

### AUD-018 — 비밀 파일 및 tarball 검사가 일부 경로와 오류를 놓칠 수 있음

- 영향 파일: `.gitignore` 9–11행, `scripts/check-tarball.sh` 5–14행.
- 증거: `.env.production`과 `.env.staging`은 git ignore 대상이 아니었다. 합성한 `npm notice 100B .env.production` 행은 현재 정규식에 매칭되지 않았다. Git 이력 22개 커밋의 텍스트 blob 144개를 제한된 키 패턴으로 검사한 결과 일치 항목은 없었다.
- 공격/실패 시나리오: 개발자가 환경별 env 파일을 추가하거나 npm 출력 형식이 바뀌어 사람이 읽는 목록 검사가 파일을 놓친다.
- 영향: 비밀의 우발적 커밋 또는 배포 가능성. 현재 `files: ["dist"]`가 루트 env 파일 배포를 제한하므로 실제 유출이 확인된 것은 아니다.
- 권장 조치: `.env*`를 제외하고 `.env.example`만 예외 처리한다. `npm pack --json`의 구조화된 경로를 검사하고 실제 tarball의 모든 텍스트 파일에 비밀 탐지를 수행한다. 과거 이력과 CI용 전용 비밀 탐지를 추가한다.

### AUD-019 — 선언된 Node 지원 범위와 의존성 요구사항이 어긋남

- 영향 파일: `package.json` 7–8행, `package-lock.json`의 commander·vitest·eslint·pdf-parse 항목, `.github/workflows/ci.yml` 30–32행.
- 증거: package는 Node `>=20`을 선언하지만 Commander 15는 `>=22.12.0`, Vitest 5는 `^22.12.0 || ^24.0.0 || >=26.0.0`을 선언한다. 현재 GitHub의 Node 20 CI는 성공했지만 이는 의존성이 공식 지원하는 범위를 확장하지 않는다.
- 공격/실패 시나리오: 사용자가 지원된다고 표시된 낮은 Node 20 버전에서 설치·실행한다.
- 영향: 경고, 예측하지 못한 런타임 실패 및 지원 책임 불명확.
- 권장 조치: 모든 런타임 의존성이 지원하는 최소 Node 버전으로 engines·문서·CI를 맞추거나 Node 20 호환 버전을 고정한다. 개발 도구와 배포 런타임의 지원 범위를 구분한다.

### AUD-020 — 아키텍처 및 운영 문서의 상태가 현재 구현과 다름

- 영향 파일: `docs/TASKS.md` 20–52행, `docs/PUBLISHING.md` 0·2절, `README.ko.md` 51–57행.
- 증거: T1–T8과 publishing 문서 일부는 코드 미착수/TODO로 표시하지만 구현과 테스트가 존재하고 T11도 완료로 기록돼 있다.
- 공격/실패 시나리오: 신규 유지보수자 또는 자동화 에이전트가 오래된 문서를 진실의 원천으로 사용해 이미 완료된 작업을 반복하거나 필요한 릴리스 통제를 잘못 판단한다.
- 영향: 운영 오류와 통제 누락 가능성.
- 권장 조치: 현재 상태의 단일 진실의 원천을 정하고 과거 기록은 changelog로 이동한다. 보안 가드레일과 릴리스 체크리스트에는 소유자, 시행 위치와 검증 방법을 명시한다.

## 7. 요청 영역별 감사 결과

| 영역 | 결과 |
| --- | --- |
| 애플리케이션 보안 | 파일 경로, 링크, 비신뢰 문서 파싱, 모델 출력 경계에서 High/Medium 위험을 확인했다. 모델 출력을 shell/eval/child_process에 직접 실행하는 경로는 발견하지 못했다. |
| 의존성·공급망 | 2026-09-06 `npm audit --package-lock-only --ignore-scripts --json` 결과 알려진 취약점 0건이었다. lockfile의 resolved는 npm registry 경로였고 resolved 항목의 integrity 누락은 없었다. 설치 스크립트 보유 패키지는 esbuild와 선택적 fsevents였다. audit은 미공개 취약점이나 악성 패키지 부재를 보장하지 않는다. |
| 비밀정보 | 소스가 API 키를 프롬프트에 직접 넣는 경로는 발견하지 못했다. SDK는 고정 HTTPS base URL과 `logLevel: off`를 사용한다. 제한된 현재/이력 패턴 검사에서 키 일치는 없었다. AUD-002·018의 유출 경계는 남는다. |
| 인증·인가 | 앱 사용자·세션·역할 시스템은 없다. Anthropic 호출은 API 키 인증을 사용한다. CLI는 실행 사용자의 OS 권한을 상속하므로 로컬 파일 접근 통제가 실질적 권한 경계다. |
| 인프라·설정 | 서버/컨테이너/IaC는 없다. 환경변수가 품질 정책을 변경하고 출력은 홈 디렉터리 아래에 설치된다. AUD-001·007·008·019 참조. |
| CI/CD | workflow 권한은 `contents: read`, Actions는 전체 SHA로 고정, `pull_request_target`은 없다. 최근 push CI는 Node 20·22 모두 성공했다. main 미보호와 배포물 smoke/provenance 부재는 AUD-016·017. |
| 데이터베이스 | DB 드라이버, SQL, ORM, migration, 자격증명 또는 persistence 서비스가 없다. SQL injection 및 DB 권한 문제는 적용되지 않는다. |
| 제3자 연동 | 애플리케이션의 명시적 외부 호출은 고정된 Anthropic API다. URL fetch·unsafe redirect·SSRF 경로는 발견하지 못했다. 입력 문서 콘텐츠가 API에 전송된다는 제품 특성은 사용자에게 명확히 고지해야 한다. |
| LLM/AI·프롬프트 주입 | AUD-003–006·008·009·013이 핵심이다. 정확성 평가와 명령 안전성, 평가 데이터 독립성을 별도 통제로 설계해야 한다. |
| 민감정보 유출 | 원문은 outline/distill/qaGen 프롬프트로 외부 API에 전송된다. 링크 및 manifest 조작은 의도한 범위 밖 파일까지 확대할 수 있다. manifest에는 원문 인용과 정답이 평문 저장된다. |
| 로깅·모니터링 | 정상 출력은 원문 전체를 로그로 남기지 않지만 구조화된 감사 로그, 단계별 오류·비용 관측, redaction 정책이 없다. AUD-015 참조. |
| 운영 배포 | 원자적 산출물 교체, 변경 탐지, clean-install smoke, provenance, 보호된 릴리스 승인이 부족하다. AUD-007·012·016·017 참조. |
| XSS/CSRF/SSRF | 웹 렌더링·쿠키 세션·사용자 제공 URL 요청이 없어 직접 적용되는 경로를 발견하지 못했다. 생성 Markdown을 다른 웹 서비스가 렌더링할 경우 해당 렌더러가 별도 신뢰 경계다. |
| 파일 업로드 | HTTP 업로드는 없다. 대응되는 로컬 파일 ingestion 위험은 AUD-002·014다. |
| rate limiting | 공개 요청 endpoint가 없어 IP별 제한은 적용되지 않는다. 사용자 API 키 비용 상한 문제는 AUD-009에 기록했다. |
| 권한 상승 | OS 관리자 권한 획득은 확인하지 못했다. 데이터가 system 지시로 승격되는 문제는 AUD-003이다. |

## 8. 아키텍처 평가

현재 계층 분리는 명확하다.

```text
CLI → core pipeline/gate → adapters
                 ↓
          assembled skill + manifest
```

`core`가 파일 IO와 SDK에 직접 의존하지 않고 `DocumentExtractor`, `LlmProvider`, `Clock` 인터페이스를 사용하는 점은 테스트 가능성과 유지보수성에 유리하다. Claude SDK의 base URL 고정, 디버그 로깅 비활성화, SDK 재시도 기본 0, answerer의 정상 compile 경로에서 한 챕터만 로드하는 구현도 긍정적이다.

그러나 현재 신뢰 경계는 타입 계층과 일치하지 않는다. 다음 값들은 모두 비신뢰 데이터지만 타입상 검증된 도메인 객체가 된 후 권한 있는 결정에 사용된다.

```text
원문 → LLM plan → 파일 경로 / 검증 모집단
원문 → LLM distill → 설치되는 스킬 지시
외부 manifest → 허용 챕터 / 정답 / 과거 PASS
```

권장 목표 구조는 비신뢰 모델 출력, 검증된 계획, 검증 기준, 설치 산출물의 타입과 단계가 구분되는 형태다.

```text
Untrusted input
  → bounded extractor
  → untrusted model response
  → deterministic policy validation
  → candidate artifact
  → coverage + accuracy + instruction-safety gates
  → atomic signed/hashed artifact generation
  → explicit install
```

## 9. 우선순위별 개선 순서

1. AUD-001·002를 처리해 파일시스템 경계를 닫는다.
2. AUD-004·005·006·008·011로 평가 모집단, 최소 커버리지, manifest 및 비용 상한을 결정론적으로 강제한다.
3. AUD-003·013으로 프롬프트 역할과 명령 안전성 경계를 분리한다.
4. AUD-007·010·012로 산출물 세대, 원자적 쓰기, 구조 검증과 변경 탐지를 연결한다.
5. AUD-015·016·017·018로 운영 관측, CI 강제, 배포물 검증과 비밀 탐지를 강화한다.
6. AUD-019·020으로 지원 범위와 문서 상태를 맞춘다.

## 10. 검증 기록과 제한

- 저장소의 `src/`, `tests/`, `scripts/`, `docs/`, 설정, CI workflow, package metadata와 lockfile을 검토했다.
- 이전 감사와 이번 감사에서 메모리 내 모의 LLM·가상 파일시스템으로 경로 탈출, 섹션/QA 누락 통과, threshold 0 통과, manifest의 정답 유입, 비정상 grader 판정, 부분 쓰기 및 오류 관측 중단을 재현했다.
- 실제 개인 파일 접근, 파괴적 링크 공격, zip bomb, 실 LLM 프롬프트 공격, 실제 npm 배포는 수행하지 않았다.
- GitHub API 읽기 결과 저장소는 private, default branch는 main, main 보호는 false였다. rulesets 조회는 현재 private 저장소 플랜 제한으로 403이어서 별도 ruleset 존재 여부를 확인하지 못했다. Actions 기본 workflow 권한은 read였고 PR 승인 권한은 false였다.
- 최근 현재 커밋의 push CI에서 Node 20·22 작업이 모두 성공했고 각 작업은 `npm ci`, `npm run check`, build, tarball 검사를 완료했다.
- npm 보안 레지스트리 감사 결과는 알려진 취약점 0건이었다.
- 현재 추적 파일 95개와 Git 이력 22개 커밋의 텍스트 blob 144개를 제한된 API 키/private-key 패턴으로 검사했고 일치 항목은 없었다. 모든 비밀 형식과 삭제된 reflog, 로컬 미추적 파일까지 포괄하는 검사는 아니다.
- 코드와 기존 문서는 변경하지 않았다. 요청된 이 감사 보고서만 `docs/003_SECURITY_ARCHITECTURE_AUDIT.md`로 추가한다.
