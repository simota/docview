import { renderMarkdown, renderMermaidDiagrams, renderExternalDiagrams, updateMermaidTheme } from './markdown';
import { initTheme, setTheme, type Theme, THEMES } from './theme';
import { FileTree, initSidebarResize } from './filetree';
import { TableOfContents } from './toc';
import { SearchModal } from './search';
import { renderJsonTree } from './json-tree';
import { renderYamlTree } from './yaml-tree';
import { TabBar, addRecent, getRecent } from './tabs';
import { renderCsvTable, initCsvSort, initCsvColumnCopy } from './csv-viewer';
import { renderJsonlTable } from './jsonl-viewer';
import { renderLogTable } from './log-viewer';
import { ChunkedTable } from './chunked-table';
import { FindBar } from './find-bar';
import { HelpModal } from './help-modal';
import { UrlBar } from './url-bar';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import './style.css';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const CHUNK_THRESHOLD = 5 * 1024 * 1024; // 5MB — files above this use chunked loading
let zoomLevel = 100; // % (#6)

// Export mode: ?export strips all UI chrome for Playwright screenshots
const exportMode = new URLSearchParams(location.search).has('export');
if (exportMode) document.documentElement.classList.add('export-mode');

let currentFilePath: string | null = null;
let sidebarVisible = false;
let tocVisible = localStorage.getItem('docview.tocVisible') !== 'false';
let wordWrap = false; // (#7)
const scrollPositions = new Map<string, number>();

type PaneId = 'left' | 'right';
type LineJumpTarget = { line: number; lineEnd: number | null };

// Split view state
let splitActive = false;
let splitViewer: HTMLDivElement | null = null;
let splitFilePath: string | null = null;
const splitScrollPositions = new Map<string, number>();
let splitPendingLineJump: LineJumpTarget | null = null;
let currentHighlightedLine: number | null = null;
let splitCurrentHighlightedLine: number | null = null;
let activePane: PaneId = 'left';
let splitFindBar: FindBar | null = null;
let syncSplitScroll = localStorage.getItem('docview.syncSplitScroll') !== 'false';
let syncingSplitScroll = false;
let leftCompareHeader: HTMLDivElement | null = null;
let leftComparePath: HTMLSpanElement | null = null;
let rightComparePath: HTMLSpanElement | null = null;
let btnSyncScroll: HTMLButtonElement | null = null;

// --- Compare view (multi-pane image compare) state ---
let compareActive = false;
let comparePane: HTMLElement | null = null;
let syncCompareZoom = false;

// --- DOM refs ---
const viewer = document.getElementById('viewer') as HTMLDivElement;
const viewerPane = document.getElementById('viewer-pane') as HTMLDivElement;
const workspace = document.getElementById('workspace') as HTMLElement;
const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;
const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnOpenUrl = document.getElementById('btn-open-url') as HTMLButtonElement;
const btnSidebar = document.getElementById('btn-sidebar') as HTMLButtonElement;
const btnToc = document.getElementById('btn-toc') as HTMLButtonElement;
const btnSearch = document.getElementById('btn-search') as HTMLButtonElement;
const btnPrint = document.getElementById('btn-print') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const sidebar = document.getElementById('sidebar') as HTMLElement;
const breadcrumb = document.getElementById('breadcrumb') as HTMLElement;
const tocSidebar = document.getElementById('toc-sidebar') as HTMLElement;
const tabBarEl = document.getElementById('tab-bar') as HTMLElement;
const progressBar = document.getElementById('progress-bar') as HTMLElement;
let splitTabBarEl: HTMLElement | null = null;
let splitProgressBar: HTMLElement | null = null;

// --- Find bar (/) ---
const findBar = new FindBar(viewer);

// --- Tab bar (#14) ---
// Compare view tabs are stored with a synthetic path `__compare__=<p1>,<p2>,...`
// so they share the existing TabBar infrastructure without a new tab model.
const COMPARE_TAB_PREFIX = '__compare__=';

function isCompareTabPath(path: string): boolean {
  return path.startsWith(COMPARE_TAB_PREFIX);
}

function parseCompareTabPath(path: string): string[] | null {
  if (!isCompareTabPath(path)) return null;
  const csv = path.slice(COMPARE_TAB_PREFIX.length);
  const paths = csv
    .split(',')
    .filter((p) => p.length > 0)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  return paths.length >= 2 ? paths : null;
}

function buildCompareTabPath(paths: string[]): string {
  return `${COMPARE_TAB_PREFIX}${paths.map(encodeURIComponent).join(',')}`;
}

function buildCompareTabTitle(paths: string[]): string {
  const names = paths.map((p) => p.split('/').pop() ?? p);
  // "Compare: a.png, b.png" or "Compare: a.png, b.png (+2)" when more
  if (paths.length === 2) return `Compare: ${names[0]} + ${names[1]}`;
  if (paths.length === 3) return `Compare: ${names[0]} + ${names[1]} + ${names[2]}`;
  // 4: show first two + count suffix
  return `Compare: ${names[0]}, ${names[1]} (+${names.length - 2})`;
}

function handleTabSelect(path: string): void {
  if (isCompareTabPath(path)) {
    const paths = parseCompareTabPath(path);
    if (paths) void renderCompare(paths, { fromTabSwitch: true });
    return;
  }
  // Switching to a non-compare tab closes compare view (if open)
  if (compareActive) closeCompareView({ skipAlbumRestore: true });
  void loadServerFile(path);
}

function handleTabClose(path: string): void {
  if (!path) {
    showWelcome();
    return;
  }
  if (isCompareTabPath(path)) {
    const paths = parseCompareTabPath(path);
    if (paths) void renderCompare(paths, { fromTabSwitch: true });
    return;
  }
  if (compareActive) closeCompareView({ skipAlbumRestore: true });
  void loadServerFile(path);
}

const tabBar = new TabBar(
  tabBarEl,
  (path) => handleTabSelect(path),
  (path) => handleTabClose(path),
);
let splitTabBar: TabBar | null = null;

// --- File type detection ---
const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdx', '.txt']);
const DATA_EXT = new Set(['.json', '.yaml', '.yml']);
const CSV_EXT = new Set(['.csv', '.tsv']);
const JSONL_EXT = new Set(['.jsonl', '.ndjson']);
const CONFIG_EXT = new Set(['.toml', '.ini', '.conf', '.env', '.cfg', '.properties']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);
const LOG_EXT = new Set(['.log']);

type FileType = 'markdown' | 'data' | 'csv' | 'jsonl' | 'config' | 'log' | 'image' | 'video' | 'unknown';

function getExt(path: string): string {
  return '.' + (path.split('.').pop()?.toLowerCase() || '');
}

function detectFileType(path: string): FileType {
  const ext = getExt(path);
  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (DATA_EXT.has(ext)) return 'data';
  if (CSV_EXT.has(ext)) return 'csv';
  if (JSONL_EXT.has(ext)) return 'jsonl';
  if (CONFIG_EXT.has(ext)) return 'config';
  if (LOG_EXT.has(ext)) return 'log';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'unknown';
}

function langFromExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', ini: 'ini', conf: 'ini',
    env: 'bash', cfg: 'ini', properties: 'properties',
  };
  return map[ext] || 'plaintext';
}

// --- TOC ---
const toc = new TableOfContents(tocSidebar, viewer);

// --- Search ---
const searchModal = new SearchModal(({ path, line }) => openFileLocation(path, line ?? null, null, getNavigationPane()));

// --- Help modal (?) ---
const helpModal = new HelpModal();

// --- URL bar (Cmd+L) ---
const urlBar = new UrlBar((target) => {
  if (target.kind === 'local') {
    openFileLocation(target.path, target.line, target.lineEnd, getNavigationPane());
  } else if (target.kind === 'album') {
    void loadAlbumView(target.albumPath, target.recursive);
  } else {
    void loadRemoteUrl(target.url);
  }
});

function getNavigationPane(): PaneId {
  return splitActive ? activePane : 'left';
}

function getPaneViewer(pane: PaneId): HTMLDivElement | null {
  return pane === 'left' ? viewer : splitViewer;
}

function getPanePath(pane: PaneId): string | null {
  return pane === 'left' ? currentFilePath : splitFilePath;
}

function getPaneScrollMap(pane: PaneId): Map<string, number> {
  return pane === 'left' ? scrollPositions : splitScrollPositions;
}

function getPendingLineJump(pane: PaneId): LineJumpTarget | null {
  return pane === 'left' ? pendingLineJump : splitPendingLineJump;
}

function setPendingLineJump(pane: PaneId, jump: LineJumpTarget | null) {
  if (pane === 'left') pendingLineJump = jump;
  else splitPendingLineJump = jump;
}

function getHighlightedLine(pane: PaneId): number | null {
  return pane === 'left' ? currentHighlightedLine : splitCurrentHighlightedLine;
}

function setHighlightedLine(pane: PaneId, line: number | null) {
  if (pane === 'left') currentHighlightedLine = line;
  else splitCurrentHighlightedLine = line;
}

function getFindBarForPane(pane: PaneId): FindBar | null {
  return pane === 'left' ? findBar : splitFindBar;
}

function getProgressBarForPane(pane: PaneId): HTMLElement | null {
  return pane === 'left' ? progressBar : splitProgressBar;
}

