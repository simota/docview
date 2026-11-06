/**
 * Line-based text diff (Myers O(ND)) with intraline word highlighting,
 * hunk grouping and unified-patch output. Pure functions, no DOM — shared by
 * the diff view and covered directly by unit tests.
 */

export type DiffOpType = 'equal' | 'delete' | 'insert';

export interface DiffOp {
  type: DiffOpType;
  /** 0-based index in the old line array (absent for inserts). */
  oldIndex?: number;
  /** 0-based index in the new line array (absent for deletes). */
  newIndex?: number;
}

export interface DiffOptions {
  /** Treat lines equal when they only differ in whitespace runs / trailing space. */
  ignoreWhitespace?: boolean;
  /** Abort exact search past this edit distance and fall back to a coarse replace. */
  maxEditDistance?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  /** Number of separate change blocks. */
  changes: number;
}

export interface DiffResult {
  oldLines: string[];
  newLines: string[];
  ops: DiffOp[];
  stats: DiffStats;
  /** True when the edit distance bound was hit and the middle was replaced wholesale. */
  approximate: boolean;
}

/** Split text into lines; a trailing newline does not produce an empty last line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function normalizeWs(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Myers' greedy shortest-edit-script over integer token ids. Returns the ops
 * for a[aStart..aEnd) vs b[bStart..bEnd), or null when the bound is exceeded.
 */
function myers(a: Int32Array, b: Int32Array, maxD: number): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const limit = Math.min(max, maxD);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;

  // Backtrack through the saved frontier snapshots.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const snap = trace[d];
    // snap index for diagonal k is (k + d + 1)
    const get = (k: number) => snap[k + d + 1];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && get(k - 1) < get(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ type: 'equal', oldIndex: x, newIndex: y }); }
    if (prevK === k + 1) { y--; ops.push({ type: 'insert', newIndex: y }); }
    else { x--; ops.push({ type: 'delete', oldIndex: x }); }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ type: 'equal', oldIndex: x, newIndex: y }); }
  ops.reverse();
  return ops;
}

function tokenIds(oldKeys: string[], newKeys: string[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const map = (keys: string[]) => {
    const out = new Int32Array(keys.length);
    keys.forEach((key, i) => {
      let id = ids.get(key);
      if (id === undefined) { id = ids.size; ids.set(key, id); }
      out[i] = id;
    });
    return out;
  };
  return [map(oldKeys), map(newKeys)];
}

/** Diff two key sequences; trims common prefix/suffix before running Myers. */
function diffKeys(oldKeys: string[], newKeys: string[], maxD: number): { ops: DiffOp[]; approximate: boolean } {
  let start = 0;
  while (start < oldKeys.length && start < newKeys.length && oldKeys[start] === newKeys[start]) start++;
  let endOld = oldKeys.length;
  let endNew = newKeys.length;
  while (endOld > start && endNew > start && oldKeys[endOld - 1] === newKeys[endNew - 1]) { endOld--; endNew--; }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', oldIndex: i, newIndex: i });

  const [a, b] = tokenIds(oldKeys.slice(start, endOld), newKeys.slice(start, endNew));
  let approximate = false;
  let middle = myers(a, b, maxD);
  if (!middle) {
    approximate = true;
    middle = [];
    for (let i = 0; i < a.length; i++) middle.push({ type: 'delete', oldIndex: i });
    for (let j = 0; j < b.length; j++) middle.push({ type: 'insert', newIndex: j });
  }
  for (const op of middle) {
    ops.push({
      type: op.type,
      oldIndex: op.oldIndex === undefined ? undefined : op.oldIndex + start,
      newIndex: op.newIndex === undefined ? undefined : op.newIndex + start,
    });
  }

  const tailOffsetNew = endNew - endOld;
  for (let i = endOld; i < oldKeys.length; i++) ops.push({ type: 'equal', oldIndex: i, newIndex: i + tailOffsetNew });
  return { ops, approximate };
}

/** Within each change block, emit deletions before insertions (git style). */
function normalizeBlocks(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  let dels: DiffOp[] = [];
  let ins: DiffOp[] = [];
  const flush = () => { out.push(...dels, ...ins); dels = []; ins = []; };
  for (const op of ops) {
    if (op.type === 'equal') { flush(); out.push(op); }
    else if (op.type === 'delete') dels.push(op);
    else ins.push(op);
  }
  flush();
  return out;
}

export function diffLines(oldText: string, newText: string, options: DiffOptions = {}): DiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const key = options.ignoreWhitespace ? normalizeWs : (s: string) => s;
  const maxD = options.maxEditDistance ?? 2000;
  const { ops: raw, approximate } = diffKeys(oldLines.map(key), newLines.map(key), maxD);
  const ops = normalizeBlocks(raw);
  let added = 0;
  let removed = 0;
  let changes = 0;
  let inChange = false;
  for (const op of ops) {
    if (op.type === 'equal') { inChange = false; continue; }
    if (!inChange) { changes++; inChange = true; }
    if (op.type === 'insert') added++;
    else removed++;
  }
  return { oldLines, newLines, ops, stats: { added, removed, changes }, approximate };
}

// --- Intraline ---

export interface InlineSegment {
  text: string;
  changed: boolean;
}

const WORD_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

function tokenize(line: string): string[] {
  return line.match(WORD_RE) ?? [];
}

