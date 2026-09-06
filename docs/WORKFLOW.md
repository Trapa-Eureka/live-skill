# WORKFLOW — 이 레포를 굴리는 AI-native 규칙

기반: Clare Liguori (AWS), "From AI-Assisted to AI-Native: Building a Frontier Development Team"
(https://youtu.be/Ry0WHNxDbYA · AWS 블로그: https://aws.amazon.com/blogs/machine-learning/how-frontier-teams-are-reinventing-ai-native-development/)
운영 원칙은 sheet_mcp/retail-mcp/lang_ai_agent/message와 동일. 공통 요약 + **이 레포 특이사항**만 적는다.

## 0. 역할 정의 (프론티어 3행동)

| 행동 | 이 레포에서 |
|---|---|
| Hands-off Coding (1~2%) | Jin은 SPEC/DESIGN 수정·리뷰·실 LLM 스모크·npm 공개 승인만 |
| Infrequent Interaction | 태스크마다 기계 판정 완료 기준 → 세션 중 개입 없이 완주 |
| Minimized Idle Time | T1 후 레인 A/B/C 병렬. 다섯 레포 백로그를 하나의 worktree 큐로 운용 |

## 1. 습관 5개 → 규칙 (공통 요약)

1. **Agent Context** — 부족지식은 CLAUDE.md/docs에만. 격주 프루닝 + 로그.
2. **Slow Down to Speed Up** — strict TS + 인터페이스 경계(추출·LLM·조립·게이트 전부 분리) 선투자. 섹션 id 안정성 같은 "미래(v0.2)를 위한 지금의 공학"이 이 습관의 이 레포판.
3. **Feed, Don't Babysit** — 배정은 TASKS 템플릿 1회, 자기 검증 = `npm run check`.
   ```bash
   git worktree add ../live-skill-t4 -b t4 && cd ../live-skill-t4 && claude
   ```
4. **Explicit Intent** — 산출 파일 구조·게이트 규칙·manifest 스키마 변경은 DESIGN diff가 코드보다 먼저.
5. **Shift Left** — LLM 5역할 전부 ScriptedLlm 대본으로 대체해 게이트 판별력까지 로컬 결정론으로 증명. 실 LLM은 smoke에만.

## 2. live-skill 특이사항

- **게이트가 곧 제품**: "게이트 판별력" 테스트 5종(훼손 주입 검출)은 제품 가설의 증거다 — 삭제·완화·임계치 하향으로 통과시키는 수정은 반려. 게이트 실패의 올바른 수정 방향은 증류·프롬프트 개선이다.
- **answerer 격리 감시**: 리뷰 시 answerer 컨텍스트에 원문이나 미선택 챕터를 흘리는 diff를 잡는다. 격리가 깨지면 통과율은 오르고 제품은 죽는다.
- **저작권 규칙**: fixtures/samples는 자작 문서만. 실서적·기사 텍스트 유입은 즉시 반려. 데모도 자작 샘플로.
- **테스트를 코드에 맞추지 않는다**: 골든 스냅샷·게이트 케이스가 흔들리면 원인은 코드나 대본이다. retail-mcp의 수식 원칙과 동일한 방향 규율.
- **book-to-skill과의 관계**: 산출 구조의 표준 호환만 참고, 코드 참조·이식 금지(독립 구현이 제품 전략이자 라이선스 위생).

## 3. 일일 운영 루틴

1. 착수 가능 태스크 확인 → 레인별 worktree 배정 (다섯 레포 공용 큐)
2. 실행 중 개입하지 않는다 — 그 시간에 v0.2(워처)·ph-skill-pack 문서를 다듬는다
3. 완료 보고 → `npm run check` 재실행 → diff 리뷰 → 머지 → 상태 갱신
4. 격주: CLAUDE.md 프루닝, TASKS 정리

## 4. 자율성의 한계선 (사람이 잡는 것)

- 실 LLM 스모크 실행(비용)과 게이트 임계치·k 기본값 확정
- npm 퍼블리시·최종 이름 결정
- 게이트 규칙·산출 구조의 변경 승인
- ph-skill-pack(자매 레포) 착수 시점과 소스 선정
