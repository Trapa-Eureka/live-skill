# PUBLISHING — npm 배포 체크리스트

작성: 2026-09-06 (docs 분석 세션) · 2026-09-06 갱신(형제 레포 실전 선례 반영) · TASKS.md T11("공개 준비")의 확장판. T11의 완료 기준(이름 조사·영어 README·ci.yml·데모 시나리오·`npm run check` 통과)은 그대로 유효하며, 이 문서는 T11 실행 시 빠뜨리기 쉬운 npm 배포 실무 단계를 순서대로 못박는다. **GitHub는 현재 비공개, npm 배포 직전 공개 전환 예정**이라는 전제를 반영했다(§3-13).

## 0. 현재 상태 스냅샷 (2026-09-06 조사 결과)

| 항목 | 상태 |
|---|---|
| 코드 구현 | 미착수 (TASKS.md T0부터 시작, 이 문서는 그 전제) |
| GitHub 저장소 | `Trapa-Eureka/live-skill`, **PRIVATE**, origin 연결 확인됨 |
| npm 계정 | 로컬에 `shiz_son` 로그인 확인됨 (registry.npmjs.org) — 배포 실행 권한은 이미 있음 |
| 패키지명 `live-skill` | npm 레지스트리 미등록 → **사용 가능** (2026-09-06 T11에서 재조회, 여전히 사용 가능) |
| 백업 후보 `live-skills` | npm 레지스트리 미등록 → **사용 가능** (SPEC §8 "후보 2개" 중 1개) |
| 백업 후보 2 `skill-gate` | npm 레지스트리 미등록 → **사용 가능** (2026-09-06 T11에서 조사·확정 — SPEC §8 "후보 2개" 충족. `skillgate`는 이미 등록돼 있어 제외) |
| `LICENSE` | 없었음 → 이번 세션에 MIT 초안 추가 (저작권자 `Trapa-Eureka` — msg-agent·sheet_mcp와 표기 통일) |
| `.gitignore` | 없었음 → 이번 세션에 Node/TS 표준안 추가 |
| Node/npm | 로컬 Node v24.12, npm v11.6 확인 — CLAUDE.md 요구사항(Node 20+) 충족 |
| 형제 레포 실전 선례 | `../msg-agent`(같은 스택, 이미 npm 배포 구조 완성), `../retail-mcp`(npm 배포 어드버서리얼 리뷰 8건 기록) — §1 참조 |

동일 카테고리 경쟁사·명칭 충돌 조사는 `docs/MARKET.md` §2 참조.

## 1. 실전 선례 — 형제 레포에서 이미 확인된 함정

같은 저자(Trapa-Eureka, npm 계정 `shiz_son`)의 두 레포가 이미 이 경로를 지났다. 처음부터 다시 겪을 필요 없는 함정들:

| 출처 | 문제 | 교훈 (live-skill 적용) |
|---|---|---|
| retail-mcp REL-001 | `package.json.private: true`를 방치하면 `npm publish` 자체가 거부됨 | T0 scaffolding 때부터 `private` 필드를 넣지 않거나 명시적으로 관리 |
| retail-mcp REL-002 | `bin`/`main` 없이는 `npx <pkg>`·`npm install` 후 실행 진입점이 없음. 실행 파일에 shebang 없으면 실행 불가, symlink 경유 시 `import.meta.url` 비교로 진입점 판별이 실패하는 사례 발생 | `bin: { "live-skill": "dist/cli/index.js" }` + shebang(`#!/usr/bin/env node`) + `chmod +x`를 빌드 스크립트에 포함. CLI 진입점 판별 로직은 symlink 경유를 가정해 테스트 |
| retail-mcp REL-003 | 배포물이 `.ts` 원본이면 `tsx`가 devDependency라 프로덕션 설치에서 실행 불가. 런타임에 실제로 쓰이는 패키지가 devDependencies에 있으면 `--omit=dev` 설치가 즉시 깨짐 | `tsconfig.build.json`으로 `dist/` 빌드 산출 후 배포, `tsx`는 devDependency 유지. 의존성이 core/adapters에서 실제 import되는지 빌드 전 grep으로 확인 |
| retail-mcp REL-004 | `files`/`.npmignore` 없으면 `.gitignore` 폴백으로 개발용 자산(테스트 97개, fixtures, 리뷰 문서 등)까지 전부 배포됨 | `package.json.files = ["dist", "README.md", "LICENSE"]`로 화이트리스트. `docs/`·`samples/`·`fixtures/`·`tests/`는 절대 포함 금지(가드레일 4·7과도 직결) |
| retail-mcp REL-005 | LICENSE·`license`/`repository`/`bugs`/`homepage` 메타데이터 누락 | 이번 세션에 LICENSE 추가 완료. `package.json` 필드는 T0/T11에서 GitHub URL과 일치시킬 것 |
| retail-mcp REL-007/QA-001~006 | `prepublishOnly` 게이트가 없으면 `npm run check` 없이도 배포 가능. 테스트가 소스 트리만 검증하고 실제 tarball 설치 스모크가 없으면, 376개 테스트 통과해도 배포물이 안 돌아갈 수 있음 | `prepublishOnly: "npm run check && npm run verify:pack"` 형태로 wiring. `verify:pack` 스크립트로 tarball fresh install + `--help` 스모크까지 자동화 |
| retail-mcp REL-008 | unscoped 이름은 "재사용 가능한 미등록 이름"인지 npm이 명확히 보장 안 함. `@trapa-eureka` 조직이 npm에 없어(`npm org ls` 403) 결국 개인 계정 스코프 `@shiz_son/retail-mcp`로 전환 | `live-skill`은 이번 조사에서 미등록 확인됐지만, **조직 스코프 문제가 재발할 수 있다** — 필요 시 `@shiz_son/live-skill` 대안을 T11에서 즉시 쓸 수 있게 §4에 결정 항목으로 남김 |
| msg-agent `scripts/check-tarball.sh` | `npm pack --dry-run` 결과에 `.env`·key-like 문자열이 섞여 있는지 셸 스크립트로 자동 검사(경량, 의존성 없음) | live-skill 규모엔 retail-mcp의 `verifyPack.ts`/`secretScan.ts`(TS, 기능 많음)보다 이 스크립트가 더 적합한 시작점 — 그대로 포팅해 `scripts/check-tarball.sh`로 추가 권장 |
| retail-mcp 008 "권장 릴리스 게이트" | 클린 설치→체크→커버리지→의존성/시크릿 감사→빌드→`npm pack` 화이트리스트 검증→tarball `--omit=dev` fresh install 스모크→사람 승인의 8단계 | live-skill의 `npm run check`(typecheck+lint+test)에 `verify:pack` 단계만 추가하면 규모에 맞는 축소판 게이트가 됨(CLAUDE.md가 이미 명시한 게이트 완화 금지 원칙과도 부합 — 오히려 게이트를 하나 더 추가하는 방향) |

