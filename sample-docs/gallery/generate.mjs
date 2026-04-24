#!/usr/bin/env node
// Generate sample images for DocView Album View demo.
// Outputs SVGs (varied colors/patterns) + a few tiny PNGs.
// Usage: node generate.mjs  (run from this directory or project root)

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const NESTED = join(HERE, 'nested');
mkdirSync(NESTED, { recursive: true });

// --- SVG generators ---
const palette = [
  ['#ef4444', '#fca5a5'], ['#f97316', '#fdba74'], ['#eab308', '#fde68a'],
  ['#22c55e', '#86efac'], ['#14b8a6', '#5eead4'], ['#0ea5e9', '#7dd3fc'],
  ['#6366f1', '#a5b4fc'], ['#a855f7', '#d8b4fe'], ['#ec4899', '#f9a8d4'],
  ['#64748b', '#cbd5e1'], ['#0f766e', '#2dd4bf'], ['#be123c', '#fb7185'],
];

function svgGradient(name, [c1, c2], variant) {
  const id = `g-${name}`;
  const shapes = variant === 'circle'
    ? `<circle cx="200" cy="200" r="140" fill="url(#${id})" />`
    : variant === 'triangle'
    ? `<polygon points="200,60 340,340 60,340" fill="url(#${id})" />`
    : variant === 'hex'
    ? `<polygon points="200,50 340,125 340,275 200,350 60,275 60,125" fill="url(#${id})" />`
    : `<rect x="60" y="60" width="280" height="280" rx="28" fill="url(#${id})" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="#fafafa" />
  ${shapes}
  <text x="200" y="385" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="18" fill="#475569">${name}</text>
</svg>`;
}

function svgDots(name, color) {
  const rows = [];
  for (let y = 40; y < 400; y += 40) {
    for (let x = 40; x < 400; x += 40) {
      const r = 6 + ((x + y) % 30) / 3;
      rows.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${color}" opacity="${(0.3 + ((x * y) % 100) / 180).toFixed(2)}" />`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" fill="#0f172a" />
  ${rows.join('\n  ')}
  <text x="200" y="385" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="18" fill="#e2e8f0">${name}</text>
</svg>`;
}

function svgStripes(name, [c1, c2]) {
  const stripes = [];
  for (let i = 0; i < 20; i++) {
    stripes.push(`<rect x="${i * 20}" y="0" width="20" height="400" fill="${i % 2 === 0 ? c1 : c2}" />`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  ${stripes.join('\n  ')}
  <rect x="0" y="170" width="400" height="60" fill="rgba(15,23,42,0.8)" />
  <text x="200" y="210" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="22" fill="#fff">${name}</text>
</svg>`;
}

// --- PNG generator (minimal RGBA, no deps) ---
function makePng(width, height, pixelFn) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const off = y * (1 + width * 4) + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', deflateSync(raw)));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

// --- Build files ---
const variants = ['rounded', 'circle', 'triangle', 'hex'];
const names = [
  'sunrise', 'tangerine', 'honey', 'meadow', 'lagoon', 'sky',
  'indigo', 'orchid', 'blossom', 'slate', 'teal', 'crimson',
];

names.forEach((name, i) => {
  const svg = svgGradient(name, palette[i], variants[i % variants.length]);
  writeFileSync(join(HERE, `${String(i + 1).padStart(2, '0')}-${name}.svg`), svg);
});

writeFileSync(join(HERE, 'pattern-dots.svg'), svgDots('dots', '#38bdf8'));
writeFileSync(join(HERE, 'pattern-stripes.svg'), svgStripes('stripes', ['#f472b6', '#7c3aed']));

// nested/ — recursive demo
['aurora', 'nebula', 'comet', 'eclipse'].forEach((name, i) => {
  const svg = svgGradient(name, palette[i + 4], variants[(i + 2) % variants.length]);
  writeFileSync(join(NESTED, `${name}.svg`), svg);
});

// A couple of real PNGs for format variety
writeFileSync(join(HERE, 'gradient.png'), makePng(256, 256, (x, y) => [
  Math.round((x / 255) * 255),
  Math.round((y / 255) * 255),
  Math.round(((x + y) / 510) * 255),
  255,
]));
writeFileSync(join(HERE, 'checker.png'), makePng(128, 128, (x, y) => {
  const on = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0;
  return on ? [30, 41, 59, 255] : [226, 232, 240, 255];
}));
writeFileSync(join(NESTED, 'spectrum.png'), makePng(256, 64, (x, _y) => {
  const h = (x / 256) * 360;
  const c = 1, xx = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, xx, 0];
  else if (h < 120) [r, g, b] = [xx, c, 0];
  else if (h < 180) [r, g, b] = [0, c, xx];
  else if (h < 240) [r, g, b] = [0, xx, c];
  else if (h < 300) [r, g, b] = [xx, 0, c];
  else [r, g, b] = [c, 0, xx];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255];
}));

console.log('Generated gallery sample images.');
