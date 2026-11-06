import { fetchLinkCheck } from './link-report';

type FileSelectCallback = (path: string) => void;
type LocationCallback = (path: string, line: number) => void;

interface Backlink {
  path: string;
  line: number;
}

export class TableOfContents {
  private container: HTMLElement;
  private viewer: HTMLElement;
  private onFileSelect: FileSelectCallback | null = null;
  private onLocation: LocationCallback | null = null;
  private onLinkReport: ((scope: string) => void) | null = null;
  private brokenSeq = 0;

  constructor(container: HTMLElement, viewer: HTMLElement) {
    this.container = container;
    this.viewer = viewer;
  }

  setFileSelectCallback(cb: FileSelectCallback) {
    this.onFileSelect = cb;
  }

  /** Hooks for the broken-links section: jump to a line / open the full report. */
  setLinkCallbacks(onLocation: LocationCallback, onLinkReport: (scope: string) => void) {
    this.onLocation = onLocation;
    this.onLinkReport = onLinkReport;
  }

  update() {
    const headings = this.viewer.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
    if (headings.length === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = '';
    let html = '<div class="toc-header"><span class="toc-title">Contents</span><button class="toc-close-btn" aria-label="Close TOC" title="Close TOC (Cmd+J)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button></div><nav class="toc-nav">';

    headings.forEach((h) => {
      const level = parseInt(h.tagName[1]);
      const id = h.id || h.querySelector('.header-anchor')?.parentElement?.id || '';
      const text = h.textContent?.replace(/^#\s*/, '').trim() || '';
      if (!text) return;
      const safeId = id.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<a class="toc-link toc-level-${level}" href="#${safeId}" data-target="${safeId}">${safeText}</a>`;
    });

    html += '</nav>';
    // Backlinks container (populated async)
    html += '<div class="backlinks-section" id="backlinks-section"></div>';
    html += '<div class="backlinks-section brokenlinks-section" id="brokenlinks-section"></div>';
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

  /** List this document's relative links whose targets are missing. */
  async loadBrokenLinks(filePath: string) {
    const seq = ++this.brokenSeq;
    const section = this.container.querySelector('#brokenlinks-section');
    if (!section) return;
    try {
      const result = await fetchLinkCheck(filePath);
      if (seq !== this.brokenSeq || !section.isConnected) return;
      if (result.broken.length === 0) {
        section.innerHTML = '';
        return;
      }
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      section.innerHTML = `<div class="backlinks-title brokenlinks-title">Broken links (${result.broken.length})</div><nav class="backlinks-nav">${
        result.broken.map((b) =>
          `<a class="backlink-item brokenlink-item" href="#" data-line="${b.line}" title="${esc(b.target ?? b.link)} が見つかりません">L${b.line} ${esc(b.link)}</a>`
        ).join('')
      }<a class="backlink-item brokenlink-report" href="#">すべての文書をチェック…</a></nav>`;
      section.querySelectorAll<HTMLAnchorElement>('.brokenlink-item').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this.onLocation?.(filePath, Number(a.dataset.line));
        });
      });
      section.querySelector('.brokenlink-report')?.addEventListener('click', (e) => {
        e.preventDefault();
        this.onLinkReport?.('');
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
