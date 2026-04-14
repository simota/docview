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

    const modal = document.createElement('div');
    modal.className = 'search-modal';

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

  open(mode: 'files' | 'fulltext' = 'files') {
    this.mode = mode;
    this.input.placeholder = mode === 'fulltext'
      ? 'Search content across all files...'
      : 'Search files by name...';
    this.input.value = '';
    this.results.innerHTML = '';
    this.regexToggle.style.display = mode === 'fulltext' ? '' : 'none';
    this.overlay.style.display = '';
    requestAnimationFrame(() => this.input.focus());

    if (mode === 'files') this.loadFileList();
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