function mergeSegments(segs: InlineSegment[]): InlineSegment[] {
  const out: InlineSegment[] = [];
  for (const seg of segs) {
    if (!seg.text) continue;
    const last = out[out.length - 1];
    if (last && last.changed === seg.changed) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/**
 * Word-level diff of a changed line pair. Returns null when the lines are too
 * dissimilar (or too long) for highlighting to be useful.
 */
export function diffInline(oldLine: string, newLine: string): { old: InlineSegment[]; new: InlineSegment[] } | null {
  if (oldLine.length + newLine.length > 4000) return null;
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const { ops } = diffKeys(a, b, 400);
  const oldSegs: InlineSegment[] = [];
  const newSegs: InlineSegment[] = [];
  let same = 0;
  for (const op of ops) {
    if (op.type === 'equal') {
      oldSegs.push({ text: a[op.oldIndex!], changed: false });
      newSegs.push({ text: b[op.newIndex!], changed: false });
      same += a[op.oldIndex!].length;
    } else if (op.type === 'delete') {
      oldSegs.push({ text: a[op.oldIndex!], changed: true });
    } else {
      newSegs.push({ text: b[op.newIndex!], changed: true });
    }
  }
  const longest = Math.max(oldLine.length, newLine.length);
  // Below ~30% shared content the highlight is mostly noise.
  if (longest > 0 && same / longest < 0.3) return null;
  return { old: mergeSegments(oldSegs), new: mergeSegments(newSegs) };
}

// --- Hunks / side-by-side rows ---

export interface SideCell {
  /** 1-based line number. */
  line: number;
  text: string;
}

export type DiffRow =
  | { kind: 'equal'; old: SideCell; new: SideCell }
  | { kind: 'change'; old: SideCell | null; new: SideCell | null; changeIndex: number }
  | { kind: 'skip'; oldStart: number; newStart: number; count: number; skipIndex: number };

/**
 * Pair deletions with insertions inside each change block and collapse long
 * unchanged stretches into `skip` rows (keeping `context` lines around changes).
 * `context < 0` keeps every line.
 */
export function buildRows(result: DiffResult, context = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  const { ops, oldLines, newLines } = result;
  let changeIndex = -1;
  let i = 0;
  // First build full rows.
  const full: DiffRow[] = [];
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'equal') {
      full.push({
        kind: 'equal',
        old: { line: op.oldIndex! + 1, text: oldLines[op.oldIndex!] },
        new: { line: op.newIndex! + 1, text: newLines[op.newIndex!] },
      });
      i++;
      continue;
    }
    changeIndex++;
    const dels: DiffOp[] = [];
    const ins: DiffOp[] = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') dels.push(ops[i]); else ins.push(ops[i]);
      i++;
    }
    const n = Math.max(dels.length, ins.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = ins[k];
      full.push({
        kind: 'change',
        old: d ? { line: d.oldIndex! + 1, text: oldLines[d.oldIndex!] } : null,
        new: a ? { line: a.newIndex! + 1, text: newLines[a.newIndex!] } : null,
        changeIndex,
      });
    }
  }
  if (context < 0) return full;

  // Mark which equal rows stay visible.
  const keep = new Uint8Array(full.length);
  full.forEach((row, idx) => {
    if (row.kind !== 'change') return;
    for (let j = Math.max(0, idx - context); j <= Math.min(full.length - 1, idx + context); j++) keep[j] = 1;
  });
  let skipIndex = 0;
  let idx = 0;
  while (idx < full.length) {
    if (keep[idx] || full[idx].kind !== 'equal') { rows.push(full[idx]); idx++; continue; }
    const start = idx;
    while (idx < full.length && !keep[idx] && full[idx].kind === 'equal') idx++;
    const first = full[start] as Extract<DiffRow, { kind: 'equal' }>;
    rows.push({ kind: 'skip', oldStart: first.old.line, newStart: first.new.line, count: idx - start, skipIndex: skipIndex++ });
  }
  return rows;
}

// --- Unified patch ---

export function toUnifiedPatch(result: DiffResult, oldLabel: string, newLabel: string, context = 3): string {
  const { ops, oldLines, newLines } = result;
  if (result.stats.changes === 0) return '';
  const out: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  // Indices of non-equal ops
  let i = 0;
  while (i < ops.length) {
    while (i < ops.length && ops[i].type === 'equal') i++;
    if (i >= ops.length) break;
    // Hunk start: back up `context` equal ops
    let start = i;
    let back = 0;
    while (start > 0 && back < context && ops[start - 1].type === 'equal') { start--; back++; }
    // Extend until we see more than 2*context equal ops in a row (or EOF)
    let end = i;
    while (end < ops.length) {
      if (ops[end].type !== 'equal') { end++; continue; }
      let run = 0;
      while (end + run < ops.length && ops[end + run].type === 'equal') run++;
      if (end + run >= ops.length || run > 2 * context) { end += Math.min(run, context); break; }
      end += run;
    }
    const slice = ops.slice(start, end);
    // Line numbers: position of first line on each side
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;
    const firstOld = slice.find((op) => op.oldIndex !== undefined);
    const firstNew = slice.find((op) => op.newIndex !== undefined);
    // Determine starting positions from preceding ops when one side is empty.
    const countBefore = (side: 'oldIndex' | 'newIndex') =>
      ops.slice(0, start).filter((op) => op[side] !== undefined).length;
    oldStart = firstOld ? firstOld.oldIndex! + 1 : countBefore('oldIndex');
    newStart = firstNew ? firstNew.newIndex! + 1 : countBefore('newIndex');
    const body: string[] = [];
    for (const op of slice) {
      if (op.type === 'equal') { body.push(` ${oldLines[op.oldIndex!]}`); oldCount++; newCount++; }
      else if (op.type === 'delete') { body.push(`-${oldLines[op.oldIndex!]}`); oldCount++; }
      else { body.push(`+${newLines[op.newIndex!]}`); newCount++; }
    }
    const range = (s: number, c: number) => (c === 1 ? `${s}` : `${s},${c}`);
    out.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`, ...body);
    i = end;
  }
  return out.join('\n') + '\n';
}