function getPaneIdForTarget(target: HTMLElement): PaneId | null {
  if (target === viewer) return 'left';
  if (splitViewer && target === splitViewer) return 'right';
  return null;
}

function formatPanePath(path: string | null): string {
  return path || 'Select a file to compare';
}

function updatePaneLabels() {
  if (leftComparePath) leftComparePath.textContent = formatPanePath(currentFilePath);
  if (rightComparePath) rightComparePath.textContent = formatPanePath(splitFilePath);
}

function updateSyncScrollButton() {
  if (!btnSyncScroll) return;
  btnSyncScroll.textContent = syncSplitScroll ? 'Sync scroll: On' : 'Sync scroll: Off';
  btnSyncScroll.setAttribute('aria-pressed', String(syncSplitScroll));
}

function setPaneProgress(pane: PaneId, pct: number) {
  getProgressBarForPane(pane)?.style.setProperty('width', `${Math.max(0, Math.min(100, pct))}%`);
}

function setActivePane(pane: PaneId) {
  activePane = splitActive ? pane : 'left';
  viewerPane.classList.toggle('compare-pane-active', splitActive && activePane === 'left');
  document.getElementById('viewer-pane-right')?.classList.toggle('compare-pane-active', splitActive && activePane === 'right');
}

function toggleSyncSplitScroll() {
  syncSplitScroll = !syncSplitScroll;
  localStorage.setItem('docview.syncSplitScroll', String(syncSplitScroll));
  updateSyncScrollButton();
}

viewerPane.addEventListener('click', () => {
  if (splitActive) setActivePane('left');
});

// --- Breadcrumb (#3) ---
function updateBreadcrumb(path: string | null, mtime?: string | null) {
  if (!path) { breadcrumb.innerHTML = ''; return; }
  const parts = path.split('/');
  let html = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    return `<span class="breadcrumb-item ${isLast ? 'active' : ''}">${p}</span>`;
  }).join('<span class="breadcrumb-sep">/</span>');
  if (mtime) {
    const date = new Date(mtime);
    const fmt = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    html += `<span class="breadcrumb-mtime" title="${escapeHtml(mtime)}">${fmt}</span>`;
  }
  breadcrumb.innerHTML = html;
}

// --- Tree/Source toggle ---
function initToggleButtons(container: HTMLElement) {
  container.querySelectorAll<HTMLButtonElement>('.json-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      container.querySelectorAll('.json-toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tree = container.querySelector('.json-view-tree') as HTMLElement;
      const source = container.querySelector('.json-view-source') as HTMLElement;
      if (tree) tree.style.display = view === 'tree' ? '' : 'none';
      if (source) source.style.display = view === 'source' ? '' : 'none';
    });
  });
}

// --- Copy button on code blocks (#4) ---
function addCopyButtons(target: HTMLElement = viewer) {
  target.querySelectorAll<HTMLElement>('.code-block, .data-view').forEach((block) => {
    if (block.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = block.querySelector('code');
      if (code) {
        navigator.clipboard.writeText(code.textContent || '');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }
    });
    block.style.position = 'relative';
    block.appendChild(btn);
  });
}

// --- Scroll position memory (#7) ---
function saveScrollPosition(pane: PaneId = 'left') {
  const path = getPanePath(pane);
  const target = getPaneViewer(pane);
  if (path && target) {
    getPaneScrollMap(pane).set(path, target.scrollTop);
  }
}

function restoreScrollPosition(path: string, pane: PaneId = 'left') {
  const target = getPaneViewer(pane);
  const pos = getPaneScrollMap(pane).get(path);
  if (target && pos !== undefined) {
    requestAnimationFrame(() => { target.scrollTop = pos; });
  }
}

function syncScrollFrom(sourcePane: PaneId) {
  if (!splitActive || !syncSplitScroll || syncingSplitScroll) return;
  const source = getPaneViewer(sourcePane);
  const targetPane: PaneId = sourcePane === 'left' ? 'right' : 'left';
  const target = getPaneViewer(targetPane);
  if (!source || !target) return;

  const sourceMax = source.scrollHeight - source.clientHeight;
  const targetMax = target.scrollHeight - target.clientHeight;
  if (sourceMax <= 0 || targetMax <= 0) return;

  syncingSplitScroll = true;
  target.scrollTop = (source.scrollTop / sourceMax) * targetMax;
  requestAnimationFrame(() => {
    syncingSplitScroll = false;
  });
}

function handlePaneScroll(pane: PaneId) {
  const target = getPaneViewer(pane);
  if (!target) return;

  const path = getPanePath(pane);
  if (path) getPaneScrollMap(pane).set(path, target.scrollTop);

  const scrollHeight = target.scrollHeight - target.clientHeight;
  const pct = scrollHeight > 0 ? (target.scrollTop / scrollHeight) * 100 : 0;
  setPaneProgress(pane, pct);

  syncScrollFrom(pane);
}

viewer.addEventListener('scroll', () => handlePaneScroll('left'));

// --- URL hash routing (#9) ---
// Format: #file=<path>[&line=<N>[-<M>]] or #album=<path>[&recursive=0|1]
// or #compare=<path1>&compare=<path2>[&compare=<path3>[&compare=<path4>]]
interface ParsedHash {
  path: string | null;
  line: number | null;
  lineEnd: number | null;
  albumPath: string | null;
  albumRecursive: boolean;
  comparePaths: string[] | null;
}

function parseHash(hash: string = location.hash): ParsedHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return { path: null, line: null, lineEnd: null, albumPath: null, albumRecursive: false, comparePaths: null };
  // URLSearchParams.get() already percent-decodes; do not decode again here or
  // filenames containing `%` (e.g. `100%.md`) break or throw.
  const params = new URLSearchParams(raw);

  const compareRaw = params.get('compare');
  if (compareRaw !== null) {
    const compareValues = params.getAll('compare').filter((p) => p.length > 0);
    const comparePaths = compareValues.length >= 2
      ? compareValues
      : compareRaw.split(',').filter((p) => p.length > 0);
    if (comparePaths.length >= 2) {
      return { path: null, line: null, lineEnd: null, albumPath: null, albumRecursive: false, comparePaths };
    }
  }

  const albumPath = params.get('album');
  if (albumPath !== null) {
    return {
      path: null,
      line: null,
      lineEnd: null,
      albumPath,
      albumRecursive: params.get('recursive') === '1',
      comparePaths: null,
    };
  }
  const path = params.get('file');
  const lineStr = params.get('line');
  let line: number | null = null;
  let lineEnd: number | null = null;
  if (lineStr) {
    const m = lineStr.match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      line = parseInt(m[1], 10);
      if (m[2]) {
        lineEnd = parseInt(m[2], 10);
        if (lineEnd < line) [line, lineEnd] = [lineEnd, line];
      }
    }
  }
  return { path, line, lineEnd, albumPath: null, albumRecursive: false, comparePaths: null };
}

function buildAlbumHash(albumPath: string, recursive: boolean): string {
  let h = `#album=${encodeURIComponent(albumPath)}`;
  if (recursive) h += '&recursive=1';
  return h;
}

