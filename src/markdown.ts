import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// @ts-expect-error — no type declarations
import footnote from 'markdown-it-footnote';
// @ts-expect-error — no type declarations
import mark from 'markdown-it-mark';
// @ts-expect-error — no type declarations
import sub from 'markdown-it-sub';
// @ts-expect-error — no type declarations
import sup from 'markdown-it-sup';
// @ts-expect-error — no type declarations
import { full as emoji } from 'markdown-it-emoji';
import anchor from 'markdown-it-anchor';
// @ts-expect-error — no type declarations
import container from 'markdown-it-container';
import githubAlerts from 'markdown-it-github-alerts';
// @ts-expect-error — no type declarations
import texmath from 'markdown-it-texmath';
import katex from 'katex';
// @ts-expect-error — no type declarations
import deflist from 'markdown-it-deflist';
import frontmatter from 'markdown-it-front-matter';

import 'katex/dist/katex.min.css';

let mermaidCounter = 0;
let diagramCounter = 0;
let diagramFullscreenOverlay: HTMLDivElement | null = null;
let diagramFullscreenTitle: HTMLHeadingElement | null = null;
let diagramFullscreenStage: HTMLDivElement | null = null;

function closeDiagramFullscreen() {
  if (!diagramFullscreenOverlay || !diagramFullscreenStage) return;
  diagramFullscreenOverlay.style.display = 'none';
  diagramFullscreenStage.innerHTML = '';
  document.body.classList.remove('diagram-fullscreen-open');
}

function ensureDiagramFullscreenOverlay() {
  if (diagramFullscreenOverlay && diagramFullscreenTitle && diagramFullscreenStage) {
    return {
      overlay: diagramFullscreenOverlay,
      title: diagramFullscreenTitle,
      stage: diagramFullscreenStage,
    };
  }

  diagramFullscreenOverlay = document.createElement('div');
  diagramFullscreenOverlay.className = 'diagram-fullscreen-overlay';
  diagramFullscreenOverlay.style.display = 'none';
  diagramFullscreenOverlay.setAttribute('role', 'dialog');
  diagramFullscreenOverlay.setAttribute('aria-modal', 'true');
  diagramFullscreenOverlay.setAttribute('aria-labelledby', 'diagram-fullscreen-title');

  const modal = document.createElement('div');
  modal.className = 'diagram-fullscreen-modal';

  const header = document.createElement('div');
  header.className = 'diagram-fullscreen-header';

  diagramFullscreenTitle = document.createElement('h2');
  diagramFullscreenTitle.id = 'diagram-fullscreen-title';
  diagramFullscreenTitle.className = 'diagram-fullscreen-title';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'diagram-fullscreen-close';
  closeButton.setAttribute('aria-label', 'Close fullscreen diagram');
  closeButton.innerHTML = '&times;';
  closeButton.addEventListener('click', () => closeDiagramFullscreen());

  header.appendChild(diagramFullscreenTitle);
  header.appendChild(closeButton);

  diagramFullscreenStage = document.createElement('div');
  diagramFullscreenStage.className = 'diagram-fullscreen-stage';

  modal.appendChild(header);
  modal.appendChild(diagramFullscreenStage);
  diagramFullscreenOverlay.appendChild(modal);
  document.body.appendChild(diagramFullscreenOverlay);

  diagramFullscreenOverlay.addEventListener('click', (e) => {
    if (e.target === diagramFullscreenOverlay) closeDiagramFullscreen();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && diagramFullscreenOverlay?.style.display !== 'none') {
      closeDiagramFullscreen();
    }
  });

  return {
    overlay: diagramFullscreenOverlay,
    title: diagramFullscreenTitle,
    stage: diagramFullscreenStage,
  };
}

function openDiagramFullscreen(source: SVGSVGElement, title: string) {
  const overlay = ensureDiagramFullscreenOverlay();
  overlay.title.textContent = title;
  overlay.stage.innerHTML = '';
  const clone = source.cloneNode(true);
  if (clone instanceof SVGSVGElement) {
    initFullscreenDiagramInteraction(clone);
    overlay.stage.appendChild(clone);
  }
  overlay.overlay.style.display = 'flex';
  document.body.classList.add('diagram-fullscreen-open');
}

type ZoomController = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

function attachZoomPan(svg: SVGSVGElement, opts: { wheelMode: 'always' | 'ctrl' }): ZoomController {
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  function applyTransform() {
    svg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    svg.style.cursor = isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in';
  }

  function setScale(next: number) {
    scale = Math.max(0.25, Math.min(6, next));
    if (scale <= 1) {
      scale = 1;
      translateX = 0;
      translateY = 0;
    }
    applyTransform();
  }

  svg.addEventListener('wheel', (e: WheelEvent) => {
    if (opts.wheelMode === 'ctrl' && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setScale(scale + delta);
  }, { passive: false });

  svg.addEventListener('dblclick', () => {
    setScale(scale > 1 ? 1 : 2);
  });

  svg.addEventListener('pointerdown', (e: PointerEvent) => {
    if (scale <= 1) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    applyTransform();
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    applyTransform();
  });

  const endDrag = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    applyTransform();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  applyTransform();

  return {
    zoomIn: () => setScale(scale + 0.25),
    zoomOut: () => setScale(scale - 0.25),
    reset: () => setScale(1),
  };
}

function initFullscreenDiagramInteraction(svg: SVGSVGElement) {
  attachZoomPan(svg, { wheelMode: 'always' });
}

const TOOLBAR_ICONS = {
  zoomIn:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  zoomOut:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  fit:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/></svg>',
  fullscreen:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  copy:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  external:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
};

interface DiagramToolbarOpts {
  surface: HTMLElement;
  title: string;
  source: string;
  kind: string;
}

function attachDiagramToolbar({ surface, title, source, kind }: DiagramToolbarOpts) {
  if (surface.querySelector('.diagram-toolbar')) return;
  const svg = surface.querySelector('svg');
  if (!(svg instanceof SVGSVGElement)) return;

  const zoom = attachZoomPan(svg, { wheelMode: 'ctrl' });

  const toolbar = document.createElement('div');
  toolbar.className = 'diagram-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', `${title} controls`);

  function addBtn(label: string, html: string, handler: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'diagram-toolbar-btn';
    b.innerHTML = html;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler();
      flashBtn(b);
    });
    toolbar.appendChild(b);
  }

  addBtn('Zoom in (Ctrl+Wheel)', TOOLBAR_ICONS.zoomIn, () => zoom.zoomIn());
  addBtn('Zoom out', TOOLBAR_ICONS.zoomOut, () => zoom.zoomOut());
  addBtn('Fit', TOOLBAR_ICONS.fit, () => zoom.reset());
  addBtn('Copy source', TOOLBAR_ICONS.copy, () => { void copySource(source); });
  addBtn('Download SVG', TOOLBAR_ICONS.download, () => downloadSvg(svg, title));
  addBtn('Download PNG', TOOLBAR_ICONS.download, () => { void downloadPng(svg, title); });
  if (kind === 'mermaid') {
    addBtn('Open in mermaid.live', TOOLBAR_ICONS.external, () => openInMermaidLive(source));
  }
  addBtn('Fullscreen', TOOLBAR_ICONS.fullscreen, () => {
    const currentSvg = surface.querySelector('svg');
    if (currentSvg instanceof SVGSVGElement) openDiagramFullscreen(currentSvg, title);
  });

  surface.appendChild(toolbar);
}

function flashBtn(btn: HTMLButtonElement) {
  btn.classList.add('diagram-toolbar-btn-flash');
  setTimeout(() => btn.classList.remove('diagram-toolbar-btn-flash'), 220);
}

async function copySource(source: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(source);
  } catch {
    // ignore
  }
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.style.transform = '';
  clone.style.cursor = '';
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return new XMLSerializer().serializeToString(clone);
}

function downloadSvg(svg: SVGSVGElement, title: string): void {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializeSvg(svg);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, `${slugifyTitle(title)}.svg`);
}

