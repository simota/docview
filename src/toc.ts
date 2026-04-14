export class TableOfContents {
  private container: HTMLElement;
  private viewer: HTMLElement;

  constructor(container: HTMLElement, viewer: HTMLElement) {
    this.container = container;
    this.viewer = viewer;
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
      html += `<a class="toc-link toc-level-${level}" href="#${id}" data-target="${id}">${text}</a>`;
    });

    html += '</nav>';
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

  private setActive(active: HTMLElement) {
    this.container.querySelectorAll('.toc-link.active').forEach((el) => el.classList.remove('active'));
    active.classList.add('active');
  }

  clear() {
    this.container.innerHTML = '';
    this.container.style.display = 'none';
  }
}
