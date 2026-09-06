// 게이트 판정 규칙의 단일 출처(B4·B6, DESIGN §4·§7). gate.ts(판정)와 schemas.ts(manifest 의미 검증)가 같은
// 상수·함수를 써야 "코드가 내린 판정"과 "manifest에 적힌 판정"이 어긋날 수 없다. import 없음(순환 방지).

export const DEFAULT_THRESHOLD = 0.9;

/** 정책 하한(B4, DESIGN §7): 절반 미만 정답을 "verified"라 부를 수는 없다. config가 강제하고 gate·schema가 재검사한다 —
 * 값을 바꾸려면 코드가 아니라 DESIGN §7과 CLAUDE.md 가드레일 1 검토가 먼저다. */
export const GATE_THRESHOLD_FLOOR = 0.5;

/** 부동소수 오차 방지: 수학적으로 임계치와 같은 비율(예: 9/10 = 0.9)이 이진 반올림 때문에 근소하게 못 미치는
 * 것으로 계산되는 사고를 막는다 — 임계치 자체를 낮추는 것과는 다르다(가드레일 1). */
export const PASS_EPSILON = 1e-9;

/** threshold가 정책 범위 [FLOOR, 1] 안인지 — 경계(config)를 거치지 않은 호출자까지 막는다. */
export function assertGateThreshold(threshold: number): void {
  if (!(threshold >= GATE_THRESHOLD_FLOOR && threshold <= 1)) {
    throw new Error(
      `gate threshold ${String(threshold)} is outside the allowed range [${String(GATE_THRESHOLD_FLOOR)}, 1]. Fix: set GATE_THRESHOLD between ${String(GATE_THRESHOLD_FLOOR)} and 1 (default ${String(DEFAULT_THRESHOLD)}); the floor is a product policy (DESIGN §7), not a tunable.`,
    );
  }
}

export interface VerdictInput {
  /** 실제로 물어본(채점된) 문항 수. */
  asked: number;
  passRate: number;
  threshold: number;
  /** 유효 문항을 하나도 못 만든(미검증) 섹션 수 — B2. */
  uncoveredSections: number;
}

/** 통과 판정: 질문이 있어야 하고(B4), 통과율이 임계치 이상이어야 하고, 미검증 섹션이 없어야 한다(B2). */
export function decidePassed(v: VerdictInput): boolean {
  return v.asked > 0 && v.passRate >= v.threshold - PASS_EPSILON && v.uncoveredSections === 0;
}