async function downloadPng(svg: SVGSVGElement, title: string): Promise<void> {
  // SVG → Image → Canvas 方式は Mermaid の foreignObject (HTML ラベル) を
  // ブラウザがレンダリングしないため空 PNG になる。modern-screenshot は
  // foreignObject を含む SVG も正しく PNG 化できる。
  try {
    const { domToBlob } = await import('modern-screenshot');
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const blob = await domToBlob(svg, {
      scale: 2,
      width: viewBox?.width || rect.width || 800,
      height: viewBox?.height || rect.height || 600,
      backgroundColor: getComputedStyle(document.body).getPropertyValue('background-color') || '#ffffff',
    });
    if (blob) triggerDownload(blob, `${slugifyTitle(title)}.png`);
  } catch (err) {
    console.error('PNG export failed:', err);
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugifyTitle(s: string): string {
  return (
    s.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram'
  );
}

function openInMermaidLive(source: string): void {
  try {
    const state = { code: source, mermaid: { theme: 'default' } };
    const json = JSON.stringify(state);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    window.open(`https://mermaid.live/edit#base64:${b64}`, '_blank', 'noopener,noreferrer');
  } catch {
    // ignore
  }
}

function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

import type { Theme } from './theme';

type MermaidVars = Record<string, string>;

const MERMAID_PALETTES: Record<Theme, { fontFamily: string; vars: MermaidVars }> = {
  light: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#eef2ff',
      primaryTextColor: '#312e81',
      primaryBorderColor: '#a5b4fc',
      secondaryColor: '#f5f3ff',
      secondaryTextColor: '#4338ca',
      secondaryBorderColor: '#c4b5fd',
      tertiaryColor: '#faf5ff',
      tertiaryTextColor: '#6d28d9',
      tertiaryBorderColor: '#d8b4fe',
      lineColor: '#6366f1',
      textColor: '#1e1b4b',
      mainBkg: '#eef2ff',
      nodeBorder: '#a5b4fc',
      clusterBkg: '#f5f3ff',
      clusterBorder: '#c4b5fd',
      titleColor: '#4338ca',
      edgeLabelBackground: '#ffffff',
      nodeTextColor: '#312e81',
      actorBkg: '#eef2ff',
      actorBorder: '#818cf8',
      actorTextColor: '#312e81',
      actorLineColor: '#a5b4fc',
      signalColor: '#6366f1',
      signalTextColor: '#312e81',
      labelBoxBkgColor: '#f5f3ff',
      labelBoxBorderColor: '#c4b5fd',
      labelTextColor: '#4338ca',
      loopTextColor: '#4338ca',
      noteBkgColor: '#fef3c7',
      noteTextColor: '#78350f',
      noteBorderColor: '#fbbf24',
      activationBkgColor: '#e0e7ff',
      activationBorderColor: '#818cf8',
      sequenceNumberColor: '#ffffff',
      attributeBackgroundColorOdd: '#ffffff',
      attributeBackgroundColorEven: '#f5f3ff',
      pie1: '#6366f1', pie2: '#8b5cf6', pie3: '#a855f7', pie4: '#c084fc',
      pie5: '#818cf8', pie6: '#6d28d9', pie7: '#a78bfa', pie8: '#7c3aed',
    },
  },
  dark: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#2d3263',
      primaryTextColor: '#e4e6f0',
      primaryBorderColor: '#4f52a8',
      secondaryColor: '#1e2744',
      secondaryTextColor: '#c7cae0',
      secondaryBorderColor: '#3a4070',
      tertiaryColor: '#1a2338',
      tertiaryTextColor: '#b0b4cc',
      tertiaryBorderColor: '#2e3558',
      lineColor: '#6366f1',
      textColor: '#e4e6f0',
      mainBkg: '#1e2040',
      nodeBorder: '#6366f1',
      clusterBkg: '#161830',
      clusterBorder: '#333660',
      titleColor: '#a5b4fc',
      edgeLabelBackground: '#1a1d2e',
      nodeTextColor: '#e4e6f0',
      actorBkg: '#2d3263',
      actorBorder: '#6366f1',
      actorTextColor: '#e4e6f0',
      actorLineColor: '#4f52a8',
      signalColor: '#818cf8',
      signalTextColor: '#e4e6f0',
      labelBoxBkgColor: '#1e2040',
      labelBoxBorderColor: '#4f52a8',
      labelTextColor: '#c7cae0',
      loopTextColor: '#a5b4fc',
      noteBkgColor: '#2a2d52',
      noteTextColor: '#e4e6f0',
      noteBorderColor: '#6366f1',
      activationBkgColor: '#2d3263',
      activationBorderColor: '#818cf8',
      sequenceNumberColor: '#1e2040',
      attributeBackgroundColorOdd: '#1e2040',
      attributeBackgroundColorEven: '#161830',
      pie1: '#6366f1', pie2: '#8b5cf6', pie3: '#a855f7', pie4: '#c084fc',
      pie5: '#818cf8', pie6: '#6d28d9', pie7: '#a78bfa', pie8: '#7c3aed',
    },
  },
  paper: {
    fontFamily: '"Lora", "Georgia", "Noto Serif JP", serif',
    vars: {
      primaryColor: '#ede1c4',
      primaryTextColor: '#3e2f1c',
      primaryBorderColor: '#a0724d',
      secondaryColor: '#e4d8b5',
      secondaryTextColor: '#5b4a32',
      secondaryBorderColor: '#c49770',
      tertiaryColor: '#f7f0de',
      tertiaryTextColor: '#6b4423',
      tertiaryBorderColor: '#d4c49c',
      lineColor: '#8b5a2b',
      textColor: '#3e2f1c',
      mainBkg: '#ede1c4',
      nodeBorder: '#a0724d',
      clusterBkg: '#f4ecd8',
      clusterBorder: '#cbb994',
      titleColor: '#6b4423',
      edgeLabelBackground: '#f4ecd8',
      nodeTextColor: '#3e2f1c',
      actorBkg: '#ede1c4',
      actorBorder: '#a0724d',
      actorTextColor: '#3e2f1c',
      actorLineColor: '#8b5a2b',
      signalColor: '#8b5a2b',
      signalTextColor: '#3e2f1c',
      labelBoxBkgColor: '#e4d8b5',
      labelBoxBorderColor: '#c49770',
      labelTextColor: '#5b4a32',
      loopTextColor: '#6b4423',
      noteBkgColor: '#f6e58d',
      noteTextColor: '#3e2f1c',
      noteBorderColor: '#a0724d',
      activationBkgColor: '#e4d8b5',
      activationBorderColor: '#c49770',
      sequenceNumberColor: '#f7f0de',
      attributeBackgroundColorOdd: '#f7f0de',
      attributeBackgroundColorEven: '#ede1c4',
      pie1: '#8b5a2b', pie2: '#a0724d', pie3: '#c49770', pie4: '#6b4423',
      pie5: '#9b2c2c', pie6: '#b45309', pie7: '#15803d', pie8: '#7c3aed',
    },
  },
  whiteboard: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#ffffff',
      primaryTextColor: '#0a0a0a',
      primaryBorderColor: '#0a0a0a',
      secondaryColor: '#fef3c7',
      secondaryTextColor: '#1a1a1a',
      secondaryBorderColor: '#404040',
      tertiaryColor: '#fafafa',
      tertiaryTextColor: '#0a0a0a',
      tertiaryBorderColor: '#404040',
      lineColor: '#0a0a0a',
      textColor: '#0a0a0a',
      mainBkg: '#ffffff',
      nodeBorder: '#0a0a0a',
      clusterBkg: '#fafafa',
      clusterBorder: '#404040',
      titleColor: '#e63946',
      edgeLabelBackground: '#ffffff',
      nodeTextColor: '#0a0a0a',
      actorBkg: '#ffffff',
      actorBorder: '#0a0a0a',
      actorTextColor: '#0a0a0a',
      actorLineColor: '#404040',
      signalColor: '#e63946',
      signalTextColor: '#0a0a0a',
      labelBoxBkgColor: '#fef3c7',
      labelBoxBorderColor: '#404040',
      labelTextColor: '#0a0a0a',
      loopTextColor: '#1e40af',
      noteBkgColor: '#fef3c7',
      noteTextColor: '#78350f',
      noteBorderColor: '#fbbf24',
      activationBkgColor: '#fafafa',
      activationBorderColor: '#0a0a0a',
      sequenceNumberColor: '#ffffff',
      attributeBackgroundColorOdd: '#ffffff',
      attributeBackgroundColorEven: '#fafafa',
      pie1: '#e63946', pie2: '#1e40af', pie3: '#15803d', pie4: '#d97706',
      pie5: '#7c3aed', pie6: '#0891b2', pie7: '#be123c', pie8: '#4338ca',
    },
  },
  handwritten: {
    fontFamily: '"Kalam", "Caveat", "Klee One", "Comic Sans MS", cursive',
    vars: {
      primaryColor: '#fdfcf7',
      primaryTextColor: '#1e3a8a',
      primaryBorderColor: '#1e3a8a',
      secondaryColor: '#f8f5ea',
      secondaryTextColor: '#334e8a',
      secondaryBorderColor: '#6b7fa8',
      tertiaryColor: '#f1ecdb',
      tertiaryTextColor: '#1e3a8a',
      tertiaryBorderColor: '#c9d6e8',
      lineColor: '#1e3a8a',
      textColor: '#1e3a8a',
      mainBkg: '#fdfcf7',
      nodeBorder: '#1e3a8a',
      clusterBkg: '#f8f5ea',
      clusterBorder: '#c9d6e8',
      titleColor: '#dc2626',
      edgeLabelBackground: '#fdfcf7',
      nodeTextColor: '#1e3a8a',
      actorBkg: '#fdfcf7',
      actorBorder: '#1e3a8a',
      actorTextColor: '#1e3a8a',
      actorLineColor: '#6b7fa8',
      signalColor: '#dc2626',
      signalTextColor: '#1e3a8a',
      labelBoxBkgColor: '#f8f5ea',
      labelBoxBorderColor: '#c9d6e8',
      labelTextColor: '#334e8a',
      loopTextColor: '#dc2626',
      noteBkgColor: '#fef08a',
      noteTextColor: '#1e3a8a',
      noteBorderColor: '#fbbf24',
      activationBkgColor: '#f8f5ea',
      activationBorderColor: '#1e3a8a',
      sequenceNumberColor: '#fdfcf7',
      attributeBackgroundColorOdd: '#fdfcf7',
      attributeBackgroundColorEven: '#f8f5ea',
      pie1: '#1e3a8a', pie2: '#dc2626', pie3: '#15803d', pie4: '#b45309',
      pie5: '#7c3aed', pie6: '#1d4ed8', pie7: '#b91c1c', pie8: '#334e8a',
    },
  },
  sakura: {
    fontFamily: '"Lora", "Noto Serif JP", "Hiragino Mincho ProN", Georgia, serif',
    vars: {
      primaryColor: '#ffe8ee',
      primaryTextColor: '#5b1a3e',
      primaryBorderColor: '#ec407a',
      secondaryColor: '#fcd7e0',
      secondaryTextColor: '#823560',
      secondaryBorderColor: '#f48fb1',
      tertiaryColor: '#fff5f7',
      tertiaryTextColor: '#c2185b',
      tertiaryBorderColor: '#f5b8c8',
      lineColor: '#e91e63',
      textColor: '#5b1a3e',
      mainBkg: '#ffe8ee',
      nodeBorder: '#ec407a',
      clusterBkg: '#fff5f7',
      clusterBorder: '#f5b8c8',
      titleColor: '#c2185b',
      edgeLabelBackground: '#fff5f7',
      nodeTextColor: '#5b1a3e',
      actorBkg: '#ffe8ee',
      actorBorder: '#ec407a',
      actorTextColor: '#5b1a3e',
      actorLineColor: '#f48fb1',
      signalColor: '#e91e63',
      signalTextColor: '#5b1a3e',
      labelBoxBkgColor: '#fcd7e0',
      labelBoxBorderColor: '#f48fb1',
      labelTextColor: '#823560',
      loopTextColor: '#c2185b',
      noteBkgColor: '#fff59d',
      noteTextColor: '#5b1a3e',
      noteBorderColor: '#fbbf24',
      activationBkgColor: '#fcd7e0',
      activationBorderColor: '#ec407a',
      sequenceNumberColor: '#fff5f7',
      attributeBackgroundColorOdd: '#fff5f7',
      attributeBackgroundColorEven: '#fcd7e0',
      pie1: '#e91e63', pie2: '#ec407a', pie3: '#f48fb1', pie4: '#fbb6ce',
      pie5: '#c2185b', pie6: '#6a1b9a', pie7: '#1976d2', pie8: '#2e7d32',
    },
  },
  matrix: {
    fontFamily: '"JetBrains Mono", "Courier Prime", ui-monospace, monospace',
    vars: {
      primaryColor: '#03060a',
      primaryTextColor: '#00ff41',
      primaryBorderColor: '#00ff41',
      secondaryColor: '#050b12',
      secondaryTextColor: '#00cc33',
      secondaryBorderColor: '#0a3818',
      tertiaryColor: '#000000',
      tertiaryTextColor: '#39ff70',
      tertiaryBorderColor: '#0a3818',
      lineColor: '#00ff41',
      textColor: '#00ff41',
      mainBkg: '#03060a',
      nodeBorder: '#00ff41',
      clusterBkg: '#000000',
      clusterBorder: '#0a3818',
      titleColor: '#39ff70',
      edgeLabelBackground: '#000000',
      nodeTextColor: '#00ff41',
      actorBkg: '#03060a',
      actorBorder: '#00ff41',
      actorTextColor: '#00ff41',
      actorLineColor: '#0a3818',
      signalColor: '#00d9ff',
      signalTextColor: '#00ff41',
      labelBoxBkgColor: '#03060a',
      labelBoxBorderColor: '#0a3818',
      labelTextColor: '#00cc33',
      loopTextColor: '#39ff70',
      noteBkgColor: '#0a1f10',
      noteTextColor: '#39ff70',
      noteBorderColor: '#00ff41',
      activationBkgColor: '#0a3818',
      activationBorderColor: '#00ff41',
      sequenceNumberColor: '#000000',
      attributeBackgroundColorOdd: '#000000',
      attributeBackgroundColorEven: '#050b12',
      pie1: '#00ff41', pie2: '#39ff70', pie3: '#00d9ff', pie4: '#6aff9a',
      pie5: '#c724ff', pie6: '#ff0844', pie7: '#ffcc00', pie8: '#007722',
    },
  },
  cyberpunk: {
    fontFamily: '"JetBrains Mono", "Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#161634',
      primaryTextColor: '#e8e8ff',
      primaryBorderColor: '#ff2d95',
      secondaryColor: '#0f0f24',
      secondaryTextColor: '#b8b8d8',
      secondaryBorderColor: '#2a2a55',
      tertiaryColor: '#1f1f44',
      tertiaryTextColor: '#05d9e8',
      tertiaryBorderColor: '#2a2a55',
      lineColor: '#ff2d95',
      textColor: '#e8e8ff',
      mainBkg: '#161634',
      nodeBorder: '#ff2d95',
      clusterBkg: '#0f0f24',
      clusterBorder: '#2a2a55',
      titleColor: '#05d9e8',
      edgeLabelBackground: '#0a0a18',
      nodeTextColor: '#e8e8ff',
      actorBkg: '#161634',
      actorBorder: '#ff2d95',
      actorTextColor: '#e8e8ff',
      actorLineColor: '#c724ff',
      signalColor: '#05d9e8',
      signalTextColor: '#e8e8ff',
      labelBoxBkgColor: '#161634',
      labelBoxBorderColor: '#ff2d95',
      labelTextColor: '#05d9e8',
      loopTextColor: '#ff2d95',
      noteBkgColor: '#1f1f44',
      noteTextColor: '#f9f871',
      noteBorderColor: '#f9f871',
      activationBkgColor: '#1a1a3a',
      activationBorderColor: '#ff2d95',
      sequenceNumberColor: '#0a0a18',
      attributeBackgroundColorOdd: '#0a0a18',
      attributeBackgroundColorEven: '#161634',
      pie1: '#ff2d95', pie2: '#05d9e8', pie3: '#c724ff', pie4: '#f9f871',
      pie5: '#00ff9c', pie6: '#ff5cb0', pie7: '#66e8ff', pie8: '#6a6a90',
    },
  },
  ascii: {
    fontFamily: '"JetBrains Mono", "Courier Prime", ui-monospace, monospace',
    vars: {
      primaryColor: '#ffffff',
      primaryTextColor: '#000000',
      primaryBorderColor: '#000000',
      secondaryColor: '#fafafa',
      secondaryTextColor: '#000000',
      secondaryBorderColor: '#000000',
      tertiaryColor: '#ffffff',
      tertiaryTextColor: '#000000',
      tertiaryBorderColor: '#000000',
      lineColor: '#000000',
      textColor: '#000000',
      mainBkg: '#ffffff',
      nodeBorder: '#000000',
      clusterBkg: '#fafafa',
      clusterBorder: '#000000',
      titleColor: '#000000',
      edgeLabelBackground: '#ffffff',
      nodeTextColor: '#000000',
      actorBkg: '#ffffff',
      actorBorder: '#000000',
      actorTextColor: '#000000',
      actorLineColor: '#000000',
      signalColor: '#000000',
      signalTextColor: '#000000',
      labelBoxBkgColor: '#fafafa',
      labelBoxBorderColor: '#000000',
      labelTextColor: '#000000',
      loopTextColor: '#000000',
      noteBkgColor: '#ffffff',
      noteTextColor: '#000000',
      noteBorderColor: '#000000',
      activationBkgColor: '#fafafa',
      activationBorderColor: '#000000',
      sequenceNumberColor: '#ffffff',
      attributeBackgroundColorOdd: '#ffffff',
      attributeBackgroundColorEven: '#fafafa',
      pie1: '#000000', pie2: '#2a2a2a', pie3: '#555555', pie4: '#808080',
      pie5: '#a0a0a0', pie6: '#bfbfbf', pie7: '#d8d8d8', pie8: '#ededed',
    },
  },
  origami: {
    fontFamily: '"Klee One", "Lora", "Noto Serif JP", serif',
    vars: {
      primaryColor: '#f1ebde',
      primaryTextColor: '#1c1916',
      primaryBorderColor: '#c8503c',
      secondaryColor: '#e7ddc7',
      secondaryTextColor: '#3d3a35',
      secondaryBorderColor: '#cdc2a6',
      tertiaryColor: '#faf6ee',
      tertiaryTextColor: '#a8412f',
      tertiaryBorderColor: '#e0d6bf',
      lineColor: '#c8503c',
      textColor: '#1c1916',
      mainBkg: '#f1ebde',
      nodeBorder: '#c8503c',
      clusterBkg: '#faf6ee',
      clusterBorder: '#cdc2a6',
      titleColor: '#a8412f',
      edgeLabelBackground: '#faf6ee',
      nodeTextColor: '#1c1916',
      actorBkg: '#f1ebde',
      actorBorder: '#c8503c',
      actorTextColor: '#1c1916',
      actorLineColor: '#cdc2a6',
      signalColor: '#c8503c',
      signalTextColor: '#1c1916',
      labelBoxBkgColor: '#e7ddc7',
      labelBoxBorderColor: '#cdc2a6',
      labelTextColor: '#3d3a35',
      loopTextColor: '#a8412f',
      noteBkgColor: '#f5d76e',
      noteTextColor: '#1c1916',
      noteBorderColor: '#c8503c',
      activationBkgColor: '#e7ddc7',
      activationBorderColor: '#c8503c',
      sequenceNumberColor: '#faf6ee',
      attributeBackgroundColorOdd: '#faf6ee',
      attributeBackgroundColorEven: '#f1ebde',
      pie1: '#c8503c', pie2: '#2e7d32', pie3: '#b45309', pie4: '#7c3aed',
      pie5: '#1d4ed8', pie6: '#a8412f', pie7: '#d56a58', pie8: '#7a766c',
    },
  },
  newspaper: {
    fontFamily: '"Lora", "Georgia", "Noto Serif JP", serif',
    vars: {
      primaryColor: '#ebe3cf',
      primaryTextColor: '#181818',
      primaryBorderColor: '#888069',
      secondaryColor: '#ddd3b9',
      secondaryTextColor: '#383838',
      secondaryBorderColor: '#c4b89e',
      tertiaryColor: '#f3ecdb',
      tertiaryTextColor: '#8a1419',
      tertiaryBorderColor: '#d5cab2',
      lineColor: '#181818',
      textColor: '#181818',
      mainBkg: '#ebe3cf',
      nodeBorder: '#181818',
      clusterBkg: '#f3ecdb',
      clusterBorder: '#888069',
      titleColor: '#8a1419',
      edgeLabelBackground: '#f3ecdb',
      nodeTextColor: '#181818',
      actorBkg: '#ebe3cf',
      actorBorder: '#181818',
      actorTextColor: '#181818',
      actorLineColor: '#c4b89e',
      signalColor: '#8a1419',
      signalTextColor: '#181818',
      labelBoxBkgColor: '#ddd3b9',
      labelBoxBorderColor: '#888069',
      labelTextColor: '#383838',
      loopTextColor: '#8a1419',
      noteBkgColor: '#f0d860',
      noteTextColor: '#181818',
      noteBorderColor: '#888069',
      activationBkgColor: '#ddd3b9',
      activationBorderColor: '#181818',
      sequenceNumberColor: '#f3ecdb',
      attributeBackgroundColorOdd: '#f3ecdb',
      attributeBackgroundColorEven: '#ebe3cf',
      pie1: '#8a1419', pie2: '#14528a', pie3: '#1c5c2c', pie4: '#8c4a06',
      pie5: '#5e2787', pie6: '#383838', pie7: '#a5252b', pie8: '#888069',
    },
  },
  galaxy: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#0a0820',
      primaryTextColor: '#e8e6ff',
      primaryBorderColor: '#ffc14d',
      secondaryColor: '#14112e',
      secondaryTextColor: '#b8b5d6',
      secondaryBorderColor: '#2a2654',
      tertiaryColor: '#03020a',
      tertiaryTextColor: '#6ee0ff',
      tertiaryBorderColor: '#15123a',
      lineColor: '#ffc14d',
      textColor: '#e8e6ff',
      mainBkg: '#0a0820',
      nodeBorder: '#ffc14d',
      clusterBkg: '#03020a',
      clusterBorder: '#2a2654',
      titleColor: '#ffc14d',
      edgeLabelBackground: '#03020a',
      nodeTextColor: '#e8e6ff',
      actorBkg: '#0a0820',
      actorBorder: '#ffc14d',
      actorTextColor: '#e8e6ff',
      actorLineColor: '#2a2654',
      signalColor: '#6ee0ff',
      signalTextColor: '#e8e6ff',
      labelBoxBkgColor: '#14112e',
      labelBoxBorderColor: '#2a2654',
      labelTextColor: '#b8b5d6',
      loopTextColor: '#ffc14d',
      noteBkgColor: '#1c1844',
      noteTextColor: '#e8e6ff',
      noteBorderColor: '#6a3b8c',
      activationBkgColor: '#14112e',
      activationBorderColor: '#ffc14d',
      sequenceNumberColor: '#03020a',
      attributeBackgroundColorOdd: '#03020a',
      attributeBackgroundColorEven: '#0a0820',
      pie1: '#ffc14d', pie2: '#6ee0ff', pie3: '#c084ff', pie4: '#ff5c8a',
      pie5: '#76ffa0', pie6: '#6a3b8c', pie7: '#ff7a9b', pie8: '#5c5896',
    },
  },
  blueprint: {
    fontFamily: '"JetBrains Mono", "SF Mono", "Consolas", monospace',
    vars: {
      primaryColor: '#122347',
      primaryTextColor: '#eaf3ff',
      primaryBorderColor: '#5fcfff',
      secondaryColor: '#1a2e58',
      secondaryTextColor: '#b8c9e6',
      secondaryBorderColor: '#284978',
      tertiaryColor: '#0a162e',
      tertiaryTextColor: '#8addff',
      tertiaryBorderColor: '#1a2e58',
      lineColor: '#5fcfff',
      textColor: '#eaf3ff',
      mainBkg: '#122347',
      nodeBorder: '#5fcfff',
      clusterBkg: '#0a162e',
      clusterBorder: '#284978',
      titleColor: '#8addff',
      edgeLabelBackground: '#0a162e',
      nodeTextColor: '#eaf3ff',
      actorBkg: '#122347',
      actorBorder: '#5fcfff',
      actorTextColor: '#eaf3ff',
      actorLineColor: '#284978',
      signalColor: '#5fcfff',
      signalTextColor: '#eaf3ff',
      labelBoxBkgColor: '#1a2e58',
      labelBoxBorderColor: '#284978',
      labelTextColor: '#b8c9e6',
      loopTextColor: '#8addff',
      noteBkgColor: '#284978',
      noteTextColor: '#eaf3ff',
      noteBorderColor: '#5fcfff',
      activationBkgColor: '#1a2e58',
      activationBorderColor: '#5fcfff',
      sequenceNumberColor: '#0a162e',
      attributeBackgroundColorOdd: '#0a162e',
      attributeBackgroundColorEven: '#122347',
      pie1: '#5fcfff', pie2: '#74e0a0', pie3: '#ffd47a', pie4: '#ff7474',
      pie5: '#c084ff', pie6: '#8addff', pie7: '#b8c9e6', pie8: '#6b86b3',
    },
  },
  solarized: {
    fontFamily: '"Source Sans 3", "Source Sans Pro", -apple-system, sans-serif',
    vars: {
      primaryColor: '#eee8d5',
      primaryTextColor: '#586e75',
      primaryBorderColor: '#268bd2',
      secondaryColor: '#fdf6e3',
      secondaryTextColor: '#657b83',
      secondaryBorderColor: '#93a1a1',
      tertiaryColor: '#e4dcc2',
      tertiaryTextColor: '#cb4b16',
      tertiaryBorderColor: '#d9d2b8',
      lineColor: '#268bd2',
      textColor: '#586e75',
      mainBkg: '#eee8d5',
      nodeBorder: '#268bd2',
      clusterBkg: '#fdf6e3',
      clusterBorder: '#93a1a1',
      titleColor: '#cb4b16',
      edgeLabelBackground: '#fdf6e3',
      nodeTextColor: '#586e75',
      actorBkg: '#eee8d5',
      actorBorder: '#268bd2',
      actorTextColor: '#586e75',
      actorLineColor: '#93a1a1',
      signalColor: '#268bd2',
      signalTextColor: '#586e75',
      labelBoxBkgColor: '#fdf6e3',
      labelBoxBorderColor: '#d9d2b8',
      labelTextColor: '#657b83',
      loopTextColor: '#cb4b16',
      noteBkgColor: '#fceec4',
      noteTextColor: '#586e75',
      noteBorderColor: '#b58900',
      activationBkgColor: '#fdf6e3',
      activationBorderColor: '#268bd2',
      sequenceNumberColor: '#fdf6e3',
      attributeBackgroundColorOdd: '#fdf6e3',
      attributeBackgroundColorEven: '#eee8d5',
      pie1: '#268bd2', pie2: '#859900', pie3: '#b58900', pie4: '#dc322f',
      pie5: '#6c71c4', pie6: '#2aa198', pie7: '#cb4b16', pie8: '#d33682',
    },
  },
  tokyo: {
    fontFamily: '"Inter", -apple-system, "Segoe UI", sans-serif',
    vars: {
      primaryColor: '#24283b',
      primaryTextColor: '#c0caf5',
      primaryBorderColor: '#7aa2f7',
      secondaryColor: '#2f334d',
      secondaryTextColor: '#a9b1d6',
      secondaryBorderColor: '#3b4261',
      tertiaryColor: '#1a1b26',
      tertiaryTextColor: '#bb9af7',
      tertiaryBorderColor: '#2a2e42',
      lineColor: '#7aa2f7',
      textColor: '#c0caf5',
      mainBkg: '#24283b',
      nodeBorder: '#7aa2f7',
      clusterBkg: '#1a1b26',
      clusterBorder: '#3b4261',
      titleColor: '#bb9af7',
      edgeLabelBackground: '#1a1b26',
      nodeTextColor: '#c0caf5',
      actorBkg: '#24283b',
      actorBorder: '#7aa2f7',
      actorTextColor: '#c0caf5',
      actorLineColor: '#3b4261',
      signalColor: '#7aa2f7',
      signalTextColor: '#c0caf5',
      labelBoxBkgColor: '#2f334d',
      labelBoxBorderColor: '#3b4261',
      labelTextColor: '#a9b1d6',
      loopTextColor: '#bb9af7',
      noteBkgColor: '#3b4261',
      noteTextColor: '#c0caf5',
      noteBorderColor: '#7aa2f7',
      activationBkgColor: '#2f334d',
      activationBorderColor: '#7aa2f7',
      sequenceNumberColor: '#1a1b26',
      attributeBackgroundColorOdd: '#1a1b26',
      attributeBackgroundColorEven: '#24283b',
      pie1: '#7aa2f7', pie2: '#9ece6a', pie3: '#e0af68', pie4: '#f7768e',
      pie5: '#bb9af7', pie6: '#7dcfff', pie7: '#a9b1d6', pie8: '#7982a9',
    },
  },
  aurora: {
    fontFamily: '"Inter", -apple-system, "Segoe UI", sans-serif',
    vars: {
      primaryColor: '#14141c',
      primaryTextColor: '#f5f5fa',
      primaryBorderColor: '#a78bfa',
      secondaryColor: '#1e1e2c',
      secondaryTextColor: '#b5b5c8',
      secondaryBorderColor: '#28283a',
      tertiaryColor: '#0a0a0f',
      tertiaryTextColor: '#c4b5fd',
      tertiaryBorderColor: '#1a1a26',
      lineColor: '#a78bfa',
      textColor: '#f5f5fa',
      mainBkg: '#14141c',
      nodeBorder: '#a78bfa',
      clusterBkg: '#0a0a0f',
      clusterBorder: '#28283a',
      titleColor: '#c4b5fd',
      edgeLabelBackground: '#0a0a0f',
      nodeTextColor: '#f5f5fa',
      actorBkg: '#14141c',
      actorBorder: '#a78bfa',
      actorTextColor: '#f5f5fa',
      actorLineColor: '#28283a',
      signalColor: '#ec4899',
      signalTextColor: '#f5f5fa',
      labelBoxBkgColor: '#1e1e2c',
      labelBoxBorderColor: '#28283a',
      labelTextColor: '#b5b5c8',
      loopTextColor: '#f59e0b',
      noteBkgColor: '#28283a',
      noteTextColor: '#f5f5fa',
      noteBorderColor: '#a78bfa',
      activationBkgColor: '#1e1e2c',
      activationBorderColor: '#ec4899',
      sequenceNumberColor: '#0a0a0f',
      attributeBackgroundColorOdd: '#0a0a0f',
      attributeBackgroundColorEven: '#14141c',
      pie1: '#a78bfa', pie2: '#ec4899', pie3: '#f59e0b', pie4: '#86efac',
      pie5: '#7dd3fc', pie6: '#c4b5fd', pie7: '#f87171', pie8: '#6a6a80',
    },
  },
  glass: {
    fontFamily: '"SF Pro Display", "Inter", -apple-system, sans-serif',
    vars: {
      primaryColor: '#2a1f47',
      primaryTextColor: '#f8f7fc',
      primaryBorderColor: '#c9b4ff',
      secondaryColor: '#1f1737',
      secondaryTextColor: '#d4cfe5',
      secondaryBorderColor: '#3a2d5e',
      tertiaryColor: '#0d0a1a',
      tertiaryTextColor: '#ddccff',
      tertiaryBorderColor: '#251c40',
      lineColor: '#c9b4ff',
      textColor: '#f8f7fc',
      mainBkg: '#2a1f47',
      nodeBorder: '#c9b4ff',
      clusterBkg: '#1f1737',
      clusterBorder: '#3a2d5e',
      titleColor: '#ddccff',
      edgeLabelBackground: '#0d0a1a',
      nodeTextColor: '#f8f7fc',
      actorBkg: '#2a1f47',
      actorBorder: '#c9b4ff',
      actorTextColor: '#f8f7fc',
      actorLineColor: '#3a2d5e',
      signalColor: '#c9b4ff',
      signalTextColor: '#f8f7fc',
      labelBoxBkgColor: '#1f1737',
      labelBoxBorderColor: '#3a2d5e',
      labelTextColor: '#d4cfe5',
      loopTextColor: '#ddccff',
      noteBkgColor: '#3a2d5e',
      noteTextColor: '#f8f7fc',
      noteBorderColor: '#c9b4ff',
      activationBkgColor: '#1f1737',
      activationBorderColor: '#c9b4ff',
      sequenceNumberColor: '#0d0a1a',
      attributeBackgroundColorOdd: '#0d0a1a',
      attributeBackgroundColorEven: '#1f1737',
      pie1: '#c9b4ff', pie2: '#93d8ff', pie3: '#ffd980', pie4: '#ff9ab2',
      pie5: '#d8a8ff', pie6: '#b1ffce', pie7: '#ddccff', pie8: '#8c87a3',
    },
  },
  holo: {
    fontFamily: '"Inter", -apple-system, "Segoe UI", sans-serif',
    vars: {
      primaryColor: '#14141e',
      primaryTextColor: '#f5f5fa',
      primaryBorderColor: '#ff66cc',
      secondaryColor: '#1e1e2a',
      secondaryTextColor: '#b5b5c8',
      secondaryBorderColor: '#2a2a3c',
      tertiaryColor: '#0a0a10',
      tertiaryTextColor: '#66c8ff',
      tertiaryBorderColor: '#1a1a26',
      lineColor: '#c466ff',
      textColor: '#f5f5fa',
      mainBkg: '#14141e',
      nodeBorder: '#ff66cc',
      clusterBkg: '#0a0a10',
      clusterBorder: '#2a2a3c',
      titleColor: '#66c8ff',
      edgeLabelBackground: '#0a0a10',
      nodeTextColor: '#f5f5fa',
      actorBkg: '#14141e',
      actorBorder: '#ff66cc',
      actorTextColor: '#f5f5fa',
      actorLineColor: '#2a2a3c',
      signalColor: '#c466ff',
      signalTextColor: '#f5f5fa',
      labelBoxBkgColor: '#1e1e2a',
      labelBoxBorderColor: '#2a2a3c',
      labelTextColor: '#b5b5c8',
      loopTextColor: '#ffe066',
      noteBkgColor: '#2a2a3c',
      noteTextColor: '#f5f5fa',
      noteBorderColor: '#66ffcc',
      activationBkgColor: '#1e1e2a',
      activationBorderColor: '#ff66cc',
      sequenceNumberColor: '#0a0a10',
      attributeBackgroundColorOdd: '#0a0a10',
      attributeBackgroundColorEven: '#14141e',
      pie1: '#ff66cc', pie2: '#ffe066', pie3: '#66ffcc', pie4: '#66c8ff',
      pie5: '#c466ff', pie6: '#ff8a8a', pie7: '#b5b5c8', pie8: '#6a6a82',
    },
  },
  highcontrast: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#e4e6ec',
      primaryTextColor: '#0a0a0a',
      primaryBorderColor: '#0a3aa8',
      secondaryColor: '#f0f1f5',
      secondaryTextColor: '#26282e',
      secondaryBorderColor: '#9a9da8',
      tertiaryColor: '#ffffff',
      tertiaryTextColor: '#0a0a0a',
      tertiaryBorderColor: '#9a9da8',
      lineColor: '#0a0a0a',
      textColor: '#0a0a0a',
      mainBkg: '#e4e6ec',
      nodeBorder: '#0a3aa8',
      clusterBkg: '#f0f1f5',
      clusterBorder: '#3a3d45',
      titleColor: '#0a3aa8',
      edgeLabelBackground: '#ffffff',
      nodeTextColor: '#0a0a0a',
      actorBkg: '#e4e6ec',
      actorBorder: '#0a3aa8',
      actorTextColor: '#0a0a0a',
      actorLineColor: '#3a3d45',
      signalColor: '#0a0a0a',
      signalTextColor: '#0a0a0a',
      labelBoxBkgColor: '#f0f1f5',
      labelBoxBorderColor: '#3a3d45',
      labelTextColor: '#0a0a0a',
      loopTextColor: '#0a3aa8',
      noteBkgColor: '#ffe066',
      noteTextColor: '#0a0a0a',
      noteBorderColor: '#7a3a00',
      activationBkgColor: '#e4e6ec',
      activationBorderColor: '#0a3aa8',
      sequenceNumberColor: '#ffffff',
      attributeBackgroundColorOdd: '#ffffff',
      attributeBackgroundColorEven: '#f0f1f5',
      pie1: '#0a3aa8', pie2: '#9a0a0a', pie3: '#0d5c2a', pie4: '#7a3a00',
      pie5: '#5a0d9a', pie6: '#8a0d6b', pie7: '#26282e', pie8: '#0b3a8a',
    },
  },
  ocean: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    vars: {
      primaryColor: '#16303d',
      primaryTextColor: '#dbeef0',
      primaryBorderColor: '#4d7079',
      secondaryColor: '#102530',
      secondaryTextColor: '#94b8bf',
      secondaryBorderColor: '#1f3b48',
      tertiaryColor: '#0c1c26',
      tertiaryTextColor: '#5fd0d0',
      tertiaryBorderColor: '#172d38',
      lineColor: '#4fd6c8',
      textColor: '#dbeef0',
      mainBkg: '#16303d',
      nodeBorder: '#4fd6c8',
      clusterBkg: '#0c1c26',
      clusterBorder: '#1f3b48',
      titleColor: '#6fd6e6',
      edgeLabelBackground: '#0c1c26',
      nodeTextColor: '#dbeef0',
      actorBkg: '#16303d',
      actorBorder: '#4fd6c8',
      actorTextColor: '#dbeef0',
      actorLineColor: '#4d7079',
      signalColor: '#5fd0d0',
      signalTextColor: '#dbeef0',
      labelBoxBkgColor: '#102530',
      labelBoxBorderColor: '#1f3b48',
      labelTextColor: '#94b8bf',
      loopTextColor: '#ff9e8a',
      noteBkgColor: '#16303d',
      noteTextColor: '#dbeef0',
      noteBorderColor: '#4fd6c8',
      activationBkgColor: '#16303d',
      activationBorderColor: '#4fd6c8',
      sequenceNumberColor: '#0c1c26',
      attributeBackgroundColorOdd: '#0c1c26',
      attributeBackgroundColorEven: '#102530',
      pie1: '#4fd6c8', pie2: '#5f9ee6', pie3: '#52d6a8', pie4: '#ff9e8a',
      pie5: '#6fd6e6', pie6: '#f2b54e', pie7: '#38b8d6', pie8: '#a3ece4',
    },
  },
  eink: {
    fontFamily: 'Lora, Georgia, "Noto Serif JP", serif',
    vars: {
      primaryColor: '#e7e7e3',
      primaryTextColor: '#1a1a18',
      primaryBorderColor: '#a8a8a3',
      secondaryColor: '#efefec',
      secondaryTextColor: '#4a4a47',
      secondaryBorderColor: '#d8d8d3',
      tertiaryColor: '#f7f7f5',
      tertiaryTextColor: '#1a1a18',
      tertiaryBorderColor: '#d8d8d3',
      lineColor: '#6f6f6b',
      textColor: '#1a1a18',
      mainBkg: '#e7e7e3',
      nodeBorder: '#a8a8a3',
      clusterBkg: '#efefec',
      clusterBorder: '#d8d8d3',
      titleColor: '#1a1a18',
      edgeLabelBackground: '#f7f7f5',
      nodeTextColor: '#1a1a18',
      actorBkg: '#e7e7e3',
      actorBorder: '#a8a8a3',
      actorTextColor: '#1a1a18',
      actorLineColor: '#a8a8a3',
      signalColor: '#4a4a47',
      signalTextColor: '#1a1a18',
      labelBoxBkgColor: '#efefec',
      labelBoxBorderColor: '#d8d8d3',
      labelTextColor: '#4a4a47',
      loopTextColor: '#1a1a18',
      noteBkgColor: '#e7e7e3',
      noteTextColor: '#1a1a18',
      noteBorderColor: '#a8a8a3',
      activationBkgColor: '#e7e7e3',
      activationBorderColor: '#a8a8a3',
      sequenceNumberColor: '#f7f7f5',
      attributeBackgroundColorOdd: '#f7f7f5',
      attributeBackgroundColorEven: '#efefec',
      pie1: '#1a1a18', pie2: '#4a4a47', pie3: '#6f6f6b', pie4: '#9a9a95',
      pie5: '#2c2c2a', pie6: '#525250', pie7: '#7a7a76', pie8: '#363634',
    },
  },
  cyanotype: {
    fontFamily: "'EB Garamond', Georgia, serif",
    vars: {
      primaryColor: '#1c3d5e',
      primaryTextColor: '#e8f1f6',
      primaryBorderColor: '#5e89a6',
      secondaryColor: '#102841',
      secondaryTextColor: '#bcd3e0',
      secondaryBorderColor: '#2c5274',
      tertiaryColor: '#15324f',
      tertiaryTextColor: '#e8f1f6',
      tertiaryBorderColor: '#2c5274',
      lineColor: '#8ba9bb',
      textColor: '#e8f1f6',
      mainBkg: '#1c3d5e',
      nodeBorder: '#5e89a6',
      clusterBkg: '#102841',
      clusterBorder: '#2c5274',
      titleColor: '#e8f1f6',
      edgeLabelBackground: '#15324f',
      nodeTextColor: '#e8f1f6',
      actorBkg: '#1c3d5e',
      actorBorder: '#5e89a6',
      actorTextColor: '#e8f1f6',
      actorLineColor: '#5e89a6',
      signalColor: '#bcd3e0',
      signalTextColor: '#e8f1f6',
      labelBoxBkgColor: '#102841',
      labelBoxBorderColor: '#2c5274',
      labelTextColor: '#bcd3e0',
      loopTextColor: '#e8f1f6',
      noteBkgColor: '#1c3d5e',
      noteTextColor: '#e8f1f6',
      noteBorderColor: '#5e89a6',
      activationBkgColor: '#1c3d5e',
      activationBorderColor: '#5e89a6',
      sequenceNumberColor: '#15324f',
      attributeBackgroundColorOdd: '#15324f',
      attributeBackgroundColorEven: '#102841',
      pie1: '#7fb2cf', pie2: '#a3cadf', pie3: '#c8e0ed', pie4: '#9fd8c4',
      pie5: '#d9c27f', pie6: '#b29adf', pie7: '#e08a8a', pie8: '#5e89a6',
    },
  },
  linen: {
    fontFamily: "'Crimson Pro', Georgia, serif",
    vars: {
      primaryColor: '#43564a',
      primaryTextColor: '#e7e1d2',
      primaryBorderColor: '#7d9384',
      secondaryColor: '#324036',
      secondaryTextColor: '#c4bda9',
      secondaryBorderColor: '#52655a',
      tertiaryColor: '#3a4a3f',
      tertiaryTextColor: '#e7e1d2',
      tertiaryBorderColor: '#52655a',
      lineColor: '#94917f',
      textColor: '#e7e1d2',
      mainBkg: '#43564a',
      nodeBorder: '#c9a24b',
      clusterBkg: '#324036',
      clusterBorder: '#52655a',
      titleColor: '#ecd9a6',
      edgeLabelBackground: '#3a4a3f',
      nodeTextColor: '#e7e1d2',
      actorBkg: '#43564a',
      actorBorder: '#c9a24b',
      actorTextColor: '#e7e1d2',
      actorLineColor: '#7d9384',
      signalColor: '#c4bda9',
      signalTextColor: '#e7e1d2',
      labelBoxBkgColor: '#324036',
      labelBoxBorderColor: '#52655a',
      labelTextColor: '#c4bda9',
      loopTextColor: '#e7e1d2',
      noteBkgColor: '#43564a',
      noteTextColor: '#e7e1d2',
      noteBorderColor: '#c9a24b',
      activationBkgColor: '#43564a',
      activationBorderColor: '#c9a24b',
      sequenceNumberColor: '#3a4a3f',
      attributeBackgroundColorOdd: '#3a4a3f',
      attributeBackgroundColorEven: '#324036',
      pie1: '#c9a24b', pie2: '#ecd9a6', pie3: '#8fc49a', pie4: '#7fa8c4',
      pie5: '#b9a0d4', pie6: '#dab96f', pie7: '#d99a8a', pie8: '#7d9384',
    },
  },
  dotmatrix: {
    fontFamily: "'DotGothic16', monospace",
    vars: {
      primaryColor: '#23234f',
      primaryTextColor: '#fcfcfc',
      primaryBorderColor: '#3cbcfc',
      secondaryColor: '#15153a',
      secondaryTextColor: '#bcc2e8',
      secondaryBorderColor: '#4848a0',
      tertiaryColor: '#0b0b22',
      tertiaryTextColor: '#fcfcfc',
      tertiaryBorderColor: '#4848a0',
      lineColor: '#3cbcfc',
      textColor: '#fcfcfc',
      mainBkg: '#23234f',
      nodeBorder: '#3cbcfc',
      clusterBkg: '#15153a',
      clusterBorder: '#4848a0',
      titleColor: '#fcc000',
      edgeLabelBackground: '#0b0b22',
      nodeTextColor: '#fcfcfc',
      actorBkg: '#23234f',
      actorBorder: '#3cbcfc',
      actorTextColor: '#fcfcfc',
      actorLineColor: '#3cbcfc',
      signalColor: '#bcc2e8',
      signalTextColor: '#fcfcfc',
      labelBoxBkgColor: '#15153a',
      labelBoxBorderColor: '#4848a0',
      labelTextColor: '#bcc2e8',
      loopTextColor: '#fcfcfc',
      noteBkgColor: '#fcc000',
      noteTextColor: '#0b0b22',
      noteBorderColor: '#3cbcfc',
      activationBkgColor: '#23234f',
      activationBorderColor: '#3cbcfc',
      sequenceNumberColor: '#0b0b22',
      attributeBackgroundColorOdd: '#0b0b22',
      attributeBackgroundColorEven: '#15153a',
      pie1: '#f83800', pie2: '#3cbcfc', pie3: '#fcc000', pie4: '#00d800',
      pie5: '#f878f8', pie6: '#ff6a4d', pie7: '#5fe85f', pie8: '#a8e4ff',
    },
  },
  ledger: {
    fontFamily: "'Cousine', monospace",
    vars: {
      primaryColor: '#e2edd6',
      primaryTextColor: '#1c2a1c',
      primaryBorderColor: '#7e9275',
      secondaryColor: '#eef4e6',
      secondaryTextColor: '#39483a',
      secondaryBorderColor: '#c4d4b8',
      tertiaryColor: '#f6f9f2',
      tertiaryTextColor: '#1c2a1c',
      tertiaryBorderColor: '#c4d4b8',
      lineColor: '#5f6e5c',
      textColor: '#1c2a1c',
      mainBkg: '#e2edd6',
      nodeBorder: '#7e9275',
      clusterBkg: '#eef4e6',
      clusterBorder: '#c4d4b8',
      titleColor: '#1c2a1c',
      edgeLabelBackground: '#f6f9f2',
      nodeTextColor: '#1c2a1c',
      actorBkg: '#e2edd6',
      actorBorder: '#7e9275',
      actorTextColor: '#1c2a1c',
      actorLineColor: '#7e9275',
      signalColor: '#39483a',
      signalTextColor: '#1c2a1c',
      labelBoxBkgColor: '#eef4e6',
      labelBoxBorderColor: '#c4d4b8',
      labelTextColor: '#39483a',
      loopTextColor: '#1c2a1c',
      noteBkgColor: '#e7f0db',
      noteTextColor: '#1c2a1c',
      noteBorderColor: '#7e9275',
      activationBkgColor: '#e2edd6',
      activationBorderColor: '#7e9275',
      sequenceNumberColor: '#f6f9f2',
      attributeBackgroundColorOdd: '#f6f9f2',
      attributeBackgroundColorEven: '#eef4e6',
      pie1: '#1f6b3b', pie2: '#2e8a4f', pie3: '#6bb088', pie4: '#1c2a1c',
      pie5: '#8a6a1c', pie6: '#2f5f8a', pie7: '#b02a1f', pie8: '#7e9275',
    },
  },
  plaintext: {
    fontFamily: "'JetBrains Mono', monospace",
    vars: {
      primaryColor: '#ebebe8',
      primaryTextColor: '#2d2d2d',
      primaryBorderColor: '#9a9a96',
      secondaryColor: '#f4f4f1',
      secondaryTextColor: '#4a4a4a',
      secondaryBorderColor: '#d6d6d2',
      tertiaryColor: '#fcfcfa',
      tertiaryTextColor: '#2d2d2d',
      tertiaryBorderColor: '#d6d6d2',
      lineColor: '#7d7d7d',
      textColor: '#2d2d2d',
      mainBkg: '#ebebe8',
      nodeBorder: '#9a9a96',
      clusterBkg: '#f4f4f1',
      clusterBorder: '#d6d6d2',
      titleColor: '#2d2d2d',
      edgeLabelBackground: '#fcfcfa',
      nodeTextColor: '#2d2d2d',
      actorBkg: '#ebebe8',
      actorBorder: '#9a9a96',
      actorTextColor: '#2d2d2d',
      actorLineColor: '#9a9a96',
      signalColor: '#4a4a4a',
      signalTextColor: '#2d2d2d',
      labelBoxBkgColor: '#f4f4f1',
      labelBoxBorderColor: '#d6d6d2',
      labelTextColor: '#4a4a4a',
      loopTextColor: '#2d2d2d',
      noteBkgColor: '#ebebe8',
      noteTextColor: '#2d2d2d',
      noteBorderColor: '#9a9a96',
      activationBkgColor: '#ebebe8',
      activationBorderColor: '#9a9a96',
      sequenceNumberColor: '#fcfcfa',
      attributeBackgroundColorOdd: '#fcfcfa',
      attributeBackgroundColorEven: '#f4f4f1',
      pie1: '#2d2d2d', pie2: '#4a4a4a', pie3: '#5a5a5a', pie4: '#6a6a6a',
      pie5: '#7d7d7d', pie6: '#9a9a9a', pie7: '#bcbcbc', pie8: '#3d3d3d',
    },
  },
  braille: {
    fontFamily: "'Atkinson Hyperlegible', sans-serif",
    vars: {
      primaryColor: '#dcd8cf',
      primaryTextColor: '#2a2824',
      primaryBorderColor: '#979388',
      secondaryColor: '#e7e4dd',
      secondaryTextColor: '#494640',
      secondaryBorderColor: '#cdc9bf',
      tertiaryColor: '#f0eee9',
      tertiaryTextColor: '#2a2824',
      tertiaryBorderColor: '#cdc9bf',
      lineColor: '#6f6c64',
      textColor: '#2a2824',
      mainBkg: '#dcd8cf',
      nodeBorder: '#979388',
      clusterBkg: '#e7e4dd',
      clusterBorder: '#cdc9bf',
      titleColor: '#2a2824',
      edgeLabelBackground: '#f0eee9',
      nodeTextColor: '#2a2824',
      actorBkg: '#dcd8cf',
      actorBorder: '#979388',
      actorTextColor: '#2a2824',
      actorLineColor: '#979388',
      signalColor: '#494640',
      signalTextColor: '#2a2824',
      labelBoxBkgColor: '#e7e4dd',
      labelBoxBorderColor: '#cdc9bf',
      labelTextColor: '#494640',
      loopTextColor: '#2a2824',
      noteBkgColor: '#dcd8cf',
      noteTextColor: '#2a2824',
      noteBorderColor: '#979388',
      activationBkgColor: '#dcd8cf',
      activationBorderColor: '#979388',
      sequenceNumberColor: '#f0eee9',
      attributeBackgroundColorOdd: '#f0eee9',
      attributeBackgroundColorEven: '#e7e4dd',
      pie1: '#2a2824', pie2: '#494640', pie3: '#5a564e', pie4: '#6a665e',
      pie5: '#7a766c', pie6: '#9a958a', pie7: '#cdc9bf', pie8: '#3a3833',
    },
  },
};

