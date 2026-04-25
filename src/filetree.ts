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
type AlbumCallback = (path: string) => void;

// --- File type icons (#1, SVG) ---
const SVG_MARKDOWN = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="9" rx="1"/><line x1="3" y1="12.5" x2="11" y2="12.5"/><line x1="3.5" y1="5" x2="7" y2="5"/><line x1="3.5" y1="7" x2="10.5" y2="7"/></svg>`;
const SVG_JSON = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2C3 2 2 3 2 4v1.5c0 .8-.6 1.5-1.5 1.5C1.4 7 2 7.7 2 8.5V10c0 1 1 2 2 2"/><path d="M10 2c1 0 2 1 2 2v1.5c0 .8.6 1.5 1.5 1.5-.9 0-1.5.7-1.5 1.5V10c0 1-1 2-2 2"/></svg>`;
const SVG_YAML = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="3.5" x2="5" y2="3.5"/><circle cx="7" cy="3.5" r="0.8" fill="currentColor" stroke="none"/><line x1="2" y1="7" x2="5" y2="7"/><circle cx="7" cy="7" r="0.8" fill="currentColor" stroke="none"/><line x1="2" y1="10.5" x2="5" y2="10.5"/><circle cx="7" cy="10.5" r="0.8" fill="currentColor" stroke="none"/></svg>`;
const SVG_CSV = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="1.5" width="5" height="5" rx="0.5"/><rect x="7.5" y="1.5" width="5" height="5" rx="0.5"/><rect x="1.5" y="7.5" width="5" height="5" rx="0.5"/><rect x="7.5" y="7.5" width="5" height="5" rx="0.5"/></svg>`;
const SVG_TEXT = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="1.5" width="10" height="11" rx="1"/><line x1="4" y1="4.5" x2="10" y2="4.5"/><line x1="4" y1="7" x2="10" y2="7"/><line x1="4" y1="9.5" x2="7.5" y2="9.5"/></svg>`;
const SVG_CODE = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4.5,4 1.5,7 4.5,10"/><polyline points="9.5,4 12.5,7 9.5,10"/><line x1="6.5" y1="2.5" x2="7.5" y2="11.5"/></svg>`;
const SVG_MARKUP = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4,4 1.5,7 4,10"/><polyline points="10,4 12.5,7 10,10"/><line x1="5.5" y1="11" x2="8.5" y2="3"/></svg>`;
const SVG_IMAGE = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="9" rx="1"/><circle cx="4.5" cy="5.5" r="1"/><polyline points="1.5,9.5 5,6.5 7.5,8.5 9.5,6.5 12.5,9.5"/></svg>`;
const SVG_VIDEO = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3" width="11" height="8" rx="1"/><polygon points="6,5.5 6,8.5 9,7" fill="currentColor" stroke="none"/></svg>`;
const SVG_DEFAULT = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5h5l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><polyline points="8,1.5 8,4.5 11,4.5"/></svg>`;

const EXT_MAP: Record<string, { category: string; svg: string }> = {
  md:         { category: 'markdown', svg: SVG_MARKDOWN },
  markdown:   { category: 'markdown', svg: SVG_MARKDOWN },
  mdx:        { category: 'markdown', svg: SVG_MARKDOWN },
  txt:        { category: 'default',  svg: SVG_TEXT },
  json:       { category: 'data',     svg: SVG_JSON },
  yaml:       { category: 'config',   svg: SVG_YAML },
  yml:        { category: 'config',   svg: SVG_YAML },
  toml:       { category: 'config',   svg: SVG_YAML },
  ini:        { category: 'config',   svg: SVG_YAML },
  conf:       { category: 'config',   svg: SVG_YAML },
  env:        { category: 'config',   svg: SVG_YAML },
  cfg:        { category: 'config',   svg: SVG_YAML },
  properties: { category: 'config',   svg: SVG_YAML },
  csv:        { category: 'data',     svg: SVG_CSV },
  tsv:        { category: 'data',     svg: SVG_CSV },
  js:         { category: 'data',     svg: SVG_CODE },
  ts:         { category: 'data',     svg: SVG_CODE },
  jsx:        { category: 'data',     svg: SVG_CODE },
  tsx:        { category: 'data',     svg: SVG_CODE },
  html:       { category: 'config',   svg: SVG_MARKUP },
  css:        { category: 'config',   svg: SVG_MARKUP },
  png:        { category: 'image',    svg: SVG_IMAGE },
  jpg:        { category: 'image',    svg: SVG_IMAGE },
  jpeg:       { category: 'image',    svg: SVG_IMAGE },
  gif:        { category: 'image',    svg: SVG_IMAGE },
  svg:        { category: 'image',    svg: SVG_IMAGE },
  webp:       { category: 'image',    svg: SVG_IMAGE },
  bmp:        { category: 'image',    svg: SVG_IMAGE },
  ico:        { category: 'image',    svg: SVG_IMAGE },
  mp4:        { category: 'video',    svg: SVG_VIDEO },
  m4v:        { category: 'video',    svg: SVG_VIDEO },
  webm:       { category: 'video',    svg: SVG_VIDEO },
  ogv:        { category: 'video',    svg: SVG_VIDEO },
  mov:        { category: 'video',    svg: SVG_VIDEO },
};

export function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const info = EXT_MAP[ext] ?? { category: 'default', svg: SVG_DEFAULT };
  return `<span class="file-icon file-icon--${info.category}">${info.svg}</span>`;
}

const ICON_DIR_CLOSED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const ICON_DIR_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ICON_CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const ICON_ALBUM = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;

// Image extensions matching server.mjs IMAGE_EXTENSIONS
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);
// Video extensions matching server.mjs VIDEO_EXTENSIONS (.mkv intentionally excluded)
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);

function classifyMediaExt(name: string): 'image' | 'video' | null {
  const ext = '.' + (name.split('.').pop()?.toLowerCase() ?? '');
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

function buildGalleryButtonAttrs(imageCount: number, videoCount: number, dirName: string): { title: string; ariaLabel: string; total: number } {
  const total = imageCount + videoCount;
  let title: string;
  if (videoCount === 0) {
    title = `Album view (${imageCount} images)`;
  } else if (imageCount === 0) {
    title = `Gallery view (${videoCount} videos)`;
  } else {
    title = `Gallery view (${total} items: ${imageCount} images, ${videoCount} videos)`;
  }
  return {
    title,
    ariaLabel: `${title} for ${dirName}`,
    total,
  };
}

export class FileTree {
  private container: HTMLElement;
  private rootLabel: HTMLElement;
  private filterInput: HTMLInputElement;
  private treeList: HTMLElement;
  private onSelect: FileSelectCallback;
  private onAlbum: AlbumCallback | null;
  private activePath: string | null = null;
  private openDirs = new Set<string>();
  private treeData: FileNode[] = [];
  private filterQuery = '';

  constructor(container: HTMLElement, onSelect: FileSelectCallback, onAlbum: AlbumCallback | null = null) {
    this.container = container;
    this.onSelect = onSelect;
    this.onAlbum = onAlbum;

    this.rootLabel = document.createElement('div');
    this.rootLabel.className = 'filetree-root';
    this.rootLabel.setAttribute('role', 'heading');
    this.rootLabel.setAttribute('aria-level', '2');

    this.filterInput = document.createElement('input');
    this.filterInput.className = 'filetree-filter';
    this.filterInput.type = 'text';
    this.filterInput.placeholder = 'Filter files...';
    this.filterInput.addEventListener('input', () => {
      this.filterQuery = this.filterInput.value.toLowerCase();
      this.renderTree(this.filterQuery ? this.filterTree(this.treeData, this.filterQuery) : this.treeData, this.treeList, 0);
    });

    this.treeList = document.createElement('div');
    this.treeList.className = 'filetree-list';
    this.treeList.setAttribute('role', 'tree');

    this.container.appendChild(this.rootLabel);
    this.container.appendChild(this.filterInput);
    this.container.appendChild(this.treeList);
  }

  private filterTree(nodes: FileNode[], query: string): FileNode[] {
    const result: FileNode[] = [];
    for (const node of nodes) {
      if (node.type === 'file') {
        if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
          result.push(node);
        }
      } else if (node.children) {
        const filtered = this.filterTree(node.children, query);
        if (filtered.length > 0) {
          result.push({ ...node, children: filtered });
        }
      }
    }
    return result;
  }

  async load(): Promise<void> {
    try {
      const res = await fetch('/api/tree');
      if (!res.ok) return;
      const data: TreeResponse = await res.json();
      this.rootLabel.textContent = data.root;
      this.treeData = data.tree;
      const display = this.filterQuery ? this.filterTree(this.treeData, this.filterQuery) : this.treeData;
      this.renderTree(display, this.treeList, 0);
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

        // Count media (image + video) files in this directory (direct children only).
        // Phase 1: directly counts both kinds and renders one button. Phase 2 may
        // diverge based on dominant kind.
        let imageCount = 0;
        let videoCount = 0;
        if (node.children) {
          for (const c of node.children) {
            if (c.type !== 'file') continue;
            const kind = classifyMediaExt(c.name);
            if (kind === 'image') imageCount++;
            else if (kind === 'video') videoCount++;
          }
        }
        const mediaCount = imageCount + videoCount;

        const albumBtnHtml = mediaCount > 0 && this.onAlbum
          ? (() => {
              const meta = buildGalleryButtonAttrs(imageCount, videoCount, node.name);
              return `<button class="filetree-album-btn" title="${esc(meta.title)}" aria-label="${esc(meta.ariaLabel)}">${ICON_ALBUM}<span class="filetree-album-count">${mediaCount}</span></button>`;
            })()
          : '';

        const renderDirInner = (open: boolean) =>
          `<span class="filetree-chevron ${open ? 'open' : ''}">${ICON_CHEVRON}</span>${open ? ICON_DIR_OPEN : ICON_DIR_CLOSED}<span class="filetree-name">${esc(node.name)}</span>${albumBtnHtml}`;

        item.innerHTML = renderDirInner(isOpen);

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'filetree-children';
        childrenContainer.setAttribute('role', 'group');
        childrenContainer.style.display = isOpen ? '' : 'none';

        if (isOpen && node.children) {
          this.renderTree(node.children, childrenContainer, depth + 1);
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          // Album button click — handled by its own listener, don't toggle dir
          if ((e.target as HTMLElement).closest('.filetree-album-btn')) return;
          const toggled = !this.openDirs.has(node.path);
          if (toggled) this.openDirs.add(node.path); else this.openDirs.delete(node.path);
          item.setAttribute('aria-expanded', String(toggled));
          item.innerHTML = renderDirInner(toggled);
          childrenContainer.style.display = toggled ? '' : 'none';
          if (toggled && node.children) {
            this.renderTree(node.children, childrenContainer, depth + 1);
          }
          // Re-wire album button after re-render
          item.querySelector('.filetree-album-btn')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.onAlbum?.(node.path);
          });
        });

        // Wire album button
        if (mediaCount > 0 && this.onAlbum) {
          item.querySelector('.filetree-album-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onAlbum?.(node.path);
          });
        }

        parent.appendChild(item);
        parent.appendChild(childrenContainer);
      } else {
        item.innerHTML = `<span class="filetree-chevron-spacer"></span>${fileIcon(node.name)}<span class="filetree-name">${esc(node.name)}</span>`;
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
