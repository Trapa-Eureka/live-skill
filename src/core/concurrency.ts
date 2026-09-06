// 제한된 동시성 map(DESIGN §6 D3). 순수 스케줄링만 — 실제 IO는 호출자가 fn으로 넘긴다.
// 입력 순서를 보존하고, 하나가 실패하면 새 작업은 더 시작하지 않는다(진행 중인 것은 끝나도록 둔다).

/** items를 입력 순서대로 fn에 넘기되 동시에 최대 limit개만 진행한다. 결과는 입력 순서. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapConcurrent: limit must be a positive integer, got ${String(limit)}`);
  }
  const results: R[] = [];
  const queue = items.entries(); // 워커들이 공유하는 단일 이터레이터 — 각 항목은 정확히 한 워커가 집는다
  let failed = false;

  async function worker(): Promise<void> {
    for (let step = queue.next(); !step.done && !failed; step = queue.next()) {
      const [index, item] = step.value;
      results[index] = await fn(item, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  try {
    await Promise.all(workers);
  } catch (e) {
    failed = true;
    throw e;
  }
  return results;
}