**T0 스캐폴딩 자체도 처음부터 설계할 필요 없다**: `../msg-agent`는 CLAUDE.md가 요구하는 스택(TS strict+`noUncheckedIndexedAccess`, ESLint flat config+`typescript-eslint` strictTypeChecked, Prettier, Vitest+coverage 90% 임계치, `tsx` 기반 cli/smoke, `check`/`prepublishOnly` 스크립트 조합)을 이미 npm 배포 수준까지 구현해 뒀다. `package.json`·`tsconfig.json`·`eslint.config.js`·`vitest.config.ts`를 이식하고 이 레포에 안 맞는 의존성(grammy·franc 등 메시징 전용)만 제거하는 편이 처음부터 설계하는 것보다 빠르고 이미 검증됐다. 추출기(`src/adapters/extractors/{pdf,docx,text,route,limits,index}.ts`)는 pdf-parse·mammoth를 그대로 쓰고 있어 T2의 직접 참고 구현이 된다(단, `extract()`가 예외 대신 `Result<ExtractedDoc, ExtractError>`를 반환하는 점은 DESIGN §2 인터페이스와 다르므로 채택 여부는 T1에서 결정 — DESIGN diff 우선 원칙).

## 2. 선행 조건 — 코드 구현 (이 세션 범위 아님)

npm 배포는 실제 패키지가 동작해야 가능하다. 아래는 TASKS.md의 실행 순서 요약이며, **이 문서에서 구현하지 않는다** — 진실의 원천은 `docs/TASKS.md`:

```
T0(스캐폴딩) → T1(타입/config) → {T2 추출기, T3 LlmProvider, T4 Assembler} → T5(Validator)
  → T6(파이프라인+manifest) → T7(품질 게이트) → T8(CLI) → T9(e2e+커버리지) → T10(스모크) → T11(공개 준비)
```

이 체크리스트(§3)는 T10 완료, 즉 실 LLM 스모크까지 통과한 뒤에 실행하는 것을 전제로 한다.

## 3. npm 배포 실행 순서

