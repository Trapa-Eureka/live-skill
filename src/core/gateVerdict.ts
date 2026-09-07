// Single source of the gate verdict rules (B4, B6; DESIGN §4, §7). gate.ts (the verdict) and
// schemas.ts (manifest semantic validation) must use the same constants and functions, so that "the
// verdict the code reached" and "the verdict written in the manifest" cannot diverge. No imports
// (avoids cycles).

export const DEFAULT_THRESHOLD = 0.9;

/** Policy floor (B4, DESIGN §7): fewer than half correct cannot be called "verified". config enforces
 * it and gate/schema re-check it. Changing the value starts with a review of DESIGN §7 and CLAUDE.md
 * guardrail 1, not with code. */
export const GATE_THRESHOLD_FLOOR = 0.5;

/** Floating-point guard: prevents a ratio that mathematically equals the threshold (e.g. 9/10 = 0.9)
 * from computing as slightly below it because of binary rounding. This is not the same as lowering
 * the threshold (guardrail 1). */
export const PASS_EPSILON = 1e-9;

/** Checks that threshold is within the policy range [FLOOR, 1]; also stops callers that did not go
 * through the boundary (config). */
export function assertGateThreshold(threshold: number): void {
  if (!(threshold >= GATE_THRESHOLD_FLOOR && threshold <= 1)) {
    throw new Error(
      `gate threshold ${String(threshold)} is outside the allowed range [${String(GATE_THRESHOLD_FLOOR)}, 1]. Fix: set GATE_THRESHOLD between ${String(GATE_THRESHOLD_FLOOR)} and 1 (default ${String(DEFAULT_THRESHOLD)}); the floor is a product policy (DESIGN §7), not a tunable.`,
    );
  }
}

export interface VerdictInput {
  /** Number of questions actually asked (graded). */
  asked: number;
  passRate: number;
  threshold: number;
  /** Number of unverified sections, i.e. sections for which no valid question could be produced (B2). */
  uncoveredSections: number;
}

/** Pass verdict: there must be questions (B4), the pass rate must meet the threshold, and there must be
 * no unverified sections (B2). */
export function decidePassed(v: VerdictInput): boolean {
  return v.asked > 0 && v.passRate >= v.threshold - PASS_EPSILON && v.uncoveredSections === 0;
}
