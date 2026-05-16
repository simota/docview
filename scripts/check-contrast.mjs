#!/usr/bin/env node
// WCAG 2.1 contrast regression check for src/style.css theme palettes.
//
// Parses [data-theme='*'] blocks from style.css, extracts the canonical
// foreground/background/accent variables, and verifies that every required
// pair meets the documented minimum ratio. Exits non-zero on any failure so
// it can be wired into `npm test` or CI.
//
// Usage:
//   node scripts/check-contrast.mjs            # check all themes
//   node scripts/check-contrast.mjs --json     # machine-readable output
//   node scripts/check-contrast.mjs dark light # check specific themes

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(__dirname, '..', 'src', 'style.css');

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const lf = relativeLuminance(hexToRgb(fg));
  const lb = relativeLuminance(hexToRgb(bg));
  const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

// Parse [data-theme='name'] { ... } blocks
function parseThemes(css) {
  const themes = {};
  const re = /\[data-theme='([^']+)'\]\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const name = m[1];
    const body = m[2];
    themes[name] = themes[name] || {};
    const varRe = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g;
    let v;
    while ((v = varRe.exec(body)) !== null) {
      themes[name][v[1]] = v[2];
    }
  }
  // Also pick up the :root, [data-theme='light'] combined block
  const rootRe = /:root,\s*\[data-theme='([^']+)'\]\s*\{([^}]+)\}/g;
  while ((m = rootRe.exec(css)) !== null) {
    const name = m[1];
    const body = m[2];
    themes[name] = themes[name] || {};
    const varRe = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g;
    let v;
    while ((v = varRe.exec(body)) !== null) {
      themes[name][v[1]] = v[2];
    }
  }
  return themes;
}

// Required minimum contrast per pair. Keys must exist in every theme.
// AA normal text = 4.5, AA large text / UI = 3.0, AAA = 7.0.
const RULES = [
  { name: 'body text',     fg: 'text-primary',   bg: 'bg-primary', min: 4.5 },
  { name: 'secondary',     fg: 'text-secondary', bg: 'bg-primary', min: 4.5 },
  { name: 'muted',         fg: 'text-muted',     bg: 'bg-primary', min: 3.0 },
  { name: 'link',          fg: 'link-color',     bg: 'bg-primary', min: 4.5 },
  { name: 'info',          fg: 'color-info',     bg: 'bg-primary', min: 3.0 },
  { name: 'success',       fg: 'color-success',  bg: 'bg-primary', min: 3.0 },
  { name: 'warning',       fg: 'color-warning',  bg: 'bg-primary', min: 3.0 },
  { name: 'danger',        fg: 'color-danger',   bg: 'bg-primary', min: 3.0 },
  { name: 'important',     fg: 'color-important', bg: 'bg-primary', min: 3.0 },
  { name: 'border-strong', fg: 'border-strong',  bg: 'bg-primary', min: 3.0 },
];

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const filterThemes = args.filter((a) => !a.startsWith('--'));

  const css = await readFile(CSS_PATH, 'utf8');
  const themes = parseThemes(css);
  const themeNames = filterThemes.length ? filterThemes : Object.keys(themes);

  const results = [];
  let failures = 0;

  for (const themeName of themeNames) {
    const palette = themes[themeName];
    if (!palette) {
      console.error(`Unknown theme: ${themeName}`);
      process.exitCode = 2;
      continue;
    }
    for (const rule of RULES) {
      const fg = palette[rule.fg];
      const bg = palette[rule.bg];
      if (!fg || !bg) {
        results.push({ theme: themeName, ...rule, ratio: null, status: 'MISSING' });
        failures++;
        continue;
      }
      const ratio = contrast(fg, bg);
      const status = ratio >= rule.min ? 'PASS' : 'FAIL';
      if (status === 'FAIL') failures++;
      results.push({ theme: themeName, ...rule, fgValue: fg, bgValue: bg, ratio, status });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ failures, results }, null, 2));
  } else {
    const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
    console.log(pad('Theme', 14) + pad('Pair', 16) + pad('Ratio', 10) + pad('Min', 6) + 'Status');
    console.log('-'.repeat(58));
    for (const r of results) {
      const ratioStr = r.ratio == null ? 'n/a' : r.ratio.toFixed(2);
      const marker = r.status === 'PASS' ? 'ok' : r.status === 'MISSING' ? '??' : 'X';
      console.log(
        pad(r.theme, 14) +
          pad(r.name, 16) +
          pad(ratioStr, 10) +
          pad(String(r.min), 6) +
          `${marker} ${r.status}`,
      );
    }
    console.log('-'.repeat(58));
    console.log(failures === 0 ? 'All contrast checks passed.' : `${failures} contrast check(s) failed.`);
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
