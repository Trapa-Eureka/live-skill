# 002 — Security Review

검토일: 2026-09-06  
대상: /Volumes/DevWork/work/live-skill  
기준 커밋: 537a42ce4e3d8d0fc6a657a52f329c6368afdb32  
범위: 전체 소스, CLI, 추출기, LLM 어댑터, Zod 스키마, 테스트, 설정, 잠금 파일, CI 및 관련 Markdown. 이전 001_CODE_REVIEW.md와 중복되는 문제는 보안상 공격 조건과 영향에 집중해 다시 기록했다.

## 발견 사항 요약

Critical 0 / High 6 / Medium 6 / Low 1 — 총 13건.

이 프로젝트는 로컬 CLI이며 서버 인증·세션·DB가 없는 구조다. 아래 심각도는 공격자가 원문 문서, 가져온 스킬 디렉터리 또는 모델 응답에 영향을 줄 수 있고, 사용자가 자신의 OS 권한과 API 키로 CLI를 실행하는 상황을 기준으로 한다. 로컬 설정 변경 권한을 가진 사용자는 이미 실행 정책을 통제한다. 이를 원격 인증 우회나 OS 관리자 권한 획득으로 분류하지 않는다.

검증 수준을 각 항목에 구분했다. 메모리 내 모의 LLM 재현은 신뢰 경계와 제어 흐름의 결함을 증명하며, 실제 Claude의 공격 지시 수용률이나 외부 에이전트의 명령 실행 성공을 증명하지 않는다.

## Critical

확인된 사항 없음. 원격 코드 실행, OS 권한 상승, 실제 API 키 탈취를 재현한 것은 아니다.

## High

### SEC-001 — 모델 slug를 통한 출력 루트 탈출

- 파일: /Volumes/DevWork/work/live-skill/src/core/schemas.ts 15–18행; /Volumes/DevWork/work/live-skill/src/adapters/fsTargets.ts 122–129행; /Volumes/DevWork/work/live-skill/src/cli/compile.ts 74–79행.
- 공격 조건: outline 응답의 slug를 공격자가 유도하거나 조작할 수 있음.
- 문제: slug는 비어 있지 않은 문자열인지밖에 확인하지 않으며 기본 스킬 경로와 임시 경로에 직접 결합된다. 상대 경로 구분자와 상위 경로가 허용된다.
- 증거: 이전 리뷰의 메모리 내 재현에서 ../../outside가 /Users/a1234/outside로 해석됐다. 임시 경로도 상위 디렉터리로 탈출했다. 이번 검토에서 해당 코드가 그대로임을 확인했다.
- 영향: 지정한 스킬 루트 밖에 SKILL.md, chapters 및 manifest를 생성할 수 있다. 실패 산출물 경로는 force: true여서 기존 산출물 이름의 파일을 덮어쓸 위험이 있다. 쓰기는 실행 사용자 권한과 생성기가 정하는 파일명으로 제한되며 임의 실행 파일 덮어쓰기나 RCE를 입증한 것은 아니다.
- 권장 수정: 경로가 아닌 단일 slug 스키마를 적용하고 /, 역슬래시, 상위 경로를 거부한다. 기본 타깃의 최종 경로를 독립적으로 경계 검사한다. 실패 산출물은 신뢰된 고정 접두사와 mkdtemp로 생성하며 모델 문자열로 임시 경로를 만들지 않는다.
- 관련 가드레일: 5. 001_CODE_REVIEW.md의 001과 중복.

### SEC-002 — 심볼릭 링크를 통한 외부 파일 읽기·쓰기