function buildCompareHash(paths: string[]): string {
  const params = new URLSearchParams();
  paths.forEach((path) => params.append('compare', path));
  return `#${params.toString()}`;
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function buildHash(path: string | null, line?: number | null, lineEnd?: number | null): string {
  if (!path) return '';
  let h = `#file=${encodeURIComponent(path)}`;
  if (line != null) {
    h += `&line=${line}`;
    if (lineEnd != null && lineEnd !== line) h += `-${lineEnd}`;
  }
  return h;
}

function updateHash(path: string | null, line?: number | null, lineEnd?: number | null) {
  if (path) {
    history.replaceState(null, '', buildHash(path, line, lineEnd));
  } else {
    history.replaceState(null, '', location.pathname);
  }
}

function openFileLocation(path: string, line: number | null = null, lineEnd: number | null = null, pane: PaneId = 'left') {
  if (pane === 'right' && splitActive && splitViewer) {
    if (line != null) {
      setPendingLineJump('right', { line, lineEnd });
      if (path === splitFilePath) {
        scrollToLine(line, lineEnd, splitViewer, 'right');
        return;
      }
      void loadIntoSplit(path);
      return;
    }

    if (path !== splitFilePath) void loadIntoSplit(path);
    return;
  }

  if (line != null) {
    setPendingLineJump('left', { line, lineEnd });
    updateHash(path, line, lineEnd);

    if (path === currentFilePath) {
      scrollToLine(line, lineEnd, viewer, 'left');
      return;
    }

    void loadServerFile(path);
    return;
  }

  updateHash(path, null, null);
  if (path !== currentFilePath) void loadServerFile(path);
}

// --- Line jump (URL hash #file=...&line=N[-M]) ---
// Tracks the line requested by URL hash. Consumed (and cleared) after rendering.
let pendingLineJump: LineJumpTarget | null = null;

function clearLineHighlights(target: HTMLElement = viewer) {
  target.querySelectorAll('.line-highlighted').forEach((el) => el.classList.remove('line-highlighted'));
}

function highlightLines(start: number, end: number | null, target: HTMLElement = viewer) {
  clearLineHighlights(target);
  const last = end ?? start;
  for (let n = start; n <= last; n++) {
    target.querySelectorAll(`[data-line="${n}"]`).forEach((el) => {
      if (el.classList.contains('line-row') || el.tagName === 'TR') {
        el.classList.add('line-highlighted');
      }
    });
  }
}

function scrollToLine(line: number, lineEnd: number | null, target: HTMLElement = viewer, pane: PaneId = 'left') {
  const el = target.querySelector(`.line-row[data-line="${line}"], tr[data-line="${line}"]`) as HTMLElement | null;
  if (!el) return false;
  highlightLines(line, lineEnd, target);
  setHighlightedLine(pane, line);
  // Center in view; fall back to scrollIntoView for robustness.
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
  return true;
}

function showCopyToast(message: string) {
  const existing = document.getElementById('copy-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'copy-toast';
  toast.className = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('copy-toast-visible'));
  setTimeout(() => {
    toast.classList.remove('copy-toast-visible');
    setTimeout(() => toast.remove(), 250);
  }, 1600);
}

async function copyLinkToLine(pane: PaneId, line: number, lineEnd: number | null) {
  const path = getPanePath(pane);
  if (!path) return;
  if (pane === 'left') updateHash(path, line, lineEnd);
  const url = `${location.origin}${location.pathname}${buildHash(path, line, lineEnd)}`;
  try {
    await navigator.clipboard.writeText(url);
    const label = lineEnd != null && lineEnd !== line
      ? `Copied link to lines ${line}–${lineEnd}`
      : `Copied link to line ${line}`;
    showCopyToast(label);
  } catch {
    showCopyToast(`Link: ${url}`);
  }
}

function handleLineNumClick(e: Event, pane: PaneId) {
  const t = e.target as HTMLElement;
  const el = t.closest('[data-line]') as HTMLElement | null;
  if (!el) return;
  // Only line-num spans (source view) and log-line-num cells (log table) are clickable.
  if (!el.classList.contains('line-num') && !el.classList.contains('log-line-num')) return;
  const line = parseInt(el.dataset.line || '', 10);
  if (!Number.isFinite(line)) return;
  e.preventDefault();

  const mouseEvt = e as MouseEvent;
  const shift = mouseEvt.shiftKey;
  const target = getPaneViewer(pane);
  const highlightedLine = getHighlightedLine(pane);
  if (!target) return;

  if (shift && highlightedLine != null && highlightedLine !== line) {
    const start = Math.min(highlightedLine, line);
    const end = Math.max(highlightedLine, line);
    highlightLines(start, end, target);
    void copyLinkToLine(pane, start, end);
  } else {
    highlightLines(line, null, target);
    setHighlightedLine(pane, line);
    void copyLinkToLine(pane, line, null);
  }
}

function handleLineNumKey(e: KeyboardEvent, pane: PaneId) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target as HTMLElement;
  if (!t.classList.contains('line-num') && !t.classList.contains('log-line-num')) return;
  e.preventDefault();
  handleLineNumClick(e, pane);
}

function bindLineInteractions(target: HTMLElement, pane: PaneId) {
  target.addEventListener('click', (e) => handleLineNumClick(e, pane));
  target.addEventListener('keydown', (e) => handleLineNumKey(e, pane));
}

// Delegated line-number click handler on the viewer.
bindLineInteractions(viewer, 'left');

// --- Relative link navigation (#10) ---
function interceptRelativeLinks(currentPath: string, target: HTMLElement = viewer, pane: PaneId = 'left') {
  target.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#')) return;
    // Relative link to another file
    a.addEventListener('click', (e) => {
      e.preventDefault();
      let targetPath = href;
      if (!href.startsWith('/')) {
        const dir = currentPath.includes('/') ? currentPath.replace(/\/[^/]+$/, '/') : '';
        targetPath = dir + href;
      }
      // Normalize path (remove ./)
      targetPath = targetPath.replace(/^\.\//, '');
      openFileLocation(targetPath, null, null, pane);
    });
  });
}

// --- Rendering ---
function renderContent(content: string, path: string, target: HTMLElement = viewer) {
  const pane = getPaneIdForTarget(target) ?? 'left';
  const type = detectFileType(path);

  switch (type) {
    case 'markdown':
      target.innerHTML = renderMarkdown(content);
      renderMermaidDiagrams(target);
      renderExternalDiagrams(target);
      fixRelativeImages(path, target);
      if (target === viewer) {
        toc.update();
        toc.loadBacklinks(path);
      }
      interceptRelativeLinks(path, target, pane);
      break;

    case 'data': {
      if (path.endsWith('.json')) {
        const treeHtml = renderJsonTree(content);
        if (treeHtml) {
          let prettyJson: string;
          try { prettyJson = JSON.stringify(JSON.parse(content), null, 2); } catch { prettyJson = content; }
          const lang = 'json';
          const highlighted = hljs.highlight(prettyJson, { language: lang }).value;
          target.innerHTML = `
            <div class="json-view-toggle">
              <button class="json-toggle-btn active" data-view="tree">Tree</button>
              <button class="json-toggle-btn" data-view="source">Source</button>
            </div>
            <div class="json-view-tree">${treeHtml}</div>
            <div class="json-view-source" style="display:none"><div class="data-view"><span class="data-lang">JSON</span><pre class="hljs"><code>${highlighted}</code></pre></div></div>`;
          initToggleButtons(target);
        } else {
          renderHighlighted(content, path, target);
        }
      } else if (path.endsWith('.yaml') || path.endsWith('.yml')) {
        const treeHtml = renderYamlTree(content);
        if (treeHtml) {
          const highlighted = hljs.highlight(content, { language: 'yaml' }).value;
          target.innerHTML = `
            <div class="json-view-toggle">
              <button class="json-toggle-btn active" data-view="tree">Tree</button>
              <button class="json-toggle-btn" data-view="source">Source</button>
            </div>
            <div class="json-view-tree">${treeHtml}</div>
            <div class="json-view-source" style="display:none"><div class="data-view"><span class="data-lang">YAML</span><pre class="hljs"><code>${highlighted}</code></pre></div></div>`;
          initToggleButtons(target);
        } else {
          renderHighlighted(content, path, target);
        }
      } else {
        renderHighlighted(content, path, target);
      }
      if (target === viewer) toc.clear();
      break;
    }

    case 'csv': {
      const tableHtml = renderCsvTable(content, path);
      const ext = path.split('.').pop()?.toUpperCase() || 'CSV';
      const escaped = escapeHtml(content);
      target.innerHTML = `
        <div class="json-view-toggle">
          <button class="json-toggle-btn active" data-view="tree">Table</button>
          <button class="json-toggle-btn" data-view="source">Source</button>
        </div>
        <div class="json-view-tree">${tableHtml}</div>
        <div class="json-view-source" style="display:none"><div class="data-view"><span class="data-lang">${ext}</span><pre class="hljs"><code>${escaped}</code></pre></div></div>`;
      initToggleButtons(target);
      if (target === viewer) toc.clear();
      break;
    }

    case 'jsonl': {
      const tableHtml = renderJsonlTable(content, path);
      const escaped = escapeHtml(content);
      target.innerHTML = `
        <div class="json-view-toggle">
          <button class="json-toggle-btn active" data-view="tree">Table</button>
          <button class="json-toggle-btn" data-view="source">Source</button>
        </div>
        <div class="json-view-tree">${tableHtml}</div>
        <div class="json-view-source" style="display:none"><div class="data-view"><span class="data-lang">JSONL</span><pre class="hljs"><code>${escaped}</code></pre></div></div>`;
      initToggleButtons(target);
      if (target === viewer) toc.clear();
      break;
    }

    case 'log': {
      const tableHtml = renderLogTable(content, path);
      if (tableHtml) {
        const escaped = escapeHtml(content);
        target.innerHTML = `
          <div class="json-view-toggle">
            <button class="json-toggle-btn active" data-view="tree">Table</button>
            <button class="json-toggle-btn" data-view="source">Source</button>
          </div>
          <div class="json-view-tree">${tableHtml}</div>
          <div class="json-view-source" style="display:none"><div class="data-view"><span class="data-lang">LOG</span><pre class="hljs"><code>${escaped}</code></pre></div></div>`;
        initToggleButtons(target);
      } else {
        // Not a recognized access log format — render as plain text
        renderHighlighted(content, path, target);
      }
      if (target === viewer) toc.clear();
      break;
    }

    case 'config':
      renderHighlighted(content, path, target);
      if (target === viewer) toc.clear();
      break;

    default:
      target.innerHTML = `<pre class="hljs"><code>${escapeHtml(content)}</code></pre>`;
      if (target === viewer) toc.clear();
  }

  addCopyButtons(target);
  initImageZoom(target);
  const lineJump = getPendingLineJump(pane);
  if (lineJump) {
    const { line, lineEnd } = lineJump;
    setPendingLineJump(pane, null);
    scrollToLine(line, lineEnd, target, pane);
  } else {
    restoreScrollPosition(path, pane);
  }
}

