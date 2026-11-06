// Unit tests for the line diff engine used by the diff view (src/text-diff.ts).
// Node strips the TypeScript types at import time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffLines, diffInline, buildRows, toUnifiedPatch, splitLines } from '../src/text-diff.ts';

function rebuild(result) {
  return {
    oldText: result.ops.filter((o) => o.type !== 'insert').map((o) => result.oldLines[o.oldIndex]),
    newText: result.ops.filter((o) => o.type !== 'delete').map((o) => result.newLines[o.newIndex]),
  };
}

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

test('splitLines normalizes CRLF and ignores the trailing newline', () => {
  assert.deepEqual(splitLines('a\r\nb\rc\n'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('\n'), ['']);
});

test('identical texts produce no changes', () => {
  const r = diffLines('a\nb\n', 'a\nb\n');
  assert.deepEqual(r.stats, { added: 0, removed: 0, changes: 0 });
  assert.equal(toUnifiedPatch(r, 'a', 'b'), '');
});

test('counts additions, removals and separate change blocks', () => {
  const r = diffLines('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nB\nc\nd\ne\nf\ng\nh\ni\n');
  assert.deepEqual(r.stats, { added: 2, removed: 1, changes: 2 });
  assert.equal(r.approximate, false);
});

test('ops always reconstruct both inputs and pair only equal lines (fuzz)', () => {
  const rand = seeded(42);
  for (let t = 0; t < 400; t++) {
    const gen = () => Array.from({ length: Math.floor(rand() * 40) }, () => 'abcde'[Math.floor(rand() * 5)]).join('\n');
    const x = gen();
    const y = gen();
    const r = diffLines(x, y);
    const { oldText, newText } = rebuild(r);
    assert.deepEqual(oldText, r.oldLines);
    assert.deepEqual(newText, r.newLines);
    for (const op of r.ops) {
      if (op.type === 'equal') assert.equal(r.oldLines[op.oldIndex], r.newLines[op.newIndex]);
    }
  }
});

test('ignoreWhitespace treats re-indented lines as equal', () => {
  const r = diffLines('if (x) {\n  y();\n}\n', 'if (x)  {\n    y();\n}\n', { ignoreWhitespace: true });
  assert.equal(r.stats.changes, 0);
  assert.equal(diffLines('a  b\n', 'a b\n').stats.changes, 1);
});

test('falls back to an approximate replace beyond the edit-distance bound', () => {
  const a = Array.from({ length: 300 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 300 }, (_, i) => `b${i}`).join('\n');
  const r = diffLines(a, b, { maxEditDistance: 10 });
  assert.equal(r.approximate, true);
  assert.deepEqual(r.stats, { added: 300, removed: 300, changes: 1 });
  const { oldText, newText } = rebuild(r);
  assert.deepEqual(oldText, r.oldLines);
  assert.deepEqual(newText, r.newLines);
});

test('diffInline highlights only the changed words', () => {
  const r = diffInline('port: 8080 # prod', 'port: 3000 # prod');
  assert.ok(r);
  assert.deepEqual(r.old.filter((s) => s.changed).map((s) => s.text), ['8080']);
  assert.deepEqual(r.new.filter((s) => s.changed).map((s) => s.text), ['3000']);
  assert.equal(r.old.map((s) => s.text).join(''), 'port: 8080 # prod');
  // Completely different lines are not worth highlighting.
  assert.equal(diffInline('alpha beta', 'gamma delta'), null);
});

test('buildRows pairs deletions with insertions and collapses unchanged runs', () => {
  const old = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const neu = old.slice();
  neu[10] = 'changed';
  const r = diffLines(old.join('\n'), neu.join('\n'));
  const rows = buildRows(r, 2);
  assert.deepEqual(rows.map((row) => row.kind), ['skip', 'equal', 'equal', 'change', 'equal', 'equal', 'skip']);
  const change = rows[3];
  assert.equal(change.old.line, 11);
  assert.equal(change.new.text, 'changed');
  assert.equal(rows[0].count, 8);
  assert.equal(buildRows(r, -1).length, 20);
});

test('unified patches apply cleanly with patch(1) (fuzz)', async (t) => {
  try { execFileSync('patch', ['--version'], { stdio: 'ignore' }); } catch { t.skip('patch(1) not installed'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'docview-diff-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rand = seeded(7);
  for (let i = 0; i < 60; i++) {
    const gen = () => `${Array.from({ length: Math.floor(rand() * 40) }, () => 'abcdef'[Math.floor(rand() * 6)]).join('\n')}\n`;
    const x = gen();
    const y = gen();
    const patch = toUnifiedPatch(diffLines(x, y), 'a/w.txt', 'b/w.txt');
    if (!patch) { assert.equal(x, y); continue; }
    await writeFile(join(dir, 'w.txt'), x);
    await writeFile(join(dir, 'p.diff'), patch);
    execFileSync('patch', ['-s', join(dir, 'w.txt'), join(dir, 'p.diff')]);
    assert.equal(await readFile(join(dir, 'w.txt'), 'utf8'), y);
  }
});
