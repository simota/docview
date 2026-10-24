export class FindBar {
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private info: HTMLSpanElement;
  private viewer: HTMLElement;
  private matches: Range[] = [];
  private currentIdx = -1;
  private isOpen = false;

  constructor(viewer: HTMLElement) {
    this.viewer = viewer;

    this.bar = document.createElement('div');
    this.bar.className = 'find-bar';
    this.bar.style.display = 'none';
    this.bar.innerHTML = `
      <span class="find-slash">/</span>
      <input class="find-input" type="text" placeholder="Search in document..." />
      <span class="find-info"></span>
      <button class="find-btn find-prev" title="Previous (Shift+Enter)">&#8593;</button>
      <button class="find-btn find-next" title="Next (Enter)">&#8595;</button>
      <button class="find-btn find-close" title="Close (Esc)">&times;</button>
    `;

    this.input = this.bar.querySelector('.find-input') as HTMLInputElement;
    this.info = this.bar.querySelector('.find-info') as HTMLSpanElement;

    // Events
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (e) => {
      // Enter/Escape that commit or cancel an IME conversion are not ours (Safari
      // reports the committing Enter with isComposing=false but keyCode 229).
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); this.prev(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.next(); }
      else if (e.key === 'Escape') { this.close(); }
    });
    this.bar.querySelector('.find-next')!.addEventListener('click', () => this.next());
    this.bar.querySelector('.find-prev')!.addEventListener('click', () => this.prev());
    this.bar.querySelector('.find-close')!.addEventListener('click', () => this.close());
    // Hidden Tree/Source halves are excluded from matches, so re-run the query
    // once a toggle (whose own listener has already swapped views) reveals the other.
    viewer.addEventListener('click', (e) => {
      if (this.isOpen && this.input.value && (e.target as Element | null)?.closest('.json-toggle-btn')) this.search();
    });

    // Insert into viewer's parent
    viewer.parentElement!.insertBefore(this.bar, viewer);
  }

  open() {
    if (this.isOpen) {
      this.input.select();
      return;
    }
    this.isOpen = true;
    this.bar.style.display = '';
    this.input.value = '';
    this.info.textContent = '';
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    this.isOpen = false;
    this.bar.style.display = 'none';
    this.clearHighlights();
    this.input.value = '';
    this.matches = [];
    this.currentIdx = -1;
  }

  get active() {
    return this.isOpen;
  }

  private search() {
    this.clearHighlights();
    const query = this.input.value;
    if (!query) {
      this.info.textContent = '';
      this.matches = [];
      this.currentIdx = -1;
      return;
    }

    this.matches = this.findAllMatches(query);
    if (this.matches.length === 0) {
      this.info.textContent = 'No matches';
      this.info.classList.add('no-match');
      this.currentIdx = -1;
      return;
    }

    this.info.classList.remove('no-match');
    this.highlightAll();
    this.currentIdx = 0;
    this.scrollToCurrent();
    this.updateInfo();
  }

  private findAllMatches(query: string): Range[] {
    const ranges: Range[] = [];
    // Case-insensitive matching on the original text: indices from a
    // lower-cased copy drift when lower-casing changes length (e.g. "İ").
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    // Skip the inactive half of a Tree/Source toggle: every view renders both,
    // so counting the hidden copy doubles the total and next/prev land on
    // invisible text.
    const walker = document.createTreeWalker(this.viewer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const view = node.parentElement?.closest<HTMLElement>('.json-view-tree, .json-view-source');
        return view?.style.display === 'none' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || '';
      for (const match of text.matchAll(pattern)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        ranges.push(range);
      }
    }
    return ranges;
  }

  private highlightAll() {
    // Use CSS custom highlight API if available, otherwise use mark elements
    if ('Highlight' in window && CSS.highlights) {
      const highlight = new Highlight(...this.matches);
      CSS.highlights.set('find-highlight', highlight);
    } else {
      // Fallback: wrap matches in <mark> (reverse order to preserve positions)
      for (let i = this.matches.length - 1; i >= 0; i--) {
        const range = this.matches[i];
        const mark = document.createElement('mark');
        mark.className = 'find-match';
        try {
          range.surroundContents(mark);
        } catch {
          // Range spans multiple elements — skip
        }
      }
      // Re-collect marks as the ranges are now invalidated
      this.matches = [];
      this.viewer.querySelectorAll('mark.find-match').forEach((m) => {
        const range = document.createRange();
        range.selectNodeContents(m);
        this.matches.push(range);
      });
    }
  }

  private clearHighlights() {
    if ('Highlight' in window && CSS.highlights) {
      CSS.highlights.delete('find-highlight');
      CSS.highlights.delete('find-current');
    }
    // Remove fallback marks
    this.viewer.querySelectorAll('mark.find-match, mark.find-current').forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
  }

  private scrollToCurrent() {
    if (this.currentIdx < 0 || this.currentIdx >= this.matches.length) return;

    // Remove previous current highlight
    this.viewer.querySelectorAll('mark.find-current').forEach((m) => {
      m.className = 'find-match';
    });

    if ('Highlight' in window && CSS.highlights) {
      const currentHighlight = new Highlight(this.matches[this.currentIdx]);
      CSS.highlights.set('find-current', currentHighlight);
    } else {
      const marks = this.viewer.querySelectorAll('mark.find-match');
      if (marks[this.currentIdx]) {
        marks[this.currentIdx].className = 'find-current';
      }
    }

    const range = this.matches[this.currentIdx];
    const rect = range.getBoundingClientRect();
    const viewerRect = this.viewer.getBoundingClientRect();
    if (rect.top < viewerRect.top || rect.bottom > viewerRect.bottom) {
      const el = range.startContainer.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private next() {
    if (this.matches.length === 0) return;
    this.currentIdx = (this.currentIdx + 1) % this.matches.length;
    this.scrollToCurrent();
    this.updateInfo();
  }

  private prev() {
    if (this.matches.length === 0) return;
    this.currentIdx = (this.currentIdx - 1 + this.matches.length) % this.matches.length;
    this.scrollToCurrent();
    this.updateInfo();
  }

  private updateInfo() {
    this.info.textContent = `${this.currentIdx + 1}/${this.matches.length}`;
  }
}