function renderHighlighted(content: string, path: string, target: HTMLElement = viewer) {
  const lang = langFromExt(path);
  const ext = path.split('.').pop()?.toUpperCase() || '';
  let highlighted: string;
  if (hljs.getLanguage(lang)) {
    highlighted = hljs.highlight(content, { language: lang }).value;
  } else {
    highlighted = hljs.highlightAuto(content).value;
  }
  const lines = highlighted.split('\n');
  const numbered = lines.map((line, i) => {
    const n = i + 1;
    return `<span class="line-row" data-line="${n}"><span class="line-num" data-line="${n}" role="button" tabindex="0" title="Click to copy link to line ${n} (Shift+Click for range)">${n}</span><span class="line-content">${line}</span></span>`;
  }).join('\n');
  target.innerHTML = `<div class="data-view"><span class="data-lang">${ext}</span><pre class="hljs has-line-nums"><code>${numbered}</code></pre></div>`;
}

async function renderVideo(path: string) {
  const url = `/api/file?path=${encodeURIComponent(path)}`;
  // Single-file mode: just show a controlled <video> inline. The album-style
  // Lightbox (with prev/next nav) is reserved for gallery openings.
  viewer.innerHTML = `<div class="video-view">
    <video class="video-view__player"
           src="${url}"
           controls
           preload="metadata"
           playsinline></video>
    <p class="image-caption">${escapeHtml(path)}</p>
  </div>`;
  const v = viewer.querySelector<HTMLVideoElement>('.video-view__player');
  v?.addEventListener('error', () => {
    if (!v.parentElement) return;
    v.parentElement.insertAdjacentHTML(
      'beforeend',
      `<div class="video-view__error">この動画はこのブラウザで再生できないコーデックの可能性があります。${escapeHtml(path).endsWith('.mov') ? ' (.mov は QuickTime コンテナ依存)' : ''}</div>`,
    );
  });
}

async function renderImage(path: string) {
  const url = `/api/file?path=${encodeURIComponent(path)}`;
  if (path.toLowerCase().endsWith('.svg')) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const svgText = await res.text();
      const cleanSvg = DOMPurify.sanitize(svgText, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_TAGS: ['use', 'foreignObject'] });
      viewer.innerHTML = `<div class="image-view"><div class="svg-container">${cleanSvg}</div><p class="image-caption">${escapeHtml(path)}</p></div>`;
      const svgEl = viewer.querySelector('.svg-container svg') as SVGElement | null;
      if (svgEl) {
        svgEl.setAttribute('width', '100%');
        svgEl.removeAttribute('height');
        svgEl.style.maxHeight = '85vh';
      }
      initImageZoom(viewer);
    } catch { /* ignore */ }
    return;
  }
  viewer.innerHTML = `<div class="image-view"><img src="${url}" alt="${escapeHtml(path)}" /><p class="image-caption">${escapeHtml(path)}</p></div>`;
  initImageZoom(viewer);
}

// Relative images in Markdown (#5)
function fixRelativeImages(currentPath: string, target: HTMLElement = viewer) {
  const dir = currentPath.includes('/') ? currentPath.replace(/\/[^/]+$/, '/') : '';
  target.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('/api/')) return;
    const resolved = (dir + src).replace(/^\.\//, '');
    img.src = `/api/file?path=${encodeURIComponent(resolved)}`;
  });
}

// Zoom (#6)
function applyZoom() {
  viewer.style.fontSize = `${zoomLevel}%`;
  if (splitViewer) splitViewer.style.fontSize = `${zoomLevel}%`;
}

function zoom(delta: number) {
  zoomLevel = Math.max(50, Math.min(200, zoomLevel + delta));
  applyZoom();
}

// Word wrap toggle (#7)
function toggleWordWrap() {
  wordWrap = !wordWrap;
  viewer.classList.toggle('word-wrap', wordWrap);
  splitViewer?.classList.toggle('word-wrap', wordWrap);
}

// Slide mode (#9) — split by --- and present
function enterSlideMode() {
  if (!currentFilePath || detectFileType(currentFilePath) !== 'markdown') return;
  const slides = viewer.innerHTML.split(/<hr\s*\/?>/gi).filter((s) => s.trim());
  if (slides.length < 2) return;

  let idx = 0;
  const overlay = document.createElement('div');
  overlay.className = 'slide-overlay';

  function renderSlide() {
    overlay.innerHTML = `
      <div class="slide-container">
        <div class="slide-content markdown-body">${slides[idx]}</div>
        <div class="slide-nav">
          <span class="slide-counter">${idx + 1} / ${slides.length}</span>
          <div class="slide-buttons">
            <button class="slide-btn" id="slide-prev" ${idx === 0 ? 'disabled' : ''}>&#8592; Prev</button>
            <button class="slide-btn" id="slide-next" ${idx === slides.length - 1 ? 'disabled' : ''}>Next &#8594;</button>
            <button class="slide-btn slide-exit" id="slide-exit">Exit</button>
          </div>
        </div>
      </div>`;
    overlay.querySelector('#slide-prev')?.addEventListener('click', () => { if (idx > 0) { idx--; renderSlide(); } });
    overlay.querySelector('#slide-next')?.addEventListener('click', () => { if (idx < slides.length - 1) { idx++; renderSlide(); } });
    overlay.querySelector('#slide-exit')?.addEventListener('click', () => overlay.remove());
  }

  renderSlide();
  document.body.appendChild(overlay);

  const keyHandler = (e: KeyboardEvent) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', keyHandler); return; }
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); if (idx < slides.length - 1) { idx++; renderSlide(); } }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (idx > 0) { idx--; renderSlide(); } }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
  };
  document.addEventListener('keydown', keyHandler);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function leaveCompareViewForNavigation(): void {
  if (compareActive) closeCompareView({ skipAlbumRestore: true });
}

function clearAlbumTracking(): void {
  _currentAlbumPath = null;
  _currentAlbumRecursive = false;
  if (_albumSseDebounce) {
    clearTimeout(_albumSseDebounce);
    _albumSseDebounce = null;
  }
}

function isAlbumEventPath(path: string, albumPath: string): boolean {
  if (albumPath === '.') return true;
  return path === albumPath || path.startsWith(`${albumPath}/`);
}

// --- Album view ---
async function loadAlbumView(albumPath: string, recursive = false): Promise<void> {
  leaveCompareViewForNavigation();
  clearAlbumTracking();
  saveScrollPosition('left');
  currentFilePath = null;
  _currentAlbumPath = albumPath;
  _currentAlbumRecursive = recursive;
  document.title = `Album: ${albumPath} — DocView`;
  updateBreadcrumb(`Album: ${albumPath}`);
  toc.clear();
  updatePaneLabels();
  history.replaceState(null, '', buildAlbumHash(albumPath, recursive));

  viewer.innerHTML = `<div class="loading-skeleton">${'<div class="skel-line"></div>'.repeat(6)}</div>`;

  const { renderAlbum, disposeAlbum } = await import('./album-viewer.js');
  disposeAlbum();

  await renderAlbum(
    albumPath,
    viewer,
    (imagePath: string) => {
      _currentAlbumPath = null;
      void loadServerFile(imagePath);
    },
    recursive,
    (paths: string[]) => {
      void renderCompare(paths);
    },
  );
}

async function reloadCurrentAlbum(): Promise<void> {
  if (_currentAlbumPath === null || currentFilePath !== null || compareActive) return;
  const { refreshAlbum } = await import('./album-viewer.js');
  await refreshAlbum(
    _currentAlbumPath,
    viewer,
    (imagePath: string) => {
      _currentAlbumPath = null;
      void loadServerFile(imagePath);
    },
    _currentAlbumRecursive,
    (paths: string[]) => {
      void renderCompare(paths);
    },
  );
}

// --- Compare view (multi-pane image compare, F5) ---

interface CloseCompareOptions {
  /** Skip restoring album view after close (used when switching tabs). */
  skipAlbumRestore?: boolean;
  /** Skip removing the tab entry (used when tab close triggered this). */
  skipTabRemoval?: boolean;
}

function closeCompareView(opts: CloseCompareOptions = {}): void {
  if (!compareActive) return;
  compareActive = false;
  syncCompareZoom = false;
  const closedPaths = _currentComparePaths.slice();
  _currentComparePaths = [];
  if (comparePane) {
    comparePane.remove();
    comparePane = null;
  }
  workspace.classList.remove('compare-view-active');

  // Remove the compare tab entry
  if (!opts.skipTabRemoval && closedPaths.length >= 2) {
    const tabPath = buildCompareTabPath(closedPaths);
    // Directly splice the tab list without re-triggering onClose navigation
    removeTabSilent(tabBar, tabPath);
  }

  if (opts.skipAlbumRestore) return;

  // Restore album view in the viewer if we came from album
  if (_currentAlbumPath !== null) {
    void loadAlbumView(_currentAlbumPath, _currentAlbumRecursive);
  } else if (currentFilePath) {
    // Re-activate the current file tab
    tabBar.setActive(currentFilePath);
    history.replaceState(null, '', buildHash(currentFilePath));
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    showWelcome();
  }
}

// TabBar internal shape reused for silent tab manipulation (compare view needs
// to add/remove tabs without recursive onClose/onSelect firing).
interface TabBarInternals {
  tabs: Array<{ path: string; name: string; kind?: 'file' | 'compare' }>;
  activePath: string | null;
  render: () => void;
}

