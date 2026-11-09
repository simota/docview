import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../lib/concurrency.mjs';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('mapWithConcurrency never exceeds max in-flight calls and keeps input order', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 50 }, (_, i) => i);
  const results = await mapWithConcurrency(items, 3, async (item, index) => {
    active++;
    peak = Math.max(peak, active);
    await tick((7 * item) % 4);
    active--;
    return `${item}:${index}`;
  });
  assert.equal(peak, 3);
  assert.deepEqual(results, items.map((i) => `${i}:${i}`));
});

test('mapWithConcurrency starts items in order and handles empty and small inputs', async () => {
  const order = [];
  await mapWithConcurrency([0, 1, 2, 3], 1, async (i) => { order.push(i); await tick(1); });
  assert.deepEqual(order, [0, 1, 2, 3]);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  assert.deepEqual(await mapWithConcurrency(['a'], 8, (x) => x.toUpperCase()), ['A']);
});

test('mapWithConcurrency rejects with the first error and stops taking new items', async () => {
  const started = [];
  await assert.rejects(mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (i) => {
    started.push(i);
    await tick(1);
    if (i === 1) throw new Error('boom');
  }), /boom/);
  await tick(10);
  assert.ok(started.length < 6, `started ${started}`);
  await assert.rejects(mapWithConcurrency([1], 1, () => { throw new Error('sync boom'); }), /sync boom/);
});

test('mapWithConcurrency rejects an invalid max', async () => {
  await assert.rejects(mapWithConcurrency([1], 0, (x) => x), RangeError);
  await assert.rejects(mapWithConcurrency([1], 1.5, (x) => x), RangeError);
});