// Mermaid theme settings — separated from the module so they can be passed
// after the lazy import resolves without re-importing the full library.
function buildMermaidConfig(theme: Theme) {
  const palette = MERMAID_PALETTES[theme] ?? MERMAID_PALETTES.light;
  const handDrawn = theme === 'whiteboard' || theme === 'handwritten';
  return {
    startOnLoad: false,
    theme: 'base' as const,
    look: (handDrawn ? 'handDrawn' : 'classic') as 'handDrawn' | 'classic',
    handDrawnSeed: 1,
    securityLevel: 'strict' as const,
    fontFamily: palette.fontFamily,
    themeVariables: palette.vars,
    flowchart: { curve: handDrawn ? ('linear' as const) : ('basis' as const), padding: 16 },
    sequence: { mirrorActors: false, bottomMarginAdj: 2 },
  };
}

// Track current theme for mermaid re-initialization after lazy load
let mermaidTheme: Theme = 'light';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str_: string, lang: string): string {
    const str = str_.replace(/^([ \t]*\n)+/, '').trimEnd();
    if (lang === 'mermaid') {
      const id = `mermaid-${mermaidCounter++}-${uniqueSuffix()}`;
      return `<div class="mermaid-container"><div class="mermaid-label">Diagram</div><pre class="mermaid" id="${id}">${md.utils.escapeHtml(str)}</pre></div>`;
    }
    const DIAGRAM_ALIASES: Record<string, string> = { dot: 'graphviz' };
    const DIAGRAM_TYPES = new Set([
      'd2',
      'plantuml',
      'ditaa',
      'graphviz',
      'bpmn',
      'wavedrom',
      'nomnoml',
      'excalidraw',
      'pikchr',
      'svgbob',
    ]);
    const normalizedLang = DIAGRAM_ALIASES[lang] || lang;
    if (DIAGRAM_TYPES.has(normalizedLang)) {
      const id = `diagram-${diagramCounter++}-${uniqueSuffix()}`;
      const labelMap: Record<string, string> = {
        d2: 'D2',
        plantuml: 'PlantUML',
        ditaa: 'Ditaa',
        graphviz: 'Graphviz',
        bpmn: 'BPMN',
        wavedrom: 'WaveDrom',
        nomnoml: 'nomnoml',
        excalidraw: 'Excalidraw',
        pikchr: 'Pikchr',
        svgbob: 'Svgbob',
      };
      return `<div class="diagram-container" data-diagram-type="${normalizedLang}" data-diagram-id="${id}"><div class="diagram-label">${labelMap[normalizedLang] || normalizedLang}</div><pre class="diagram-source" id="${id}">${md.utils.escapeHtml(str)}</pre><div class="diagram-rendered" id="${id}-rendered"></div></div>`;
    }
    const langLabel = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : '';
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<div class="code-block">${langLabel}<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre></div>`;
      } catch {
        // fallthrough
      }
    }
    return `<div class="code-block">${langLabel}<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre></div>`;
  },
});

// Override fence renderer to use highlight output directly (avoid wrapping in extra <pre><code>)
md.renderer.rules.fence = function (tokens, idx, options, _env, slf) {
  const token = tokens[idx];
  const info = token.info ? token.info.trim() : '';
  const lang = info.split(/\s+/g)[0] || '';
  if (options.highlight) {
    const result = options.highlight(token.content, lang, '');
    if (result) return result;
  }
  return `<pre${slf.renderAttrs(token)}><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
};