1. **패키지명 최종 확정** (사람 결정 — WORKFLOW §4). §0 조사 결과(`live-skill` 가용) 기준 그대로 갈지, `@shiz_son/live-skill` 스코프로 갈지(§1 retail-mcp 선례) 결정하고 SPEC §8을 갱신한다.
2. **`package.json` 필드 점검**: `name`, `version`(`0.1.0`부터), `description`, `keywords`(`agent-skills`, `claude`, `skill-compiler`, `docs-to-skill` 등 — MARKET.md 경쟁사 키워드 참고), `license: "MIT"`, `repository`/`bugs`/`homepage`(GitHub URL과 일치), `engines.node >= 20`, `bin`, `main`, `type`. **`private` 필드를 넣지 않거나 배포 직전 명시적으로 관리**(§1 REL-001).
3. **LICENSE 확정**: 이미 추가된 MIT 초안의 저작권자 표기를 실명/법인명으로 확정할지 확인.
4. **영어 README 초안** (T11 원 항목) — 내부 `docs/`는 한국어 유지, 배포용 `README.md` 상단에 영어 섹션 추가 또는 `README.en.md` 분리.
5. **배포 파일 화이트리스트**: `package.json.files = ["dist", "README.md", "LICENSE"]`로 명시(§1 REL-004) — `docs/`·`samples/`·`fixtures/`·`tests/`·`.env*`·`scripts/smoke.ts` 등 전부 제외.
6. **`bin` 스크립트 점검**: `dist/cli/index.js`에 `#!/usr/bin/env node` shebang, 빌드 스크립트에서 `chmod +x`(§1 REL-002) — `tsconfig.build.json`으로 `dist/`만 빌드, `tsx`는 devDependency 유지(§1 REL-003).
7. **`npm pack --dry-run`**: 파일 목록 검수. msg-agent의 `scripts/check-tarball.sh` 패턴을 포팅해 `.env`·key-like 문자열 자동 검사(가드레일 7 최종 방어선, §1 참고).
8. **`npm publish --dry-run`**: 레지스트리 응답까지 포함한 최종 리허설.
9. **CI 그린 확인**: GHA `ci.yml`(T11 원 항목)이 `npm run check`를 실행하고 통과하는지 확인.
10. **`prepublishOnly` 게이트 wiring**: `"prepublishOnly": "npm run check && npm run verify:pack"` 형태로 — 로컬/CI 어디서 `npm publish`를 실행하든 체크·빌드·tarball 검증이 강제되게(§1 REL-007).
11. **버전·태깅 전략 확정**: `0.1.0`부터 semver 시작, `public beta`/`alpha` 태그(`npm publish --tag beta`) 사용 여부를 SPEC 성숙도(§6 성공 기준 충족 여부)에 맞춰 결정.
12. **npm 2FA 확인**: 계정 `shiz_son`의 2단계 인증·publish 시 OTP 요구 여부 확인 — CI에서 publish 시엔 automation 토큰 필요.
13. **(권장) provenance 배포**: GitHub Actions + OIDC로 `npm publish --provenance`(retail-mcp가 이미 `.github/workflows/release.yml`로 채택한 패턴 — 태그 푸시 → publish). `id-token: write` 권한 필요.
14. **GitHub 저장소 공개 전환 — 타이밍 명시**: `package.json`의 `repository`/`bugs`/`homepage`가 GitHub URL을 가리키므로, **npm 배포 직전(§3-9까지 통과 확인 후) 공개로 전환**한다. 전환 직후 재점검: README에 비공개 시절 흔적 없는지 / LICENSE 노출 / GitHub Actions 시크릿(`NPM_TOKEN`)이 fork PR에 노출되지 않는지.
15. **`npm publish`** 실행 (unscoped면 기본 public, scoped면 `--access public` 필요). **이 버튼은 사람이 누른다** (WORKFLOW §4).
16. **배포 후 확인**: `https://www.npmjs.com/package/<name>` 페이지 렌더링, `npx <name> --help` 실제 설치 스모크.
17. **GitHub Release 태그** 생성 + CHANGELOG 첫 항목 작성.
18. **(v0.4 로드맵, 지금 착수 안 함)** skills.sh/skillpm 등 스킬 마켓 호환 게시(`npx skills add` 계열)는 MARKET.md §2에서 확인한 인접 생태계 — SPEC §4가 명시한 비목표이므로 v0.4에서 재검토.

## 4. 사람이 반드시 결정할 것 (WORKFLOW §4 재확인, 위임 불가)

- 최종 패키지명 — **unscoped `live-skill` vs `@shiz_son/live-skill` 스코프**(§1 retail-mcp 선례: 조직 스코프가 없어 개인 계정으로 전환한 사례가 있음)
- LICENSE 저작권자 표기(개인/법인)
- `npm publish` 실행 시점
- GitHub 공개 전환 시점
- 게이트 임계치·k 기본값, 실 LLM 스모크 비용 지출

## 5. 리스크·주의사항

- **가드레일 7 (시크릿)**: `.env`가 `.gitignore`·`npm pack` 화이트리스트 양쪽에서 배제되는지 이중 확인. msg-agent의 `check-tarball.sh` 포팅 권장(§1).
- **가드레일 4 (저작권)**: `npm pack --dry-run` 결과에 `fixtures/docs/`·`samples/`가 포함된다면 애초에 `files` 화이트리스트 설계가 잘못된 것(§3-5) — 자체 제작 문서 여부와 무관하게 개발용 자산은 배포하지 않는다.
- **경쟁 혼잡도**: MARKET.md §2 기준 동일 카테고리 도구가 이미 다수 — README/keywords에서 "품질 게이트(검증된 생성)" 차별점을 첫 문단에 명시.
- **이름 재확인 시점**: §0의 가용성 조사는 2026-09-06 스냅샷이다. npm 이름은 선착순이므로 §3-1(최종 확정) 직전에 재조회 권장.
