type TabSelectCallback = (path: string) => void;
type TabCloseCallback = (path: string) => void;

export interface Tab {
  path: string;
  name: string;
}

export class TabBar {
  private container: HTMLElement;
  private tabs: Tab[] = [];
  private activePath: string | null = null;
  private onSelect: TabSelectCallback;
  private onClose: TabCloseCallback;

  constructor(container: HTMLElement, onSelect: TabSelectCallback, onClose: TabCloseCallback) {
    this.container = container;
    this.onSelect = onSelect;
    this.onClose = onClose;
  }

  open(path: string) {
    if (!this.tabs.find((t) => t.path === path)) {
      const name = path.split('/').pop() || path;
      this.tabs.push({ path, name });
    }
    this.activePath = path;
    this.render();
  }

  close(path: string) {
    const idx = this.tabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);

    if (this.activePath === path) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activePath = next?.path || null;
      if (this.activePath) {
        this.onClose(this.activePath);
      } else {
        this.onClose('');
      }
    }
    this.render();
  }

  setActive(path: string) {
    this.activePath = path;
    this.render();
  }

  get count() {
    return this.tabs.length;
  }

  get active() {
    return this.activePath;
  }

  private dragSrcIdx = -1;

  private render() {
    if (this.tabs.length <= 1) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = '';
    this.container.innerHTML = this.tabs.map((tab) => {
      const isActive = tab.path === this.activePath;
      const safePath = this.escapeAttr(tab.path);
      return `<div class="tab-item ${isActive ? 'active' : ''}" data-path="${safePath}" title="${safePath}" draggable="true">
        <span class="tab-name">${this.escapeHtml(tab.name)}</span>
        <button class="tab-close" data-path="${safePath}" title="Close">&times;</button>
      </div>`;
    }).join('');

    const items = this.container.querySelectorAll<HTMLElement>('.tab-item');
    items.forEach((el, idx) => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tab-close')) return;
        const path = el.dataset.path;
        if (path && path !== this.activePath) {
          this.activePath = path;
          this.onSelect(path);
          this.render();
        }
      });

      // Drag & drop reorder
      el.addEventListener('dragstart', (e) => {
        this.dragSrcIdx = idx;
        el.classList.add('tab-dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('tab-dragging');
        this.container.querySelectorAll('.tab-drop-before, .tab-drop-after').forEach((d) => {
          d.classList.remove('tab-drop-before', 'tab-drop-after');
        });
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        el.classList.toggle('tab-drop-before', e.clientX < mid);
        el.classList.toggle('tab-drop-after', e.clientX >= mid);
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('tab-drop-before', 'tab-drop-after');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (this.dragSrcIdx < 0 || this.dragSrcIdx === idx) return;
        const rect = el.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        const targetIdx = e.clientX < mid ? idx : idx + 1;
        const [moved] = this.tabs.splice(this.dragSrcIdx, 1);
        const insertAt = targetIdx > this.dragSrcIdx ? targetIdx - 1 : targetIdx;
        this.tabs.splice(insertAt, 0, moved);
        this.dragSrcIdx = -1;
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>('.tab-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = btn.dataset.path;
        if (path) this.close(path);
      });
    });
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// --- Recent files (#15) ---
const RECENT_KEY = 'docview-recent';
const MAX_RECENT = 20;

export function addRecent(path: string) {
  const list = getRecent().filter((p) => p !== path);
  list.unshift(path);
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch { return []; }
}
