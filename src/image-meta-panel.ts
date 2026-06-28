import DOMPurify from 'dompurify';

// --- Types matching /api/image/meta schema ---
interface ImageMetaBasic {
  size: number;
  sizeHuman: string;
  mtime: string;
  ext: string;
  mime: string;
}

interface ImageMetaDimensions {
  width: number;
  height: number;
  aspectRatio: string;
  megapixels: number | null;
}

interface ImageMetaExif {
  make: string | null;
  model: string | null;
  lensModel: string | null;
  iso: number | null;
  exposureTime: string | null;
  fNumber: number | null;
  focalLength: number | null;
  dateTimeOriginal: string | null;
  orientation: number | null;
}

interface ImageMetaColor {
  bitDepth: number | null;
  colorSpace: string | null;
  iccProfile: string | null;
  hasAlpha: boolean | null;
  compression: string | null;
}

interface ImageMetaGps {
  lat: number;
  lon: number;
  mapUrl: string;
}

interface AiIndicator {
  source: string;
  label: string;
  detail: string;
}

interface ImageMetaAi {
  isLikelyAiGenerated: boolean;
  indicators: AiIndicator[];
  c2pa: {
    verified: boolean;
    issuer: string | null;
    claimGenerator: string | null;
    assertions: string[];
  } | null;
}

interface ImageMeta {
  path: string;
  basic: ImageMetaBasic;
  dimensions: ImageMetaDimensions | null;
  exif: ImageMetaExif | null;
  color: ImageMetaColor | null;
  gps: ImageMetaGps | null;
  ai: ImageMetaAi | null;
  raw: Record<string, unknown> | null;
}

const PANEL_OPEN_KEY = 'image-meta-panel-open';

