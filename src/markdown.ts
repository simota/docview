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
  const serialized = serializeSvg(svg);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const w = viewBox?.width || rect.width || 800;
    const h = viewBox?.height || rect.height || 600;
    const SCALE = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(w * SCALE));
    canvas.height = Math.max(1, Math.floor(h * SCALE));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(SCALE, SCALE);
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `${slugifyTitle(title)}.png`);
    }, 'image/png');
  } catch {
    // ignore
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  terminal: {
    fontFamily: '"JetBrains Mono", "Courier Prime", "Courier New", ui-monospace, monospace',
    vars: {
      primaryColor: '#121a12',
      primaryTextColor: '#4dff7a',
      primaryBorderColor: '#00ff66',
      secondaryColor: '#0d130d',
      secondaryTextColor: '#3ad466',
      secondaryBorderColor: '#1f3a23',
      tertiaryColor: '#050905',
      tertiaryTextColor: '#88ffaa',
      tertiaryBorderColor: '#16291a',
      lineColor: '#00ff66',
      textColor: '#4dff7a',
      mainBkg: '#121a12',
      nodeBorder: '#00ff66',
      clusterBkg: '#0d130d',
      clusterBorder: '#1f3a23',
      titleColor: '#88ffaa',
      edgeLabelBackground: '#0a0e0a',
      nodeTextColor: '#4dff7a',
      actorBkg: '#121a12',
      actorBorder: '#00ff66',
      actorTextColor: '#4dff7a',
      actorLineColor: '#1f3a23',
      signalColor: '#44ff88',
      signalTextColor: '#4dff7a',
      labelBoxBkgColor: '#121a12',
      labelBoxBorderColor: '#1f3a23',
      labelTextColor: '#3ad466',
      loopTextColor: '#88ffaa',
      noteBkgColor: '#1a2a14',
      noteTextColor: '#ffcc00',
      noteBorderColor: '#ffcc00',
      activationBkgColor: '#16291a',
      activationBorderColor: '#00ff66',
      sequenceNumberColor: '#050905',
      attributeBackgroundColorOdd: '#050905',
      attributeBackgroundColorEven: '#0d130d',
      pie1: '#00ff66', pie2: '#44ff88', pie3: '#88ffaa', pie4: '#ffcc00',
      pie5: '#44aaff', pie6: '#cc88ff', pie7: '#ff4466', pie8: '#2a8a44',
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
  hackerman: {
    fontFamily: '"Courier Prime", "JetBrains Mono", ui-monospace, monospace',
    vars: {
      primaryColor: '#100c06',
      primaryTextColor: '#ffb000',
      primaryBorderColor: '#ff8800',
      secondaryColor: '#161009',
      secondaryTextColor: '#d49000',
      secondaryBorderColor: '#3a2a08',
      tertiaryColor: '#050402',
      tertiaryTextColor: '#ffd700',
      tertiaryBorderColor: '#3a2a08',
      lineColor: '#ff8800',
      textColor: '#ffb000',
      mainBkg: '#100c06',
      nodeBorder: '#ff8800',
      clusterBkg: '#0a0805',
      clusterBorder: '#3a2a08',
      titleColor: '#ffd700',
      edgeLabelBackground: '#0a0805',
      nodeTextColor: '#ffb000',
      actorBkg: '#100c06',
      actorBorder: '#ff8800',
      actorTextColor: '#ffb000',
      actorLineColor: '#3a2a08',
      signalColor: '#ffd700',
      signalTextColor: '#ffb000',
      labelBoxBkgColor: '#100c06',
      labelBoxBorderColor: '#3a2a08',
      labelTextColor: '#d49000',
      loopTextColor: '#ffd700',
      noteBkgColor: '#251a05',
      noteTextColor: '#00ff88',
      noteBorderColor: '#00ff88',
      activationBkgColor: '#3a2a08',
      activationBorderColor: '#ff8800',
      sequenceNumberColor: '#0a0805',
      attributeBackgroundColorOdd: '#050402',
      attributeBackgroundColorEven: '#100c06',
      pie1: '#ff8800', pie2: '#ffb000', pie3: '#ffd700', pie4: '#00ff88',
      pie5: '#4dc4ff', pie6: '#cc88ff', pie7: '#ff4422', pie8: '#7a5500',
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
        const cleanSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_TAGS: ['use', 'foreignObject'] });
        wrapper.innerHTML = `<div class="mermaid-rendered">${cleanSvg}</div>`;
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
