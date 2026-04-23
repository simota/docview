import { resolveLocator } from './locator';

const HISTORY_KEY = 'docview.urlBar.recent';
const HISTORY_MAX = 20;
const VALIDATE_DEBOUNCE_MS = 150;
const SUGGEST_FILES_LIMIT = 10;
const SUGGEST_RECENT_LIMIT = 5;

export type UrlBarTarget =
  | { kind: 'local'; path: string; line: number | null; lineEnd: number | null }
  | { kind: 'remote'; url: string };

type OpenCallback = (target: UrlBarTarget) => void;

interface RemoteInfo {
  enabled: boolean;
  allowPrivate: boolean;
  maxSizeBytes: number;
}

type SuggestionKind = 'file' | 'recent';

interface Suggestion {
  kind: SuggestionKind;
  // Entry is the literal string fed back into the input when selected.
  entry: string;
  // Display path (may equal entry; for hash entries, this is the parsed file path).
  display: string;
}

export class UrlBar {
  private overlay: HTMLElement;
  private dialog: HTMLElement;
  private inputRow: HTMLElement;
  private input: HTMLInputElement;
  private pasteBtn: HTMLButtonElement;
  private status: HTMLElement;
  private suggestList: HTMLElement;
  private onOpen: OpenCallback;
  private activeSuggestIdx = -1;
  private suggestions: Suggestion[] = [];

  // Lazy-loaded file index.
  private fileList: string[] = [];
  private fileListLoaded = false;
  private fileListLoading: Promise<void> | null = null;

  // Lazy-loaded remote capability info.
  private remoteInfo: RemoteInfo | null = null;
  private remoteInfoLoading: Promise<void> | null = null;

  // Live validation state.
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private validateAbort: AbortController | null = null;
  // Session-only existence cache to avoid repeat HEADs for the same path.
  private existsCache = new Map<string, boolean>();