// --- Plugins ---

// Math/LaTeX via KaTeX
md.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: { throwOnError: false },
});

// Footnotes
md.use(footnote);

// Mark / Highlight ==text==
md.use(mark);

// Subscript ~text~ and Superscript ^text^
md.use(sub);
md.use(sup);

// Emoji :smile:
md.use(emoji);

// Heading anchors with linkable IDs
md.use(anchor, {
  permalink: anchor.permalink.linkInsideHeader({
    symbol: '#',
    ariaHidden: true,
    class: 'header-anchor',
    placement: 'before',
  }),
  slugify: (s: string) =>
    s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u3000-\u9fff\u4e00-\u9faf-]/g, ''),
});

// Custom containers :::tip / :::warning / :::danger / :::info / :::details
const containerTypes = ['tip', 'warning', 'danger', 'info', 'details'];
for (const type of containerTypes) {
  md.use(container, type, {
    render(tokens: { nesting: number; info: string }[], idx: number) {
      const token = tokens[idx];
      if (token.nesting === 1) {
        const title = token.info.trim().slice(type.length).trim() || type.toUpperCase();
        if (type === 'details') {
          return `<details class="custom-block details"><summary>${md.utils.escapeHtml(title)}</summary>\n`;
        }
        return `<div class="custom-block ${type}"><p class="custom-block-title">${md.utils.escapeHtml(title)}</p>\n`;
      }
      return type === 'details' ? '</details>\n' : '</div>\n';
    },
  });
}

