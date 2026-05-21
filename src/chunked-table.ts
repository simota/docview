/**
 * Chunked table viewer with server-side pagination and search.
 * Handles large CSV, TSV, JSONL, and Log files without loading them fully into memory.
 */

import Papa from 'papaparse';
import { detectLogFormat, type LogEntry, type LogFormat } from './log-viewer';

type FileKind = 'csv' | 'jsonl' | 'log';

interface ChunkMeta {
  path: string;
  kind: FileKind;
  totalLines: number;
  fileSize: number;
  mtime: string;
}

interface SearchMatch {
  lineNum: number;
  text: string;
}

interface SearchResult {
  matches: SearchMatch[];
  totalMatches: number;
  totalLines: number;
  headerLine: string | null;
}

const PAGE_SIZE = 1000;
const SEARCH_DEBOUNCE_MS = 300;

// --- Shared HTML helpers ---

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape HTML then wrap matching portions in <mark> */
function escWithHighlight(s: string, query: string): string {
  const escaped = esc(s);
  if (!query) return escaped;
  const escapedQuery = esc(query);
  const re = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(re, '<mark class="chunk-highlight">$1</mark>');
}

function statusClass(status: string): string {
  const code = parseInt(status, 10);
  if (code >= 200 && code < 300) return 'log-status-2xx';
  if (code >= 300 && code < 400) return 'log-status-3xx';
  if (code >= 400 && code < 500) return 'log-status-4xx';
  if (code >= 500) return 'log-status-5xx';
  return '';
}

// --- CSV/TSV chunk parsing ---

interface CsvChunkResult {
  fields: string[];
  rows: Record<string, unknown>[];
}

function parseCsvChunk(text: string, hasHeader: boolean): CsvChunkResult {
  const result = Papa.parse(text, {
    header: hasHeader,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  const fields = result.meta.fields ?? [];
  const rows = (result.data as Record<string, unknown>[]) ?? [];
  return { fields, rows };
}

// --- JSONL chunk parsing ---

interface JsonlChunkResult {
  fields: string[];
  rows: Record<string, unknown>[];
  parseErrors: number;
}

function parseJsonlChunk(text: string): JsonlChunkResult {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const rows: Record<string, unknown>[] = [];
  let parseErrors = 0;
  const fieldSet = new Map<string, true>();

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        rows.push(obj as Record<string, unknown>);
        for (const key of Object.keys(obj)) fieldSet.set(key, true);
      } else {
        parseErrors++;
      }
    } catch {
      parseErrors++;
    }
  }

  return { fields: Array.from(fieldSet.keys()), rows, parseErrors };
}

// --- Log chunk parsing ---

const COMBINED_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*?)"\s+(\d{3}|-)\s+(\S+)\s+"([^"]*?)"\s+"([^"]*?)"\s*$/;
const COMMON_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*?)"\s+(\d{3}|-)\s+(\S+)\s*$/;

function parseLogLine(line: string, format: LogFormat): LogEntry | null {
  if (format === 'combined') {
    const m = COMBINED_RE.exec(line);
    if (!m) return null;
    const parts = m[5].split(' ');
    return {
      ip: m[1], user: m[3], timestamp: m[4],
      method: parts[0] ?? '', path: parts[1] ?? m[5], protocol: parts[2] ?? '',
      status: m[6], size: m[7], referer: m[8], userAgent: m[9], raw: line,
    };
  }
  if (format === 'common') {
    const m = COMMON_RE.exec(line);
    if (!m) return null;
    const parts = m[5].split(' ');
    return {
      ip: m[1], user: m[3], timestamp: m[4],
      method: parts[0] ?? '', path: parts[1] ?? m[5], protocol: parts[2] ?? '',
      status: m[6], size: m[7], referer: '-', userAgent: '-', raw: line,
    };
  }
  return null;
}

// --- Render helpers with optional highlighting ---

function renderCsvRows(fields: string[], rows: Record<string, unknown>[], query = ''): string {
  return rows.map((row, i) => {
    const tds = fields.map((f) => `<td>${escWithHighlight(String(row[f] ?? ''), query)}</td>`).join('');
    return `<tr data-row-index="${i}">${tds}</tr>`;
  }).join('');
}