- 파일: /Volumes/DevWork/work/live-skill/src/adapters/fsTargets.ts 34–43, 58–72, 85–110행.
- 공격 조건: 공격자가 입력/출력/가져온 스킬 디렉터리에 링크를 배치할 수 있음. 출력 덮어쓰기는 --force 또는 검사와 쓰기 사이의 경쟁 조건이 필요할 수 있음.
- 문제: 쓰기 경계는 문자열 기준이며 실제 쓰기는 링크를 따른다. 입력 순회도 stat 및 readFile로 링크를 따라간다.
- 증거: 정적 데이터 흐름 확인. 실제 개인 파일을 읽거나 덮어쓰는 공격은 실행하지 않았다.
- 영향: 출력 내부처럼 보이는 링크를 통해 다른 디렉터리에 파일을 쓸 수 있다. .md 같은 지원 확장자의 입력 링크가 외부의 읽기 가능한 텍스트 파일을 가리키면 그 내용이 원문으로 추출돼 LLM API에 전달될 수 있다. 가드레일 2의 파일 격리에도 영향을 준다.
- 권장 수정: 기본적으로 심볼릭 링크와 일반 파일이 아닌 입력을 거부한다. 허용 시 실제 경로가 승인된 루트 내부인지 검사한다. 검사 후 경로 교체 공격까지 고려한 파일 열기와 타깃 잠금, staging 교체를 적용한다. realpath 검사만으로 경쟁 조건까지 해결됐다고 간주하지 않는다.
- 관련 가드레일: 2, 5, 7. 이전 리뷰 002·012·014와 연관.

### SEC-003 — 비신뢰 모델 출력이 system 지시문과 설치 스킬로 승격됨

- 파일: /Volumes/DevWork/work/live-skill/src/core/prompts.ts 45–57, 68–76, 94–123행; /Volumes/DevWork/work/live-skill/src/core/schemas.ts 7–18행; /Volumes/DevWork/work/live-skill/src/core/assembler.ts 136–153, 215–220행.
- 공격 조건: 원문 문서의 지시문을 통해 outline/distill 응답을 유도할 수 있음.
- 문제: chapter.title이 system 프롬프트에 직접 삽입된다. 제목에는 개행·길이 제한이 없고, 원문·QA·후보 답변도 신뢰되지 않은 데이터라는 구분 없이 후속 프롬프트에 결합된다. distill 본문은 설치되는 스킬에 그대로 남는다.
- 증거: 가상의 SYSTEM_OVERRIDE_MARKER를 포함한 chapter.title이 distill 요청의 system 필드에 들어가는 것을 재현했다. 모델이 이를 실제로 따르는지는 실 LLM으로 시험하지 않았다.
- 영향: 낮은 신뢰도의 문서·모델 텍스트가 높은 우선순위의 지시로 취급될 가능성이 있다. 정상 사실 몇 개에 대한 QA가 통과해도, 스킬에 숨겨진 악성 지시가 안전하다는 뜻은 아니다. downstream 에이전트에서의 실행 영향은 해당 에이전트 권한에 달린다.
- 권장 수정: system 문구는 신뢰된 상수로 유지하고 제목과 문서는 별도 구조화된 데이터 필드로 전달한다. 각 역할에 데이터 내 지시를 실행하지 말라는 경계를 명시하고 필드 크기·형식도 검증한다. 컴파일 산출물은 지식 정확성과 별도로 지시 안전성을 평가하며, 비신뢰 원문의 자동 설치에 검토/격리 경계를 마련한다. 프롬프트 문구나 문자열 필터만으로 완전한 방어를 주장하지 않는다.
- 관련 가드레일: 1, 2.

### SEC-004 — 모델이 평가할 원문 범위를 축소해 게이트를 우회할 수 있음

- 파일: /Volumes/DevWork/work/live-skill/src/core/pipeline.ts 159–193, 236–241행; /Volumes/DevWork/work/live-skill/src/core/gate.ts 250–258행; /Volumes/DevWork/work/live-skill/src/core/schemas.ts 7–19행.
- 공격 조건: 불완전하거나 조작된 outline 응답.
- 문제: 입력 섹션 전체와 계획의 배정 목록을 대조하지 않는다. gate는 모델이 선택한 sectionIds만 평가하고 알 수 없는 ID는 건너뛴다.
- 증거: 이전 리뷰에서 두 원문 섹션 중 하나만 계획에 포함했는데 게이트 통과와 나머지 섹션의 manifest 누락을 재현했다.
- 영향: 공격자가 검증하기 어려운 내용이나 중요한 제약을 계획에서 제외하면, 작은 일부의 정확성만으로 전체 스킬이 verified로 배포될 수 있다.
- 권장 수정: 모델 계획과 별개인 원문 섹션 목록을 평가 모집단으로 유지한다. 모든 실질 섹션의 정확히 한 번 배정, ID 존재·유일성, chapter ID 유일성을 경계에서 검증한다. 제외 가능한 빈 헤딩 등은 모델 재량이 아닌 명시적인 결정론 정책으로 처리한다.
- 관련 가드레일: 1. 이전 리뷰 004·006과 연관.

