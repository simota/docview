import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import mermaid from 'mermaid';
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

function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
    themeVariables: isDark
      ? {
          // Dark theme — soft indigo palette
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
          pie1: '#6366f1',
          pie2: '#8b5cf6',
          pie3: '#a855f7',
          pie4: '#c084fc',
          pie5: '#818cf8',
          pie6: '#6d28d9',
          pie7: '#a78bfa',
          pie8: '#7c3aed',
        }
      : {
          // Light theme — clean indigo palette
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
          pie1: '#6366f1',
          pie2: '#8b5cf6',
          pie3: '#a855f7',
          pie4: '#c084fc',
          pie5: '#818cf8',
          pie6: '#6d28d9',
          pie7: '#a78bfa',
          pie8: '#7c3aed',
        },
    flowchart: { curve: 'basis', padding: 16 },
    sequence: { mirrorActors: false, bottomMarginAdj: 2 },
  });
}

initMermaid(false);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str_: string, lang: string): string {
    const str = str_.replace(/^([ \t]*\n)+/, '').trimEnd();
    if (lang === 'mermaid') {
      const id = `mermaid-${mermaidCounter++}`;
      return `<div class="mermaid-container"><div class="mermaid-label">Diagram</div><pre class="mermaid" id="${id}">${md.utils.escapeHtml(str)}</pre></div>`;
    }
    const DIAGRAM_TYPES = new Set(['d2', 'plantuml', 'ditaa']);
    if (DIAGRAM_TYPES.has(lang)) {
      const id = `diagram-${diagramCounter++}`;
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

export async function renderMermaidDiagrams(): Promise<void> {
  const elements = document.querySelectorAll<HTMLElement>('pre.mermaid');
  for (const el of elements) {
    if (el.dataset.processed === 'true') continue;
    const code = el.textContent || '';
    const id = el.id || `mermaid-${Date.now()}`;
    try {
      const { svg } = await mermaid.render(id + '-svg', code);
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

export function updateMermaidTheme(isDark: boolean): void {
  initMermaid(isDark);
}