// Open or re-activate a compare tab with a custom display title.
function openCompareTab(bar: TabBar, tabPath: string, title: string): void {
  const anyBar = bar as unknown as TabBarInternals;
  const existing = anyBar.tabs.find((t) => t.path === tabPath);
  if (existing) {
    existing.name = title;
    existing.kind = 'compare';
  } else {
    anyBar.tabs.push({ path: tabPath, name: title, kind: 'compare' });
  }
  anyBar.activePath = tabPath;
  anyBar.render();
}

// Remove a tab entry without triggering onSelect/onClose callbacks.
function removeTabSilent(bar: TabBar, tabPath: string): void {
  const anyBar = bar as unknown as TabBarInternals;
  const idx = anyBar.tabs.findIndex((t) => t.path === tabPath);
  if (idx < 0) return;
  anyBar.tabs.splice(idx, 1);
  if (anyBar.activePath === tabPath) {
    anyBar.activePath = null;
  }
  anyBar.render();
}

interface RenderCompareOptions {
  /** True when triggered by a tab switch (skip re-opening the tab). */
  fromTabSwitch?: boolean;
}

let _currentComparePaths: string[] = [];

async function renderCompare(paths: string[], opts: RenderCompareOptions = {}): Promise<void> {
  if (paths.length < 2 || paths.length > 4) return;

  // Close any existing compare view (but keep the tab slot for replacement)
  if (compareActive) closeCompareView({ skipAlbumRestore: true, skipTabRemoval: true });

  compareActive = true;
  syncCompareZoom = false;
  _currentComparePaths = paths.slice();

  // Register a compare tab entry so users can switch back via tabs
  if (!opts.fromTabSwitch) {
    const tabPath = buildCompareTabPath(paths);
    openCompareTab(tabBar, tabPath, buildCompareTabTitle(paths));
  } else {
    tabBar.setActive(buildCompareTabPath(paths));
  }

  // Update URL
  history.replaceState(null, '', buildCompareHash(paths));

  document.title = `Compare: ${paths.length} images — DocView`;
  updateBreadcrumb(`Compare: ${paths.length} images`);
  toc.clear();

  // Build the compare pane overlay over the viewer area
  const pane = document.createElement('div');
  pane.id = 'compare-view-pane';
  pane.className = 'compare-view-pane';
  workspace.classList.add('compare-view-active');

  const colsClass = `compare-grid--cols-${paths.length}`;
  const truncTitle = paths.map((p) => p.split('/').pop() ?? p).join(' + ');
  const displayTitle = truncTitle.length > 60 ? `${paths.length} images` : truncTitle;

  pane.innerHTML = `
    <div class="compare-toolbar">
      <span class="compare-toolbar__title">Compare: ${escapeHtml(displayTitle)}</span>
      <label class="compare-sync-zoom-label">
        <input type="checkbox" id="compare-sync-zoom" ${syncCompareZoom ? 'checked' : ''}/>
        Sync Zoom
      </label>
      <button type="button" class="compare-close-btn" aria-label="Close compare view">&#x2715; Close</button>
    </div>
    <div class="compare-grid ${colsClass}">
      ${paths.map((p, i) => {
    const name = p.split('/').pop() ?? p;
    return `<div class="compare-pane-item" data-index="${i}" data-path="${escapeHtml(p)}">
          <div class="compare-pane-item__header">
            <span class="compare-pane-item__name" title="${escapeHtml(p)}">${escapeHtml(name)}</span>
          </div>
          <div class="compare-pane-item__img-wrap" id="compare-pane-wrap-${i}">
            <div class="compare-loading">読み込み中...</div>
          </div>
        </div>`;
  }).join('')}
    </div>`;

  // Keep compare inside the main viewer pane so it replaces the document area
  // instead of becoming a separate flex column next to the tab bar.
  viewerPane.appendChild(pane);
  comparePane = pane;

  // Wire close button
  pane.querySelector('.compare-close-btn')?.addEventListener('click', () => closeCompareView());

  // Wire sync zoom toggle
  const syncZoomCheck = pane.querySelector<HTMLInputElement>('#compare-sync-zoom');
  syncZoomCheck?.addEventListener('change', () => {
    syncCompareZoom = syncZoomCheck.checked;
  });

  // Load images into each pane
  await Promise.all(paths.map(async (p, i) => {
    const wrap = pane.querySelector<HTMLElement>(`#compare-pane-wrap-${i}`);
    if (!wrap) return;
    await loadImageIntoComparePane(p, i, wrap);
  }));
}

async function loadImageIntoComparePane(path: string, paneIndex: number, wrap: HTMLElement): Promise<void> {
  const url = `/api/file?path=${encodeURIComponent(path)}`;

  if (path.toLowerCase().endsWith('.svg')) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const svgText = await res.text();
      const cleanSvg = DOMPurify.sanitize(svgText, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        ADD_TAGS: ['use', 'foreignObject'],
      });
      wrap.innerHTML = `<div class="image-view compare-image-view"><div class="svg-container">${cleanSvg}</div></div>`;
    } catch {
      wrap.innerHTML = '<div class="compare-load-error">画像を読み込めませんでした</div>';
    }
  } else {
    const imgEl = document.createElement('img');
    imgEl.className = 'compare-img';
    imgEl.alt = path.split('/').pop() ?? path;
    imgEl.src = url;
    wrap.innerHTML = '';
    const imgView = document.createElement('div');
    imgView.className = 'image-view compare-image-view';
    imgView.appendChild(imgEl);
    wrap.appendChild(imgView);
  }

  // Init zoom for this pane
  initComparePaneZoom(wrap, paneIndex);
}

// Zoom state per compare pane
type CompareZoomState = {
  scale: number;
  translateX: number;
  translateY: number;
};

const _compareZoomStates: CompareZoomState[] = [];
let _compareZoomSyncRaf: number | null = null;

function initComparePaneZoom(wrap: HTMLElement, paneIndex: number): void {
  _compareZoomStates[paneIndex] = { scale: 1, translateX: 0, translateY: 0 };

  const imgWrap = wrap.querySelector<HTMLElement>('.image-view, .compare-image-view');
  if (!imgWrap) return;

  const getEl = (): HTMLElement | null =>
    imgWrap.querySelector<HTMLElement>('img, .svg-container');

  function applyTransform(el: HTMLElement, state: CompareZoomState): void {
    el.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
    el.style.cursor = state.scale > 1 ? 'grab' : 'zoom-in';
  }

  function broadcastZoom(state: CompareZoomState): void {
    if (!syncCompareZoom) return;
    if (_compareZoomSyncRaf !== null) cancelAnimationFrame(_compareZoomSyncRaf);
    _compareZoomSyncRaf = requestAnimationFrame(() => {
      _compareZoomSyncRaf = null;
      _compareZoomStates.forEach((s, idx) => {
        if (idx === paneIndex) return;
        const otherWrap = comparePane?.querySelector<HTMLElement>(`#compare-pane-wrap-${idx}`);
        if (!otherWrap) return;
        const otherEl = otherWrap.querySelector<HTMLElement>('img, .svg-container');
        if (!otherEl) return;
        s.scale = state.scale;
        s.translateX = state.translateX;
        s.translateY = state.translateY;
        applyTransform(otherEl, s);
      });
    });
  }

  imgWrap.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const el = getEl();
    if (!el) return;
    const state = _compareZoomStates[paneIndex];
    if (!state) return;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.scale = Math.max(0.5, Math.min(5, state.scale + delta));
    if (state.scale <= 1) { state.translateX = 0; state.translateY = 0; }
    applyTransform(el, state);
    broadcastZoom(state);
  }, { passive: false });

  imgWrap.addEventListener('dblclick', () => {
    const el = getEl();
    if (!el) return;
    const state = _compareZoomStates[paneIndex];
    if (!state) return;
    state.scale = state.scale > 1 ? 1 : 2;
    state.translateX = 0;
    state.translateY = 0;
    applyTransform(el, state);
    broadcastZoom(state);
  });

  let isDragging = false;
  let startX = 0;
  let startY = 0;

  imgWrap.addEventListener('mousedown', (e: MouseEvent) => {
    const state = _compareZoomStates[paneIndex];
    if (!state || state.scale <= 1) return;
    isDragging = true;
    startX = e.clientX - state.translateX;
    startY = e.clientY - state.translateY;
    const el = getEl();
    if (el) el.style.cursor = 'grabbing';
    e.preventDefault();
  });

  const mouseMoveHandler = (e: MouseEvent): void => {
    if (!isDragging) return;
    const state = _compareZoomStates[paneIndex];
    if (!state) return;
    state.translateX = e.clientX - startX;
    state.translateY = e.clientY - startY;
    const el = getEl();
    if (el) applyTransform(el, state);
    broadcastZoom(state);
  };

  const mouseUpHandler = (): void => {
    if (isDragging) {
      isDragging = false;
      const state = _compareZoomStates[paneIndex];
      const el = getEl();
      if (el && state) el.style.cursor = state.scale > 1 ? 'grab' : 'zoom-in';
    }
  };

  document.addEventListener('mousemove', mouseMoveHandler);
  document.addEventListener('mouseup', mouseUpHandler);
}