### SEC-005 — QA 생성 실패를 분모에서 제외해 미평가 챕터도 통과함

- 파일: /Volumes/DevWork/work/live-skill/src/core/gate.ts 74–107, 223–237, 252–265행.
- 관련 문서: /Volumes/DevWork/work/live-skill/docs/DESIGN.md 100행; /Volumes/DevWork/work/live-skill/docs/TESTING.md 25행; /Volumes/DevWork/work/live-skill/CLAUDE.md 47행.
- 공격 조건: 특정 섹션의 qaGen이 빈 배열, 잘못된 JSON 또는 유효하지 않은 인용을 두 번 반환함. 프롬프트 공격 없이 일반 모델 실패로도 발생.
- 문제: 재생성 실패 문항은 집계에서 제외되며 최소 섹션/챕터 커버리지를 강제하지 않는다.
- 증거: 두 챕터 중 A만 1문항 정답, B는 QA 생성 두 번 실패하도록 모의 응답을 주었다. 결과는 passRate=1, passed=true, B asked=0, failures=[]였다.
- 영향: 미검증 내용이 있는 스킬을 완전히 검증된 것처럼 배포한다. 실패한 질문이 리포트의 실패 목록에도 나타나지 않는다.
- 권장 수정: QA 생성 실패를 독립적인 검증 실패 또는 미검증 상태로 기록하고, 요구된 섹션 커버리지를 채우지 못하면 verified 배포를 금지한다. 해당 문항을 임의의 오답으로 조작하기보다 생성 실패 사유와 커버리지를 분리해 표시한다.
- 관련 가드레일: 1. 구현은 DESIGN의 제외 규칙을 따르므로 단순 구현 불일치가 아니라 설계와 상위 가드레일의 충돌이다. 수정 전에 두 문서의 정책을 함께 정리해야 한다.

### SEC-006 — 조작된 manifest가 정답 저장 파일을 answerer 챕터로 허용함

