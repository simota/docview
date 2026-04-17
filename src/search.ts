type FileSelectCallback = (path: string) => void;

interface SearchResult {
  path: string;
  line: number;
  text: string;
}

export class SearchModal {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private results: HTMLElement;
  private regexToggle: HTMLButtonElement;
  private tabFiles: HTMLButtonElement;
  private tabFulltext: HTMLButtonElement;
  private onSelect: FileSelectCallback;
  private mode: 'files' | 'fulltext' = 'files';
  private useRegex = false;
  private fileList: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onSelect: FileSelectCallback) {
    this.onSelect = onSelect;

    this.overlay = document.createElement('div');
    this.overlay.className = 'search-overlay';
    this.overlay.style.display = 'none';

    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Search');

    const modal = document.createElement('div');
    modal.className = 'search-modal';

    // Mode tabs
    const tabList = document.createElement('div');
    tabList.className = 'search-tab-list';
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Search mode');

    this.tabFiles = document.createElement('button');
    this.tabFiles.className = 'search-tab active';
    this.tabFiles.textContent = 'Files';
    this.tabFiles.setAttribute('role', 'tab');
    this.tabFiles.setAttribute('aria-selected', 'true');
    this.tabFiles.addEventListener('click', () => this.switchMode('files'));

    this.tabFulltext = document.createElement('button');
    this.tabFulltext.className = 'search-tab';
    this.tabFulltext.textContent = 'Full text';
    this.tabFulltext.setAttribute('role', 'tab');
    this.tabFulltext.setAttribute('aria-selected', 'false');
    this.tabFulltext.addEventListener('click', () => this.switchMode('fulltext'));

    // Arrow key navigation between tabs
    tabList.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = this.mode === 'files' ? 'fulltext' : 'files';
        this.switchMode(next);
        (next === 'files' ? this.tabFiles : this.tabFulltext).focus();
      }
    });

    tabList.appendChild(this.tabFiles);
    tabList.appendChild(this.tabFulltext);

    const inputRow = document.createElement('div');
    inputRow.className = 'search-input-row';

    this.input = document.createElement('input');
    this.input.className = 'search-input';
    this.input.placeholder = 'Search files... (Shift for full-text)';
    this.input.type = 'text';

    this.regexToggle = document.createElement('button');
    this.regexToggle.className = 'search-regex-toggle';
    this.regexToggle.textContent = '.*';
    this.regexToggle.title = 'Toggle regex search';
    this.regexToggle.addEventListener('click', () => {
      this.useRegex = !this.useRegex;
      this.regexToggle.classList.toggle('active', this.useRegex);
      if (this.input.value.trim()) this.search();
    });

    this.results = document.createElement('div');
    this.results.className = 'search-results';

    inputRow.appendChild(this.input);
    inputRow.appendChild(this.regexToggle);
    modal.appendChild(tabList);
    modal.appendChild(inputRow);
    modal.appendChild(this.results);
    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.input.addEventListener('input', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.search(), this.mode === 'fulltext' ? 300 : 50);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      // Shift key toggles mode (backward compat)
      if (e.key === 'Shift') {
        this.switchMode(this.mode === 'files' ? 'fulltext' : 'files');
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigate(e.key === 'ArrowDown' ? 1 : -1);
      }
      if (e.key === 'Enter') {
        const active = this.results.querySelector('.search-item.active') as HTMLElement;
        if (active?.dataset.path) {
          this.onSelect(active.dataset.path);
          this.close();
        }
      }
    });
  }

  private switchMode(mode: 'files' | 'fulltext') {
    this.mode = mode;
    this.input.placeholder = mode === 'fulltext'
      ? 'Search content across all files...'
      : 'Search files by name...';
    this.regexToggle.style.display = mode === 'fulltext' ? '' : 'none';
    this.overlay.setAttribute('aria-label', mode === 'fulltext' ? 'Full-text search' : 'Search files');
    this.tabFiles.classList.toggle('active', mode === 'files');
    this.tabFiles.setAttribute('aria-selected', String(mode === 'files'));
    this.tabFulltext.classList.toggle('active', mode === 'fulltext');
    this.tabFulltext.setAttribute('aria-selected', String(mode === 'fulltext'));
    if (this.input.value.trim()) this.search();
    if (mode === 'files') this.loadFileList();
  }

  open(mode: 'files' | 'fulltext' = 'files') {
    this.input.value = '';
    this.results.innerHTML = '';
    this.overlay.style.display = '';
    this.switchMode(mode);
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    this.overlay.style.display = 'none';
    this.input.value = '';
    this.results.innerHTML = '';
  }

  get isOpen() {
    return this.overlay.style.display !== 'none';
  }

  private async loadFileList() {
    try {
      const res = await fetch('/api/tree');
      if (!res.ok) return;
      const data = await res.json();
      this.fileList = this.flattenTree(data.tree);
    } catch { /* ignore */ }
  }

  private flattenTree(nodes: { name: string; path: string; type: string; children?: unknown[] }[]): string[] {
    const result: string[] = [];
    for (const node of nodes) {
      if (node.type === 'file') result.push(node.path);
      if (node.type === 'dir' && Array.isArray(node.children)) {
        result.push(...this.flattenTree(node.children as typeof nodes));
      }
    }
    return result;
  }

  private async search() {
    const query = this.input.value.trim();
    if (!query) {
      this.results.innerHTML = '';
      return;
    }

    if (this.mode === 'fulltext') {
      await this.searchFullText(query);
    } else {
      this.searchFiles(query);
    }
  }

  private searchFiles(query: string) {
    const lower = query.toLowerCase();
    const matches = this.fileList
      .filter((p) => p.toLowerCase().includes(lower))
      .slice(0, 20);

    this.results.innerHTML = matches
      .map((p, i) => `<div class="search-item ${i === 0 ? 'active' : ''}" data-path="${this.escapeAttr(p)}"><span class="search-icon">📄</span><span class="search-path">${this.highlight(p, query)}</span></div>`)
      .join('') || '<div class="search-empty">No files found</div>';

    this.bindClicks();
  }

  private async searchFullText(query: string) {
    try {
      const regexParam = this.useRegex ? '&regex=1' : '';
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}${regexParam}`);
      if (!res.ok) return;
      const results: SearchResult[] = await res.json();

      this.results.innerHTML = results.length
        ? results.map((r, i) =>
          `<div class="search-item ${i === 0 ? 'active' : ''}" data-path="${this.escapeAttr(r.path)}"><span class="search-icon">📄</span><div class="search-detail"><span class="search-path">${this.escapeHtml(r.path)}<span class="search-line">:${r.line}</span></span><span class="search-text">${this.escapeHtml(r.text.trim())}</span></div></div>`
        ).join('')
        : '<div class="search-empty">No results found</div>';

      this.bindClicks();
    } catch { /* ignore */ }
  }

  private highlight(text: string, query: string): string {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return this.escapeHtml(text);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return `${this.escapeHtml(before)}<mark>${this.escapeHtml(match)}</mark>${this.escapeHtml(after)}`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private bindClicks() {
    this.results.querySelectorAll<HTMLElement>('.search-item').forEach((item) => {
      item.addEventListener('click', () => {
        if (item.dataset.path) {
          this.onSelect(item.dataset.path);
          this.close();
        }
      });
    });
  }

  private navigate(dir: number) {
    const items = Array.from(this.results.querySelectorAll('.search-item'));
    const activeIdx = items.findIndex((el) => el.classList.contains('active'));
    const nextIdx = Math.max(0, Math.min(items.length - 1, activeIdx + dir));
    items.forEach((el) => el.classList.remove('active'));
    items[nextIdx]?.classList.add('active');
    items[nextIdx]?.scrollIntoView({ block: 'nearest' });
  }
}