  constructor(onOpen: OpenCallback) {
    this.onOpen = onOpen;

    this.overlay = document.createElement('div');
    this.overlay.className = 'url-bar-overlay';
    this.overlay.style.display = 'none';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Open by URL or path');

    this.dialog = document.createElement('div');
    this.dialog.className = 'url-bar-modal';

    const label = document.createElement('div');
    label.className = 'url-bar-label';
    label.textContent = 'Open URL or path';

    this.inputRow = document.createElement('div');
    this.inputRow.className = 'url-bar-input-row';

    this.input = document.createElement('input');
    this.input.className = 'url-bar-input';
    this.input.type = 'text';
    this.input.placeholder = 'e.g. docs/guide.md or #file=docs/api.md&line=42';
    this.input.setAttribute('aria-label', 'URL or path');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;

    this.pasteBtn = document.createElement('button');
    this.pasteBtn.type = 'button';
    this.pasteBtn.className = 'url-bar-paste';
    this.pasteBtn.title = 'Paste from clipboard';
    this.pasteBtn.setAttribute('aria-label', 'Paste from clipboard');
    this.pasteBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      </svg>
      <span>Paste</span>`;

    this.inputRow.appendChild(this.input);
    this.inputRow.appendChild(this.pasteBtn);

    this.status = document.createElement('div');
    this.status.className = 'url-bar-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.suggestList = document.createElement('div');
    this.suggestList.className = 'url-bar-suggest';

    const hint = document.createElement('div');
    hint.className = 'url-bar-hint';
    hint.innerHTML = '<kbd>↵</kbd> Open &nbsp; <kbd>↑↓</kbd> Navigate &nbsp; <kbd>Esc</kbd> Close';

    this.dialog.appendChild(label);
    this.dialog.appendChild(this.inputRow);
    this.dialog.appendChild(this.status);
    this.dialog.appendChild(this.suggestList);
    this.dialog.appendChild(hint);
    this.overlay.appendChild(this.dialog);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.input.addEventListener('input', () => {
      this.activeSuggestIdx = -1;
      this.renderSuggestions();
      this.scheduleValidate();
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.key === 'Enter') { e.preventDefault(); void this.submit(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateSuggest(e.key === 'ArrowDown' ? 1 : -1);
      }
    });

    this.pasteBtn.addEventListener('click', () => { void this.pasteFromClipboard(); });
  }

  open(): void {
    this.input.value = '';
    this.clearStatus();
    this.activeSuggestIdx = -1;
    this.cancelValidate();
    void this.ensureFileListLoaded();
    void this.ensureRemoteInfoLoaded();
    this.renderSuggestions();
    this.overlay.style.display = '';
    requestAnimationFrame(() => this.input.focus());
  }

  close(): void {
    this.cancelValidate();
    this.overlay.style.display = 'none';
  }

  get isOpen(): boolean {
    return this.overlay.style.display !== 'none';
  }

  // --- Clipboard ---

  private async pasteFromClipboard(): Promise<void> {
    try {
      if (!navigator.clipboard?.readText) {
        this.setWarn('Clipboard access unavailable — paste manually with Cmd+V');
        this.input.focus();
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) return;
      this.input.value = text.trim();
      this.input.focus();
      this.activeSuggestIdx = -1;
      this.renderSuggestions();
      this.scheduleValidate();
    } catch {
      this.setWarn('Clipboard permission denied — paste manually with Cmd+V');
      this.input.focus();
    }
  }

  // --- Live validation (debounced HEAD) ---

  private scheduleValidate(): void {
    this.cancelValidate();
    const raw = this.input.value.trim();
    if (!raw) { this.clearStatus(); return; }

    const result = resolveLocator(raw);
    if (result.kind === 'invalid') { this.setError(result.reason); return; }
    if (result.kind === 'remote') {
      if (this.remoteInfo?.enabled === false) {
        this.setError('Remote URLs are disabled on this server');
      } else {
        this.setInfo(`Remote: ${result.url}`);
      }
      return;
    }

    const suffix = result.line != null
      ? ` · line ${result.line}${result.lineEnd != null ? `–${result.lineEnd}` : ''}`
      : '';
    // Immediate optimistic line, confirmed by HEAD.
    this.setInfo(`Checking ${result.path}${suffix}...`);

    const cached = this.existsCache.get(result.path);
    if (cached === true) { this.setInfo(`${result.path}${suffix} ✓`); return; }
    if (cached === false) { this.setError(`File not found: ${result.path}`); return; }

    this.validateTimer = setTimeout(() => { void this.runValidate(result.path, suffix); }, VALIDATE_DEBOUNCE_MS);
  }

  private async runValidate(path: string, suffix: string): Promise<void> {
    this.validateAbort = new AbortController();
    const signal = this.validateAbort.signal;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'HEAD', signal });
      if (signal.aborted) return;
      const ok = res.ok;
      this.existsCache.set(path, ok);
      if (ok) this.setInfo(`${path}${suffix} ✓`);
      else this.setError(`File not found: ${path}`);
    } catch (err: unknown) {
      if (signal.aborted) return;
      if ((err as { name?: string })?.name === 'AbortError') return;
      this.setError(`Network error while checking ${path}`);
    }
  }

  private cancelValidate(): void {
    if (this.validateTimer) { clearTimeout(this.validateTimer); this.validateTimer = null; }
    if (this.validateAbort) { this.validateAbort.abort(); this.validateAbort = null; }
  }

  private clearStatus() { this.status.textContent = ''; this.status.className = 'url-bar-status'; }
  private setInfo(msg: string) { this.status.textContent = msg; this.status.className = 'url-bar-status url-bar-status-info'; }
  private setWarn(msg: string) { this.status.textContent = msg; this.status.className = 'url-bar-status url-bar-status-warn'; }
  private setError(msg: string) { this.status.textContent = msg; this.status.className = 'url-bar-status url-bar-status-error'; }

  // --- Submit ---

  private async submit(): Promise<void> {
    // If a suggestion is active, use its entry verbatim.
    if (this.activeSuggestIdx >= 0 && this.suggestions[this.activeSuggestIdx]) {
      this.input.value = this.suggestions[this.activeSuggestIdx].entry;
    }

    const raw = this.input.value.trim();
    if (!raw) return;

    const result = resolveLocator(raw);
    if (result.kind === 'invalid') { this.setError(result.reason); return; }

    if (result.kind === 'remote') {
      await this.ensureRemoteInfoLoaded();
      if (this.remoteInfo?.enabled === false) {
        this.setError('Remote URLs are disabled on this server');
        return;
      }
      this.pushHistory(raw);
      this.close();
      this.onOpen({ kind: 'remote', url: result.url });
      return;
    }

    const exists = await this.verifyPath(result.path);
    if (!exists) { this.setError(`File not found: ${result.path}`); return; }

    this.pushHistory(raw);
    this.close();
    this.onOpen({ kind: 'local', path: result.path, line: result.line, lineEnd: result.lineEnd });
  }

  private async verifyPath(path: string): Promise<boolean> {
    const cached = this.existsCache.get(path);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'HEAD' });
      this.existsCache.set(path, res.ok);
      return res.ok;
    } catch {
      return false;
    }
  }

  // --- History ---

  private getHistory(): string[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  }

  private pushHistory(entry: string): void {
    try {
      const existing = this.getHistory().filter((x) => x !== entry);
      existing.unshift(entry);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(existing.slice(0, HISTORY_MAX)));
    } catch { /* ignore */ }
  }

  // --- Remote info (lazy) ---

  private async ensureRemoteInfoLoaded(): Promise<void> {
    if (this.remoteInfo !== null) return;
    if (this.remoteInfoLoading) { await this.remoteInfoLoading; return; }
    this.remoteInfoLoading = (async () => {
      try {
        const res = await fetch('/api/info');
        if (!res.ok) return;
        const data = await res.json();
        this.remoteInfo = data.remote ?? { enabled: false, allowPrivate: false, maxSizeBytes: 0 };
      } catch {
        this.remoteInfo = { enabled: false, allowPrivate: false, maxSizeBytes: 0 };
      }
    })();
    await this.remoteInfoLoading;
  }

  // --- File list (lazy) ---

  private async ensureFileListLoaded(): Promise<void> {
    if (this.fileListLoaded) return;
    if (this.fileListLoading) { await this.fileListLoading; return; }
    this.fileListLoading = (async () => {
      try {
        const res = await fetch('/api/tree');
        if (!res.ok) return;
        const data = await res.json();
        this.fileList = flattenTree(data.tree);
        this.fileListLoaded = true;
      } catch { /* ignore — suggestions degrade to history only */ }
      finally {
        if (this.isOpen) this.renderSuggestions();
      }
    })();
    await this.fileListLoading;
  }

  // --- Suggestions ---

  private renderSuggestions(): void {
    const query = this.input.value.trim().toLowerCase();
    this.suggestions = this.buildSuggestions(query);

    if (this.suggestions.length === 0) { this.suggestList.innerHTML = ''; return; }

    const fileSuggestions = this.suggestions.filter((s) => s.kind === 'file');
    const recentSuggestions = this.suggestions.filter((s) => s.kind === 'recent');

    const sections: string[] = [];
    let globalIdx = 0;

    if (fileSuggestions.length > 0) {
      sections.push(`<div class="url-bar-suggest-title">Files</div>`);
      sections.push(fileSuggestions.map((s) => this.renderSuggestItem(s, globalIdx++)).join(''));
    }
    if (recentSuggestions.length > 0) {
      sections.push(`<div class="url-bar-suggest-title">Recent</div>`);
      sections.push(recentSuggestions.map((s) => this.renderSuggestItem(s, globalIdx++)).join(''));
    }

    this.suggestList.innerHTML = sections.join('');
    this.updateSuggestSelection();

    this.suggestList.querySelectorAll<HTMLButtonElement>('.url-bar-suggest-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx ?? -1);
        if (idx < 0) return;
        this.activeSuggestIdx = idx;
        void this.submit();
      });
    });
  }

  private buildSuggestions(query: string): Suggestion[] {
    const history = this.getHistory();

    if (!query) {
      return history.slice(0, SUGGEST_RECENT_LIMIT).map((entry) => ({
        kind: 'recent' as const,
        entry,
        display: entry,
      }));
    }

    const fileMatches = this.fileList
      .filter((p) => p.toLowerCase().includes(query))
      .slice(0, SUGGEST_FILES_LIMIT)
      .map((p) => ({ kind: 'file' as const, entry: p, display: p }));

    const recentMatches = history
      .filter((entry) => entry.toLowerCase().includes(query))
      .filter((entry) => !fileMatches.some((f) => f.entry === entry))
      .slice(0, SUGGEST_RECENT_LIMIT)
      .map((entry) => ({ kind: 'recent' as const, entry, display: entry }));

    return [...fileMatches, ...recentMatches];
  }

  private renderSuggestItem(s: Suggestion, idx: number): string {
    const icon = s.kind === 'file' ? '📄' : '↻';
    return `<button type="button" class="url-bar-suggest-item" data-idx="${idx}" tabindex="-1">
      <span class="url-bar-suggest-icon" aria-hidden="true">${icon}</span>
      <span class="url-bar-suggest-text">${escapeHtml(s.display)}</span>
    </button>`;
  }

  private navigateSuggest(dir: number): void {
    if (this.suggestions.length === 0) return;
    this.activeSuggestIdx = this.activeSuggestIdx < 0
      ? (dir > 0 ? 0 : this.suggestions.length - 1)
      : Math.max(0, Math.min(this.suggestions.length - 1, this.activeSuggestIdx + dir));
    this.updateSuggestSelection();
    const active = this.suggestions[this.activeSuggestIdx];
    if (active) {
      this.input.value = active.entry;
      this.scheduleValidate();
      this.suggestList.querySelectorAll<HTMLButtonElement>('.url-bar-suggest-item')[this.activeSuggestIdx]
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  private updateSuggestSelection(): void {
    const items = this.suggestList.querySelectorAll<HTMLButtonElement>('.url-bar-suggest-item');
    items.forEach((el, i) => el.classList.toggle('url-bar-suggest-item-active', i === this.activeSuggestIdx));
  }
}

function flattenTree(nodes: { name: string; path: string; type: string; children?: unknown[] }[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') result.push(node.path);
    if (node.type === 'dir' && Array.isArray(node.children)) {
      result.push(...flattenTree(node.children as typeof nodes));
    }
  }
  return result;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
