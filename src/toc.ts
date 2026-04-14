type FileSelectCallback = (path: string) => void;

interface Backlink {
  path: string;
  line: number;
}

export class TableOfContents {
  private container: HTMLElement;
  private viewer: HTMLElement;
  private onFileSelect: FileSelectCallback | null = null;

  constructor(container: HTMLElement, viewer: HTMLElement) {
    this.container = container;
    this.viewer = viewer;
  }

  setFileSelectCallback(cb: FileSelectCallback) {
    this.onFileSelect = cb;
  }

  update() {
    const headings = this.viewer.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
    if (headings.length === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = '';
    let html = '<div class="toc-title">Contents</div><nav class="toc-nav">';

    headings.forEach((h) => {
      const level = parseInt(h.tagName[1]);
      const id = h.id || h.querySelector('.header-anchor')?.parentElement?.id || '';
      const text = h.textContent?.replace(/^#\s*/, '').trim() || '';
      if (!text) return;
      const safeId = id.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<a class="toc-link toc-level-${level}" href="#${safeId}" data-target="${safeId}">${safeText}</a>`;
    });

    html += '</nav>';
    // Backlinks container (populated async)
    html += '<div class="backlinks-section" id="backlinks-section"></div>';
    this.container.innerHTML = html;

    // Click handler — smooth scroll
    this.container.querySelectorAll<HTMLAnchorElement>('.toc-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.dataset.target;
        if (!targetId) return;
        const target = this.viewer.querySelector(`#${CSS.escape(targetId)}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          this.setActive(link);
        }
      });
    });
  }

  async loadBacklinks(filePath: string) {
    const section = this.container.querySelector('#backlinks-section');
    if (!section) return;
    try {
      const res = await fetch(`/api/backlinks?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) return;
      const backlinks: Backlink[] = await res.json();
      if (backlinks.length === 0) {
        section.innerHTML = '';
        return;
      }
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      section.innerHTML = `<div class="backlinks-title">Backlinks</div><nav class="backlinks-nav">${
        backlinks.map((b) =>
          `<a class="backlink-item" href="#" data-path="${escAttr(b.path)}" title="Line ${b.line}">${esc(b.path)}</a>`
        ).join('')
      }</nav>`;
      section.querySelectorAll<HTMLAnchorElement>('.backlink-item').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const path = a.dataset.path;
          if (path && this.onFileSelect) this.onFileSelect(path);
        });
      });
    } catch { /* ignore */ }
  }

  private setActive(active: HTMLElement) {
    this.container.querySelectorAll('.toc-link.active').forEach((el) => el.classList.remove('active'));
    active.classList.add('active');
  }

  clear() {
    this.container.innerHTML = '';
    this.container.style.display = 'none';
  }
}
