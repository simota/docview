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
  const width = Math.max(frame.clientWidth || 1200, 800);

  // Create a temporary same-origin iframe to render full document with body styles
  const tempFrame = document.createElement('iframe');
  tempFrame.className = 'html-capture-temp-frame';
  tempFrame.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${width}px;
    height: 1000px;
    border: none;
    margin: 0;
    padding: 0;
    background: #ffffff;
    z-index: -99999;
    opacity: 0.01;
    pointer-events: none;
    overflow: visible;
  `;
  tempFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  tempFrame.setAttribute('srcdoc', srcdoc);

  document.body.appendChild(tempFrame);

  try {
    await new Promise((resolve) => {
      tempFrame.onload = resolve;
      setTimeout(resolve, 1500);
    });

    const doc = tempFrame.contentDocument || tempFrame.contentWindow?.document;
    if (!doc) {
      throw new Error('Could not access iframe document');
    }

    const images = Array.from(doc.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((r) => {
          img.onload = r;
          img.onerror = r;
        });
      })
    );

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const body = doc.body;
    const html = doc.documentElement;
    const fullHeight = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      html ? html.scrollHeight : 0,
      html ? html.offsetHeight : 0,
      600
    );
    const fullWidth = Math.max(
      body ? body.scrollWidth : 0,
      html ? html.scrollWidth : 0,
      width
    );

    tempFrame.style.width = `${fullWidth}px`;
    tempFrame.style.height = `${fullHeight}px`;

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    let dataUrl: string | null = null;
    try {
      dataUrl = await domToPng(html, {
        scale: 2,
        width: fullWidth,
        height: fullHeight,
        backgroundColor: '#ffffff',
      });
    } catch (e) {
      dataUrl = await domToPng(tempFrame, {
        scale: 2,
        width: fullWidth,
        height: fullHeight,
        backgroundColor: '#ffffff',
      });
    }

    if (dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = defaultFilename;
      a.click();
    }
  } finally {
    if (tempFrame.parentNode) {
      tempFrame.parentNode.removeChild(tempFrame);
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