function sanitize(value: unknown): string {
  if (value == null) return '';
  return DOMPurify.sanitize(String(value), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

function row(label: string, value: string | null | undefined, na = '該当なし'): string {
  const v = value != null && value !== '' ? sanitize(value) : na;
  return `<tr><td class="imp-key">${label}</td><td class="imp-val">${v}</td><td class="imp-copy-cell"><button class="imp-copy" type="button" aria-label="コピー" data-value="${v.replace(/"/g, '&quot;')}">⎘</button></td></tr>`;
}

function section(id: string, title: string, content: string, defaultOpen = true): string {
  const open = defaultOpen ? ' open' : '';
  return `<details class="imp-section"${open}>
    <summary class="imp-section-title" id="${id}">${title}</summary>
    <div class="imp-section-body">${content}</div>
  </details>`;
}

function buildBasicSection(meta: ImageMeta): string {
  const d = meta.dimensions;
  const b = meta.basic;
  let dims = '該当なし', aspect = '該当なし', mp = '該当なし';
  if (d) {
    dims = `${d.width} × ${d.height} px`;
    aspect = sanitize(d.aspectRatio);
    mp = d.megapixels != null ? `${d.megapixels.toFixed(2)} MP` : 'N/A';
  }
  const content = `<table class="imp-table">
    ${row('ファイルサイズ', b.sizeHuman)}
    ${row('更新日時', b.mtime ? new Date(b.mtime).toLocaleString('ja-JP') : null)}
    ${row('形式', `${sanitize(b.ext)} / ${sanitize(b.mime)}`)}
    ${row('寸法', dims)}
    ${row('アスペクト比', aspect)}
    ${row('メガピクセル', mp)}
  </table>`;
  return section('imp-basic', '基本情報 / 寸法', content);
}

function buildExifSection(exif: ImageMetaExif | null): string {
  if (!exif) {
    return section('imp-exif', 'EXIF', '<p class="imp-none">メタデータなし</p>');
  }
  const content = `<table class="imp-table">
    ${row('カメラメーカー', exif.make)}
    ${row('カメラモデル', exif.model)}
    ${row('レンズモデル', exif.lensModel)}
    ${row('ISO', exif.iso != null ? String(exif.iso) : null)}
    ${row('露出時間', exif.exposureTime)}
    ${row('F値', exif.fNumber != null ? `f/${exif.fNumber}` : null)}
    ${row('焦点距離', exif.focalLength != null ? `${exif.focalLength} mm` : null)}
    ${row('撮影日時', exif.dateTimeOriginal ? new Date(exif.dateTimeOriginal).toLocaleString('ja-JP') : null)}
    ${row('向き', exif.orientation != null ? String(exif.orientation) : null)}
  </table>`;
  return section('imp-exif', 'EXIF', content);
}

function buildColorSection(color: ImageMetaColor | null): string {
  if (!color) {
    return section('imp-color', '色・形式詳細', '<p class="imp-none">メタデータなし</p>');
  }
  const content = `<table class="imp-table">
    ${row('ビット深度', color.bitDepth != null ? `${color.bitDepth} bit` : null)}
    ${row('色空間', color.colorSpace)}
    ${row('ICCプロファイル', color.iccProfile)}
    ${row('アルファチャンネル', color.hasAlpha != null ? (color.hasAlpha ? 'あり' : 'なし') : null)}
    ${row('圧縮方式', color.compression)}
  </table>`;
  return section('imp-color', '色・形式詳細', content);
}

function buildGpsSection(gps: ImageMetaGps | null): string {
  if (!gps) {
    return section('imp-gps', 'GPS', '<p class="imp-none">該当なし</p>');
  }
  const lat = gps.lat.toFixed(6);
  const lon = gps.lon.toFixed(6);
  const safeUrl = DOMPurify.sanitize(gps.mapUrl, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  const content = `<table class="imp-table">
    ${row('緯度', lat)}
    ${row('経度', lon)}
  </table>
  <a class="imp-map-link" href="${safeUrl}" target="_blank" rel="noopener">OpenStreetMap で開く ↗</a>`;
  return section('imp-gps', 'GPS', content);
}

function buildAiSection(ai: ImageMetaAi | null): string {
  if (!ai) {
    return section('imp-ai', 'AI Provenance', '<p class="imp-none">メタデータなし</p>');
  }
  const badgeClass = ai.isLikelyAiGenerated ? 'imp-badge imp-badge--warn' : 'imp-badge imp-badge--ok';
  const badgeText = ai.isLikelyAiGenerated ? 'AI生成の可能性' : 'AI生成の指標なし';
  let html = `<div class="imp-ai-badge"><span class="${badgeClass}">${badgeText}</span></div>`;

  if (ai.indicators.length > 0) {
    html += '<ul class="imp-indicator-list">';
    for (const ind of ai.indicators) {
      const label = sanitize(ind.label);
      const detail = sanitize(ind.detail);
      html += `<li><span class="imp-ind-label">${label}</span>`;
      if (detail) {
        html += `<details class="imp-ind-detail"><summary>詳細</summary><pre class="imp-ind-pre">${detail}</pre></details>`;
      }
      html += '</li>';
    }
    html += '</ul>';
  }

  if (ai.c2pa) {
    const c = ai.c2pa;
    const verifiedText = c.verified ? '✓ 検証済み' : '✗ 検証失敗';
    const verifiedClass = c.verified ? 'imp-c2pa-verified' : 'imp-c2pa-invalid';
    html += `<div class="imp-c2pa">
      <div class="imp-c2pa-title">C2PA Content Credentials</div>
      <table class="imp-table">
        <tr><td class="imp-key">検証状態</td><td class="imp-val ${verifiedClass}">${verifiedText}</td><td class="imp-copy-cell"></td></tr>
        ${row('発行者', c.issuer)}
        ${row('生成ツール', c.claimGenerator)}
      </table>`;
    if (c.assertions.length > 0) {
      html += `<div class="imp-c2pa-assertions">アサーション: ${c.assertions.map(sanitize).join(', ')}</div>`;
    }
    html += '</div>';
  }

  return section('imp-ai', 'AI Provenance', html);
}

function buildRawSection(raw: Record<string, unknown> | null): string {
  if (!raw || Object.keys(raw).length === 0) {
    return section('imp-raw', 'Raw タグ', '<p class="imp-none">メタデータなし</p>', false);
  }
  let rows = '';
  for (const [k, v] of Object.entries(raw)) {
    rows += row(sanitize(k), String(v));
  }
  const content = `<table class="imp-table">${rows}</table>`;
  return section('imp-raw', 'Raw タグ', content, false); // collapsed by default (FR-10)
}

// --- Panel class ---
export class ImageMetaPanel {
  private container: HTMLElement;
  private abortController: AbortController | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Mount panel toggle UI into the image-view wrapper. Called after renderImage. */
  mount(imagePath: string) {
    this.destroy();
    const imageView = this.container.querySelector<HTMLElement>('.image-view');
    if (!imageView) return;

    // Wrap image-view in a flex row with the panel
    const wrapper = document.createElement('div');
    wrapper.className = 'imp-wrapper';
    imageView.parentElement?.insertBefore(wrapper, imageView);
    wrapper.appendChild(imageView);

    // Toggle button (inside image-view, above image)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'imp-toggle-btn';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', 'メタデータパネルを開閉');
    toggleBtn.setAttribute('title', 'メタデータパネル');
    toggleBtn.textContent = 'ℹ';
    imageView.insertBefore(toggleBtn, imageView.firstChild);

    // Panel element
    const panel = document.createElement('aside');
    panel.className = 'imp-panel';
    panel.setAttribute('aria-label', '画像メタデータ');
    panel.innerHTML = '<div class="imp-loading">読み込み中...</div>';
    wrapper.appendChild(panel);

    // Restore open state (FR-13)
    const stored = localStorage.getItem(PANEL_OPEN_KEY);
    const isOpen = stored !== 'false'; // default open
    panel.classList.toggle('imp-panel--open', isOpen);
    toggleBtn.setAttribute('aria-expanded', String(isOpen));

    toggleBtn.addEventListener('click', () => {
      const open = panel.classList.toggle('imp-panel--open');
      toggleBtn.setAttribute('aria-expanded', String(open));
      localStorage.setItem(PANEL_OPEN_KEY, String(open));
      if (open && panel.querySelector('.imp-loading')) {
        void this.fetchAndRender(imagePath, panel);
      }
    });

    if (isOpen) {
      void this.fetchAndRender(imagePath, panel);
    }

    // Copy buttons (FR-12) — delegate
    panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.imp-copy');
      if (!btn) return;
      const value = btn.dataset.value ?? '';
      navigator.clipboard.writeText(value).catch(() => { /* ignore */ });
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '⎘'; }, 1500);
    });
  }

  private async fetchAndRender(imagePath: string, panel: HTMLElement) {
    if (this.abortController) this.abortController.abort();
    const ctrl = new AbortController();
    this.abortController = ctrl;

    try {
      const res = await fetch(`/api/image/meta?path=${encodeURIComponent(imagePath)}`, { signal: ctrl.signal });
      if (!res.ok) {
        panel.innerHTML = `<p class="imp-error">メタデータを取得できませんでした (${res.status})</p>`;
        return;
      }
      const meta: ImageMeta = await res.json() as ImageMeta;
      panel.innerHTML = this.buildPanelHtml(meta);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      panel.innerHTML = '<p class="imp-error">メタデータの読み込みに失敗しました</p>';
    }
  }

  private buildPanelHtml(meta: ImageMeta): string {
    return `<div class="imp-content">
      <div class="imp-panel-title">メタデータ</div>
      ${buildBasicSection(meta)}
      ${buildExifSection(meta.exif)}
      ${buildColorSection(meta.color)}
      ${buildGpsSection(meta.gps)}
      ${buildAiSection(meta.ai)}
      ${buildRawSection(meta.raw)}
    </div>`;
  }

  /** Cleanup: abort fetch, remove DOM. Call on navigation. */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // Unwrap imp-wrapper → restore children to original parent
    const wrapper = this.container.querySelector<HTMLElement>('.imp-wrapper');
    if (wrapper && wrapper.parentElement) {
      const parent = wrapper.parentElement;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  }
}
