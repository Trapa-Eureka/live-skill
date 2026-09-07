// Bounded-concurrency map (DESIGN §6 D3). Pure scheduling only: the caller passes the actual IO
// as fn. Preserves input order, and once one item fails no new item is started (in-flight items
// are allowed to finish).

/** Passes items to fn in input order with at most `limit` in flight at once. Results are in input
 * order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapConcurrent: limit must be a positive integer, got ${String(limit)}`);
  }
  const results: R[] = [];
  const queue = items.entries(); // one iterator shared by all workers: each item is taken by exactly one worker
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
