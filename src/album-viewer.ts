/**
 * album-viewer.ts — Album View for DocView
 *
 * Renders a directory's images as a CSS Grid of tiles with lazy loading,
 * keyboard navigation, and a recursive toggle.
 * Also implements F3 Lightbox with keyboard navigation and zoom/pan.
 */

import DOMPurify from 'dompurify';

export interface AlbumImage {
  path: string;
  name: string;
  size: number;
  mtime: string;
  ext: string;
}

export interface AlbumResponse {
  dir: string;
  total: number;
  truncated: boolean;
  images: AlbumImage[];
}

// Callback signature for opening a single image in the main viewer
export type OpenImageCallback = (path: string) => void;

// Callback signature for triggering compare view with multiple paths
export type CompareCallback = (paths: string[]) => void;

let _currentAlbumPath: string | null = null;
let _currentImages: AlbumImage[] = [];
let _selectedIndex = -1;
let _albumTarget: HTMLElement | null = null;
let _keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let _observer: IntersectionObserver | null = null;

// ---- Multi-select state ----
const MAX_COMPARE = 4;
const _multiSelected = new Set<string>(); // path set
let _lastClickedIndex = -1; // for Shift+Click range select
let _compareCallback: CompareCallback | null = null;

// ---- Contact Sheet (F11) state ----
const CONTACT_SHEET_COLS_KEY = 'album-contact-sheet-cols';
const CONTACT_SHEET_COLS_DEFAULT = 4;
const VALID_COLS = [3, 4, 5] as const;
type ContactSheetCols = (typeof VALID_COLS)[number];

function getContactSheetCols(): ContactSheetCols {
  const stored = localStorage.getItem(CONTACT_SHEET_COLS_KEY);
  const n = stored != null ? parseInt(stored, 10) : NaN;
  return (VALID_COLS as readonly number[]).includes(n)
    ? (n as ContactSheetCols)
    : CONTACT_SHEET_COLS_DEFAULT;
}

function setContactSheetCols(cols: ContactSheetCols): void {
  localStorage.setItem(CONTACT_SHEET_COLS_KEY, String(cols));
}

// ---- Lightbox state ----
let _lightboxEl: HTMLElement | null = null;
let _lightboxIndex = -1;
let _lightboxOpen = false;
let _lightboxKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let _lightboxPopstateHandler: (() => void) | null = null;
let _preloadLinks: HTMLLinkElement[] = [];

// Zoom/pan state per Lightbox open session
let _lbScale = 1;
let _lbTranslateX = 0;
let _lbTranslateY = 0;
let _lbDragging = false;
let _lbStartX = 0;
let _lbStartY = 0;
let _lbMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
let _lbMouseUpHandler: (() => void) | null = null;

// ---- Utility ----

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isSvg(path: string): boolean {
  return path.toLowerCase().endsWith('.svg');
}

// ---- Clipboard helpers ----

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  // Fallback: execCommand for non-secure contexts
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function flashCopyFeedback(btn: HTMLButtonElement, ok: boolean): void {
  const prevTitle = btn.title;
  btn.classList.add(ok ? 'album-tile__copy--ok' : 'album-tile__copy--err');
  btn.title = ok ? 'Copied!' : 'Copy failed';
  setTimeout(() => {
    btn.classList.remove('album-tile__copy--ok', 'album-tile__copy--err');
    btn.title = prevTitle;
  }, 1200);
}

