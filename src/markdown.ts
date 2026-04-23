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
      pie1: '#1e3a8a', pie2: '#dc2626', pie3: '#15803d', pie4: '#b45309',
      pie5: '#7c3aed', pie6: '#1d4ed8', pie7: '#b91c1c', pie8: '#334e8a',
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
    const DIAGRAM_TYPES = new Set(['d2', 'plantuml', 'ditaa']);
    if (DIAGRAM_TYPES.has(lang)) {
      const id = `diagram-${diagramCounter++}-${uniqueSuffix()}`;
      const labelMap: Record<string, string> = { d2: 'D2', plantuml: 'PlantUML', ditaa: 'Ditaa' };
      return `<div class="diagram-container" data-diagram-type="${lang}" data-diagram-id="${id}"><div class="diagram-label">${labelMap[lang] || lang}</div><pre class="diagram-source" id="${id}">${md.utils.escapeHtml(str)}</pre><div class="diagram-rendered" id="${id}-rendered"></div></div>`;
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