// GitHub-style alerts > [!NOTE], > [!WARNING], etc.
md.use(githubAlerts);

// Definition lists
md.use(deflist);

// Front matter (parse but don't render)
md.use(frontmatter, () => {
  // silently consume front matter
});

// Wiki links [[target]] or [[target|display]]
function wikiLinkPlugin(mdi: MarkdownIt) {
  mdi.inline.ruler.after('link', 'wiki_link', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x5B || src.charCodeAt(pos + 1) !== 0x5B) return false; // [[
    const closeIdx = src.indexOf(']]', pos + 2);
    if (closeIdx === -1) return false;
    if (silent) return true;

    const content = src.slice(pos + 2, closeIdx);
    const pipeIdx = content.indexOf('|');
    const target = pipeIdx >= 0 ? content.slice(0, pipeIdx).trim() : content.trim();
    const display = pipeIdx >= 0 ? content.slice(pipeIdx + 1).trim() : target;

    const href = target.includes('.') ? target : target + '.md';
    // Reject dangerous URL schemes (javascript:, vbscript:, data:) — render as plain text
    if (/^(javascript|vbscript|data):/i.test(href.replace(/[\u0000-\u0020]/g, ''))) {
      const tokenT = state.push('text', '', 0);
      tokenT.content = display;
      state.pos = closeIdx + 2;
      return true;
    }
    const tokenO = state.push('wiki_link_open', 'a', 1);
    tokenO.attrSet('href', href);
    tokenO.attrSet('class', 'wiki-link');
    tokenO.markup = '[[';
    const tokenT = state.push('text', '', 0);
    tokenT.content = display;
    state.push('wiki_link_close', 'a', -1);
    state.pos = closeIdx + 2;
    return true;
  });
}
md.use(wikiLinkPlugin);