function renderJsonlRows(fields: string[], rows: Record<string, unknown>[], query = ''): string {
  return rows.map((row, i) => {
    const tds = fields.map((f) => {
      const val = row[f];
      const cell = val === undefined || val === null ? ''
        : typeof val === 'object' ? JSON.stringify(val)
        : String(val);
      return `<td>${escWithHighlight(cell, query)}</td>`;
    }).join('');
    return `<tr data-row-index="${i}">${tds}</tr>`;
  }).join('');
}

function renderLogRows(entries: LogEntry[], isCombined: boolean, query = ''): string {
  return entries.map((e, i) => {
    const sc = statusClass(e.status);
    const h = (s: string) => escWithHighlight(s, query);
    const tds = [
      `<td>${h(e.ip)}</td>`,
      `<td>${h(e.user)}</td>`,
      `<td class="log-ts">${h(e.timestamp)}</td>`,
      `<td><span class="log-method log-method-${esc(e.method.toLowerCase())}">${h(e.method)}</span></td>`,
      `<td class="log-path" title="${esc(e.path)}">${h(e.path)}</td>`,
      `<td><span class="log-status ${sc}">${h(e.status)}</span></td>`,
      `<td class="log-num">${h(e.size)}</td>`,
    ];
    if (isCombined) {
      tds.push(
        `<td class="log-referer" title="${esc(e.referer)}">${h(e.referer)}</td>`,
        `<td class="log-ua" title="${esc(e.userAgent)}">${h(e.userAgent)}</td>`,
      );
    }
    return `<tr data-row-index="${i}">${tds.join('')}</tr>`;
  }).join('');
}

function renderPagination(currentPage: number, totalPages: number): string {
  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
  return `<div class="chunk-pagination">
    <button class="chunk-page-btn" data-page="first" ${prevDisabled} title="First page">&laquo;</button>
    <button class="chunk-page-btn" data-page="prev" ${prevDisabled} title="Previous page">&lsaquo;</button>
    <span class="chunk-page-info">
      <input class="chunk-page-input" type="number" min="1" max="${totalPages}" value="${currentPage}" aria-label="Page number"> / ${totalPages.toLocaleString()}
    </span>
    <button class="chunk-page-btn" data-page="next" ${nextDisabled} title="Next page">&rsaquo;</button>
    <button class="chunk-page-btn" data-page="last" ${nextDisabled} title="Last page">&raquo;</button>
  </div>`;
}

function renderSearchBar(query: string, totalMatches: number | null): string {
  const matchInfo = totalMatches !== null
    ? `<span class="chunk-search-count">${totalMatches.toLocaleString()} matches</span>`
    : '';
  const clearBtn = query
    ? `<button class="chunk-search-clear" title="Clear search">&times;</button>`
    : '';
  return `<div class="chunk-search">
    <input class="chunk-search-input" type="text" placeholder="Search in file..." value="${esc(query)}" aria-label="Search in file">
    ${clearBtn}
    ${matchInfo}
  </div>`;
}

// --- Main chunked table class ---

interface ChunkedOptions {
  /** Target line from URL hash. Used to open the page that contains it. */
  initialLine?: number | null;
  /** Retained for signature parity with the main viewer; currently unused
   *  because chunked rendering only navigates by page, not by range. */
  initialLineEnd?: number | null;
}

export class ChunkedTable {
  private container: HTMLElement;
  private meta: ChunkMeta;
  private currentPage = 1;
  private totalPages: number;
  private initialLine: number | null;

  // Cached header for CSV (first row parsed from first chunk)
  private csvFields: string[] | null = null;
  // Cached log format
  private logFormat: LogFormat = 'unknown';

