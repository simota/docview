/**
 * Link check report — lists relative links in Markdown documents whose
 * target does not exist (inline links, images, reference definitions and wiki
 * links), with same-name candidates as fix hints. Re-runs on file changes while
 * open so fixes are confirmed live.
 */

export interface BrokenLink {
  source: string;
  line: number;
  kind: 'link' | 'image' | 'reference' | 'wiki';
  link: string;
  target: string | null;
  reason: 'missing' | 'invalid';
  suggestions: string[];
}

export interface LinkCheckResult {
  scope: string;
  scannedFiles: number;
  totalLinks: number;
  broken: BrokenLink[];
  truncated: boolean;
}

export interface LinkReportHooks {
  openLocation: (path: string, line: number | null) => void;
  notify: (message: string) => void;
}

const KIND_LABEL: Record<BrokenLink['kind'], string> = {
  link: 'リンク',
  image: '画像',
  reference: '参照定義',
  wiki: 'Wiki',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function fetchLinkCheck(scope: string): Promise<LinkCheckResult> {
  const res = await fetch(`/api/links/check?path=${encodeURIComponent(scope)}`, { cache: 'no-store' });
  if (!res.ok) {
    let detail = String(res.status);
    try { detail = (await res.json()).error ?? detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return res.json() as Promise<LinkCheckResult>;
}

function reasonText(item: BrokenLink): string {
  if (item.reason === 'invalid') return '不正な URL';
  return item.target ? `${item.target} が見つかりません` : '見つかりません';
}

/** Markdown checklist of broken links, suitable for an issue or PR comment. */
export function linkReportMarkdown(result: LinkCheckResult): string {
  const lines = [`## リンク切れ: ${result.broken.length} 件 (${result.scope || 'ルート'} / ${result.scannedFiles} ファイル)`, ''];
  for (const item of result.broken) {
    const hint = item.suggestions.length > 0 ? ` — 候補: ${item.suggestions.map((s) => `\`${s}\``).join(', ')}` : '';
    lines.push(`- [ ] \`${item.source}:${item.line}\` ${KIND_LABEL[item.kind]} \`${item.link}\` — ${reasonText(item)}${hint}`);
  }
  return `${lines.join('\n')}\n`;
}

