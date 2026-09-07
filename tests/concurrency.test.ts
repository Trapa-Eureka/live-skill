// mapConcurrent: bounded-concurrency map (core/concurrency.ts, D3). Pure scheduling, so it is
// verified without real IO.
import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../src/core/concurrency.js";

/** Spins the event loop once so a waiting worker picks up the next item. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Controlled {
  started: number[];
  peak: number;
  release: (n: number) => void;
  fn: (n: number) => Promise<number>;
}

/** An fn that holds each item until the caller explicitly releases it, to observe how many run at
 * once. */
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
    expect(c.started).toEqual([1, 2]); // the first `limit` items start immediately

    c.release(2);
    await tick();
    expect(c.started).toEqual([1, 2, 3]); // one finishes, one more starts; still only 2 in flight

    c.release(1);
    c.release(3);
    await tick();
    expect(c.started).toEqual([1, 2, 3, 4, 5]);
    c.release(5);
    c.release(4);

    expect(await done).toEqual([10, 20, 30, 40, 50]); // input order, not completion order (2,1,3,5,4)
    expect(c.peak).toBe(2);
  });

  it("rejects with the first failure and starts no further items", async () => {
    const c = controlled();
    const boom = new Error("boom");
    const done = mapConcurrent([1, 2, 3, 4], 2, (n) => (n === 2 ? Promise.reject(boom) : c.fn(n)));
    await expect(done).rejects.toBe(boom);
    c.release(1); // the in-flight item 1 is allowed to finish,
    await tick();
    expect(c.started).toEqual([1]); // but 3 and 4 never start
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
