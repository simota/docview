/**
 * HTML viewer — renders .html / .htm files faithfully inside a sandboxed
 * iframe (Preview), alongside a syntax-highlighted Source view.
 *
 * Security: the iframe uses `allow-scripts` with NO `allow-same-origin`,
 * giving the document an opaque origin so it cannot reach the parent page,
 * cookies, or storage.
 */

/** Escape a string for safe embedding inside a double-quoted HTML attribute. */
function escapeSrcdoc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const RESOURCE_URL_ATTRS = [
  ['link', 'href'],
  ['script', 'src'],
  ['img', 'src'],
  ['iframe', 'src'],
  ['audio', 'src'],
  ['video', 'src'],
  ['source', 'src'],
  ['track', 'src'],
  ['embed', 'src'],
  ['object', 'data'],
  ['input', 'src'],
] as const;

function isExternalOrSpecialUrl(raw: string): boolean {
  const url = raw.trim();
  return (
    !url ||
    url.startsWith('#') ||
    url.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(url)
  );
}

function normalizeLocalPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function splitLocalUrl(raw: string): { path: string; suffix: string } | null {
  const match = raw.trim().match(/^([^?#]*)([^#]*)?(#.*)?$/);
  if (!match) return null;
  const path = match[1] ?? '';
  if (!path) return null;
  return { path, suffix: `${match[2] ?? ''}${match[3] ?? ''}` };
}

function resolveResourceUrl(currentPath: string, raw: string): string | null {
  if (isExternalOrSpecialUrl(raw)) return null;
  const split = splitLocalUrl(raw);
  if (!split) return null;

  const baseDir = currentPath.includes('/') ? currentPath.replace(/\/[^/]+$/, '') : '';
  const candidate = split.path.startsWith('/')
    ? split.path.slice(1)
    : `${baseDir ? `${baseDir}/` : ''}${split.path}`;
  const normalized = normalizeLocalPath(candidate);
  if (!normalized) return null;

  const resourceUrl = `/api/raw/${normalized.split('/').map(encodeURIComponent).join('/')}`;
  if (split.suffix.startsWith('?')) return `${resourceUrl}${split.suffix}`;
  return `${resourceUrl}${split.suffix}`;
}

function rewriteCssResourceUrls(css: string, currentPath: string): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, rawUrl: string) => {
      const resolved = resolveResourceUrl(currentPath, rawUrl);
      if (!resolved) return match;
      return `url(${quote}${resolved}${quote})`;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, rawUrl: string) => {
      const resolved = resolveResourceUrl(currentPath, rawUrl);
      if (!resolved) return match;
      return `@import ${quote}${resolved}${quote}`;
    });
}

function rewriteSrcset(raw: string, currentPath: string): string {
  if (raw.includes('data:')) return raw;
  return raw.split(',').map((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return candidate;
    const [url, ...descriptors] = trimmed.split(/\s+/);
    const resolved = resolveResourceUrl(currentPath, url);
    return [resolved ?? url, ...descriptors].join(' ');
  }).join(', ');
}

function buildPreviewHtml(displayContent: string, currentPath: string): string {
  const doc = new DOMParser().parseFromString(displayContent, 'text/html');

  for (const [selector, attr] of RESOURCE_URL_ATTRS) {
    doc.querySelectorAll<HTMLElement>(`${selector}[${attr}]`).forEach((el) => {
      const raw = el.getAttribute(attr);
      if (!raw) return;
      const resolved = resolveResourceUrl(currentPath, raw);
      if (resolved) el.setAttribute(attr, resolved);
    });
  }

  doc.querySelectorAll<HTMLImageElement | HTMLSourceElement>('img[srcset], source[srcset]').forEach((el) => {
    const raw = el.getAttribute('srcset');
    if (raw) el.setAttribute('srcset', rewriteSrcset(raw, currentPath));
  });

  doc.querySelectorAll<HTMLStyleElement>('style').forEach((style) => {
    style.textContent = rewriteCssResourceUrls(style.textContent ?? '', currentPath);
  });
  doc.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const raw = el.getAttribute('style');
    if (raw) el.setAttribute('style', rewriteCssResourceUrls(raw, currentPath));
  });

  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : '<!doctype html>';
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}

/**
 * Build the HTML-view markup. `displayContent` is the (already secret-masked
 * when applicable) raw HTML; `sourceHighlighted` is the hljs-highlighted source.
 */
export function renderHtmlView(displayContent: string, ext: string, sourceHighlighted: string, currentPath: string): string {
  const srcdoc = escapeSrcdoc(buildPreviewHtml(displayContent, currentPath));
  return `
    <div class="json-view-toggle">
      <button class="json-toggle-btn active" data-view="tree">Preview</button>
      <button class="json-toggle-btn" data-view="source">Source</button>
      <button class="html-scripts-toggle html-scripts-toggle--on" type="button" aria-pressed="true" title="このHTML内のスクリプトを切り替え">スクリプト: 有効</button>
    </div>
    <div class="json-view-tree">
      <iframe class="html-preview-frame" sandbox="allow-scripts" srcdoc="${srcdoc}" title="HTML preview" referrerpolicy="no-referrer"></iframe>
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