// --- Link target ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultRender =
  md.renderer.rules.link_open ||
  function (tokens: any[], idx: number, options: any, _env: unknown, self: any) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrGet('href');
  if (href && /^https?:\/\//.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultRender(tokens, idx, options, env, self);
};

// --- Exports ---

export function renderMarkdown(source: string): string {
  mermaidCounter = 0;
  diagramCounter = 0;
  return md.render(source);
}

export async function renderExternalDiagrams(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('.diagram-container');
  for (const block of blocks) {
    const type = block.dataset.diagramType;
    const pre = block.querySelector<HTMLElement>('.diagram-source');
    const target = block.querySelector<HTMLElement>('.diagram-rendered');
    if (!type || !pre || !target) continue;
    const source = pre.textContent || '';
    try {
      const res = await fetch('/api/diagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, source }),
      });
      if (res.ok) {
        const svg = await res.text();
        const cleanSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_TAGS: ['use', 'foreignObject'] });
        target.innerHTML = cleanSvg;
        pre.style.display = 'none';
        block.classList.add('diagram-rendered-ok');
        const label = block.querySelector<HTMLElement>('.diagram-label')?.textContent?.trim() || 'Diagram';
        attachDiagramToolbar({ surface: target, title: label, source, kind: type });
      }
    } catch { /* show source as fallback */ }
  }
}

