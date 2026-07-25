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
  const previewHtml = buildPreviewHtml(displayContent, currentPath);
  const srcdoc = escapeSrcdoc(previewHtml);
  return `
    <div class="json-view-toggle">
      <button class="json-toggle-btn active" data-view="tree">Preview</button>
      <button class="json-toggle-btn" data-view="source">Source</button>
      <button class="html-screenshot-btn" type="button" title="HTMLプレビューの全画面スクリーンショットをキャプチャ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>全画面キャプチャ</span>
      </button>
      <button class="html-scripts-toggle html-scripts-toggle--on" type="button" aria-pressed="true" title="このHTML内のスクリプトを切り替え">スクリプト: 有効</button>
    </div>
    <div class="json-view-tree" data-current-path="${escapeSrcdoc(currentPath)}">
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

/**
 * Capture full-page screenshot of the rendered HTML.
 */
export async function captureHtmlFullPage(frame: HTMLIFrameElement, defaultFilename = 'html-screenshot.png'): Promise<void> {
  const { domToPng } = await import('modern-screenshot');

  const srcdoc = frame.getAttribute('srcdoc') || '';

  // Create temporary host container in parent DOM context (same-origin, no canvas tainting)
  const host = document.createElement('div');
  host.className = 'html-capture-host';
  host.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 1200px;
    height: auto;
    background: #ffffff;
    color: #000000;
    z-index: -99999;
    overflow: visible;
    pointer-events: none;
    box-sizing: border-box;
  `;

  if (srcdoc) {
    const doc = new DOMParser().parseFromString(srcdoc, 'text/html');

    doc.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      host.appendChild(node.cloneNode(true));
    });

    doc.body.childNodes.forEach((node) => {
      host.appendChild(node.cloneNode(true));
    });
  } else {
    host.innerHTML = '<div>HTML Preview</div>';
  }

  document.body.appendChild(host);

  try {
    const images = Array.from(host.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      })
    );

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const width = Math.max(host.scrollWidth, host.offsetWidth, 1200);
    const height = Math.max(host.scrollHeight, host.offsetHeight, 400);

    const dataUrl = await domToPng(host, {
      scale: 2,
      width,
      height,
      backgroundColor: '#ffffff',
    });

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = defaultFilename;
    a.click();
  } finally {
    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }
}

/**
 * Wire the HTML full-page screenshot button. Delegated once at startup.
 */
export function initHtmlScreenshotToggle(): void {
  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.html-screenshot-btn') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const toggle = btn.closest('.json-view-toggle');
    const frame = toggle?.parentElement?.querySelector('.html-preview-frame') as HTMLIFrameElement | null;
    if (!frame) return;

    btn.disabled = true;
    btn.classList.add('html-screenshot-btn--loading');
    const labelSpan = btn.querySelector('span');
    const originalText = labelSpan?.textContent || '全画面キャプチャ';
    if (labelSpan) {
      labelSpan.textContent = 'キャプチャ中...';
    }

    try {
      const currentFilePath = document.querySelector<HTMLElement>('#breadcrumb')?.textContent?.trim() || 'html-document.html';
      const cleanName = currentFilePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'html-document';
      const filename = cleanName + '-fullpage.png';
      await captureHtmlFullPage(frame, filename);
    } catch (err) {
      console.error('HTML full-page screenshot failed:', err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('html-screenshot-btn--loading');
      if (labelSpan) {
        labelSpan.textContent = originalText;
      }
    }
  });
}