export class LinkReport {
  private overlay: HTMLElement;
  private dialog: HTMLElement;
  private body: HTMLElement;
  private summary: HTMLElement;
  private titleEl: HTMLElement;
  private hooks: LinkReportHooks;
  private scope = '';
  private result: LinkCheckResult | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(hooks: LinkReportHooks) {
    this.hooks = hooks;
    this.overlay = document.createElement('div');
    this.overlay.className = 'linkcheck-overlay';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'linkcheck-title');
    this.overlay.innerHTML = `
      <div class="linkcheck-modal" tabindex="-1">
        <header class="linkcheck-header">
          <h2 id="linkcheck-title" class="linkcheck-title">リンクチェック</h2>
          <span class="linkcheck-summary" aria-live="polite"></span>
          <span class="diff-spacer"></span>
          <button type="button" class="diff-btn linkcheck-rerun" title="再チェック">再チェック</button>
          <button type="button" class="diff-btn linkcheck-copy" title="Markdown のチェックリストとしてコピー">Markdown でコピー</button>
          <button type="button" class="diff-btn linkcheck-close" aria-label="リンクチェックを閉じる" title="閉じる (Esc)">✕</button>
        </header>
        <div class="linkcheck-body"></div>
      </div>`;
    document.body.appendChild(this.overlay);
    this.dialog = this.overlay.querySelector('.linkcheck-modal')!;
    this.body = this.overlay.querySelector('.linkcheck-body')!;
    this.summary = this.overlay.querySelector('.linkcheck-summary')!;
    this.titleEl = this.overlay.querySelector('.linkcheck-title')!;
    this.overlay.querySelector('.linkcheck-close')!.addEventListener('click', () => this.close());
    this.overlay.querySelector('.linkcheck-rerun')!.addEventListener('click', () => void this.run());
    this.overlay.querySelector('.linkcheck-copy')!.addEventListener('click', () => void this.copy());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
    this.body.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-open]');
      if (!btn) return;
      const path = btn.dataset.open!;
      const line = btn.dataset.line ? Number(btn.dataset.line) : null;
      this.close();
      this.hooks.openLocation(path, line);
    });
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  async open(scope: string): Promise<void> {
    if (!this.isOpen) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.overlay.hidden = false;
    }
    this.scope = scope;
    this.titleEl.textContent = `リンクチェック: ${scope || 'すべての文書'}`;
    this.dialog.focus();
    await this.run();
  }

  close(): void {
    if (!this.isOpen) return;
    ++this.seq;
    if (this.timer) clearTimeout(this.timer);
    this.overlay.hidden = true;
    const focus = this.returnFocus;
    this.returnFocus = null;
    if (focus?.isConnected) focus.focus();
  }

  /** Re-check (debounced) after any file add/change/unlink while open. */
  notifyChange(): void {
    if (!this.isOpen) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(true), 400);
  }

  private async run(quiet = false): Promise<void> {
    const seq = ++this.seq;
    if (!quiet) {
      this.summary.textContent = 'チェック中…';
      this.body.innerHTML = '<div class="diff-loading">チェック中…</div>';
    }
    let result: LinkCheckResult;
    try {
      result = await fetchLinkCheck(this.scope);
    } catch (err) {
      if (seq !== this.seq) return;
      this.result = null;
      this.summary.textContent = '';
      this.body.innerHTML = `<div class="diff-empty diff-error" role="alert">チェックに失敗しました: ${esc(err instanceof Error ? err.message : String(err))}</div>`;
      return;
    }
    if (seq !== this.seq) return;
    this.result = result;
    this.render();
  }

  private render(): void {
    const result = this.result!;
    const count = result.broken.length;
    this.summary.innerHTML = `${result.scannedFiles} 文書 · ${result.totalLinks} リンク · ${count === 0
      ? '<span class="diff-stat-add">リンク切れなし</span>'
      : `<span class="diff-stat-del">リンク切れ ${count}${result.truncated ? '+' : ''} 件</span>`}`;
    if (count === 0) {
      this.body.innerHTML = `<div class="diff-empty">${result.scannedFiles === 0 ? 'Markdown 文書がありません。' : 'すべての相対リンクの参照先が存在します。'}</div>`;
      return;
    }
    const groups = new Map<string, BrokenLink[]>();
    for (const item of result.broken) {
      const list = groups.get(item.source) ?? [];
      list.push(item);
      groups.set(item.source, list);
    }
    const parts: string[] = [];
    if (result.truncated) parts.push('<div class="diff-notice">件数またはファイル数が上限に達したため、一部のみ表示しています。フォルダを絞ってチェックしてください。</div>');
    for (const [source, items] of groups) {
      parts.push(`<section class="linkcheck-group"><h3 class="linkcheck-source"><button type="button" class="linkcheck-open" data-open="${esc(source)}">${esc(source)}</button> <span class="linkcheck-count">${items.length}</span></h3><ul class="linkcheck-list">`);
      for (const item of items) {
        const suggestions = item.suggestions.map((s) =>
          `<button type="button" class="linkcheck-suggestion" data-open="${esc(s)}" title="候補を開く">${esc(s)}</button>`).join(' ');
        parts.push(`<li class="linkcheck-item">
          <button type="button" class="linkcheck-line" data-open="${esc(item.source)}" data-line="${item.line}" title="${esc(item.source)} の ${item.line} 行目を開く">L${item.line}</button>
          <span class="linkcheck-kind linkcheck-kind--${item.kind}">${KIND_LABEL[item.kind]}</span>
          <code class="linkcheck-link">${esc(item.link)}</code>
          <span class="linkcheck-reason">${esc(reasonText(item))}</span>
          ${suggestions ? `<span class="linkcheck-hint">候補: ${suggestions}</span>` : ''}
        </li>`);
      }
      parts.push('</ul></section>');
    }
    this.body.innerHTML = parts.join('');
  }

  private async copy(): Promise<void> {
    if (!this.result) return;
    try {
      await navigator.clipboard.writeText(linkReportMarkdown(this.result));
      this.hooks.notify('リンクチェック結果をコピーしました');
    } catch {
      this.hooks.notify('クリップボードにコピーできませんでした');
    }
  }
}