function showToast(message: string): void {
  const existing = document.querySelector('.album-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'album-toast';
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  // Trigger fade-in
  requestAnimationFrame(() => toast.classList.add('album-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('album-toast--visible');
    setTimeout(() => toast.remove(), 200);
  }, 1400);
}

async function copyNamesForKeyboardShortcut(): Promise<void> {
  // If multi-selection exists, copy all selected names (album order).
  // Otherwise, copy the keyboard-selected tile's name.
  let names: string[] = [];
  if (_multiSelected.size > 0) {
    names = _currentImages.filter((img) => _multiSelected.has(img.path)).map((img) => img.name);
  } else if (_selectedIndex >= 0 && _selectedIndex < _currentImages.length) {
    const img = _currentImages[_selectedIndex];
    if (img) names = [img.name];
  }
  if (names.length === 0) return;
  const text = names.join('\n');
  const ok = await copyTextToClipboard(text);
  if (ok) {
    const label = names.length === 1 ? `Copied: ${names[0]}` : `Copied ${names.length} filenames`;
    showToast(label);
  } else {
    showToast('Copy failed');
  }
}

// ---- Lightbox Zoom/Pan helpers ----

function lbApplyTransform(imgEl: HTMLElement): void {
  imgEl.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
  imgEl.style.cursor = _lbScale > 1 ? 'grab' : 'zoom-in';
}

function lbResetZoom(imgEl: HTMLElement): void {
  _lbScale = 1;
  _lbTranslateX = 0;
  _lbTranslateY = 0;
  lbApplyTransform(imgEl);
}

function lbZoom(delta: number, imgEl: HTMLElement): void {
  _lbScale = Math.max(0.5, Math.min(5, _lbScale + delta));
  if (_lbScale <= 1) {
    _lbTranslateX = 0;
    _lbTranslateY = 0;
  }
  lbApplyTransform(imgEl);
}

function initLightboxZoom(imgEl: HTMLElement): void {
  _lbScale = 1;
  _lbTranslateX = 0;
  _lbTranslateY = 0;
  _lbDragging = false;

  // Cleanup previous mouse listeners
  if (_lbMouseMoveHandler) {
    document.removeEventListener('mousemove', _lbMouseMoveHandler);
    _lbMouseMoveHandler = null;
  }
  if (_lbMouseUpHandler) {
    document.removeEventListener('mouseup', _lbMouseUpHandler);
    _lbMouseUpHandler = null;
  }

  imgEl.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    lbZoom(delta, imgEl);
  }, { passive: false });

  imgEl.addEventListener('dblclick', () => {
    _lbScale = _lbScale > 1 ? 1 : 2;
    _lbTranslateX = 0;
    _lbTranslateY = 0;
    lbApplyTransform(imgEl);
  });

  imgEl.addEventListener('mousedown', (e: MouseEvent) => {
    if (_lbScale <= 1) return;
    _lbDragging = true;
    _lbStartX = e.clientX - _lbTranslateX;
    _lbStartY = e.clientY - _lbTranslateY;
    imgEl.style.cursor = 'grabbing';
    e.preventDefault();
  });

  _lbMouseMoveHandler = (e: MouseEvent) => {
    if (!_lbDragging) return;
    _lbTranslateX = e.clientX - _lbStartX;
    _lbTranslateY = e.clientY - _lbStartY;
    lbApplyTransform(imgEl);
  };
  _lbMouseUpHandler = () => {
    if (_lbDragging) {
      _lbDragging = false;
      imgEl.style.cursor = _lbScale > 1 ? 'grab' : 'zoom-in';
    }
  };
  document.addEventListener('mousemove', _lbMouseMoveHandler);
  document.addEventListener('mouseup', _lbMouseUpHandler);
}

// ---- Preload helpers ----

function updatePreloadLinks(index: number, images: AlbumImage[]): void {
  // Remove previous preload links
  for (const link of _preloadLinks) {
    link.remove();
  }
  _preloadLinks = [];

  const targets = [index - 1, index + 1].filter((i) => i >= 0 && i < images.length);
  for (const i of targets) {
    const img = images[i];
    if (!img || isSvg(img.path)) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = `/api/file?path=${encodeURIComponent(img.path)}`;
    document.head.appendChild(link);
    _preloadLinks.push(link);
  }
}

// ---- Lightbox DOM builder ----

