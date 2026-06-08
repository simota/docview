/**
 * HTML viewer — renders .html / .htm files faithfully inside a sandboxed
 * iframe (Preview), alongside a syntax-highlighted Source view.
 *
 * Security: the iframe uses the `sandbox` attribute with NO `allow-same-origin`,
 * giving the document an opaque origin so it cannot reach the parent page,
 * cookies, or storage. Scripts are disabled by default; the user can opt in
 * per-file via the toolbar toggle (adds `allow-scripts` only — never paired
 * with `allow-same-origin`, which would let the frame escape its own sandbox).
 */

/** Escape a string for safe embedding inside a double-quoted HTML attribute. */
function escapeSrcdoc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Build the HTML-view markup. `displayContent` is the (already secret-masked
 * when applicable) raw HTML; `sourceHighlighted` is the hljs-highlighted source.
 */
export function renderHtmlView(displayContent: string, ext: string, sourceHighlighted: string): string {
  const srcdoc = escapeSrcdoc(displayContent);
  return `
    <div class="json-view-toggle">
      <button class="json-toggle-btn active" data-view="tree">Preview</button>
      <button class="json-toggle-btn" data-view="source">Source</button>
      <button class="html-scripts-toggle" type="button" aria-pressed="false" title="このHTML内のスクリプトを有効化（既定は無効）">スクリプト: 無効</button>
    </div>
    <div class="json-view-tree">
      <iframe class="html-preview-frame" sandbox="" srcdoc="${srcdoc}" title="HTML preview" referrerpolicy="no-referrer"></iframe>
    </div>
    <div class="json-view-source" style="display:none"><div class="data-view"><span class="data-lang">${ext}</span><pre class="hljs"><code>${sourceHighlighted}</code></pre></div></div>`;
}

/**
 * Wire the per-file "enable scripts" toggle. Delegated once at startup; works
 * for any rendered HTML view (main or split pane). Toggling re-assigns the
 * iframe's `sandbox` and reloads `srcdoc` so the change takes effect.
 */
export function initHtmlScriptsToggle(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.html-scripts-toggle') as HTMLButtonElement | null;
    if (!btn) return;
    const toggle = btn.closest('.json-view-toggle');
    const frame = toggle?.parentElement?.querySelector('.html-preview-frame') as HTMLIFrameElement | null;
    if (!frame) return;

    const enabled = btn.getAttribute('aria-pressed') === 'true';
    const next = !enabled;
    // allow-scripts only — never allow-same-origin (would defeat the sandbox).
    frame.setAttribute('sandbox', next ? 'allow-scripts' : '');
    btn.setAttribute('aria-pressed', String(next));
    btn.classList.toggle('html-scripts-toggle--on', next);
    btn.textContent = next ? 'スクリプト: 有効' : 'スクリプト: 無効';
    // Reassign srcdoc to force the frame to reload under the new sandbox.
    const doc = frame.getAttribute('srcdoc') ?? '';
    frame.setAttribute('srcdoc', doc);
  });
}
