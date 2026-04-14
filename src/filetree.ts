export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

interface TreeResponse {
  root: string;
  path: string;
  tree: FileNode[];
}

type FileSelectCallback = (path: string) => void;

// --- File type icons (#1) ---
function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, { color: string; label: string }> = {
    md: { color: '#6366f1', label: 'M' }, markdown: { color: '#6366f1', label: 'M' },
    mdx: { color: '#6366f1', label: 'M' }, txt: { color: '#8e91ab', label: 'T' },
    json: { color: '#22c55e', label: '{}' },
    yaml: { color: '#f59e0b', label: 'Y' }, yml: { color: '#f59e0b', label: 'Y' },
    toml: { color: '#d97706', label: 'T' },
    ini: { color: '#d97706', label: 'I' }, conf: { color: '#d97706', label: 'C' },
    env: { color: '#d97706', label: 'E' }, cfg: { color: '#d97706', label: 'C' },
    properties: { color: '#d97706', label: 'P' },
    csv: { color: '#22c55e', label: ',' }, tsv: { color: '#22c55e', label: ',' },
    png: { color: '#ec4899', label: '◻' }, jpg: { color: '#ec4899', label: '◻' },
    jpeg: { color: '#ec4899', label: '◻' }, gif: { color: '#ec4899', label: '◻' },
    svg: { color: '#ec4899', label: '◻' }, webp: { color: '#ec4899', label: '◻' },
    bmp: { color: '#ec4899', label: '◻' }, ico: { color: '#ec4899', label: '◻' },
  };
  const info = icons[ext] || { color: '#8e91ab', label: '?' };
  return `<span class="file-icon" style="color:${info.color}" aria-hidden="true">${info.label}</span>`;
}

const ICON_DIR_CLOSED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const ICON_DIR_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
const ICON_CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

export class FileTree {
  private container: HTMLElement;
  private rootLabel: HTMLElement;
  private treeList: HTMLElement;
  private onSelect: FileSelectCallback;
  private activePath: string | null = null;
  private openDirs = new Set<string>();

  constructor(container: HTMLElement, onSelect: FileSelectCallback) {
    this.container = container;
    this.onSelect = onSelect;

    this.rootLabel = document.createElement('div');
    this.rootLabel.className = 'filetree-root';
    this.rootLabel.setAttribute('role', 'heading');
    this.rootLabel.setAttribute('aria-level', '2');

    this.treeList = document.createElement('div');
    this.treeList.className = 'filetree-list';
    this.treeList.setAttribute('role', 'tree');

    this.container.appendChild(this.rootLabel);
    this.container.appendChild(this.treeList);
  }

  async load(): Promise<void> {
    try {
      const res = await fetch('/api/tree');
      if (!res.ok) return;
      const data: TreeResponse = await res.json();
      this.rootLabel.textContent = data.root;
      this.renderTree(data.tree, this.treeList, 0);
    } catch {
      this.container.style.display = 'none';
    }
  }

  private renderTree(nodes: FileNode[], parent: HTMLElement, depth: number) {
    parent.innerHTML = '';
    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = 'filetree-item';
      item.dataset.path = node.path;
      item.dataset.type = node.type;
      item.style.paddingLeft = `${12 + depth * 16}px`;
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-label', node.name);

      if (node.type === 'dir') {
        const isOpen = this.openDirs.has(node.path);
        item.setAttribute('aria-expanded', String(isOpen));
        item.innerHTML = `<span class="filetree-chevron ${isOpen ? 'open' : ''}">${ICON_CHEVRON}</span>${isOpen ? ICON_DIR_OPEN : ICON_DIR_CLOSED}<span class="filetree-name">${node.name}</span>`;

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'filetree-children';
        childrenContainer.setAttribute('role', 'group');
        childrenContainer.style.display = isOpen ? '' : 'none';

        if (isOpen && node.children) {
          this.renderTree(node.children, childrenContainer, depth + 1);
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const toggled = !this.openDirs.has(node.path);
          if (toggled) this.openDirs.add(node.path); else this.openDirs.delete(node.path);
          item.setAttribute('aria-expanded', String(toggled));
          item.innerHTML = `<span class="filetree-chevron ${toggled ? 'open' : ''}">${ICON_CHEVRON}</span>${toggled ? ICON_DIR_OPEN : ICON_DIR_CLOSED}<span class="filetree-name">${node.name}</span>`;
          childrenContainer.style.display = toggled ? '' : 'none';
          if (toggled && node.children) {
            this.renderTree(node.children, childrenContainer, depth + 1);
          }
        });

        parent.appendChild(item);
        parent.appendChild(childrenContainer);
      } else {
        item.innerHTML = `<span class="filetree-chevron-spacer"></span>${fileIcon(node.name)}<span class="filetree-name">${node.name}</span>`;
        if (this.activePath === node.path) {
          item.classList.add('active');
          item.setAttribute('aria-selected', 'true');
        }
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setActive(node.path);
          this.onSelect(node.path);
        });
        parent.appendChild(item);
      }
    }
  }

  setActive(path: string) {
    this.activePath = path;
    this.container.querySelectorAll('.filetree-item[aria-selected]').forEach((el) => {
      el.removeAttribute('aria-selected');
      el.classList.remove('active');
    });
    const el = this.container.querySelector(`.filetree-item[data-path="${CSS.escape(path)}"][data-type="file"]`);
    if (el) {
      el.classList.add('active');
      el.setAttribute('aria-selected', 'true');
    }
  }

  refresh() {
    this.load();
  }
}

// --- Sidebar resize (#5) ---
export function initSidebarResize(sidebar: HTMLElement) {
  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Resize sidebar');
  sidebar.appendChild(handle);

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(500, startWidth + ev.clientX - startX));
      sidebar.style.width = `${newWidth}px`;
      sidebar.style.minWidth = `${newWidth}px`;
      sidebar.style.maxWidth = `${newWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
