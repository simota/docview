/**
 * Log viewer supporting Apache/nginx access logs and Laravel application logs.
 *
 * Supported formats:
 *   Combined (Apache/nginx): %h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i"
 *   Common  (Apache):        %h %l %u %t "%r" %>s %b
 *   Laravel:                 [YYYY-MM-DD HH:MM:SS] env.LEVEL: message
 */

import { renderJsonTree } from './json-tree';

const MAX_TABLE_ROWS = 1000;

// Combined log format regex (covers Apache Combined & nginx default)
const COMBINED_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*?)"\s+(\d{3}|-)\s+(\S+)\s+"([^"]*?)"\s+"([^"]*?)"\s*$/;

// Common log format regex (no Referer / User-Agent)
const COMMON_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*?)"\s+(\d{3}|-)\s+(\S+)\s*$/;

// Laravel format: `[2026-05-21 11:36:17] local.INFO: ...`
// Allows ISO 8601 timestamps too (T-separator, fractional seconds, timezone).
const LARAVEL_RE =
  /^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?)\]\s+([^.\s]+)\.([A-Z!]+):\s*(.*)$/;

export interface LogEntry {
  ip: string;
  user: string;
  timestamp: string;
  method: string;
  path: string;
  protocol: string;
  status: string;
  size: string;
  referer: string;
  userAgent: string;
  raw: string;
}

export type LogFormat = 'combined' | 'common' | 'laravel' | 'unknown';

function parseRequest(req: string): { method: string; path: string; protocol: string } {
  const parts = req.split(' ');
  return {
    method: parts[0] ?? '',
    path: parts[1] ?? req,
    protocol: parts[2] ?? '',
  };
}

export function detectLogFormat(content: string): LogFormat {
  const firstLines = content.split('\n').filter((l) => l.trim()).slice(0, 10);
  let laravelHits = 0;
  for (const line of firstLines) {
    if (COMBINED_RE.test(line)) return 'combined';
    if (COMMON_RE.test(line)) return 'common';
    if (LARAVEL_RE.test(line)) laravelHits++;
  }
  if (laravelHits > 0) return 'laravel';
  return 'unknown';
}

function parseLine(line: string, format: LogFormat): LogEntry | null {
  const raw = line;

  if (format === 'combined') {
    const m = COMBINED_RE.exec(line);
    if (!m) return null;
    const req = parseRequest(m[5]);
    return {
      ip: m[1], user: m[3], timestamp: m[4],
      method: req.method, path: req.path, protocol: req.protocol,
      status: m[6], size: m[7], referer: m[8], userAgent: m[9],
      raw,
    };
  }

  if (format === 'common') {
    const m = COMMON_RE.exec(line);
    if (!m) return null;
    const req = parseRequest(m[5]);
    return {
      ip: m[1], user: m[3], timestamp: m[4],
      method: req.method, path: req.path, protocol: req.protocol,
      status: m[6], size: m[7], referer: '-', userAgent: '-',
      raw,
    };
  }

  return null;
}