function showWelcome() {
  leaveCompareViewForNavigation();
  currentFilePath = null;
  clearAlbumTracking();
  const recent = getRecent().slice(0, 5);
  let recentSection = '';
  if (recent.length > 0) {
    const items = recent.map((p) => {
      const parts = p.split('/');
      const fileName = parts[parts.length - 1] ?? p;
      const parentDir = parts.length >= 2 ? parts[parts.length - 2] + '/' : '';
      return `<button class="welcome-recent-item" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">
        <span class="welcome-recent-dir">${escapeHtml(parentDir)}</span><span class="welcome-recent-name">${escapeHtml(fileName)}</span>
      </button>`;
    }).join('');
    recentSection = `<div class="welcome-recent"><p class="welcome-recent-title">Recent files</p>${items}</div>`;
  } else {
    recentSection = `<p class="welcome-hint">&#8592; Click <strong>Files</strong> in the toolbar to browse</p>`;
  }

  viewer.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">D.</div>
      <h1>DocView</h1>
      <p>Document &amp; data file viewer</p>
      <div class="welcome-formats">
        <span>Markdown</span><span>YAML</span><span>JSON</span>
        <span>TOML</span><span>INI</span><span>Images</span>
      </div>
      ${recentSection}
      <p class="welcome-hint"><kbd>Cmd+P</kbd> to search files &nbsp; <kbd>Cmd+Shift+F</kbd> for full-text search</p>
    </div>`;

  viewer.querySelectorAll<HTMLButtonElement>('.welcome-recent-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.path;
      if (path) loadServerFile(path);
    });
  });

  toc.clear();
  updateBreadcrumb(null);
  updatePaneLabels();
}

// --- Chunked file type check ---
const CHUNKED_TYPES = new Set<FileType>(['csv', 'jsonl', 'log']);

function fileTypeToChunkKind(type: FileType): 'csv' | 'jsonl' | 'log' | null {
  if (type === 'csv') return 'csv';
  if (type === 'jsonl') return 'jsonl';
  if (type === 'log') return 'log';
  return null;
}

// --- File loading ---
async function loadServerFile(path: string) {
  leaveCompareViewForNavigation();
  clearAlbumTracking();
  saveScrollPosition('left');
  const type = detectFileType(path);
  const fileChanged = currentFilePath !== path;
  currentFilePath = path;
  document.title = `${path} — DocView`;
  updateBreadcrumb(path);
  updatePaneLabels();
  // Preserve existing line info in hash when the caller didn't provide one.
  const existingHash = parseHash();
  const hashLine = existingHash.path === path ? existingHash.line : null;
  const hashLineEnd = existingHash.path === path ? existingHash.lineEnd : null;
  updateHash(path, hashLine, hashLineEnd);
  if (fileChanged) currentHighlightedLine = null;
  // Re-apply the URL-declared line on every (re)load so SSE-triggered reloads
  // and manual reloads keep the shared-link highlight intact. Only set when
  // not already queued by hashchange/init, to avoid stomping a fresher target.
  if (hashLine != null && !pendingLineJump) {
    pendingLineJump = { line: hashLine, lineEnd: hashLineEnd };
  }
  addRecent(path);
  tabBar.open(path);

  if (type === 'image') {
    await renderImage(path);
    // Fetch mtime for images too
    try {
      const headRes = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'HEAD' });
      updateBreadcrumb(path, headRes.headers.get('X-File-Mtime'));
    } catch { /* ignore */ }
    toc.clear();
    fileTree?.setActive(path);
    return;
  }

  if (type === 'video') {
    await renderVideo(path);
    try {
      const headRes = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'HEAD' });
      updateBreadcrumb(path, headRes.headers.get('X-File-Mtime'));
    } catch { /* ignore */ }
    toc.clear();
    fileTree?.setActive(path);
    return;
  }

  // Show loading skeleton for feedback
  viewer.innerHTML = `<div class="loading-skeleton">${'<div class="skel-line"></div>'.repeat(6)}</div>`;

  try {
    // Pre-check file size for chunk-eligible types
    const chunkKind = fileTypeToChunkKind(type);
    if (chunkKind && CHUNKED_TYPES.has(type)) {
      const metaRes = await fetch(`/api/file/meta?path=${encodeURIComponent(path)}`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        updateBreadcrumb(path, meta.mtime);

        if (meta.size > CHUNK_THRESHOLD) {
          // Chunked mode — never load full file. Pass the pending line jump
          // so ChunkedTable opens on the page containing the target line.
          // Per-row highlight inside a chunked page is a follow-up; here we
          // at least avoid silently ignoring `&line=N` on large files.
          const chunked = new ChunkedTable(viewer, {
            path,
            kind: chunkKind,
            totalLines: meta.lines ?? 0,
            fileSize: meta.size,
            mtime: meta.mtime,
          }, {
            initialLine: pendingLineJump?.line ?? null,
            initialLineEnd: pendingLineJump?.lineEnd ?? null,
          });
          await chunked.init();

          // If log format is unknown, fall back to plain chunked text
          if (chunked.isLogUnknown()) {
            await loadFullFile(path);
          } else {
            // ChunkedTable consumed the line target (page navigation). Clear
            // it so a later non-chunked render doesn't try to re-apply.
            pendingLineJump = null;
            toc.clear();
            fileTree?.setActive(path);
            setPaneProgress('left', 0);
          }
          return;
        }
      }
    }

    // Standard full-file loading
    await loadFullFile(path);
  } catch {
    showError(`Connection error loading: ${path}`);
  }

  fileTree?.setActive(path);
  // Reset progress bar
  setPaneProgress('left', 0);
}

// --- Remote URL loading (Phase 3) ---
// Remote views are stateless: no tab entry, no hash update, no SSE tracking,
// no scroll memory — each open is a fresh read through /api/remote.
async function loadRemoteUrl(rawUrl: string) {
  leaveCompareViewForNavigation();
  clearAlbumTracking();
  saveScrollPosition('left');
  currentFilePath = null;
  currentHighlightedLine = null;
  const displayName = remoteDisplayName(rawUrl);
  document.title = `${displayName} — DocView (remote)`;
  updateBreadcrumb(rawUrl);
  updatePaneLabels();
  // Deactivate all local tabs — remote views aren't tabbed.
  tabBar.setActive('');
  viewer.innerHTML = `<div class="loading-skeleton">${'<div class="skel-line"></div>'.repeat(6)}</div>`;

  try {
    const res = await fetch(`/api/remote?url=${encodeURIComponent(rawUrl)}`);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError(`Remote fetch failed: ${detail.error ?? res.status}`);
      return;
    }
    const type = detectFileType(displayName);

    if (type === 'image') {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      viewer.innerHTML = `<div class="image-view"><img src="${blobUrl}" alt="${escapeHtml(rawUrl)}" /><p class="image-caption">${escapeHtml(rawUrl)}</p></div>`;
      initImageZoom(viewer);
      toc.clear();
      return;
    }

    const content = await res.text();
    renderContent(content, displayName);
    const mtime = res.headers.get('X-File-Mtime');
    updateBreadcrumb(rawUrl, mtime);
  } catch (err) {
    showError(`Remote fetch error: ${String(err)}`);
  }
}

function remoteDisplayName(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || u.hostname;
  } catch {
    return rawUrl;
  }
}

async function loadFullFile(path: string) {
  const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    showError(`Failed to load: ${path} (${res.status})`);
    return;
  }
  const mtime = res.headers.get('X-File-Mtime');
  updateBreadcrumb(path, mtime);
  const content = await res.text();

  // Large file warning
  if (content.length > MAX_FILE_SIZE) {
    viewer.innerHTML = `<div class="error-banner">
      <p><strong>Large file</strong> (${(content.length / 1024).toFixed(0)} KB)</p>
      <p>This file may be slow to render.</p>
      <button class="error-btn" id="force-render">Render anyway</button>
    </div>`;
    document.getElementById('force-render')?.addEventListener('click', () => renderContent(content, path));
    return;
  }

  renderContent(content, path);
}

// Error UX (#11)
function showError(message: string) {
  viewer.innerHTML = `<div class="error-banner"><p>${escapeHtml(message)}</p><button class="error-btn" onclick="location.reload()">Reload</button></div>`;
}

async function reloadCurrentFile() {
  if (currentFilePath) await loadServerFile(currentFilePath);
}

function loadLocalFile(file: File) {
  leaveCompareViewForNavigation();
  clearAlbumTracking();
  const type = detectFileType(file.name);
  currentFilePath = null;
  document.title = `${file.name} — DocView`;
  updateBreadcrumb(file.name);
  updatePaneLabels();

  if (type === 'image') {
    const url = URL.createObjectURL(file);
    viewer.innerHTML = `<div class="image-view"><img src="${url}" alt="${escapeHtml(file.name)}" /><p class="image-caption">${escapeHtml(file.name)}</p></div>`;
    toc.clear();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => renderContent(reader.result as string, file.name);
  reader.readAsText(file);
}

// --- UI ---
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  sidebar.classList.toggle('sidebar-hidden', !sidebarVisible);
  btnSidebar.classList.toggle('toolbar-btn-active', sidebarVisible);
}

function applyTocVisibility(visible: boolean, focusBtn?: boolean) {
  tocVisible = visible;
  tocSidebar.classList.toggle('toc-hidden', !tocVisible);
  tocSidebar.setAttribute('aria-hidden', String(!tocVisible));
  btnToc.classList.toggle('toolbar-btn-active', tocVisible);
  btnToc.setAttribute('aria-pressed', String(tocVisible));
  localStorage.setItem('docview.tocVisible', String(tocVisible));
  if (!visible && focusBtn) btnToc.focus();
}

function toggleToc() {
  applyTocVisibility(!tocVisible, true);
}

// --- Keyboard navigation in sidebar (#5) ---
function setupSidebarKeyNav() {
  sidebar.addEventListener('keydown', (e) => {
    const items = Array.from(sidebar.querySelectorAll<HTMLElement>('.filetree-item[data-type="file"]'));
    if (!items.length) return;
    const activeIdx = items.findIndex((el) => el.classList.contains('active'));

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? Math.min(activeIdx + 1, items.length - 1)
        : Math.max(activeIdx - 1, 0);
      items[next]?.click();
      items[next]?.scrollIntoView({ block: 'nearest' });
    }
  });
  sidebar.tabIndex = 0;
}

// --- Event handlers ---
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loadLocalFile(file);
  input.value = '';
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) loadLocalFile(file);
}


// Recent files modal (#15)
function showRecentFiles() {
  const recent = getRecent();
  if (recent.length === 0) { searchModal.open('files'); return; }
  searchModal.open('files');
  // Inject recent list into search
}

// HTML export (#16)
function exportHTML() {
  const content = viewer.innerHTML;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${document.title}</title>
<style>body{font-family:Inter,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1c2e}
pre{background:#f5f6fb;padding:1em;border-radius:8px;overflow-x:auto}code{font-family:'JetBrains Mono',monospace}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}
blockquote{border-left:3px solid #6366f1;margin:0;padding:0.5em 1em;color:#555}
img{max-width:100%}h1,h2,h3{color:#1a1c2e}</style></head>
<body>${content}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentFilePath?.replace(/\.[^.]+$/, '') || 'document') + '.html';
  a.click();
  URL.revokeObjectURL(url);
}

function handleKeyboard(e: KeyboardEvent) {
  if (helpModal.isOpen) return;
  const openPaneFindBar = [findBar, splitFindBar].find((bar) => bar?.active);
  if (openPaneFindBar) {
    if (e.key === 'Escape') { openPaneFindBar.close(); e.preventDefault(); }
    return;
  }
  if (searchModal.isOpen) return;
  if (urlBar.isOpen) return;

  // Guard: don't fire single-key shortcuts when typing in an input
  const tag = (e.target as HTMLElement).tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

  // Vim-style find (/)
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable) {
    e.preventDefault();
    getFindBarForPane(getNavigationPane())?.open();
    return;
  }
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
    // n/N for next/prev match when find was used
  }

  if (e.key === '?' && !e.metaKey && !e.ctrlKey && !isEditable) {
    e.preventDefault();
    helpModal.toggle();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    searchModal.open('files');
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    searchModal.open('fulltext');
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey) {
    e.preventDefault();
    showRecentFiles();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    exportHTML();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    e.preventDefault();
    fileInput.click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'l' && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    urlBar.open();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'j' && !e.shiftKey) {
    e.preventDefault();
    toggleToc();
  }
  // Zoom (#6)
  if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    zoom(10);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '-') {
    e.preventDefault();
    zoom(-10);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '0') {
    e.preventDefault();
    zoomLevel = 100;
    applyZoom();
  }
  // Word wrap (#7)
  if (e.altKey && e.key === 'z') {
    e.preventDefault();
    toggleWordWrap();
  }
  // Slide mode (#9)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    enterSlideMode();
  }
  // Split view
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault();
    toggleSplitView();
  }
}

// --- SSE ---
// Debounce timer for album SSE refresh
let _albumSseDebounce: ReturnType<typeof setTimeout> | null = null;
let _currentAlbumPath: string | null = null;
let _currentAlbumRecursive = false;

function connectSSE() {
  const evtSource = new EventSource('/api/watch');
  evtSource.onmessage = (event) => {
    if (event.data === 'connected') return;
    try {
      const data = JSON.parse(event.data) as { event: string; path: string };
      if (data.event === 'change' && data.path === currentFilePath) reloadCurrentFile();
      if (data.event === 'change' && splitActive && data.path === splitFilePath) void loadIntoSplit(data.path);
      if (data.event === 'add' || data.event === 'unlink') fileTree?.refresh();

      // Album live reload: only while the album view is the active main view.
      if (_currentAlbumPath !== null && currentFilePath === null && !compareActive) {
        if (isAlbumEventPath(data.path, _currentAlbumPath)) {
          if (_albumSseDebounce) clearTimeout(_albumSseDebounce);
          _albumSseDebounce = setTimeout(() => {
            void reloadCurrentAlbum();
          }, 500);
        }
      }
    } catch { /* ignore */ }
  };
  evtSource.onerror = () => {
    evtSource.close();
    showReconnectBanner();
    setTimeout(connectSSE, 3000);
  };
}

function showReconnectBanner() {
  if (document.getElementById('reconnect-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'reconnect-banner';
  banner.className = 'reconnect-banner';
  banner.innerHTML = 'Connection lost — reconnecting...';
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}

async function detectServerMode(): Promise<{ server: boolean; initialFile: string | null }> {
  try {
    const res = await fetch('/api/info');
    if (res.ok) {
      const data = await res.json();
      return { server: true, initialFile: data.initialFile || null };
    }
  } catch { /* not server mode */ }
  return { server: false, initialFile: null };
}

// --- Custom CSS (#13) ---
async function loadCustomCSS() {
  try {
    const res = await fetch('/api/custom-css');
    if (res.ok) {
      const css = await res.text();
      const style = document.createElement('style');
      style.id = 'custom-css';
      style.textContent = css;
      document.head.appendChild(style);
    }
  } catch { /* ignore */ }
}

// --- Image zoom/pan ---
function initImageZoom(target: HTMLElement = viewer) {
  target.querySelectorAll<HTMLImageElement>('.image-view img, .image-view .svg-container').forEach((el) => {
    if (el.dataset.zoomInit) return;
    el.dataset.zoomInit = '1';
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    function applyTransform() {
      el.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      el.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
    }

    el.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      scale = Math.max(0.5, Math.min(5, scale + delta));
      if (scale <= 1) { translateX = 0; translateY = 0; }
      applyTransform();
    }, { passive: false });

    el.addEventListener('dblclick', () => {
      scale = scale > 1 ? 1 : 2;
      translateX = 0;
      translateY = 0;
      applyTransform();
    });

    el.addEventListener('mousedown', (e: MouseEvent) => {
      if (scale <= 1) return;
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isDragging) return;
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      applyTransform();
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        el.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
      }
    });
  });
}

// --- Split view ---
function ensureLeftCompareHeader() {
  if (leftCompareHeader) return;
  leftCompareHeader = document.createElement('div');
  leftCompareHeader.className = 'pane-header compare-pane-header';
  leftCompareHeader.innerHTML = `
    <div class="compare-pane-info">
      <span class="pane-title">Left</span>
      <span class="compare-pane-path"></span>
    </div>`;
  leftComparePath = leftCompareHeader.querySelector('.compare-pane-path') as HTMLSpanElement;
  leftCompareHeader.addEventListener('click', () => setActivePane('left'));
  viewerPane.insertBefore(leftCompareHeader, tabBarEl);
}

function renderSplitEmptyState() {
  if (!splitViewer) return;
  splitViewer.innerHTML = `
    <div class="compare-empty-state">
      <p>Select a file for the right pane.</p>
      <p>Click inside the pane, then choose a file from the sidebar or search.</p>
    </div>`;
}

function resetSplitPane() {
  splitFilePath = null;
  splitPendingLineJump = null;
  splitCurrentHighlightedLine = null;
  splitFindBar?.close();
  renderSplitEmptyState();
  updatePaneLabels();
}

function toggleSplitView() {
  splitActive = !splitActive;

  if (splitActive) {
    ensureLeftCompareHeader();
    const pane = document.createElement('div');
    pane.id = 'viewer-pane-right';
    pane.className = 'viewer-pane-split';
    pane.innerHTML = `
      <div class="pane-header compare-pane-header">
        <div class="compare-pane-info">
          <span class="pane-title">Right</span>
          <span class="compare-pane-path"></span>
        </div>
        <div class="compare-pane-actions">
          <button type="button" class="compare-sync-btn">Sync scroll</button>
        </div>
      </div>
      <div id="tab-bar-right" class="tab-bar split-tab-bar" style="display:none" role="tablist"></div>
      <div id="progress-bar-right" class="progress-bar"></div>
      <div id="viewer-right" class="markdown-body" role="main" aria-label="Comparison viewer"></div>`;
    workspace.classList.add('split-view');
    workspace.insertBefore(pane, tocSidebar);
    splitViewer = pane.querySelector('#viewer-right')!;
    splitTabBarEl = pane.querySelector('#tab-bar-right') as HTMLElement;
    splitProgressBar = pane.querySelector('#progress-bar-right') as HTMLElement;
    rightComparePath = pane.querySelector('.compare-pane-path') as HTMLSpanElement;
    btnSyncScroll = pane.querySelector('.compare-sync-btn') as HTMLButtonElement;
    splitTabBar = new TabBar(
      splitTabBarEl,
      (path) => {
        setActivePane('right');
        void loadIntoSplit(path);
      },
      (path) => {
        setActivePane('right');
        if (path) {
          void loadIntoSplit(path);
        } else {
          resetSplitPane();
        }
      }
    );
    btnSyncScroll.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSyncSplitScroll();
    });
    pane.addEventListener('click', () => setActivePane('right'));
    splitViewer.addEventListener('scroll', () => handlePaneScroll('right'));
    bindLineInteractions(splitViewer, 'right');
    splitFindBar = new FindBar(splitViewer);
    applyZoom();
    if (wordWrap) splitViewer.classList.add('word-wrap');
    updatePaneLabels();
    updateSyncScrollButton();
    if (currentFilePath) {
      void loadIntoSplit(currentFilePath);
    } else {
      renderSplitEmptyState();
    }
    setActivePane('right');
  } else {
    workspace.classList.remove('split-view');
    document.getElementById('viewer-pane-right')?.remove();
    splitViewer = null;
    splitTabBar = null;
    splitTabBarEl = null;
    splitProgressBar = null;
    splitFilePath = null;
    splitPendingLineJump = null;
    splitCurrentHighlightedLine = null;
    splitFindBar = null;
    rightComparePath = null;
    btnSyncScroll = null;
    setActivePane('left');
    updatePaneLabels();
  }
}

async function loadIntoSplit(path: string) {
  if (!splitViewer) return;
  saveScrollPosition('right');
  const fileChanged = splitFilePath !== path;
  splitFilePath = path;
  if (fileChanged) splitCurrentHighlightedLine = null;
  addRecent(path);
  splitTabBar?.open(path);
  updatePaneLabels();
  setPaneProgress('right', 0);
  const type = detectFileType(path);

  if (type === 'image') {
    const url = `/api/file?path=${encodeURIComponent(path)}`;
    if (path.toLowerCase().endsWith('.svg')) {
      try {
        const res = await fetch(url);
        const svgText = await res.text();
        const cleanSvg = DOMPurify.sanitize(svgText, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_TAGS: ['use', 'foreignObject'] });
        splitViewer.innerHTML = `<div class="image-view"><div class="svg-container">${cleanSvg}</div></div>`;
      } catch { /* ignore */ }
    } else {
      splitViewer.innerHTML = `<div class="image-view"><img src="${url}" alt="${escapeHtml(path)}" /></div>`;
    }
    initImageZoom(splitViewer);
    if (syncSplitScroll) requestAnimationFrame(() => syncScrollFrom('left'));
    return;
  }

  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) return;
    const content = await res.text();
    renderContent(content, path, splitViewer);
    initImageZoom(splitViewer);
    if (syncSplitScroll) requestAnimationFrame(() => syncScrollFrom('left'));
  } catch { /* ignore */ }
}

// --- Init ---
let fileTree: FileTree | null = null;

async function init() {
  const currentTheme = initTheme();
  updateMermaidTheme(currentTheme);

  const { server: hasServer, initialFile } = await detectServerMode();

  if (hasServer) {
    await loadCustomCSS();

    fileTree = new FileTree(
      document.getElementById('filetree')!,
      (path) => {
        if (splitActive && activePane === 'right') {
          void loadIntoSplit(path);
        } else {
          void loadServerFile(path);
        }
      },
      (albumPath) => {
        void loadAlbumView(albumPath, false);
      },
    );
    await fileTree.load();

    // Wire up TOC backlinks to navigate files
    toc.setFileSelectCallback((path) => loadServerFile(path));

    sidebarVisible = true;
    sidebar.classList.remove('sidebar-hidden');
    btnSidebar.classList.add('toolbar-btn-active');

    // Apply TOC visibility from localStorage
    applyTocVisibility(tocVisible);

    // Wire up TOC close button (delegated — button is rendered on each toc.update())
    tocSidebar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.toc-close-btn')) toggleToc();
    });

    connectSSE();
    setupSidebarKeyNav();
    initSidebarResize(sidebar);
    initCsvSort();
    initCsvColumnCopy();

    // URL hash takes priority, then CLI initial file, then first file in tree
    const parsed = parseHash();

    if (parsed.comparePaths !== null) {
      void renderCompare(parsed.comparePaths);
    } else if (parsed.albumPath !== null) {
      void loadAlbumView(parsed.albumPath, parsed.albumRecursive);
    } else {
      const startFile = parsed.path || initialFile;
      if (startFile) {
        if (parsed.path && parsed.line != null) {
          setPendingLineJump('left', { line: parsed.line, lineEnd: parsed.lineEnd });
        }
        void loadServerFile(startFile);
      } else {
        const firstFile = sidebar.querySelector('.filetree-item[data-type="file"]') as HTMLElement;
        if (firstFile?.dataset.path) {
          void loadServerFile(firstFile.dataset.path);
        } else {
          showWelcome();
        }
      }
    }
  } else {
    sidebar.style.display = 'none';
    btnSidebar.style.display = 'none';
    btnSearch.style.display = 'none';
    showWelcome();
  }
}

init();

// --- Event listeners ---
btnHelp.addEventListener('click', () => helpModal.open());
const themeMenu = document.getElementById('theme-menu') as HTMLElement | null;

function setThemeMenuOpen(open: boolean) {
  if (!themeMenu) return;
  themeMenu.hidden = !open;
  btnTheme.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    const current = document.documentElement.getAttribute('data-theme');
    const target = themeMenu.querySelector<HTMLButtonElement>(
      current ? `[data-theme-value="${current}"]` : '.theme-menu-item',
    );
    target?.focus();
  }
}

function applyTheme(theme: Theme) {
  setTheme(theme);
  updateMermaidTheme(theme);
  if (currentFilePath) void reloadCurrentFile();
  if (splitActive && splitFilePath) void loadIntoSplit(splitFilePath);
}

btnTheme.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!themeMenu) {
    const order = [...THEMES];
    const stored = (document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'light';
    const next = order[(order.indexOf(stored) + 1) % order.length];
    applyTheme(next);
    return;
  }
  setThemeMenuOpen(Boolean(themeMenu.hidden));
});

if (themeMenu) {
  themeMenu.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-theme-value]');
    if (!btn) return;
    const theme = btn.dataset.themeValue as Theme | undefined;
    if (theme && (THEMES as readonly string[]).includes(theme)) {
      applyTheme(theme);
      setThemeMenuOpen(false);
      btnTheme.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (themeMenu.hidden) return;
    const target = e.target as Node;
    if (!themeMenu.contains(target) && target !== btnTheme && !btnTheme.contains(target)) {
      setThemeMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (themeMenu.hidden) return;
    if (e.key === 'Escape') {
      setThemeMenuOpen(false);
      btnTheme.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(themeMenu.querySelectorAll<HTMLButtonElement>('.theme-menu-item'));
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = items.findIndex((el) => el === active);
      const next = e.key === 'ArrowDown'
        ? items[(idx + 1 + items.length) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      next.focus();
    }
  });
}
btnOpen.addEventListener('click', () => fileInput.click());
btnOpenUrl?.addEventListener('click', () => urlBar.open());
btnSidebar.addEventListener('click', toggleSidebar);
btnToc.addEventListener('click', toggleToc);
btnSearch.addEventListener('click', () => searchModal.open('files'));
btnPrint.addEventListener('click', () => window.print()); // #12
btnExport.addEventListener('click', async () => {
  btnExport.disabled = true;
  btnExport.classList.add('toolbar-btn-active');
  try {
    const { domToPng } = await import('modern-screenshot');

    // Temporarily apply export-mode styling in-place
    document.documentElement.classList.add('export-mode');

    // Wait for reflow
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const dataUrl = await domToPng(viewer, {
      scale: 2,
      backgroundColor: getComputedStyle(document.body).getPropertyValue('background-color'),
    });

    document.documentElement.classList.remove('export-mode');

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = (currentFilePath?.replace(/\.[^.]+$/, '') || 'document') + '.png';
    a.click();
  } catch (err) {
    document.documentElement.classList.remove('export-mode');
    console.error('Export failed:', err);
  } finally {
    btnExport.disabled = false;
    btnExport.classList.remove('toolbar-btn-active');
  }
});
fileInput.addEventListener('change', handleFileSelect);
document.addEventListener('drop', handleDrop);
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
document.addEventListener('keydown', handleKeyboard);

// Hash change navigation (#9)
window.addEventListener('hashchange', () => {
  const parsed = parseHash();

  if (parsed.comparePaths !== null) {
    if (!compareActive || !sameStringArray(parsed.comparePaths, _currentComparePaths)) {
      void renderCompare(parsed.comparePaths);
    }
    return;
  }

  if (parsed.albumPath !== null) {
    if (compareActive || parsed.albumPath !== _currentAlbumPath || parsed.albumRecursive !== _currentAlbumRecursive) {
      void loadAlbumView(parsed.albumPath, parsed.albumRecursive);
    }
    return;
  }

  if (!parsed.path) {
    leaveCompareViewForNavigation();
    return;
  }
  leaveCompareViewForNavigation();
  if (parsed.path !== currentFilePath) {
    if (parsed.line != null) {
      setPendingLineJump('left', { line: parsed.line, lineEnd: parsed.lineEnd });
    }
    void loadServerFile(parsed.path);
  } else if (parsed.line != null) {
    scrollToLine(parsed.line, parsed.lineEnd, viewer, 'left');
  } else {
    clearLineHighlights();
    setHighlightedLine('left', null);
  }
});
