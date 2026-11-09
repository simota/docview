// Bounded concurrency for fan-out work (e.g. filesystem syscalls).

/**
 * Map `items` through async `fn(item, index)` with at most `max` calls in
 * flight, resolving to results in input order (like Promise.all over
 * `items.map(fn)`). Only `max` workers exist at a time, so no promise or
 * closure is allocated per pending item. Rejects with the first error; workers
 * stop picking up new items once an error has occurred.
 */
export async function mapWithConcurrency(items, max, fn) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be a positive integer');
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(max, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