function statusClass(status: string): string {
  const code = parseInt(status, 10);
  if (code >= 200 && code < 300) return 'log-status-2xx';
  if (code >= 300 && code < 400) return 'log-status-3xx';
  if (code >= 400 && code < 500) return 'log-status-4xx';
  if (code >= 500) return 'log-status-5xx';
  return '';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Laravel ----------

interface LaravelEntry {
  startLine: number;     // 1-based line in the original file
  endLine: number;       // last line of this entry (inclusive)
  timestamp: string;
  channel: string;
  level: string;
  firstLine: string;     // text after `level:` on the same line as the timestamp
  body: string;          // multi-line continuation (excludes the header line)
}

function parseLaravel(content: string): LaravelEntry[] {
  const lines = content.split('\n');
  const entries: LaravelEntry[] = [];
  let current: LaravelEntry | null = null;
  const bodyParts: string[] = [];

  const flush = () => {
    if (current) {
      current.body = bodyParts.join('\n').replace(/\s+$/, '');
      entries.push(current);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = LARAVEL_RE.exec(line);
    if (m) {
      flush();
      bodyParts.length = 0;
      current = {
        startLine: i + 1,
        endLine: i + 1,
        timestamp: m[1],
        channel: m[2],
        level: m[3],
        firstLine: m[4],
        body: '',
      };
    } else if (current) {
      bodyParts.push(line);
      current.endLine = i + 1;
    }
  }
  flush();
  return entries;
}

function levelClass(level: string): string {
  const k = level.toUpperCase();
  if (k === 'EMERGENCY' || k === 'ALERT' || k === 'CRITICAL') return 'log-level-critical';
  if (k === 'ERROR') return 'log-level-error';
  if (k === 'WARNING' || k === 'WARN' || k === 'NOTICE') return 'log-level-warn';
  if (k === 'INFO') return 'log-level-info';
  if (k === 'DEBUG') return 'log-level-debug';
  return 'log-level-other';
}

interface PreviewPayload {
  summary: string;
  jsonText?: string;       // pretty-printed JSON, if parseable
  parsedJson?: unknown;    // for HTTP-style summary fields
  detailText?: string;     // raw multi-line content when no JSON
}

function tryParseJsonSlice(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Find a balanced `{...}` block starting at the first `{` in `s`.
 * Returns the slice or null if no balanced block is found.
 * Handles strings (with escaped quotes) and ignores braces inside them.
 */
function extractBalancedJson(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function buildPreview(entry: LaravelEntry): PreviewPayload {
  const head = entry.firstLine;
  const full = entry.body ? `${head}\n${entry.body}` : head;

  // Attempt 1: JSON at the end of the first line (single-line entries).
  const balancedHead = extractBalancedJson(head);
  if (balancedHead && balancedHead.length > 2) {
    const parsed = tryParseJsonSlice(balancedHead);
    if (parsed && typeof parsed === 'object') {
      const before = head.slice(0, head.indexOf('{')).trim();
      return {
        summary: summarizeJson(parsed, before),
        jsonText: JSON.stringify(parsed, null, 2),
        parsedJson: parsed,
        detailText: entry.body || undefined,
      };
    }
  }

  // Attempt 2: JSON that spans multiple lines (e.g. exception payloads).
  const balancedFull = extractBalancedJson(full);
  if (balancedFull && balancedFull.length > 2) {
    const parsed = tryParseJsonSlice(balancedFull);
    const before = full.slice(0, full.indexOf('{')).trim();
    if (parsed && typeof parsed === 'object') {
      return {
        summary: summarizeJson(parsed, before),
        jsonText: JSON.stringify(parsed, null, 2),
        parsedJson: parsed,
      };
    }
    // JSON was not strictly parseable (Laravel sometimes emits unescaped newlines
    // inside exception strings); still surface the leading text as the summary
    // and keep the full body in the detail panel.
  }

  // Plain text / multi-line var_dump-style entry.
  const summary = head.trim() || entry.body.split('\n').find((l) => l.trim()) || '';
  return {
    summary: summary.slice(0, 240),
    detailText: entry.body || undefined,
  };
}

function summarizeJson(json: unknown, before: string): string {
  if (!json || typeof json !== 'object') return before;
  const obj = json as Record<string, unknown>;

  // HTTP-style log
  if (typeof obj.url === 'string' && typeof obj.method === 'string') {
    const method = String(obj.method);
    const url = String(obj.url);
    const status = obj.status != null ? String(obj.status) : '';
    const user = obj.user_id != null ? String(obj.user_id) : '-';
    const arrow = status ? ` → ${status}` : '';
    return `${method} ${url}${arrow}  (user: ${user})`;
  }

  // Exception log: prefer the human text before the JSON.
  if (before) return before;

  // Fallback: first few key/value pairs.
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (pairs.length >= 3) break;
    let val: string;
    if (v === null) val = 'null';
    else if (typeof v === 'object') val = Array.isArray(v) ? `[${v.length}]` : '{…}';
    else val = String(v);
    if (val.length > 40) val = val.slice(0, 37) + '…';
    pairs.push(`${k}: ${val}`);
  }
  return pairs.join(', ');
}

function renderLaravelTable(content: string): string {
  const entries = parseLaravel(content);
  if (!entries.length) {
    return `<p class="error-banner">No Laravel log entries found.</p>`;
  }

  const totalCount = entries.length;
  const items = entries.slice(0, MAX_TABLE_ROWS);
  const truncated = totalCount > MAX_TABLE_ROWS;

  const ths = `
    <th class="log-line-num-head" aria-label="Line number">#</th>
    <th data-col="time" data-sort-key="time" role="columnheader" aria-sort="none">Time<span class="sort-indicator" aria-hidden="true"></span></th>
    <th data-col="level" data-sort-key="level" role="columnheader" aria-sort="none">Level<span class="sort-indicator" aria-hidden="true"></span></th>
    <th data-col="channel" data-sort-key="channel" role="columnheader" aria-sort="none">Channel<span class="sort-indicator" aria-hidden="true"></span></th>
    <th>Message</th>`;

  const rows = items.map((entry, i) => {
    const lvCls = levelClass(entry.level);
    const lineNum = entry.startLine;
    const preview = buildPreview(entry);
    const expandable = !!(preview.jsonText || preview.detailText);

    const summaryHtml = expandable
      ? `<button class="laravel-expand" type="button" aria-expanded="false" aria-label="Toggle details" tabindex="0">▶</button><span class="laravel-msg-text">${esc(preview.summary)}</span>`
      : `<span class="laravel-msg-text">${esc(preview.summary)}</span>`;

    const mainRow = `<tr class="laravel-row" data-row="${i}" data-line="${lineNum}">
      <td class="log-line-num" data-line="${lineNum}" role="button" tabindex="0" title="Click to copy link to line ${lineNum}">${lineNum}</td>
      <td class="log-ts">${esc(entry.timestamp)}</td>
      <td><span class="log-level ${lvCls}">${esc(entry.level)}</span></td>
      <td class="log-channel">${esc(entry.channel)}</td>
      <td class="laravel-msg">${summaryHtml}</td>
    </tr>`;

    let detailRow = '';
    if (expandable) {
      const parts: string[] = [];
      if (preview.parsedJson != null && preview.jsonText) {
        const tree = renderJsonTree(preview.jsonText);
        if (tree) parts.push(`<div class="laravel-detail-json">${tree}</div>`);
        else parts.push(`<pre class="laravel-detail-pre">${esc(preview.jsonText)}</pre>`);
      } else if (preview.jsonText) {
        parts.push(`<pre class="laravel-detail-pre">${esc(preview.jsonText)}</pre>`);
      }
      if (preview.detailText) {
        parts.push(`<pre class="laravel-detail-pre">${esc(preview.detailText)}</pre>`);
      }
      detailRow = `<tr class="laravel-row-detail" data-row="${i}" hidden>
        <td colspan="5">${parts.join('')}</td>
      </tr>`;
    }

    return mainRow + detailRow;
  }).join('');

  const totalLabel = truncated
    ? `Showing first ${items.length} of ${totalCount} entries`
    : `${totalCount} entries`;

  const truncBanner = truncated
    ? `<div class="csv-info csv-info--warn">Table limited to first ${MAX_TABLE_ROWS} entries. Use Source view to see the full file.</div>`
    : '';

  return `<div class="csv-view log-view laravel-log-view">
    <div class="csv-info">${esc(totalLabel)} &bull; Format: laravel</div>
    ${truncBanner}
    <div class="csv-table-wrap">
      <table class="csv-table laravel-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

// ---------- Apache / nginx (unchanged) ----------

function renderAccessLogTable(content: string, format: 'combined' | 'common'): string {
  const rawLines = content.split('\n');
  const indexed: Array<{ line: string; origLine: number }> = [];
  rawLines.forEach((l, i) => { if (l.trim() !== '') indexed.push({ line: l, origLine: i + 1 }); });

  if (!indexed.length) {
    return `<p class="error-banner">No log entries found.</p>`;
  }

  const allCount = indexed.length;
  const tableItems = indexed.slice(0, MAX_TABLE_ROWS);
  const truncated = allCount > MAX_TABLE_ROWS;

  const entries: LogEntry[] = [];
  const entryLineNums: number[] = [];
  const unparsed: number[] = [];

  tableItems.forEach(({ line, origLine }) => {
    const entry = parseLine(line, format);
    if (entry) {
      entries.push(entry);
      entryLineNums.push(origLine);
    } else {
      unparsed.push(origLine);
    }
  });

  if (!entries.length) {
    return `<p class="error-banner">Could not parse any log entries.</p>`;
  }

  const isCombined = format === 'combined';

  const headerCols = [
    'IP', 'User', 'Timestamp', 'Method', 'Path', 'Status', 'Size',
    ...(isCombined ? ['Referer', 'User-Agent'] : []),
  ];

  const ths = [
    `<th class="log-line-num-head" aria-label="Line number">#</th>`,
    ...headerCols.map((h) => `<th data-col="${esc(h)}" role="columnheader" aria-sort="none">${esc(h)}<span class="sort-indicator" aria-hidden="true"></span></th>`),
  ].join('');

  const trs = entries
    .map((e, i) => {
      const sc = statusClass(e.status);
      const lineNum = entryLineNums[i];
      const lineTd = `<td class="log-line-num" data-line="${lineNum}" role="button" tabindex="0" title="Click to copy link to line ${lineNum}">${lineNum}</td>`;
      const baseTds = [
        `<td>${esc(e.ip)}</td>`,
        `<td>${esc(e.user)}</td>`,
        `<td class="log-ts">${esc(e.timestamp)}</td>`,
        `<td><span class="log-method log-method-${esc(e.method.toLowerCase())}">${esc(e.method)}</span></td>`,
        `<td class="log-path" title="${esc(e.path)}">${esc(e.path)}</td>`,
        `<td><span class="log-status ${sc}">${esc(e.status)}</span></td>`,
        `<td class="log-num">${esc(e.size)}</td>`,
      ];
      const extraTds = isCombined
        ? [
            `<td class="log-referer" title="${esc(e.referer)}">${esc(e.referer)}</td>`,
            `<td class="log-ua" title="${esc(e.userAgent)}">${esc(e.userAgent)}</td>`,
          ]
        : [];
      return `<tr data-row-index="${i}" data-line="${lineNum}">${[lineTd, ...baseTds, ...extraTds].join('')}</tr>`;
    })
    .join('');

  const totalLabel = truncated
    ? `Showing first ${entries.length} of ${allCount} lines`
    : `${entries.length} entries`;

  const warnBanner =
    unparsed.length > 0
      ? `<div class="csv-info csv-info--warn">Skipped ${unparsed.length} unparsed line(s): ${unparsed.slice(0, 10).join(', ')}${unparsed.length > 10 ? '…' : ''}</div>`
      : '';

  const truncBanner = truncated
    ? `<div class="csv-info csv-info--warn">Table limited to first ${MAX_TABLE_ROWS} rows. Use Source view to see all ${allCount} lines.</div>`
    : '';

  return `<div class="csv-view log-view">
    <div class="csv-info">${esc(totalLabel)} &bull; Format: ${esc(format)}</div>
    ${warnBanner}${truncBanner}
    <div class="csv-table-wrap">
      <table class="csv-table csv-sortable">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  </div>`;
}

export function renderLogTable(content: string, _path: string): string {
  const format = detectLogFormat(content);
  if (format === 'unknown') return '';
  if (format === 'laravel') return renderLaravelTable(content);
  return renderAccessLogTable(content, format);
}

// ---------- Laravel table sorting ----------
//
// Each entry occupies two rows (the main `.laravel-row` and the optional
// `.laravel-row-detail` that follows it). The CSV sort helper sorts individual
// rows, which would split these pairs, so Laravel logs get their own click
// handler that operates on row pairs.

const LEVEL_RANK: Record<string, number> = {
  DEBUG: 10, INFO: 20, NOTICE: 30, WARNING: 40, WARN: 40,
  ERROR: 50, CRITICAL: 60, ALERT: 70, EMERGENCY: 80,
};

function cmpForKey(a: HTMLElement, b: HTMLElement, key: string): number {
  if (key === 'time') {
    const ta = a.querySelector<HTMLElement>('.log-ts')?.textContent?.trim() ?? '';
    const tb = b.querySelector<HTMLElement>('.log-ts')?.textContent?.trim() ?? '';
    const da = Date.parse(ta);
    const db = Date.parse(tb);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    return ta.localeCompare(tb);
  }
  if (key === 'level') {
    const la = a.querySelector<HTMLElement>('.log-level')?.textContent?.trim().toUpperCase() ?? '';
    const lb = b.querySelector<HTMLElement>('.log-level')?.textContent?.trim().toUpperCase() ?? '';
    return (LEVEL_RANK[la] ?? 0) - (LEVEL_RANK[lb] ?? 0);
  }
  if (key === 'channel') {
    const ca = a.querySelector<HTMLElement>('.log-channel')?.textContent?.trim() ?? '';
    const cb = b.querySelector<HTMLElement>('.log-channel')?.textContent?.trim() ?? '';
    return ca.localeCompare(cb);
  }
  return 0;
}

function sortLaravelTable(table: HTMLTableElement, th: HTMLElement): void {
  const key = th.dataset.sortKey;
  if (!key) return;
  const current = th.getAttribute('aria-sort');
  const direction: 'ascending' | 'descending' =
    current === 'ascending' ? 'descending' : 'ascending';

  // Reset all sortable headers
  table.querySelectorAll<HTMLElement>('thead th[data-sort-key]').forEach((h) => {
    h.setAttribute('aria-sort', 'none');
    h.classList.remove('sort-asc', 'sort-desc');
  });
  th.setAttribute('aria-sort', direction);
  th.classList.add(direction === 'ascending' ? 'sort-asc' : 'sort-desc');

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  // Group rows into [main, detail?] pairs by data-row.
  const mains = Array.from(tbody.querySelectorAll<HTMLElement>('tr.laravel-row'));
  const pairs: Array<{ main: HTMLElement; detail: HTMLElement | null }> = mains.map((main) => {
    const rowId = main.dataset.row;
    const detail = rowId != null
      ? tbody.querySelector<HTMLElement>(`tr.laravel-row-detail[data-row="${rowId}"]`)
      : null;
    return { main, detail };
  });

  pairs.sort((a, b) => {
    const cmp = cmpForKey(a.main, b.main, key);
    return direction === 'ascending' ? cmp : -cmp;
  });

  // Re-append in new order (preserves DOM state like expand/collapse).
  pairs.forEach(({ main, detail }) => {
    tbody.appendChild(main);
    if (detail) tbody.appendChild(detail);
  });
}

let laravelSortInited = false;
export function initLaravelSort(): void {
  if (laravelSortInited) return;
  laravelSortInited = true;
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const th = target.closest('th[data-sort-key]') as HTMLElement | null;
    if (!th) return;
    const table = th.closest('table.laravel-table') as HTMLTableElement | null;
    if (!table) return;
    e.preventDefault();
    sortLaravelTable(table, th);
  });
}