  // Search state
  private searchQuery = '';
  private searchTotalMatches = 0;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, meta: ChunkMeta, options: ChunkedOptions = {}) {
    this.container = container;
    this.meta = meta;
    this.initialLine = options.initialLine ?? null;
    const dataLines = meta.kind === 'csv' ? Math.max(0, meta.totalLines - 1) : meta.totalLines;
    this.totalPages = Math.max(1, Math.ceil(dataLines / PAGE_SIZE));
  }

  async init(): Promise<void> {
    if (this.meta.kind === 'csv') {
      const headerText = await this.fetchLines(0, 1);
      const parsed = parseCsvChunk(headerText, true);
      this.csvFields = parsed.fields.length > 0 ? parsed.fields : null;
    }

    if (this.meta.kind === 'log') {
      const sampleText = await this.fetchLines(0, 5);
      this.logFormat = detectLogFormat(sampleText);
      // Chunked rendering only supports the line-oriented Apache/nginx formats.
      // Laravel entries can span multiple lines (stack traces, var_dump output),
      // which the page-based fetcher cannot safely split — fall back to the
      // non-chunked viewer in main.ts by clearing the container.
      if (this.logFormat === 'unknown' || this.logFormat === 'laravel') {
        this.container.innerHTML = '';
        return;
      }
    }

    await this.loadPage(this.computeInitialPage());
  }

  /** Page that contains `initialLine`. Falls back to 1 when unset. */
  private computeInitialPage(): number {
    if (this.initialLine == null) return 1;
    const n = this.initialLine;
    // CSV line 1 is the header; data rows span lines 2..N, so the data index
    // is (line - 1) and paging counts from there.
    const dataIdx = this.meta.kind === 'csv' ? Math.max(1, n - 1) : n;
    return Math.max(1, Math.min(this.totalPages, Math.ceil(dataIdx / PAGE_SIZE)));
  }

  isLogUnknown(): boolean {
    // Returns true when ChunkedTable cannot render the log itself and the caller
    // should fall back to the full-file viewer. Includes Laravel logs, which
    // require multi-line entry parsing that doesn't fit the page-based fetcher.
    return this.meta.kind === 'log' && (this.logFormat === 'unknown' || this.logFormat === 'laravel');
  }

  private async fetchLines(offset: number, limit: number): Promise<string> {
    const url = `/api/file?path=${encodeURIComponent(this.meta.path)}&offset=${offset}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const totalHeader = res.headers.get('X-Total-Lines');
    if (totalHeader) {
      const total = parseInt(totalHeader, 10);
      if (!isNaN(total) && total > 0) {
        const dataLines = this.meta.kind === 'csv' ? Math.max(0, total - 1) : total;
        if (!this.searchQuery) {
          this.totalPages = Math.max(1, Math.ceil(dataLines / PAGE_SIZE));
        }
        this.meta.totalLines = total;
      }
    }
    return res.text();
  }

  private async fetchSearchResults(query: string, offset: number, limit: number): Promise<SearchResult> {
    const url = `/api/file/search?path=${encodeURIComponent(this.meta.path)}&q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  }

  private async loadPage(page: number): Promise<void> {
    if (this.searchQuery) {
      await this.loadSearchPage(page);
      return;
    }

    this.currentPage = Math.max(1, Math.min(page, this.totalPages));
    const dataOffset = (this.currentPage - 1) * PAGE_SIZE;
    const lineOffset = this.meta.kind === 'csv' ? dataOffset + 1 : dataOffset;

    this.showLoading();
    const text = await this.fetchLines(lineOffset, PAGE_SIZE);
    this.renderTable(text);
  }

  private async loadSearchPage(page: number): Promise<void> {
    const searchPages = Math.max(1, Math.ceil(this.searchTotalMatches / PAGE_SIZE));
    this.currentPage = Math.max(1, Math.min(page, searchPages));
    this.totalPages = searchPages;

    const offset = (this.currentPage - 1) * PAGE_SIZE;
    this.showLoading();

    const result = await this.fetchSearchResults(this.searchQuery, offset, PAGE_SIZE);
    this.searchTotalMatches = result.totalMatches;
    this.totalPages = Math.max(1, Math.ceil(result.totalMatches / PAGE_SIZE));

    this.renderSearchResults(result);
  }

  private showLoading(): void {
    const tbody = this.container.querySelector('.chunk-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="99" class="chunk-loading">Loading...</td></tr>`;
    }
  }

  private async executeSearch(query: string): Promise<void> {
    this.searchQuery = query;
    if (!query) {
      // Clear search — restore normal view
      this.searchTotalMatches = 0;
      const dataLines = this.meta.kind === 'csv' ? Math.max(0, this.meta.totalLines - 1) : this.meta.totalLines;
      this.totalPages = Math.max(1, Math.ceil(dataLines / PAGE_SIZE));
      await this.loadPage(1);
      return;
    }

    // Fetch first page of search results
    this.showLoading();
    const result = await this.fetchSearchResults(query, 0, PAGE_SIZE);
    this.searchTotalMatches = result.totalMatches;
    this.totalPages = Math.max(1, Math.ceil(result.totalMatches / PAGE_SIZE));
    this.currentPage = 1;

    this.renderSearchResults(result);
  }

  private renderSearchResults(result: SearchResult): void {
    const { kind } = this.meta;
    const query = this.searchQuery;
    let theadHtml: string;
    let tbodyHtml: string;

    if (kind === 'csv') {
      const fields = this.csvFields ?? [];
      if (fields.length && result.matches.length) {
        // Re-parse each matched line with the known header
        const headerLine = result.headerLine || fields.join(',');
        const chunkText = headerLine + '\n' + result.matches.map((m) => m.text).join('\n');
        const parsed = parseCsvChunk(chunkText, true);
        theadHtml = this.buildThead(fields);
        tbodyHtml = renderCsvRows(fields, parsed.rows, query);
      } else {
        theadHtml = this.buildThead(fields);
        tbodyHtml = '';
      }
    } else if (kind === 'jsonl') {
      const chunkText = result.matches.map((m) => m.text).join('\n');
      const parsed = parseJsonlChunk(chunkText);
      theadHtml = this.buildThead(parsed.fields);
      tbodyHtml = renderJsonlRows(parsed.fields, parsed.rows, query);
    } else {
      // log
      const isCombined = this.logFormat === 'combined';
      const headerCols = ['IP', 'User', 'Timestamp', 'Method', 'Path', 'Status', 'Size',
        ...(isCombined ? ['Referer', 'User-Agent'] : [])];
      theadHtml = this.buildThead(headerCols);

      const entries: LogEntry[] = [];
      for (const m of result.matches) {
        const entry = parseLogLine(m.text, this.logFormat);
        if (entry) entries.push(entry);
      }
      tbodyHtml = renderLogRows(entries, isCombined, query);
    }

    const startMatch = (this.currentPage - 1) * PAGE_SIZE + 1;
    const endMatch = Math.min(this.currentPage * PAGE_SIZE, this.searchTotalMatches);
    const rangeInfo = this.searchTotalMatches > 0
      ? `Matches ${startMatch.toLocaleString()}&ndash;${endMatch.toLocaleString()}`
      : 'No matches';

    const sizeLabel = this.meta.fileSize >= 1024 * 1024
      ? `${(this.meta.fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(this.meta.fileSize / 1024).toFixed(0)} KB`;

    const pagination = this.totalPages > 1 ? renderPagination(this.currentPage, this.totalPages) : '';
    const searchBar = renderSearchBar(this.searchQuery, this.searchTotalMatches);

    this.container.innerHTML = `<div class="csv-view${kind === 'log' ? ' log-view' : ''}">
      <div class="csv-info">${this.searchTotalMatches.toLocaleString()} matches in ${this.meta.totalLines.toLocaleString()} lines &bull; ${sizeLabel} &bull; ${rangeInfo}</div>
      ${searchBar}
      ${pagination}
      <div class="csv-table-wrap">
        <table class="csv-table">
          <thead><tr>${theadHtml}</tr></thead>
          <tbody class="chunk-tbody">${tbodyHtml}</tbody>
        </table>
      </div>
      ${pagination}
    </div>`;

    this.bindEvents();
    // Re-focus search input and place cursor at end
    const input = this.container.querySelector<HTMLInputElement>('.chunk-search-input');
    if (input) {
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    }
  }

  private renderTable(chunkText: string): void {
    const { kind } = this.meta;
    let theadHtml: string;
    let tbodyHtml: string;
    let infoHtml: string;

    if (kind === 'csv') {
      const fields = this.csvFields ?? [];
      if (!fields.length) {
        const parsed = parseCsvChunk(chunkText, true);
        this.csvFields = parsed.fields;
        theadHtml = this.buildThead(parsed.fields);
        tbodyHtml = renderCsvRows(parsed.fields, parsed.rows);
      } else {
        const parsed = parseCsvChunk(fields.join(',') + '\n' + chunkText, true);
        theadHtml = this.buildThead(fields);
        tbodyHtml = renderCsvRows(fields, parsed.rows);
      }
      const ext = this.meta.path.split('.').pop()?.toUpperCase() || 'CSV';
      infoHtml = `${(this.meta.totalLines - 1).toLocaleString()} rows &mdash; ${ext} (chunked)`;
    } else if (kind === 'jsonl') {
      const parsed = parseJsonlChunk(chunkText);
      theadHtml = this.buildThead(parsed.fields);
      tbodyHtml = renderJsonlRows(parsed.fields, parsed.rows);
      infoHtml = `${this.meta.totalLines.toLocaleString()} lines &mdash; JSONL (chunked)`;
    } else {
      const isCombined = this.logFormat === 'combined';
      const headerCols = ['IP', 'User', 'Timestamp', 'Method', 'Path', 'Status', 'Size',
        ...(isCombined ? ['Referer', 'User-Agent'] : [])];
      theadHtml = this.buildThead(headerCols);

      const lines = chunkText.split('\n').filter((l) => l.trim() !== '');
      const entries: LogEntry[] = [];
      for (const line of lines) {
        const entry = parseLogLine(line, this.logFormat);
        if (entry) entries.push(entry);
      }
      tbodyHtml = renderLogRows(entries, isCombined);
      infoHtml = `${this.meta.totalLines.toLocaleString()} lines &bull; Format: ${esc(this.logFormat)} (chunked)`;
    }

    const startRow = (this.currentPage - 1) * PAGE_SIZE + 1;
    const endRow = Math.min(this.currentPage * PAGE_SIZE, kind === 'csv' ? this.meta.totalLines - 1 : this.meta.totalLines);
    const rangeInfo = `Rows ${startRow.toLocaleString()}&ndash;${endRow.toLocaleString()}`;

    const sizeLabel = this.meta.fileSize >= 1024 * 1024
      ? `${(this.meta.fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(this.meta.fileSize / 1024).toFixed(0)} KB`;

    const pagination = renderPagination(this.currentPage, this.totalPages);
    const searchBar = renderSearchBar(this.searchQuery, null);

    this.container.innerHTML = `<div class="csv-view${kind === 'log' ? ' log-view' : ''}">
      <div class="csv-info">${infoHtml} &bull; ${sizeLabel} &bull; ${rangeInfo}</div>
      ${searchBar}
      ${pagination}
      <div class="csv-table-wrap">
        <table class="csv-table">
          <thead><tr>${theadHtml}</tr></thead>
          <tbody class="chunk-tbody">${tbodyHtml}</tbody>
        </table>
      </div>
      ${pagination}
    </div>`;

    this.bindEvents();
  }

  private buildThead(cols: string[]): string {
    return cols.map((f) => `<th>${esc(f)}</th>`).join('');
  }

  private bindEvents(): void {
    // Pagination buttons
    this.container.querySelectorAll<HTMLButtonElement>('.chunk-page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.page;
        if (action === 'first') this.loadPage(1);
        else if (action === 'prev') this.loadPage(this.currentPage - 1);
        else if (action === 'next') this.loadPage(this.currentPage + 1);
        else if (action === 'last') this.loadPage(this.totalPages);
      });
    });

    this.container.querySelectorAll<HTMLInputElement>('.chunk-page-input').forEach((input) => {
      const onSubmit = () => {
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val >= 1 && val <= this.totalPages) {
          this.loadPage(val);
        } else {
          input.value = String(this.currentPage);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
      });
      input.addEventListener('change', onSubmit);
    });

    // Search input with debounce
    const searchInput = this.container.querySelector<HTMLInputElement>('.chunk-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          const val = searchInput.value.trim();
          if (val.length >= 2 || val.length === 0) {
            this.executeSearch(val);
          }
        }, SEARCH_DEBOUNCE_MS);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInput.value = '';
          this.executeSearch('');
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
          this.executeSearch(searchInput.value.trim());
        }
      });
    }

    // Clear button
    const clearBtn = this.container.querySelector<HTMLButtonElement>('.chunk-search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.executeSearch('');
      });
    }
  }
}