function buildLightboxHtml(image: AlbumImage, index: number, total: number): string {
  const counter = `${index + 1} / ${total}`;
  const prevDisabled = index === 0 ? ' disabled aria-disabled="true"' : '';
  const nextDisabled = index === total - 1 ? ' disabled aria-disabled="true"' : '';

  return `
    <div class="lightbox__backdrop" aria-hidden="true"></div>
    <div class="lightbox__container" role="dialog" aria-modal="true" aria-label="画像ビューア">
      <div class="lightbox__toolbar">
        <span class="lightbox__filename" title="${esc(image.name)}">${esc(image.name)}</span>
        <span class="lightbox__counter">${esc(counter)}</span>
        <button type="button" class="lightbox__close" aria-label="閉じる" title="閉じる (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="lightbox__stage">
        <button type="button" class="lightbox__nav lightbox__nav-prev" aria-label="前の画像"${prevDisabled}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="lightbox__img-wrap" id="lightbox-img-wrap">
          <!-- image injected by loadLightboxImage -->
        </div>
        <button type="button" class="lightbox__nav lightbox__nav-next" aria-label="次の画像"${nextDisabled}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ---- Lightbox image loader ----

async function loadLightboxImage(image: AlbumImage, wrap: HTMLElement): Promise<void> {
  wrap.innerHTML = '<div class="lightbox__loading">読み込み中...</div>';

  const url = `/api/file?path=${encodeURIComponent(image.path)}`;

  if (isSvg(image.path)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const svgText = await res.text();
      const cleanSvg = DOMPurify.sanitize(svgText, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        ADD_TAGS: ['use', 'foreignObject'],
      });
      wrap.innerHTML = `<div class="lightbox__img lightbox__img--svg">${cleanSvg}</div>`;
      const svgEl = wrap.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width', '100%');
        svgEl.removeAttribute('height');
        svgEl.style.maxHeight = '80vh';
      }
      const imgEl = wrap.querySelector<HTMLElement>('.lightbox__img');
      if (imgEl) initLightboxZoom(imgEl);
    } catch {
      wrap.innerHTML = '<div class="lightbox__error">画像を読み込めませんでした</div>';
    }
    return;
  }

  const imgEl = document.createElement('img');
  imgEl.className = 'lightbox__img';
  imgEl.alt = image.name;
  imgEl.src = url;
  wrap.innerHTML = '';
  wrap.appendChild(imgEl);
  initLightboxZoom(imgEl);
}

// ---- Lightbox navigation ----

async function navigateLightbox(newIndex: number): Promise<void> {
  if (!_lightboxEl || newIndex < 0 || newIndex >= _currentImages.length) return;
  _lightboxIndex = newIndex;

  const total = _currentImages.length;
  const image = _currentImages[_lightboxIndex];
  if (!image) return;

  // Update counter
  const counter = _lightboxEl.querySelector<HTMLElement>('.lightbox__counter');
  if (counter) counter.textContent = `${_lightboxIndex + 1} / ${total}`;

  // Update filename
  const filename = _lightboxEl.querySelector<HTMLElement>('.lightbox__filename');
  if (filename) {
    filename.textContent = image.name;
    filename.title = image.name;
  }

  // Update nav buttons
  const prevBtn = _lightboxEl.querySelector<HTMLButtonElement>('.lightbox__nav-prev');
  const nextBtn = _lightboxEl.querySelector<HTMLButtonElement>('.lightbox__nav-next');
  if (prevBtn) {
    prevBtn.disabled = _lightboxIndex === 0;
    prevBtn.setAttribute('aria-disabled', String(_lightboxIndex === 0));
  }
  if (nextBtn) {
    nextBtn.disabled = _lightboxIndex === total - 1;
    nextBtn.setAttribute('aria-disabled', String(_lightboxIndex === total - 1));
  }

  // Load image
  const wrap = _lightboxEl.querySelector<HTMLElement>('#lightbox-img-wrap');
  if (wrap) await loadLightboxImage(image, wrap);

  // Update preloads
  updatePreloadLinks(_lightboxIndex, _currentImages);
}

// ---- Open / Close Lightbox ----

function closeLightbox(): void {
  if (!_lightboxOpen) return;
  _lightboxOpen = false;

  // Re-enable body scroll
  document.body.classList.remove('lightbox-open');

  // Remove keyboard handler
  if (_lightboxKeyHandler) {
    document.removeEventListener('keydown', _lightboxKeyHandler);
    _lightboxKeyHandler = null;
  }

  // Remove popstate handler
  if (_lightboxPopstateHandler) {
    window.removeEventListener('popstate', _lightboxPopstateHandler);
    _lightboxPopstateHandler = null;
  }

  // Clean up mouse handlers
  if (_lbMouseMoveHandler) {
    document.removeEventListener('mousemove', _lbMouseMoveHandler);
    _lbMouseMoveHandler = null;
  }
  if (_lbMouseUpHandler) {
    document.removeEventListener('mouseup', _lbMouseUpHandler);
    _lbMouseUpHandler = null;
  }

  // Remove preload links
  for (const link of _preloadLinks) {
    link.remove();
  }
  _preloadLinks = [];

  // Remove lightbox DOM
  if (_lightboxEl) {
    _lightboxEl.remove();
    _lightboxEl = null;
  }

  // Restore focus to the album tile
  if (_albumTarget && _lightboxIndex >= 0) {
    const tiles = _albumTarget.querySelectorAll<HTMLElement>('.album-tile');
    const tile = tiles[_lightboxIndex];
    if (tile) {
      _selectedIndex = _lightboxIndex;
      tile.focus({ preventScroll: false });
    }
  }
}

function buildLightboxKeyHandler(): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (!_lightboxOpen) return;

    const imgEl = _lightboxEl?.querySelector<HTMLElement>('.lightbox__img');

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        if (_lightboxIndex < _currentImages.length - 1) {
          void navigateLightbox(_lightboxIndex + 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        if (_lightboxIndex > 0) {
          void navigateLightbox(_lightboxIndex - 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (imgEl) lbZoom(0.1, imgEl);
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (imgEl) lbZoom(-0.1, imgEl);
        break;
      case '+':
      case '=':
        e.preventDefault();
        if (imgEl) lbZoom(0.2, imgEl);
        break;
      case '-':
        e.preventDefault();
        if (imgEl) lbZoom(-0.2, imgEl);
        break;
      case '0':
        e.preventDefault();
        if (imgEl) lbResetZoom(imgEl);
        break;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        void navigateLightbox(0);
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        void navigateLightbox(_currentImages.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        // Pop the history state we pushed when opening
        history.back();
        break;
      default:
        break;
    }
  };
}

async function openLightbox(index: number): Promise<void> {
  if (index < 0 || index >= _currentImages.length) return;

  // Close any existing lightbox first
  if (_lightboxOpen) closeLightbox();

  _lightboxIndex = index;
  _lightboxOpen = true;

  const image = _currentImages[index];
  if (!image) return;

  // Push history state so browser Back closes the lightbox
  history.pushState({ lightbox: true, index }, '', location.href);

  // Build overlay DOM
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.setAttribute('role', 'presentation');
  overlay.innerHTML = buildLightboxHtml(image, index, _currentImages.length);
  document.body.appendChild(overlay);
  _lightboxEl = overlay;

  // Body scroll lock
  document.body.classList.add('lightbox-open');

  // Load image into wrap
  const wrap = overlay.querySelector<HTMLElement>('#lightbox-img-wrap');
  if (wrap) await loadLightboxImage(image, wrap);

  // Preload adjacent
  updatePreloadLinks(index, _currentImages);

  // Focus close button (accessibility)
  const closeBtn = overlay.querySelector<HTMLButtonElement>('.lightbox__close');
  closeBtn?.focus();

  // Wire close button
  closeBtn?.addEventListener('click', () => history.back());

  // Wire backdrop click
  overlay.querySelector('.lightbox__backdrop')?.addEventListener('click', () => history.back());

  // Wire nav buttons
  overlay.querySelector('.lightbox__nav-prev')?.addEventListener('click', () => {
    if (_lightboxIndex > 0) void navigateLightbox(_lightboxIndex - 1);
  });
  overlay.querySelector('.lightbox__nav-next')?.addEventListener('click', () => {
    if (_lightboxIndex < _currentImages.length - 1) void navigateLightbox(_lightboxIndex + 1);
  });

  // Keyboard handler
  const keyHandler = buildLightboxKeyHandler();
  _lightboxKeyHandler = keyHandler;
  document.addEventListener('keydown', keyHandler);

  // Popstate (browser back) handler
  const popstateHandler = () => {
    if (_lightboxOpen) closeLightbox();
  };
  _lightboxPopstateHandler = popstateHandler;
  window.addEventListener('popstate', popstateHandler, { once: true });
}

// ---- Multi-select management ----

function updateCompareButton(): void {
  const toolbar = _albumTarget?.querySelector<HTMLElement>('.album-toolbar');
  if (!toolbar) return;

  let btn = toolbar.querySelector<HTMLButtonElement>('.album-compare-btn');
  const count = _multiSelected.size;

  if (count >= 2) {
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'album-compare-btn';
      btn.addEventListener('click', () => {
        const paths = Array.from(_multiSelected);
        if (paths.length >= 2 && _compareCallback) {
          _compareCallback(paths);
        }
      });
      toolbar.appendChild(btn);
    }
    btn.textContent = `Compare (${count})`;
    btn.style.display = '';
  } else if (btn) {
    btn.style.display = 'none';
  }
}

function syncTileSelectionClass(): void {
  if (!_albumTarget) return;
  const tiles = _albumTarget.querySelectorAll<HTMLElement>('.album-tile');
  tiles.forEach((tile) => {
    const path = tile.dataset.path ?? '';
    const isMulti = _multiSelected.has(path);
    tile.classList.toggle('album-tile--multi-selected', isMulti);
    // Update checkmark visibility
    const check = tile.querySelector<HTMLElement>('.album-tile__check');
    if (check) check.style.display = isMulti ? '' : 'none';
  });
}

function toggleMultiSelect(path: string, index: number): void {
  if (_multiSelected.has(path)) {
    _multiSelected.delete(path);
  } else {
    if (_multiSelected.size >= MAX_COMPARE) {
      // Remove the oldest entry (first in iteration order)
      const first = _multiSelected.values().next();
      if (!first.done) _multiSelected.delete(first.value);
    }
    _multiSelected.add(path);
  }
  _lastClickedIndex = index;
  syncTileSelectionClass();
  updateCompareButton();
  updatePrintButton();
}

function rangeSelect(endIndex: number): void {
  if (_lastClickedIndex < 0 || !_albumTarget) return;
  const start = Math.min(_lastClickedIndex, endIndex);
  const end = Math.max(_lastClickedIndex, endIndex);
  for (let i = start; i <= end; i++) {
    const img = _currentImages[i];
    if (!img) continue;
    if (!_multiSelected.has(img.path)) {
      if (_multiSelected.size >= MAX_COMPARE) break;
      _multiSelected.add(img.path);
    }
  }
  _lastClickedIndex = endIndex;
  syncTileSelectionClass();
  updateCompareButton();
  updatePrintButton();
}

function clearMultiSelection(): void {
  _multiSelected.clear();
  syncTileSelectionClass();
  updateCompareButton();
  updatePrintButton();
}

// ---- Tile interaction handler — F3 Lightbox or multi-select ----
function handleImageClick(_image: AlbumImage, index: number, e?: MouseEvent): void {
  // Accept both metaKey (Cmd on macOS) and ctrlKey (Ctrl on any platform) for multi-select.
  const isModified = e ? (e.metaKey || e.ctrlKey) : false;
  const isShift = e?.shiftKey ?? false;

  if (isShift && _lastClickedIndex >= 0) {
    // Shift+Click: range select
    rangeSelect(index);
    return;
  }

  if (isModified) {
    // Cmd/Ctrl+Click: toggle multi-select
    toggleMultiSelect(_image.path, index);
    return;
  }

  // Normal click: open Lightbox (clear multi-select)
  void openLightbox(index);
}

// ---- Selection management ----
function setSelected(index: number): void {
  if (!_albumTarget) return;
  const tiles = _albumTarget.querySelectorAll<HTMLElement>('.album-tile');

  if (_selectedIndex >= 0 && _selectedIndex < tiles.length) {
    tiles[_selectedIndex]?.classList.remove('album-tile--selected');
    tiles[_selectedIndex]?.removeAttribute('aria-selected');
  }

  _selectedIndex = Math.max(0, Math.min(tiles.length - 1, index));

  const tile = tiles[_selectedIndex];
  if (tile) {
    tile.classList.add('album-tile--selected');
    tile.setAttribute('aria-selected', 'true');
    tile.focus({ preventScroll: false });
    tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function getColumnsCount(): number {
  if (!_albumTarget) return 4;
  const grid = _albumTarget.querySelector<HTMLElement>('.album-grid');
  if (!grid) return 4;
  const style = window.getComputedStyle(grid);
  const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length;
  return cols > 0 ? cols : 4;
}

// ---- Keyboard handler (album grid) ----
function buildKeyboardHandler(): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    // Don't handle when lightbox is open (lightbox has its own handler)
    if (_lightboxOpen) return;
    if (!_albumTarget) return;
    // Don't interfere when typing in inputs
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const total = _currentImages.length;
    if (total === 0) return;

    const cols = getColumnsCount();

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        setSelected(_selectedIndex < 0 ? 0 : Math.min(_selectedIndex + 1, total - 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setSelected(_selectedIndex <= 0 ? 0 : _selectedIndex - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelected(_selectedIndex < 0 ? 0 : Math.min(_selectedIndex + cols, total - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelected(_selectedIndex < cols ? 0 : _selectedIndex - cols);
        break;
      case 'Enter': {
        e.preventDefault();
        if (_selectedIndex >= 0 && _selectedIndex < total) {
          handleImageClick(_currentImages[_selectedIndex]!, _selectedIndex);
        }
        break;
      }
      case ' ': {
        e.preventDefault();
        if (_selectedIndex >= 0 && _selectedIndex < total) {
          const img = _currentImages[_selectedIndex];
          if (img) toggleMultiSelect(img.path, _selectedIndex);
        }
        break;
      }
      case 'c':
      case 'C': {
        // Skip when modifier keys are held (let browser copy/paste work)
        if (e.metaKey || e.ctrlKey || e.altKey) break;
        if (_multiSelected.size === 0 && _selectedIndex < 0) break;
        e.preventDefault();
        void copyNamesForKeyboardShortcut();
        break;
      }
      case 'Escape':
        e.preventDefault();
        // First clear multi-selection if any, then deselect keyboard focus
        if (_multiSelected.size > 0) {
          clearMultiSelection();
        } else if (_selectedIndex >= 0) {
          const tiles = _albumTarget?.querySelectorAll<HTMLElement>('.album-tile');
          tiles?.[_selectedIndex]?.classList.remove('album-tile--selected');
          tiles?.[_selectedIndex]?.removeAttribute('aria-selected');
          _selectedIndex = -1;
          // Return focus to the album toolbar so user can navigate elsewhere
          _albumTarget?.querySelector<HTMLElement>('.album-toolbar')?.focus();
        }
        break;
      default:
        break;
    }
  };
}

// ---- IntersectionObserver for prioritized loading ----
function setupIntersectionObserver(target: HTMLElement): void {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }

  _observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const img = entry.target as HTMLImageElement;
        if (entry.isIntersecting && img.dataset.lazySrc) {
          img.src = img.dataset.lazySrc;
          delete img.dataset.lazySrc;
          _observer?.unobserve(img);
        }
      }
    },
    { root: null, rootMargin: '200px 0px', threshold: 0 },
  );

  target.querySelectorAll<HTMLImageElement>('img[data-lazy-src]').forEach((img) => {
    _observer?.observe(img);
  });
}

// ---- Render ----
function renderGrid(images: AlbumImage[]): string {
  if (images.length === 0) {
    return `<div class="album-empty">画像がありません</div>`;
  }

  const tiles = images.map((img, i) => {
    const src = `/api/file?path=${encodeURIComponent(img.path)}`;
    const isMultiSel = _multiSelected.has(img.path);
    return `<div
      class="album-tile${isMultiSel ? ' album-tile--multi-selected' : ''}"
      data-index="${i}"
      data-path="${esc(img.path)}"
      role="gridcell"
      tabindex="-1"
      title="${esc(img.name)} (${formatSize(img.size)})"
    >
      <div class="album-tile__img-wrap">
        <img
          class="album-tile__img"
          data-lazy-src="${esc(src)}"
          src=""
          loading="lazy"
          decoding="async"
          alt="${esc(img.name)}"
        />
        <div class="album-tile__check" aria-hidden="true" style="${isMultiSel ? '' : 'display:none'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
      <div class="album-tile__meta">
        <div class="album-tile__meta-text">
          <span class="album-tile__name" title="${esc(img.name)}">${esc(img.name)}</span>
          <span class="album-tile__size">${formatSize(img.size)}</span>
        </div>
        <button
          type="button"
          class="album-tile__copy"
          data-copy-index="${i}"
          aria-label="ファイル名をコピー"
          title="ファイル名をコピー"
        >
          <svg class="album-tile__copy-icon album-tile__copy-icon--copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg class="album-tile__copy-icon album-tile__copy-icon--ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `<div class="album-grid" role="grid">${tiles}</div>`;
}

