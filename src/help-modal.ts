/** OS modifier key label — ⌘ on Mac, Ctrl elsewhere */
const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent) ? '⌘' : 'Ctrl';

interface ShortcutSection {
  title: string;
  items: [string, string][];
}

function buildSections(): ShortcutSection[] {
  return [
    {
      title: 'Navigation',
      items: [
        [`${MOD}+P`, 'Search files'],
        [`${MOD}+E`, 'Recent files'],
        [`${MOD}+O`, 'Open local file'],
        [`${MOD}+L`, 'Open by URL or path'],
        [`${MOD}+B`, 'Toggle sidebar'],
        ['↑ / ↓', 'Navigate sidebar'],
      ],
    },
    {
      title: 'Search',
      items: [
        [`${MOD}+Shift+F`, 'Full-text search'],
        ['/', 'Find in document'],
      ],
    },
    {
      title: 'View',
      items: [
        [`${MOD}+=  /  ${MOD}+−  /  ${MOD}+0`, 'Zoom in / out / reset'],
        ['Alt+Z', 'Word wrap toggle'],
        [`${MOD}+J`, 'Toggle TOC'],
        [`${MOD}+Shift+S`, 'Slide mode'],
        [`${MOD}+\\`, 'Split view'],
      ],
    },
    {
      title: 'Export',
      items: [
        [`${MOD}+Shift+E`, 'Export HTML'],
        ['Print menu', 'Print / PDF'],
      ],
    },
    {
      title: 'Other',
      items: [
        ['?', 'Show this help'],
        ['Esc', 'Close overlay'],
      ],
    },
  ];
}

function renderSections(sections: ShortcutSection[]): string {
  return sections.map((section) => `
    <div class="help-section">
      <h3>${section.title}</h3>
      <div class="help-keys">
        ${section.items.map(([key, desc]) => `
          <div class="help-row">
            <kbd>${key}</kbd>
            <span class="help-desc">${desc}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

export class HelpModal {
  private overlay: HTMLElement;
  private dialog: HTMLElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'help-overlay';
    this.overlay.style.display = 'none';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'help-modal-title');

    this.dialog = document.createElement('div');
    this.dialog.className = 'help-modal';
    this.dialog.setAttribute('tabindex', '-1');

    const titleId = 'help-modal-title';
    this.dialog.innerHTML = `
      <div class="help-header">
        <h2 id="${titleId}" class="help-title">Keyboard Shortcuts</h2>
        <button class="help-close" aria-label="Close keyboard shortcuts" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="help-content">
        ${renderSections(buildSections())}
      </div>`;

    this.overlay.appendChild(this.dialog);
    document.body.appendChild(this.overlay);

    // Close on overlay click (outside dialog)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Close button
    this.dialog.querySelector<HTMLButtonElement>('.help-close')!
      .addEventListener('click', () => this.close());

    // Escape key
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if (e.key === 'Tab') this._trapFocus(e);
    });
  }

  open(): void {
    this.overlay.style.display = '';
    requestAnimationFrame(() => this.dialog.focus());
  }

  close(): void {
    this.overlay.style.display = 'none';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  get isOpen(): boolean {
    return this.overlay.style.display !== 'none';
  }

  private _trapFocus(e: KeyboardEvent): void {
    const focusable = Array.from(
      this.dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));

    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
}
