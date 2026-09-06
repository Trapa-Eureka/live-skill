// mapConcurrent — 제한된 동시성 map(core/concurrency.ts, D3). 순수 스케줄링이라 실 IO 없이 검증한다.
import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../src/core/concurrency.js";

/** 이벤트 루프를 한 바퀴 돌려 대기 중인 워커가 다음 항목을 집게 한다. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Controlled {
  started: number[];
  peak: number;
  release: (n: number) => void;
  fn: (n: number) => Promise<number>;
}

/** 각 항목을 호출자가 명시적으로 풀어줄 때까지 붙잡아 두는 fn — 동시 진행 수를 관찰한다. */
function controlled(): Controlled {
  const started: number[] = [];
  const resolvers = new Map<number, () => void>();
  let active = 0;
  const state: Controlled = {
    started,
    peak: 0,
    release: (n) => {
      const r = resolvers.get(n);
      if (r === undefined) throw new Error(`item ${String(n)} not started`);
      resolvers.delete(n);
      r();
    },
    fn: (n) =>
      new Promise<number>((resolve) => {
        active += 1;
        state.peak = Math.max(state.peak, active);
        started.push(n);
        resolvers.set(n, () => {
          active -= 1;
          resolve(n * 10);
        });
      }),
  };
  return state;
}

describe("mapConcurrent", () => {
  it("runs at most `limit` items at once, starts the next as soon as one finishes, keeps input order", async () => {
    const c = controlled();
    const done = mapConcurrent([1, 2, 3, 4, 5], 2, c.fn);
    expect(c.started).toEqual([1, 2]); // 첫 limit개는 즉시 시작

    c.release(2);
    await tick();
    expect(c.started).toEqual([1, 2, 3]); // 하나 끝나면 하나 더 — 여전히 2개만 진행 중

    c.release(1);
    c.release(3);
    await tick();
    expect(c.started).toEqual([1, 2, 3, 4, 5]);
    c.release(5);
    c.release(4);

    expect(await done).toEqual([10, 20, 30, 40, 50]); // 끝난 순서(2,1,3,5,4)가 아니라 입력 순서
    expect(c.peak).toBe(2);
  });

  it("rejects with the first failure and starts no further items", async () => {
    const c = controlled();
    const boom = new Error("boom");
    const done = mapConcurrent([1, 2, 3, 4], 2, (n) => (n === 2 ? Promise.reject(boom) : c.fn(n)));
    await expect(done).rejects.toBe(boom);
    c.release(1); // 진행 중이던 1은 끝나도록 두되
    await tick();
    expect(c.started).toEqual([1]); // 3·4는 시작하지 않는다
  });

  it("handles an empty input and a limit larger than the input", async () => {
    expect(await mapConcurrent([], 4, () => Promise.resolve(1))).toEqual([]);
    expect(await mapConcurrent(["a", "b"], 10, (s) => Promise.resolve(s.toUpperCase()))).toEqual([
      "A",
      "B",
    ]);
  });

  it("rejects a non-positive or fractional limit", async () => {
    await expect(mapConcurrent([1], 0, () => Promise.resolve(1))).rejects.toThrow(RangeError);
    await expect(mapConcurrent([1], 1.5, () => Promise.resolve(1))).rejects.toThrow(/limit/u);
  });
});