async function fetchAlbum(path: string, recursive: boolean): Promise<AlbumResponse> {
  const params = new URLSearchParams({ path, recursive: recursive ? '1' : '0' });
  const res = await fetch(`/api/album?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<AlbumResponse>;
}

/**
 * Render an album view into `target`.
 *
 * @param path - Serve-root-relative directory path.
 * @param target - Container element to render into.
 * @param openImage - Callback invoked when user opens a single image (Enter key / click).
 *                   Kept for API compatibility but no longer used (Lightbox takes over).
 * @param recursive - Initial recursive state (default false).
 * @param onCompare - Callback invoked when the user clicks Compare button (2-4 paths).
 */
export async function renderAlbum(
  path: string,
  target: HTMLElement,
  openImage: OpenImageCallback | null = null,
  recursive = false,
  onCompare: CompareCallback | null = null,
): Promise<void> {
  _albumTarget = target;
  _currentAlbumPath = path;
  _selectedIndex = -1;
  _currentImages = [];

  // Dispose any previous keyboard handler and lightbox
  disposeAlbum();

  // Set compare callback AFTER disposeAlbum (which clears it)
  _compareCallback = onCompare;

  target.innerHTML = `<div class="album-view">
    <div class="album-toolbar" tabindex="-1">
      <span class="album-toolbar__title">${esc(path)}</span>
      <label class="album-toolbar__recursive">
        <input type="checkbox" id="album-recursive-toggle" ${recursive ? 'checked' : ''}/>
        サブフォルダを含む
      </label>
    </div>
    <div class="album-loading">読み込み中...</div>
  </div>`;

  const albumView = target.querySelector<HTMLElement>('.album-view')!;

  // Wire up recursive toggle
  const toggle = target.querySelector<HTMLInputElement>('#album-recursive-toggle');
  toggle?.addEventListener('change', () => {
    const newRecursive = toggle.checked;
    // Re-render with new recursive flag
    void renderAlbum(path, target, openImage, newRecursive, onCompare);
  });

  let data: AlbumResponse;
  try {
    data = await fetchAlbum(path, recursive);
  } catch (err: unknown) {
    target.innerHTML = `<div class="album-view"><div class="error-banner"><p>アルバムの読み込みに失敗しました: ${esc(String(err instanceof Error ? err.message : err))}</p></div></div>`;
    return;
  }

  _currentImages = data.images;

  const banner = data.truncated
    ? `<div class="album-banner album-banner--warn">
        上限 (${data.total} 件) に達しました。一部の画像は表示されていません。
       </div>`
    : '';

  albumView.innerHTML = `
    <div class="album-toolbar" tabindex="-1">
      <span class="album-toolbar__title">${esc(path)}</span>
      <span class="album-toolbar__count">${data.total} 枚</span>
      <label class="album-toolbar__recursive">
        <input type="checkbox" id="album-recursive-toggle" ${recursive ? 'checked' : ''}/>
        サブフォルダを含む
      </label>
    </div>
    ${banner}
    ${renderGrid(data.images)}
  `;

  // Re-wire toggle after re-render
  const toggle2 = albumView.querySelector<HTMLInputElement>('#album-recursive-toggle');
  toggle2?.addEventListener('change', () => {
    void renderAlbum(path, target, openImage, toggle2.checked, onCompare);
  });

  // Add Print button to toolbar (F11 Contact Sheet)
  const toolbar2 = albumView.querySelector<HTMLElement>('.album-toolbar');
  if (toolbar2) {
    upsertPrintControls(toolbar2, data.images, path);
  }

  // Wire tile clicks → Lightbox or multi-select
  albumView.querySelectorAll<HTMLElement>('.album-tile').forEach((tile, i) => {
    tile.addEventListener('click', (e) => {
      // Skip if the click originated from the copy button (handled separately)
      const target = e.target as HTMLElement;
      if (target.closest('.album-tile__copy')) return;
      e.stopPropagation();
      setSelected(i);
      const img = _currentImages[i];
      if (img) handleImageClick(img, i, e);
    });
    // Copy-filename button
    const copyBtn = tile.querySelector<HTMLButtonElement>('.album-tile__copy');
    copyBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const img = _currentImages[i];
      if (!img) return;
      const ok = await copyTextToClipboard(img.name);
      flashCopyFeedback(copyBtn, ok);
    });
    copyBtn?.addEventListener('keydown', (e) => {
      // Prevent Enter/Space from bubbling up to tile handlers which open Lightbox
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
      }
    });
    tile.addEventListener('focus', () => {
      _selectedIndex = i;
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const img = _currentImages[i];
        if (img) handleImageClick(img, i);
      }
    });
    // Make tiles keyboard-focusable
    tile.setAttribute('tabindex', '0');
  });

  // Setup IntersectionObserver for lazy loading
  setupIntersectionObserver(albumView);

  // Register global keyboard handler
  const handler = buildKeyboardHandler();
  _keyboardHandler = handler;
  document.addEventListener('keydown', handler);
}

// ---- Contact Sheet (F11) ----

/**
 * Build a .contact-sheet-preview DOM element for printing.
 * The element is appended to body during printing and removed after.
 */
function buildContactSheetPreview(images: AlbumImage[], dirPath: string, cols: ContactSheetCols): HTMLElement {
  if (images.length > 100) {
    console.warn(`[album] Contact Sheet: printing ${images.length} images (>100) — this may be slow.`);
  }

  const now = new Date().toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const tiles = images.map((img, i) => {
    const src = `/api/file?path=${encodeURIComponent(img.path)}`;
    return `<div class="contact-sheet-tile">
      <div class="contact-sheet-img-wrap">
        <img src="${esc(src)}" alt="${esc(img.name)}" class="contact-sheet-img" />
      </div>
      <div class="contact-sheet-number">${i + 1}</div>
      <div class="contact-sheet-caption" title="${esc(img.name)}">${esc(img.name)}</div>
    </div>`;
  }).join('');

  const preview = document.createElement('div');
  preview.className = 'contact-sheet-preview';
  preview.innerHTML = `
    <div class="contact-sheet-header">
      <span class="contact-sheet-header__path">${esc(dirPath)}</span>
      <span class="contact-sheet-header__count">${images.length} 枚</span>
      <span class="contact-sheet-header__date">${esc(now)}</span>
    </div>
    <div class="contact-sheet-grid" style="--cols: ${cols}">${tiles}</div>
  `;
  return preview;
}

/**
 * Trigger browser print dialog with Contact Sheet layout.
 * Builds the preview DOM, attaches it, calls window.print(), then cleans up.
 */
function triggerContactSheetPrint(images: AlbumImage[], dirPath: string): void {
  if (images.length === 0) {
    alert('印刷する画像がありません。');
    return;
  }

  const cols = getContactSheetCols();
  const preview = buildContactSheetPreview(images, dirPath, cols);

  document.body.classList.add('contact-sheet-printing');
  document.body.appendChild(preview);

  const cleanup = (): void => {
    document.body.classList.remove('contact-sheet-printing');
    preview.remove();
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);
  window.print();
}

/**
 * Return the list of images targeted by the Print button.
 * When there is a multi-selection, only the selected subset is returned
 * (preserving album display order). Otherwise, all current images are returned.
 */
function getPrintTargets(): AlbumImage[] {
  if (_multiSelected.size === 0) return _currentImages;
  return _currentImages.filter((img) => _multiSelected.has(img.path));
}

/**
 * Update the Print button label / aria / disabled state based on current
 * selection. Called whenever multi-select changes or album re-renders.
 */
function updatePrintButton(): void {
  const toolbar = _albumTarget?.querySelector<HTMLElement>('.album-toolbar');
  const btn = toolbar?.querySelector<HTMLButtonElement>('.album-print-btn');
  if (!btn) return;

  const selectionCount = _multiSelected.size;
  const totalCount = _currentImages.length;
  const targetCount = selectionCount > 0 ? selectionCount : totalCount;

  const label = btn.querySelector<HTMLElement>('.album-print-btn__label');
  if (label) {
    label.textContent = selectionCount > 0 ? `Print (${selectionCount})` : 'Print';
  }

  if (totalCount === 0) {
    btn.disabled = true;
    btn.title = '印刷する画像がありません';
    btn.setAttribute('aria-label', '印刷する画像がありません');
  } else if (selectionCount > 0) {
    btn.disabled = false;
    btn.title = `選択中の ${selectionCount} 枚を印刷`;
    btn.setAttribute('aria-label', `Print selected ${selectionCount} images`);
  } else {
    btn.disabled = false;
    btn.title = `アルバム全 ${targetCount} 枚を印刷`;
    btn.setAttribute('aria-label', 'Print all images in this album');
  }
}

/**
 * Create or update the Print button and columns selector in the album toolbar.
 */
function upsertPrintControls(toolbar: HTMLElement, images: AlbumImage[], dirPath: string): void {
  // Avoid duplicates
  if (toolbar.querySelector('.album-print-btn')) return;

  const colSelect = document.createElement('select');
  colSelect.className = 'album-print-cols';
  colSelect.setAttribute('aria-label', '列数');
  colSelect.title = '列数';

  const currentCols = getContactSheetCols();
  for (const c of VALID_COLS) {
    const opt = document.createElement('option');
    opt.value = String(c);
    opt.textContent = `${c} 列`;
    if (c === currentCols) opt.selected = true;
    colSelect.appendChild(opt);
  }

  colSelect.addEventListener('change', () => {
    const n = parseInt(colSelect.value, 10);
    if ((VALID_COLS as readonly number[]).includes(n)) {
      setContactSheetCols(n as ContactSheetCols);
    }
  });

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'album-print-btn';
  printBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg><span class="album-print-btn__label">Print</span>`;

  // Initial disabled state for empty album
  if (images.length === 0) {
    printBtn.disabled = true;
  }

  printBtn.addEventListener('click', () => {
    const targets = getPrintTargets();
    triggerContactSheetPrint(targets, _currentAlbumPath ?? dirPath);
  });

  toolbar.appendChild(colSelect);
  toolbar.appendChild(printBtn);

  // Set initial label/aria/title based on current state
  updatePrintButton();
}

/**
 * Dispose album keyboard handler, IntersectionObserver, and any open Lightbox.
 * Call this when navigating away from album view.
 */
export function disposeAlbum(): void {
  // Close lightbox without using history.back() to avoid unintended navigation
  if (_lightboxOpen) {
    _lightboxOpen = false;
    document.body.classList.remove('lightbox-open');

    if (_lightboxKeyHandler) {
      document.removeEventListener('keydown', _lightboxKeyHandler);
      _lightboxKeyHandler = null;
    }
    if (_lightboxPopstateHandler) {
      window.removeEventListener('popstate', _lightboxPopstateHandler);
      _lightboxPopstateHandler = null;
    }
    if (_lbMouseMoveHandler) {
      document.removeEventListener('mousemove', _lbMouseMoveHandler);
      _lbMouseMoveHandler = null;
    }
    if (_lbMouseUpHandler) {
      document.removeEventListener('mouseup', _lbMouseUpHandler);
      _lbMouseUpHandler = null;
    }
    for (const link of _preloadLinks) {
      link.remove();
    }
    _preloadLinks = [];
    if (_lightboxEl) {
      _lightboxEl.remove();
      _lightboxEl = null;
    }
  }

  if (_keyboardHandler) {
    document.removeEventListener('keydown', _keyboardHandler);
    _keyboardHandler = null;
  }
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  // Clear multi-select state
  _multiSelected.clear();
  _lastClickedIndex = -1;
  _compareCallback = null;
}

/**
 * Re-fetch album data and re-render in-place.
 * Used for SSE-triggered live reload (debounced from main.ts).
 */
export async function refreshAlbum(
  path: string,
  target: HTMLElement,
  openImage: OpenImageCallback | null,
  recursive: boolean,
  onCompare: CompareCallback | null = null,
): Promise<void> {
  const wasSelected = _selectedIndex;
  // Preserve multi-selected paths across refresh (paths that still exist will be re-applied)
  const prevMultiSelected = new Set(_multiSelected);
  await renderAlbum(path, target, openImage, recursive, onCompare);
  // Restore multi-selection for paths that still exist in the new image list
  const newPaths = new Set(_currentImages.map((img) => img.path));
  for (const p of prevMultiSelected) {
    if (newPaths.has(p)) _multiSelected.add(p);
  }
  syncTileSelectionClass();
  updateCompareButton();
  updatePrintButton();
  // Restore keyboard selection if still valid
  if (wasSelected >= 0 && wasSelected < _currentImages.length) {
    setSelected(wasSelected);
  }
}

/** Return current album path (used by SSE handler in main.ts). */
export function currentAlbumPath(): string | null {
  return _currentAlbumPath;
}
