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

  private render() {
    if (this.tabs.length <= 1) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = '';
    this.container.innerHTML = this.tabs.map((tab) => {
      const isActive = tab.path === this.activePath;
      return `<div class="tab-item ${isActive ? 'active' : ''}" data-path="${tab.path}" title="${tab.path}">
        <span class="tab-name">${this.escapeHtml(tab.name)}</span>
        <button class="tab-close" data-path="${tab.path}" title="Close">&times;</button>
      </div>`;
    }).join('');

    this.container.querySelectorAll<HTMLElement>('.tab-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tab-close')) return;
        const path = el.dataset.path;
        if (path && path !== this.activePath) {
          this.activePath = path;
          this.onSelect(path);
          this.render();
        }
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
