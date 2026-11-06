/**
 * Diff view — compares two text sources side by side (or unified):
 *   - two files in the served directory,
 *   - a file against one of its Git revisions (HEAD, earlier commits),
 *   - a file against the snapshot taken when it was first opened in this
 *     session (live-change review while another tool edits it).
 * Both sides re-diff automatically when the underlying file changes on disk.
 */
import { diffLines, diffInline, buildRows, toUnifiedPatch, type DiffResult, type DiffRow, type InlineSegment } from './text-diff';
import { isSecretSafeModeEnabled, maskSecrets } from './secret-mask';

export type DiffSource =
  | { kind: 'file'; path: string }
  | { kind: 'git'; path: string; rev: string }
  | { kind: 'snapshot'; path: string };

export interface Snapshot {
  text: string;
  takenAt: number;
}

export interface DiffViewHooks {
  /** In-session baseline of a file, if one was recorded. */
  getSnapshot: (path: string) => Snapshot | null;
  /** Replace the baseline with the given text ("mark as reviewed"). */
  resetSnapshot: (path: string, text: string) => void;
  /** Navigate the main viewer to a file location. */
  openLocation: (path: string, line: number) => void;
  notify: (message: string) => void;
}

interface GitCommit {
  hash: string;
  short: string;
  date: string;
  author: string;
  subject: string;
}

interface GitLog {
  git: boolean;
  status: 'clean' | 'modified' | 'untracked' | 'ignored' | null;
  commits: GitCommit[];
}

type Layout = 'split' | 'unified';

const NON_TEXT_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif',
  'mp4', 'm4v', 'webm', 'ogv', 'mov',
  'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'numbers', 'pages', 'key',
]);

const MAX_DIFF_CHARS = 4 * 1024 * 1024;
const MAX_RENDER_ROWS = 20000;
const LAYOUT_KEY = 'docview.diffLayout';
const IGNORE_WS_KEY = 'docview.diffIgnoreWhitespace';