// Cached mermaid module — loaded on first use to keep it out of the initial bundle.
// Mermaid is 2.7 MB (715 KB gzip) and only needed when a markdown file contains
// a ```mermaid``` code block, so lazy-loading it improves initial page load time.
let mermaidModule: typeof import('mermaid').default | null = null;

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidModule) {
    const mod = await import('mermaid');
    mermaidModule = mod.default;
    mermaidModule.initialize(buildMermaidConfig(mermaidTheme));
  }
  return mermaidModule;
}

export async function renderMermaidDiagrams(container?: ParentNode): Promise<void> {
  const scope: ParentNode = container ?? document;
  const elements = scope.querySelectorAll<HTMLElement>('pre.mermaid');
  if (elements.length === 0) return; // skip lazy load when no diagrams present

  // Load mermaid only when the page actually contains mermaid blocks
  const mermaidLib = await getMermaid();

  for (const el of elements) {
    if (el.dataset.processed === 'true') continue;
    const code = el.textContent || '';
    const id = el.id || `mermaid-${Date.now()}`;
    try {
      const { svg } = await mermaidLib.render(id + '-svg', code);
      const wrapper = el.closest('.mermaid-container');
      if (wrapper) {
        // Mermaid v11 + securityLevel:'strict' は出力 SVG を内部で DOMPurify
        // 済み。さらに外側で DOMPurify を通すと foreignObject の HTML 子要素や
        // SVG text のレイアウト属性が剥がれ、ノードラベルが空になる。
        wrapper.innerHTML = `<div class="mermaid-rendered">${svg}</div>`;
        const rendered = wrapper.querySelector<HTMLElement>('.mermaid-rendered');
        if (rendered) {
          attachDiagramToolbar({
            surface: rendered,
            title: 'Mermaid diagram',
            source: code,
            kind: 'mermaid',
          });
        }
      }
    } catch {
      el.classList.add('mermaid-error');
      el.dataset.processed = 'true';
    }
  }
}

export function updateMermaidTheme(theme: Theme): void {
  mermaidTheme = theme;
  // Re-initialize only if the module has already been loaded; otherwise the
  // updated flag is picked up when getMermaid() is first called.
  if (mermaidModule) {
    mermaidModule.initialize(buildMermaidConfig(theme));
  }
}