- 파일: /Volumes/DevWork/work/live-skill/src/core/schemas.ts 60–73행; /Volumes/DevWork/work/live-skill/src/core/gate.ts 50–59, 128–161행; /Volumes/DevWork/work/live-skill/src/cli/eval.ts 35–54행.
- 공격 조건: 사용자가 외부에서 받은 또는 수정된 스킬 디렉터리에 eval을 실행함.
- 문제: manifest.sections[].chapterFile은 임의 문자열이다. chaptersFromManifest가 이 값을 허용 챕터 목록으로 만들고 readSkillDir는 manifest를 포함한 모든 파일을 읽는다.
- 증거: chapterFile='manifest.json'인 manifest가 Zod 검증을 통과했다. 모의 선택 응답으로 manifest.json을 반환하자, goldenQa.refAnswer에만 넣은 SECRET_REFERENCE_MARKER가 answerer 요청에 포함됐다. loadHistory에도 manifest.json이 로드된 것으로 기록됐다.
- 영향: 평가 정답과 다른 QA가 answerer에 유입돼 가드레일 2가 무력화된다. 디렉터리 내 다른 민감 파일도 챕터로 지정할 수 있다. SEC-002와 결합하면 범위 밖 텍스트 유입 가능성도 커진다.
- 권장 수정: 실제 승인된 chapters/*.md 일반 파일만 챕터로 허용한다. manifest.json, 원문, QA 저장소는 파일 로더 단계에서 제외하고 스키마·파일 목록·출력 목록의 일관성을 검사한다. 외부 manifest의 QA 자체도 신뢰된 기준 정답이 아니므로 출처를 검증하거나 신뢰된 원문에서 다시 생성해야 한다.
- 관련 가드레일: 2, 1.

## Medium

### SEC-007 — 환경변수로 0%·질문 0개를 verified 통과시킬 수 있음

- 파일: /Volumes/DevWork/work/live-skill/src/core/config.ts 23–29, 49–57, 66–72행; /Volumes/DevWork/work/live-skill/src/core/gate.ts 223–234행; /Volumes/DevWork/work/live-skill/src/cli/index.ts 23–28행.
- 공격 조건: 실행 환경 또는 현재 디렉터리의 .env에 영향을 줄 수 있음. 로컬 설정 소유자의 의도적인 정책 변경일 수도 있으므로 원격 권한 상승으로 보지 않는다.
- 문제: GATE_THRESHOLD=0을 허용하고 빈 QA의 passRate=0도 통과시킨다. 공백 문자열도 Number()로 0이 된다.
- 증거: loadConfig({GATE_THRESHOLD:'0'}) 후 질문 0개 평가 결과가 passed=true였다.
- 영향: --no-gate와 달리 skipped/unverified 표시 없이 무검증 통과가 가능하다. 가드레일 1의 기본 정책과 충돌한다.
- 권장 수정: 정책상 허용한 최소 threshold를 강제하고 질문 0개는 threshold와 무관하게 실패시킨다. 공백 값을 명시적으로 처리한다. 정책 변경이 필요하면 별도 명시적 설정·기록으로 구분하고 환경변수만으로 인증 수준이 조용히 달라지지 않게 한다.
- 관련 가드레일: 1. DESIGN의 환경 설정 허용 범위도 함께 정리할 것.

### SEC-008 — 실제 호출·토큰 예산을 강제하지 않아 비용 소진 가능

- 파일: /Volumes/DevWork/work/live-skill/src/core/gate.ts 63–64, 92–94행; /Volumes/DevWork/work/live-skill/src/core/pipeline.ts 171–193행; /Volumes/DevWork/work/live-skill/src/cli/eval.ts 47–54, 85–87행; /Volumes/DevWork/work/live-skill/src/core/schemas.ts 22–28, 73행.
- 공격 조건: QA 재생성이 발생하거나 외부 manifest에 다수의 QA가 포함됨.
- 문제: compile 추정에는 재생성이 빠지고 실행 중 호출 상한 카운터가 없다. eval은 config.maxLlmCalls를 검사하지 않는다. manifest QA 배열과 필드에 상한도 없다.
- 증거: 이전 리뷰에서 상한 6회 설정에 7회 호출을 재현했다. eval 경로의 상한 검사 부재는 정적으로 확인했다.
- 영향: 사용자 API 키로 예상보다 많은 과금 호출이 발생하거나 과도한 요청 크기로 실행이 실패할 수 있다.
- 권장 수정: compile/eval 공통 LLM 래퍼에서 호출 직전 총 호출 수·요청 토큰·시간 상한을 강제한다. 재시도도 같은 예산에서 차감하고 QA 개수와 문자열 길이를 제한한다.
- 관련 가드레일: 6. 공개 HTTP 서비스가 없으므로 IP별 rate limiting 부재를 별도 취약점으로 보지 않는다.

### SEC-009 — 구조 검증 결과가 배포 차단으로 연결되지 않음

- 파일: /Volumes/DevWork/work/live-skill/src/core/pipeline.ts 224–254행; /Volumes/DevWork/work/live-skill/src/cli/compile.ts 71–93행; /Volumes/DevWork/work/live-skill/src/core/assembler.ts 136–140행; /Volumes/DevWork/work/live-skill/src/core/validator.ts 57–86행.
- 공격 조건: 모델이 예산 초과 본문이나 특수문자가 포함된 metadata를 반환함.
- 문제: CLI가 validation을 무시한다. YAML 값도 이스케이프하지 않으며 키 존재 검사만 수행한다.
- 증거: 이전 리뷰에서 1,000토큰 예산에 1,501토큰 챕터가 쓰기 함수에 전달되고 종료코드 0이 나왔다. Guide: Setup 제목의 원시 YAML도 자체 검증을 통과했다.
- 영향: 악성·비정상 모델 출력을 막아야 할 결정론 경계가 배포 단계에서 작동하지 않는다. 단, 구조 검증을 강제한다고 프롬프트 공격까지 차단되는 것은 아니다.
- 권장 수정: gate 전에 구조 검증 오류를 차단하고 최종 산출물도 검증한다. metadata는 serializer로 생성하고 실제 YAML 파싱·값 검증을 수행한다.
- 관련 가드레일: 1, 6. 이전 리뷰 003·009와 중복.

### SEC-010 — 비정상 grader 출력도 CORRECT 접두사만으로 정답 처리

- 파일: /Volumes/DevWork/work/live-skill/src/core/prompts.ts 105–129행; /Volumes/DevWork/work/live-skill/src/core/gate.ts 162–169행.
- 공격 조건: 모델이 설명·모순된 답변을 반환하거나 후보 답변의 주입 지시가 grader 출력에 영향을 줌.
- 문제: /^\s*correct\b/ 검사로 시작 부분만 보고 정답을 판정한다.
- 증거: 'CORRECT? No, WRONG.'이 correct로 파싱됐다.
- 영향: 불확실하거나 형식에 맞지 않는 판정이 정답으로 집계돼 가드레일 1의 보수 채점 원칙을 약화한다.
- 권장 수정: 정규화한 전체 문자열의 enum 또는 엄격한 구조화 응답을 검증하고 나머지는 실패/미판정으로 처리한다. 후보 답변은 grader의 지시가 아닌 데이터로 분리한다.
- 관련 가드레일: 1.

### SEC-011 — 비신뢰 문서 파싱의 메모리·시간 제한이 충분하지 않음

- 파일: /Volumes/DevWork/work/live-skill/src/cli/compile.ts 46–51행; /Volumes/DevWork/work/live-skill/src/adapters/fsTargets.ts 77–99행; /Volumes/DevWork/work/live-skill/src/adapters/extractors/limits.ts 8–22행; /Volumes/DevWork/work/live-skill/src/adapters/extractors/docx.ts 95–105, 126–139행.
- 공격 조건: 사용자가 큰 폴더·파일, 순환 링크 또는 파싱 부하가 큰 문서를 제공받아 실행함.
- 문제: 추출 전 파일별·전체 바이트 제한이 없고 일괄 읽기를 수행한다. Promise.race 타임아웃은 파서를 취소하지 않으며 동기 CPU 점유를 중단하지 못한다. DOCX 검사는 ZIP 로딩 이후 메타데이터와 내부 _data 필드에 의존한다.
- 증거: 정적 검토. 실제 zip bomb이나 메모리 고갈 공격은 실행하지 않았으며 특정 ZIP 우회를 확인했다고 주장하지 않는다.
- 영향: 프로세스 가용성 저하, 메모리 소진, 장시간 CPU 점유 및 종료 지연.
- 권장 수정: 읽기 전 크기·개수·파일 종류를 제한하고 제한된 동시성을 사용한다. 파서는 종료 가능한 worker/subprocess에서 실행해 메모리·벽시계 시간을 제한한다. ZIP 메타데이터 검사에 더해 실제 압축 해제된 바이트 누적 상한을 적용한다.
- 관련 가드레일: 6. PDF 페이지 제한, DOCX 항목/크기 제한 및 이미지 읽기 생략은 존재하지만 전체 자원 격리를 대신하지 않는다.

### SEC-012 — 배포용 비밀 파일 검사가 npm 출력 형식을 잘못 해석함

- 파일: /Volumes/DevWork/work/live-skill/scripts/check-tarball.sh 5–14행; /Volumes/DevWork/work/live-skill/package.json 13–15, 28–29행.
- 공격 조건: 배포 파일 설정 변경 등으로 루트 .env 계열 파일이 포함되거나 스캔 대상 읽기가 실패함.
- 문제: 사람이 읽는 npm notice 출력에서 파일명 앞에 접두사와 크기가 있지만 정규식은 줄 시작 또는 / 바로 뒤의 파일명만 찾는다. grep 오류도 조건문에서 무검출처럼 진행할 수 있다.
- 증거: 합성한 'npm notice 100B .env.production' 행이 현재 정규식에 매칭되지 않았다. 실제 비밀 파일을 만들거나 배포하지 않았다.
- 영향: 검사 메시지가 실제 배포 비밀 파일 유입을 놓칠 수 있다. 현재 files=['dist']가 루트 .env 배포를 막고 있어 즉시 유출이 확인된 것은 아니다.
- 권장 수정: npm pack --dry-run --json의 files[].path를 파싱해 경로를 검사한다. 실제 포함 파일 전체를 대상으로 비밀 패턴을 검사하고 읽기/명령 오류는 배포 실패로 처리한다. 루트 및 중첩 경로의 테스트를 추가한다.
- 관련 가드레일: 7; 공급망·배포 보호.

## Low

### SEC-013 — .env 변형 파일이 Git 제외 규칙에서 빠짐

- 파일: /Volumes/DevWork/work/live-skill/.gitignore 9–11행.
- 공격 조건: 개발자가 .env.production 또는 .env.staging 같은 파일에 자격증명을 보관함.
- 문제: .env와 .env.local만 제외한다.
- 증거: git check-ignore에서 .env.local만 제외됐고 production/staging은 제외되지 않았다.
- 영향: git add 과정에서 자격증명 파일이 실수로 커밋될 수 있다. 현재 실제 키가 커밋됐다는 증거는 없다.
- 권장 수정: .env 및 .env.*를 제외하고 .env.example만 예외로 관리한다. 커밋·CI 비밀 탐지는 추가 방어로 적용한다.
- 관련 가드레일: 7.

## 가드레일 1·2·4 집중 평가

| 가드레일 | 판정 | 근거 |
| --- | --- | --- |
| 1: 품질 게이트 완화 금지 | 우회 및 설계 충돌 확인 | SEC-004·005·007·010. 문항 생성 실패 제외는 DESIGN 100행에 명시돼 있으므로 문서 정책 자체도 수정 대상이다. |
| 2: answerer 격리 | 정상 compile 경로의 기본 제한은 존재하나 eval에서 우회 확인 | gate.ts 135–161행은 허용 목록과 선택한 파일만 사용한다. 그러나 외부 manifest가 허용 목록을 정하므로 SEC-006이 가능하다. |
| 4: 자체 제작 픽스처·샘플 | 검토 범위에서 위반 증거 없음 | fixtures의 자작 설명, 가상 제품·기관명, scripts/fixtures/generate.ts의 직접 생성 내용 및 PDF/DOCX 추출 결과와 일치한다. 주석만으로 권리 보유를 법적으로 증명한 것은 아니다. |

가드레일 4는 개발용 픽스처의 출처 규칙이며, 운영자가 처리하는 모든 입력이 신뢰 가능하다는 뜻은 아니다. src/adapters/extractors/html.ts 14–15행의 '자체 제작 문서를 전제'라는 설명을 보안 신뢰 가정으로 확장해서는 안 된다. 이번 공격 재현 문자열은 합성 데이터이며 실제 문서·키·개인정보를 사용하지 않았다.

## 요청 영역별 점검 결과

| 영역 | 결과 및 한계 |
| --- | --- |
| 인증·인가 | HTTP 로그인, 사용자 역할, 세션은 없다. CLI는 실행 사용자의 OS 권한을 사용하며 Anthropic API 키 인증을 적용한다. 별도 로그인 부재를 취약점으로 보지 않는다. |
| API 키·환경변수 | SDK의 apiKey로 전달하고 프롬프트에 키를 직접 넣는 코드는 발견하지 못했다. baseURL은 고정 HTTPS, logLevel은 off, SDK 자동 재시도는 기본 0이다. 환경 기반 정책 우회와 .env 제외 누락은 SEC-007·013. |
| 입력·Zod·모델 출력 | 기본 타입 검사는 있으나 경로, 개수, 길이, 상호 참조 및 커버리지 검증이 부족하다. SEC-001·003·004·006·008·009 참조. Zod 파싱 성공은 콘텐츠 안전성 보증이 아니다. |
| SQL·DB | DB 드라이버·SQL 실행·ORM 접근 경로를 발견하지 못했다. SQL injection 적용 지점 없음. |
| XSS·CSRF | 웹 서버·브라우저 렌더링·쿠키 인증 흐름이 없어 프로젝트 자체의 XSS/CSRF 실행 경로를 확인하지 못했다. 생성 Markdown을 다른 서비스에서 렌더링하는 경우는 그 렌더러의 보안 경계다. |
| SSRF·redirect | 명시적인 원격 호출은 고정된 Anthropic API 경로다. 문서 URL을 fetch하거나 redirect URL을 받아 요청하는 애플리케이션 경로를 발견하지 못했다. 의존성의 모든 내부 네트워크 동작을 동적 계측한 것은 아니다. |
| 외부 API | 원문 일부/전체가 역할에 따라 API로 전송되는 것은 제품 동작이다. 입력 링크 탈출, eval 잘못된 파일 허용이 이 전송 범위를 확대할 수 있다. SEC-002·006. |
| 파일 업로드 | HTTP 업로드 endpoint 없음. 대응되는 로컬 비신뢰 파일 입력·파싱 위험은 SEC-002·011. |
| 명령·코드 실행 | src에서 모델 출력을 shell/eval/child_process에 전달하는 실행 경로를 발견하지 못했다. 스킬의 지시가 downstream 에이전트에서 실행될 가능성과 이 CLI의 직접 RCE는 구분한다. |
| rate limit·비용 | 공개 요청 endpoint는 없다. 단일 실행의 비용 제한 불완전성은 SEC-008. |
| 권한 상승 | 관리자/root 권한 획득은 확인하지 못했다. 모델 데이터의 system 지시문 승격과 출력 루트 탈출은 각각 SEC-003·001. |
| 민감 로깅 | SDK 디버그 로그는 off이며 정상 CLI는 원문 전체 대신 요약을 출력한다. llmProvider.ts 18–30행은 외부 오류 메시지를 그대로 보존하고 index.ts 124행은 최상위 오류를 처리하지 않는다. 실제 비밀 유출은 재현하지 못했지만 오류 요약·redaction 및 제어문자 처리를 적용할 여지가 있다. |
| 공급망 | 아래 npm audit 결과 및 CI/잠금 파일 검토 참조. |
| LLM prompt injection | SEC-003 및 grader·QA 신뢰 경계 결함. 정답률 통과는 악성 지시 부재를 의미하지 않는다. |

## 의존성·공급망·비밀 검사

- 2026-09-06 npm 보안 레지스트리에 npm audit --package-lock-only --ignore-scripts --json을 실행했다. 결과: 알려진 취약점 0건, metadata.dependencies.total=297. 설치·업데이트·audit fix는 하지 않았다. 네트워크는 npm 감사 조회에만 사용했고 실 LLM 호출은 없었다.
- 이 결과는 조회 시점 레지스트리에 등록된 advisory 범위이며 악성 패키지나 미공개 취약점 부재를 보장하지 않는다.
- package-lock.json의 resolved 항목은 모두 https://registry.npmjs.org/ 경로였고 resolved가 있으면서 integrity가 없는 항목은 없었다.
- .github/workflows/ci.yml 16–17행은 contents: read이고, 37–38행 Actions는 전체 commit SHA로 고정돼 있다. npm ci로 lockfile 설치를 수행한다. CI는 PR 및 main push에서 실행하며 pull_request_target은 없다.
- CI에는 명시적인 취약점 판정 임계치/전용 비밀 탐지 단계가 없다. npm ci의 기본 감사 출력만으로 릴리스 차단을 보장하지 않으므로 지속적인 보안 게이트는 보완할 수 있다. 이것만으로 현재 공급망 침해를 주장하지 않는다.
- 추적 파일 95개를 대상으로 Anthropic/OpenAI 키 및 private-key header의 제한된 패턴 검사를 수행했고 일치 파일은 0개였다. 실제 키 값이나 사용자 환경은 출력하지 않았다. 모든 비밀 형식·과거 Git 이력·미추적 파일까지 검사한 것은 아니다.
- package.json의 Node >=20 선언과 Commander/Vitest 요구 버전 불일치는 기존 일반 리뷰 016에 기록돼 있다. 호환성 문제를 확인된 CVE로 재분류하지 않는다.

## 검증 방법과 제한

- 현재 커밋의 보안 관련 소스와 문서를 읽고 이전 전체 코드 리뷰 결과와 대조했다.
- 실제 소스를 메모리에서 변환·로드하고 모의 LLM으로 다음을 재현했다: title의 system 필드 유입, 전체 챕터 QA 누락 후 통과, 질문 0개/threshold 0 통과, manifest.json의 refAnswer가 answerer에 유입, 모순된 CORRECT 접두사 허용.
- 비용 상한 초과·출력 경로 탈출·구조 검증 무시는 직전 리뷰의 재현 결과와 동일 코드 확인을 근거로 했다.
- 악성 링크를 통해 실제 개인 파일을 읽거나 덮어쓰기, zip bomb 실행, 실 LLM 공격, 실제 배포, 인증정보 전송 시험은 수행하지 않았다.
- 대상 폴더에 node_modules가 없어 전체 npm run check를 실행하지 않았다. 재현에는 별도 workspace의 설치된 TypeScript/Zod를 사용했다. npm audit는 대상 폴더의 lockfile을 조회했다.
- 코드 수정은 하지 않았다. 이 보고서만 docs/002_SECURITY_REVIEW.md로 신규 저장한다. 이전 001_CODE_REVIEW.md는 보존한다.