/** True when a file can be compared as text. */
export function isDiffablePath(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return true;
  return !NON_TEXT_EXT.has(name.slice(dot + 1).toLowerCase());
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function sourceKey(src: DiffSource): string {
  if (src.kind === 'file') return `file:${src.path}`;
  if (src.kind === 'snapshot') return `snap:${src.path}`;
  return `git:${src.rev}:${src.path}`;
}

function parseSourceKey(key: string): DiffSource | null {
  if (key.startsWith('file:')) return { kind: 'file', path: key.slice(5) };
  if (key.startsWith('snap:')) return { kind: 'snapshot', path: key.slice(5) };
  const m = key.match(/^git:([^:]+):(.*)$/);
  if (m) return { kind: 'git', rev: m[1], path: m[2] };
  return null;
}

function formatTime(ts: number | string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return sameDay ? hm : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm.slice(0, 5)}`;
}

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function segmentsHtml(segs: InlineSegment[], cls: string): string {
  return segs.map((s) => (s.changed ? `<span class="${cls}">${esc(s.text)}</span>` : esc(s.text))).join('');
}

export class DiffView {
  private overlay: HTMLElement;
  private dialog: HTMLElement;
  private body: HTMLElement;
  private oldSelect: HTMLSelectElement;
  private newSelect: HTMLSelectElement;
  private statsEl: HTMLElement;
  private noticeEl: HTMLElement;
  private layoutBtns: HTMLButtonElement[];
  private wsToggle: HTMLInputElement;
  private changesOnlyToggle: HTMLInputElement;
  private navLabel: HTMLElement;
  private baselineBtn: HTMLButtonElement;
  private hooks: DiffViewHooks;

  private oldSource: DiffSource | null = null;
  private newSource: DiffSource | null = null;
  private oldText = '';
  private newText = '';
  private result: DiffResult | null = null;
  // Without a stored preference, narrow screens start in the single-column layout.
  private layout: Layout = (readPref(LAYOUT_KEY) ?? (window.innerWidth < 720 ? 'unified' : 'split')) === 'unified' ? 'unified' : 'split';
  private ignoreWhitespace = readPref(IGNORE_WS_KEY) === 'true';
  private changesOnly = true;
  private expandedSkips = new Set<number>();
  private currentChange = -1;
  private loadSeq = 0;
  private gitLogs = new Map<string, Promise<GitLog>>();
  private fileList: Promise<string[]> | null = null;
  private returnFocus: HTMLElement | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(hooks: DiffViewHooks) {
    this.hooks = hooks;
    this.overlay = document.createElement('div');
    this.overlay.className = 'diff-overlay';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'diff-title');
    this.overlay.innerHTML = `
      <div class="diff-modal" tabindex="-1">
        <header class="diff-header">
          <div class="diff-header-row">
            <h2 id="diff-title" class="diff-title">差分</h2>
            <div class="diff-sources">
              <label class="diff-source"><span class="diff-source-tag diff-source-tag--old">旧</span>
                <select class="diff-select" data-side="old" aria-label="比較元 (旧)"></select></label>
              <button type="button" class="diff-btn diff-swap" title="左右を入れ替え" aria-label="比較元と比較先を入れ替え">⇄</button>
              <label class="diff-source"><span class="diff-source-tag diff-source-tag--new">新</span>
                <select class="diff-select" data-side="new" aria-label="比較先 (新)"></select></label>
            </div>
            <button type="button" class="diff-btn diff-close" aria-label="差分を閉じる" title="閉じる (Esc)">✕</button>
          </div>
          <div class="diff-header-row diff-toolbar">
            <span class="diff-stats" aria-live="polite"></span>
            <div class="diff-nav" role="group" aria-label="変更箇所の移動">
              <button type="button" class="diff-btn diff-prev" title="前の変更 (p / k)" aria-label="前の変更">↑</button>
              <span class="diff-nav-label"></span>
              <button type="button" class="diff-btn diff-next" title="次の変更 (n / j)" aria-label="次の変更">↓</button>
            </div>
            <div class="diff-layout" role="group" aria-label="表示形式">
              <button type="button" class="diff-btn" data-layout="split" aria-pressed="false">左右</button>
              <button type="button" class="diff-btn" data-layout="unified" aria-pressed="false">統合</button>
            </div>
            <label class="diff-check"><input type="checkbox" class="diff-changes-only" checked> 変更箇所のみ</label>
            <label class="diff-check"><input type="checkbox" class="diff-ignore-ws"> 空白の差を無視</label>
            <span class="diff-spacer"></span>
            <button type="button" class="diff-btn diff-baseline" hidden title="現在の内容を新しい基準にして、以降の変更だけを追跡します">確認済みにする</button>
            <button type="button" class="diff-btn diff-copy-patch" title="unified diff 形式でコピー">パッチをコピー</button>
            <button type="button" class="diff-btn diff-download-patch" title=".patch ファイルとして保存">保存</button>
          </div>
          <div class="diff-notice" hidden></div>
        </header>
        <div class="diff-body" tabindex="0" aria-label="差分の内容"></div>
      </div>`;
    document.body.appendChild(this.overlay);

    const q = <T extends HTMLElement>(sel: string) => this.overlay.querySelector<T>(sel)!;
    this.dialog = q('.diff-modal');
    this.body = q('.diff-body');
    this.oldSelect = q<HTMLSelectElement>('select[data-side="old"]');
    this.newSelect = q<HTMLSelectElement>('select[data-side="new"]');
    this.statsEl = q('.diff-stats');
    this.noticeEl = q('.diff-notice');
    this.navLabel = q('.diff-nav-label');
    this.wsToggle = q<HTMLInputElement>('.diff-ignore-ws');
    this.changesOnlyToggle = q<HTMLInputElement>('.diff-changes-only');
    this.baselineBtn = q<HTMLButtonElement>('.diff-baseline');
    this.layoutBtns = Array.from(this.overlay.querySelectorAll<HTMLButtonElement>('[data-layout]'));
    this.wsToggle.checked = this.ignoreWhitespace;

    q('.diff-close').addEventListener('click', () => this.close());
    q('.diff-swap').addEventListener('click', () => this.swap());
    q('.diff-prev').addEventListener('click', () => this.gotoChange(-1));
    q('.diff-next').addEventListener('click', () => this.gotoChange(1));
    q('.diff-copy-patch').addEventListener('click', () => void this.copyPatch());
    q('.diff-download-patch').addEventListener('click', () => this.downloadPatch());
    this.baselineBtn.addEventListener('click', () => this.markReviewed());
    this.layoutBtns.forEach((btn) => btn.addEventListener('click', () => {
      this.layout = btn.dataset.layout === 'unified' ? 'unified' : 'split';
      writePref(LAYOUT_KEY, this.layout);
      this.renderBody();
    }));
    this.wsToggle.addEventListener('change', () => {
      this.ignoreWhitespace = this.wsToggle.checked;
      writePref(IGNORE_WS_KEY, String(this.ignoreWhitespace));
      this.recompute();
    });
    this.changesOnlyToggle.addEventListener('change', () => {
      this.changesOnly = this.changesOnlyToggle.checked;
      this.expandedSkips.clear();
      this.renderBody();
    });
    for (const select of [this.oldSelect, this.newSelect]) {
      select.addEventListener('change', () => void this.onSelectChange(select));
    }
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.body.addEventListener('click', (e) => this.onBodyClick(e));
    this.overlay.addEventListener('keydown', (e) => this.onKeydown(e));
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Open the view comparing `oldSource` (left) to `newSource` (right). */
  async open(oldSource: DiffSource, newSource: DiffSource): Promise<void> {
    if (!this.isOpen) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.overlay.hidden = false;
      document.documentElement.classList.add('diff-open');
    }
    this.oldSource = oldSource;
    this.newSource = newSource;
    this.expandedSkips.clear();
    this.currentChange = -1;
    this.dialog.focus();
    await this.load();
  }

  close(): void {
    if (!this.isOpen) return;
    ++this.loadSeq;
    this.overlay.hidden = true;
    document.documentElement.classList.remove('diff-open');
    this.body.innerHTML = '';
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    const focus = this.returnFocus;
    this.returnFocus = null;
    if (focus?.isConnected) focus.focus();
  }

  /** Called on file-change / unlink events so open comparisons stay live. */
  notifyFileChanged(path: string): void {
    this.gitLogs.delete(path);
    if (!this.isOpen) return;
    const touches = (src: DiffSource | null) => src !== null && src.path === path && src.kind === 'file';
    if (!touches(this.oldSource) && !touches(this.newSource)) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.load({ keepPosition: true }), 150);
  }

  /** Forget cached file listings so new files show up in the selector. */
  invalidateFileList(): void {
    this.fileList = null;
  }

  // --- Loading ---

  private async fetchText(src: DiffSource): Promise<string> {
    if (src.kind === 'snapshot') {
      const snap = this.hooks.getSnapshot(src.path);
      if (!snap) throw new Error('このセッションで記録した内容がありません');
      return snap.text;
    }
    const url = src.kind === 'file'
      ? `/api/file?path=${encodeURIComponent(src.path)}`
      : `/api/git/show?path=${encodeURIComponent(src.path)}&rev=${encodeURIComponent(src.rev)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      let detail = `${res.status}`;
      try { detail = (await res.json()).error ?? detail; } catch { /* not JSON */ }
      if (src.kind === 'git' && res.status === 404) throw new Error(`${src.rev} にこのファイルは存在しません`);
      throw new Error(detail);
    }
    const text = await res.text();
    if (text.length > MAX_DIFF_CHARS) throw new Error('ファイルが大きすぎるため比較できません (上限 4 MB)');
    return text;
  }

  private gitLog(path: string): Promise<GitLog> {
    let p = this.gitLogs.get(path);
    if (!p) {
      p = fetch(`/api/git/log?path=${encodeURIComponent(path)}&limit=30`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() as Promise<GitLog> : { git: false, status: null, commits: [] }))
        .catch(() => ({ git: false, status: null, commits: [] } as GitLog));
      this.gitLogs.set(path, p);
      p.catch(() => this.gitLogs.delete(path));
    }
    return p;
  }

  private getFileList(): Promise<string[]> {
    if (!this.fileList) {
      this.fileList = fetch('/api/tree', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: { tree?: Array<{ path: string; type: string; children?: unknown[] }> }) => {
          const out: string[] = [];
          const walk = (nodes: Array<{ path: string; type: string; children?: unknown[] }>) => {
            for (const n of nodes) {
              if (n.type === 'file' && isDiffablePath(n.path)) out.push(n.path);
              else if (n.children) walk(n.children as typeof nodes);
            }
          };
          walk(data.tree ?? []);
          return out.sort();
        })
        .catch(() => {
          this.fileList = null;
          return [];
        });
    }
    return this.fileList;
  }

  private async load(opts: { keepPosition?: boolean } = {}): Promise<void> {
    const seq = ++this.loadSeq;
    const oldSrc = this.oldSource;
    const newSrc = this.newSource;
    if (!oldSrc || !newSrc) return;
    const scrollTop = this.body.scrollTop;
    if (!opts.keepPosition) this.body.innerHTML = '<div class="diff-loading">読み込み中…</div>';
    void this.populateSelectors();
    this.updateTitle();

    let oldText: string;
    let newText: string;
    try {
      [oldText, newText] = await Promise.all([this.fetchText(oldSrc), this.fetchText(newSrc)]);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.result = null;
      this.statsEl.textContent = '';
      this.navLabel.textContent = '';
      this.body.innerHTML = `<div class="diff-empty diff-error" role="alert">比較できません: ${esc(err instanceof Error ? err.message : String(err))}</div>`;
      this.updateBaselineButton();
      return;
    }
    if (seq !== this.loadSeq) return;
    if (isSecretSafeModeEnabled()) {
      oldText = maskSecrets(oldText);
      newText = maskSecrets(newText);
    }
    this.oldText = oldText;
    this.newText = newText;
    this.recompute();
    if (opts.keepPosition) this.body.scrollTop = scrollTop;
    else if (this.currentChange < 0 && (this.result?.stats.changes ?? 0) > 0) this.gotoChange(1);
  }

  private recompute(): void {
    this.result = diffLines(this.oldText, this.newText, { ignoreWhitespace: this.ignoreWhitespace });
    if (this.currentChange >= this.result.stats.changes) this.currentChange = this.result.stats.changes - 1;
    this.renderBody();
  }

  // --- Selectors ---

  private sourceLabel(src: DiffSource): string {
    if (src.kind === 'file') return src.path;
    if (src.kind === 'snapshot') {
      const snap = this.hooks.getSnapshot(src.path);
      return `${src.path} @ 開いた時点${snap ? ` (${formatTime(snap.takenAt)})` : ''}`;
    }
    return `${src.path} @ ${src.rev}`;
  }

  private updateTitle(): void {
    const title = this.overlay.querySelector('.diff-title')!;
    const o = this.oldSource;
    const n = this.newSource;
    if (!o || !n) return;
    title.textContent = o.path === n.path ? `差分: ${baseName(n.path)}` : `差分: ${baseName(o.path)} ↔ ${baseName(n.path)}`;
    title.setAttribute('title', `${this.sourceLabel(o)}  →  ${this.sourceLabel(n)}`);
  }

  private async populateSelectors(): Promise<void> {
    const oldSrc = this.oldSource;
    const newSrc = this.newSource;
    if (!oldSrc || !newSrc) return;
    const paths = Array.from(new Set([newSrc.path, oldSrc.path]));
    const logs = await Promise.all(paths.map((p) => this.gitLog(p)));
    if (oldSrc !== this.oldSource || newSrc !== this.newSource) return;

    const build = (selected: DiffSource) => {
      const groups: string[] = [];
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const log = logs[i];
        const opts: string[] = [];
        opts.push(this.option({ kind: 'file', path }, `現在のファイル — ${path}`, selected));
        if (this.hooks.getSnapshot(path)) {
          opts.push(this.option({ kind: 'snapshot', path }, `開いた時点 (${formatTime(this.hooks.getSnapshot(path)!.takenAt)})`, selected));
        }
        if (log.git && log.commits.length > 0) {
          opts.push(this.option({ kind: 'git', path, rev: 'HEAD' }, 'Git: HEAD (最新コミット)', selected));
          for (const c of log.commits) {
            const subject = c.subject.length > 60 ? `${c.subject.slice(0, 57)}…` : c.subject;
            opts.push(this.option({ kind: 'git', path, rev: c.short }, `Git: ${c.short} ${formatTime(c.date)} ${subject}`, selected));
          }
        }
        groups.push(`<optgroup label="${esc(path)}">${opts.join('')}</optgroup>`);
      }
      // Keep a selected source that isn't otherwise listed (e.g. an old commit beyond the log limit).
      const key = sourceKey(selected);
      const listed = groups.some((g) => g.includes(`value="${esc(key)}"`));
      const extra = listed ? '' : `<option value="${esc(key)}" selected>${esc(this.sourceLabel(selected))}</option>`;
      return `${extra}${groups.join('')}<option value="__other__">別のファイルを選ぶ…</option>`;
    };
    this.oldSelect.innerHTML = build(oldSrc);
    this.newSelect.innerHTML = build(newSrc);
    this.oldSelect.title = this.sourceLabel(oldSrc);
    this.newSelect.title = this.sourceLabel(newSrc);
  }

  private option(src: DiffSource, label: string, selected: DiffSource): string {
    const key = sourceKey(src);
    return `<option value="${esc(key)}"${key === sourceKey(selected) ? ' selected' : ''}>${esc(label)}</option>`;
  }

  private async onSelectChange(select: HTMLSelectElement): Promise<void> {
    const side = select.dataset.side === 'old' ? 'old' : 'new';
    const current = side === 'old' ? this.oldSource : this.newSource;
    let next: DiffSource | null;
    if (select.value === '__other__') {
      next = await this.pickFile(current?.path ?? '');
      if (!next) {
        if (current) select.value = sourceKey(current);
        return;
      }
    } else {
      next = parseSourceKey(select.value);
    }
    if (!next) return;
    if (side === 'old') this.oldSource = next; else this.newSource = next;
    this.expandedSkips.clear();
    this.currentChange = -1;
    await this.load();
  }

  /** Inline picker: a filterable input over every diffable file in the tree. */
  private pickFile(initial: string): Promise<DiffSource | null> {
    return new Promise((resolveChoice) => {
      const existing = this.overlay.querySelector('.diff-picker');
      existing?.remove();
      const picker = document.createElement('form');
      picker.className = 'diff-picker';
      const listId = `diff-picker-list-${Date.now()}`;
      picker.innerHTML = `
        <label class="diff-picker-label">比較するファイル
          <input type="text" class="diff-picker-input" list="${listId}" autocomplete="off" spellcheck="false"></label>
        <datalist id="${listId}"></datalist>
        <button type="submit" class="diff-btn">比較</button>
        <button type="button" class="diff-btn diff-picker-cancel">キャンセル</button>
        <span class="diff-picker-error" role="alert"></span>`;
      this.noticeEl.after(picker);
      const input = picker.querySelector<HTMLInputElement>('input')!;
      const list = picker.querySelector('datalist')!;
      const error = picker.querySelector<HTMLElement>('.diff-picker-error')!;
      input.value = initial;
      input.select();
      input.focus();
      let files: string[] = [];
      void this.getFileList().then((f) => {
        files = f;
        list.innerHTML = f.map((p) => `<option value="${esc(p)}"></option>`).join('');
      });
      const finish = (choice: DiffSource | null) => {
        picker.remove();
        resolveChoice(choice);
        this.dialog.focus();
      };
      picker.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value.trim().replace(/^\/+/, '');
        if (!value) return;
        if (files.length > 0 && !files.includes(value)) {
          error.textContent = '一覧にないファイルです';
          return;
        }
        if (!isDiffablePath(value)) {
          error.textContent = 'テキストとして比較できない形式です';
          return;
        }
        finish({ kind: 'file', path: value });
      });
      picker.querySelector('.diff-picker-cancel')!.addEventListener('click', () => finish(null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      });
    });
  }

  private swap(): void {
    if (!this.oldSource || !this.newSource) return;
    [this.oldSource, this.newSource] = [this.newSource, this.oldSource];
    [this.oldText, this.newText] = [this.newText, this.oldText];
    this.expandedSkips.clear();
    this.currentChange = -1;
    void this.populateSelectors();
    this.updateTitle();
    this.recompute();
  }

  // --- Rendering ---

  private visibleRows(): DiffRow[] {
    const result = this.result!;
    const rows = buildRows(result, this.changesOnly ? 3 : -1);
    if (this.expandedSkips.size === 0) return rows;
    const out: DiffRow[] = [];
    for (const row of rows) {
      if (row.kind !== 'skip' || !this.expandedSkips.has(row.oldStart)) { out.push(row); continue; }
      for (let i = 0; i < row.count; i++) {
        const o = row.oldStart - 1 + i;
        const n = row.newStart - 1 + i;
        out.push({ kind: 'equal', old: { line: o + 1, text: result.oldLines[o] }, new: { line: n + 1, text: result.newLines[n] } });
      }
    }
    return out;
  }

  private renderBody(): void {
    const result = this.result;
    this.layoutBtns.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.layout === this.layout)));
    this.updateBaselineButton();
    if (!result) return;
    const { added, removed, changes } = result.stats;
    this.statsEl.innerHTML = changes === 0
      ? '<span class="diff-stat-same">差分なし</span>'
      : `<span class="diff-stat-add">+${added}</span> <span class="diff-stat-del">−${removed}</span> <span class="diff-stat-blocks">${changes} 箇所</span>`;
    const notices: string[] = [];
    if (result.approximate) notices.push('変更量が多いため、差分は概算で表示しています。');
    if (this.ignoreWhitespace && changes === 0 && this.oldText !== this.newText) notices.push('空白以外の差分はありません。');
    if (isSecretSafeModeEnabled()) notices.push('Secret Safe モード: 機密値はマスクして比較しています。');
    this.noticeEl.hidden = notices.length === 0;
    this.noticeEl.textContent = notices.join(' ');

    if (changes === 0 && this.changesOnly) {
      this.body.innerHTML = `<div class="diff-empty">${this.oldText === this.newText ? '内容は同一です。' : '比較条件の範囲では同一です。'}</div>`;
      this.updateNav();
      return;
    }

    const rows = this.visibleRows();
    const truncated = rows.length > MAX_RENDER_ROWS;
    const shown = truncated ? rows.slice(0, MAX_RENDER_ROWS) : rows;
    const oldNav = this.oldSource?.kind === 'file' ? this.oldSource.path : null;
    const newNav = this.newSource?.kind === 'file' ? this.newSource.path : null;
    const num = (cell: { line: number } | null, nav: string | null, side: string) => {
      if (!cell) return `<td class="diff-num diff-num--${side}"></td>`;
      if (!nav) return `<td class="diff-num diff-num--${side}">${cell.line}</td>`;
      return `<td class="diff-num diff-num--${side}"><button type="button" class="diff-line-link" data-path="${esc(nav)}" data-line="${cell.line}" title="${esc(baseName(nav))} の ${cell.line} 行目を開く">${cell.line}</button></td>`;
    };
    const parts: string[] = [];
    let lastChange = -1;
    const colspan = this.layout === 'split' ? 4 : 3;
    for (const row of shown) {
      if (row.kind === 'skip') {
        parts.push(`<tr class="diff-row diff-row--skip"><td colspan="${colspan}"><button type="button" class="diff-expand" data-old-start="${row.oldStart}">⋯ 変更のない ${row.count} 行を表示</button></td></tr>`);
        continue;
      }
      let oldHtml: string;
      let newHtml: string;
      let anchor = '';
      if (row.kind === 'equal') {
        oldHtml = esc(row.old.text);
        newHtml = esc(row.new.text);
      } else {
        if (row.changeIndex !== lastChange) {
          anchor = ` data-change="${row.changeIndex}"`;
          lastChange = row.changeIndex;
        }
        const inline = row.old && row.new ? diffInline(row.old.text, row.new.text) : null;
        oldHtml = row.old ? (inline ? segmentsHtml(inline.old, 'diff-word-del') : esc(row.old.text)) : '';
        newHtml = row.new ? (inline ? segmentsHtml(inline.new, 'diff-word-add') : esc(row.new.text)) : '';
      }
      if (this.layout === 'split') {
        const oldCls = row.kind === 'equal' ? '' : row.old ? ' diff-cell--del' : ' diff-cell--empty';
        const newCls = row.kind === 'equal' ? '' : row.new ? ' diff-cell--add' : ' diff-cell--empty';
        parts.push(`<tr class="diff-row diff-row--${row.kind}"${anchor}>${num(row.old, oldNav, 'old')}<td class="diff-code${oldCls}">${oldHtml}</td>${num(row.new, newNav, 'new')}<td class="diff-code${newCls}">${newHtml}</td></tr>`);
      } else if (row.kind === 'equal') {
        parts.push(`<tr class="diff-row diff-row--equal">${num(row.old, oldNav, 'old')}${num(row.new, newNav, 'new')}<td class="diff-code"><span class="diff-sign"> </span>${newHtml}</td></tr>`);
      } else {
        // Unified: deletions of a block are emitted before its insertions by
        // splitting paired rows — collect into the block's del/ins lists.
        parts.push(`<!--u:${row.changeIndex}:${anchor ? 1 : 0}-->`);
        if (row.old) parts.push(`<tr class="diff-row diff-row--change diff-u-del" data-u="${row.changeIndex}">${num(row.old, oldNav, 'old')}<td class="diff-num diff-num--new"></td><td class="diff-code diff-cell--del"><span class="diff-sign">-</span>${oldHtml}</td></tr>`);
        if (row.new) parts.push(`<tr class="diff-row diff-row--change diff-u-add" data-u="${row.changeIndex}"><td class="diff-num diff-num--old"></td>${num(row.new, newNav, 'new')}<td class="diff-code diff-cell--add"><span class="diff-sign">+</span>${newHtml}</td></tr>`);
      }
    }
    let html = parts.join('');
    if (this.layout === 'unified') html = this.reorderUnified(parts);
    const tableCls = this.layout === 'split' ? 'diff-table diff-table--split' : 'diff-table diff-table--unified';
    const cols = this.layout === 'split'
      ? '<colgroup><col class="diff-col-num"><col><col class="diff-col-num"><col></colgroup>'
      : '<colgroup><col class="diff-col-num"><col class="diff-col-num"><col></colgroup>';
    this.body.innerHTML = `<table class="${tableCls}">${cols}<tbody>${html}</tbody></table>${truncated ? `<div class="diff-empty">表示行数の上限 (${MAX_RENDER_ROWS.toLocaleString()} 行) に達したため以降を省略しました。パッチのコピー/保存には全体が含まれます。</div>` : ''}`;
    this.updateNav();
  }

  /** In unified layout, list all deletions of a change block before its insertions. */
  private reorderUnified(parts: string[]): string {
    const out: string[] = [];
    let i = 0;
    while (i < parts.length) {
      const marker = parts[i].match(/^<!--u:(\d+):([01])-->$/);
      if (!marker) { out.push(parts[i]); i++; continue; }
      const block = marker[1];
      const dels: string[] = [];
      const adds: string[] = [];
      while (i < parts.length) {
        const m = parts[i].match(/^<!--u:(\d+):[01]-->$/);
        if (m) {
          if (m[1] !== block) break;
          i++;
          continue;
        }
        if (!parts[i].includes(`data-u="${block}"`)) break;
        (parts[i].includes('diff-u-del') ? dels : adds).push(parts[i]);
        i++;
      }
      const rows = [...dels, ...adds];
      if (rows.length > 0) rows[0] = rows[0].replace('<tr ', `<tr data-change="${block}" `);
      out.push(...rows);
    }
    return out.join('');
  }

  private updateNav(): void {
    const total = this.result?.stats.changes ?? 0;
    this.navLabel.textContent = total === 0 ? '0 / 0' : `${this.currentChange < 0 ? '–' : this.currentChange + 1} / ${total}`;
    this.overlay.querySelectorAll('.diff-row--current').forEach((el) => el.classList.remove('diff-row--current'));
    if (this.currentChange >= 0) {
      this.body.querySelectorAll(`[data-change="${this.currentChange}"]`).forEach((el) => el.classList.add('diff-row--current'));
    }
  }

  private gotoChange(delta: number): void {
    const total = this.result?.stats.changes ?? 0;
    if (total === 0) return;
    let next = this.currentChange + delta;
    if (this.currentChange < 0 && delta < 0) next = total - 1;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    // A change may sit inside collapsed rows only when "changes only" is off,
    // which renders everything, so every change has an anchor row.
    this.currentChange = next;
    this.updateNav();
    const row = this.body.querySelector<HTMLElement>(`[data-change="${next}"]`);
    row?.scrollIntoView({ block: 'center' });
  }

  private onBodyClick(e: Event): void {
    const target = e.target as HTMLElement;
    const expand = target.closest<HTMLButtonElement>('.diff-expand');
    if (expand) {
      this.expandedSkips.add(Number(expand.dataset.oldStart));
      const top = this.body.scrollTop;
      this.renderBody();
      this.body.scrollTop = top;
      return;
    }
    const link = target.closest<HTMLButtonElement>('.diff-line-link');
    if (link?.dataset.path) {
      const line = Number(link.dataset.line);
      this.close();
      this.hooks.openLocation(link.dataset.path, line);
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, form')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'j') { e.preventDefault(); this.gotoChange(1); }
    else if (e.key === 'p' || e.key === 'k') { e.preventDefault(); this.gotoChange(-1); }
    else if (e.key === 'u') { e.preventDefault(); this.layout = this.layout === 'split' ? 'unified' : 'split'; writePref(LAYOUT_KEY, this.layout); this.renderBody(); }
    else if (e.key === 'Tab') this.trapFocus(e);
  }

  private trapFocus(e: KeyboardEvent): void {
    const focusables = Array.from(this.dialog.querySelectorAll<HTMLElement>('button:not([hidden]), select, input, [tabindex="0"]'))
      .filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // --- Baseline / export ---

  private updateBaselineButton(): void {
    const snapSide = this.oldSource?.kind === 'snapshot' && this.newSource?.kind === 'file' && this.oldSource.path === this.newSource.path;
    this.baselineBtn.hidden = !snapSide || !this.result || this.result.stats.changes === 0;
  }

  private markReviewed(): void {
    if (this.oldSource?.kind !== 'snapshot' || this.newSource?.kind !== 'file') return;
    // Store the unmasked current file, not the possibly masked display text.
    const path = this.newSource.path;
    void fetch(`/api/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        this.hooks.resetSnapshot(path, text);
        this.hooks.notify('現在の内容を確認済みにしました');
        void this.load();
      })
      .catch(() => this.hooks.notify('基準の更新に失敗しました'));
  }

  private patchText(): string {
    if (!this.result || !this.oldSource || !this.newSource) return '';
    const label = (src: DiffSource, prefix: string) =>
      src.kind === 'file' ? `${prefix}/${src.path}` : src.kind === 'git' ? `${prefix}/${src.path}\t(${src.rev})` : `${prefix}/${src.path}\t(snapshot)`;
    return toUnifiedPatch(this.result, label(this.oldSource, 'a'), label(this.newSource, 'b'));
  }

  private async copyPatch(): Promise<void> {
    const patch = this.patchText();
    if (!patch) { this.hooks.notify('差分がありません'); return; }
    try {
      await navigator.clipboard.writeText(patch);
      this.hooks.notify('パッチをコピーしました');
    } catch {
      this.hooks.notify('クリップボードにコピーできませんでした');
    }
  }

  private downloadPatch(): void {
    const patch = this.patchText();
    if (!patch) { this.hooks.notify('差分がありません'); return; }
    const blob = new Blob([patch], { type: 'text/x-diff;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName(this.newSource!.path).replace(/\.[^.]+$/, '') || 'diff'}.patch`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
