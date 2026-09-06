# DEMO — 60초 데모 시나리오

작성: 2026-09-06 (T11) · 목적: 녹화용 스크립트. 자체 제작 샘플만 사용(가드레일 4) — `samples/manual.pdf`(가상 장비 "SkillSync X200 (Fixture)" 매뉴얼, `docs/TESTING.md` §5의 실 LLM 스모크와 같은 파일이라 결과가 이미 검증돼 있다).

**전제**: `npm install` 완료, `.env`에 실 `ANTHROPIC_API_KEY` 채움(비용 발생 — WORKFLOW §4, 사람 승인 사항). 터미널 폭은 100컬럼 이상 권장.

## 타임라인

| 시간 | 화면 | 대사/자막 |
|---|---|---|
| 0:00–0:08 | 빈 터미널, `samples/manual.pdf` 뷰어로 4쪽짜리 매뉴얼을 스치듯 보여준다 | "이 문서 한 장으로 검증된 에이전트 스킬을 만듭니다." |
| 0:08–0:10 | 터미널로 전환 | `npm run cli -- compile samples/manual.pdf --out ./demo-skill` 입력 |
| 0:10–0:30 | 실행 중(실 LLM 호출 — 추출→개요→증류→**품질 게이트**) | "컴파일만 하는 게 아니라, 만든 스킬이 원문 질문에 실제로 맞게 답하는지 자동으로 채점합니다." |
| 0:30–0:38 | 출력: `컴파일 완료: ./demo-skill` + 게이트 리포트(`PASSED`, passRate, 챕터별 정답 수) | "이게 이 프로젝트의 핵심입니다 — 통과율이 낮으면 애초에 배포되지 않아요." |
| 0:38–0:46 | `ls demo-skill` → `SKILL.md`·`chapters/`·`glossary.md`·`patterns.md`·`cheatsheet.md`·`manifest.json` | "산출물은 Agent Skills 표준 그대로라 Claude Code가 바로 읽습니다." |
| 0:46–0:54 | `npm run cli -- report ./demo-skill` (같은 리포트를 다시 사람이 읽을 형태로) | "`manifest.json`에 게이트 결과가 남아서 나중에 언제든 다시 볼 수 있어요." |
| 0:54–1:00 | 로고/GitHub 링크 카드 | "live-skill — 생성이 아니라 검증된 생성." |

## 실행할 명령 (그대로 복사)

```bash
npm run cli -- compile samples/manual.pdf --out ./demo-skill
ls demo-skill
npm run cli -- report ./demo-skill
rm -rf ./demo-skill   # 녹화 후 정리 — --out 밖으로는 아무것도 쓰지 않는다(가드레일 5)
```

## 약한 챕터 케이스를 곁들이고 싶다면 (선택, +20초)

`tests/e2e.test.ts`의 시나리오 2(SOP 폴더, 한 챕터 의도적 오답)가 이미 이 흐름을 ScriptedLlm으로 재현해 둔 자동 테스트다 — 실 LLM으로 같은 그림을 보여주려면 두 개 이상의 자체 제작 SOP 문서 폴더를 준비해 컴파일한 뒤, 게이트 미달 시 출력되는 임시 디렉터리 경로와 리포트(`실패 문항` 목록)를 보여주면 된다. 이 문서는 통과 케이스만을 기본 60초 시나리오로 잡는다 — 실패 케이스는 "게이트가 진짜로 걸러낸다"는 것을 보여줄 때 덧붙이는 확장판이다.

## 참고

- 리포트 형식·통과 임계치: `docs/DESIGN.md` §4, §9
- 이 샘플의 실 LLM 검증 이력: `docs/TESTING.md` §5(`npm run smoke`)
