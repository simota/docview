// Marp (https://marp.app) slide rendering.
//
// A Markdown file is treated as a Marp deck when its YAML front matter declares
// `marp: true`. Such files can be presented as real slides via @marp-core, which
// reproduces Marp themes (default / gaia / uncover), directives (paginate, header,
// footer, size, backgroundColor, _class, …) and slide splitting on `---`.
//
// Safety: the deck is rendered with `html: false` (raw HTML in the source is
// escaped, never injected) and `script: false` (no inline auto-scaling script).
// The remaining markup is Marp's own SVG/foreignObject/section structure plus
// markdown-it-escaped text, so it is safe by construction and is NOT passed
// through DOMPurify — doing so strips the HTML children inside <foreignObject>
// and blanks every slide (see the note in markdown.ts renderMermaidDiagrams).

export interface MarpDeck {
  /** The `<div class="marpit">…</div>` markup containing one <svg> per slide. */
  html: string;
  /** Theme CSS, scoped under `div.marpit`, with external @import rules removed. */
  css: string;
  /** Number of slides in the deck. */
  slideCount: number;
}

// Front matter must be the very first thing in the file: a `---` fence on line 1.
function extractFrontMatter(source: string): string | null {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return m ? m[1] : null;
}

/**
 * Detect a Marp document: YAML front matter containing the global directive
 * `marp: true`. Matched without a full YAML parse so it stays cheap to call on
 * every markdown render.
 */
export function isMarpMarkdown(source: string): boolean {
  const fm = extractFrontMatter(source);
  if (!fm) return false;
  return /^[ \t]*marp[ \t]*:[ \t]*true[ \t]*$/im.test(fm);
}

// @marp-core pulls in markdown-it, postcss and the bundled themes (~hundreds of
// KB), and is only needed when a Marp deck is actually presented — lazy-load it
// the same way mermaid is, to keep it out of the initial bundle.
let marpModule: typeof import('@marp-team/marp-core') | null = null;

export async function renderMarpDeck(source: string): Promise<MarpDeck> {
  if (!marpModule) {
    marpModule = await import('@marp-team/marp-core');
  }
  const { Marp } = marpModule;
  const marp = new Marp({
    html: false,
    script: false,
  });
  const { html, css } = marp.render(source);

  // The bundled themes @import web fonts from fonts.bunny.net. DocView is a
  // local, offline-friendly viewer, so strip the external import and let the
  // themes fall back to their system-font stacks.
  const localCss = css.replace(/@import\s+[^;]+;/g, '');

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const slideCount = tmp.querySelectorAll('.marpit > svg[data-marpit-svg]').length;

  return { html, css: localCss, slideCount };
}
