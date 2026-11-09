// decodeTextBuffer must return exactly what the original detector-first
// algorithm returned; its pure-ASCII fast path is only an optimisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTextBuffer, detectEncoding, hasUtf8Bom } from '../lib/text-decode.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The pre-fast-path implementation: always consult the detector. */
function referenceDecode(buf) {
  const encoding = detectEncoding(buf);
  if (encoding === 'utf-8') return buf.toString('utf-8', hasUtf8Bom(buf) ? 3 : 0);
  return new TextDecoder(encoding).decode(buf);
}

function assertSame(buf, label) {
  assert.equal(decodeTextBuffer(buf), referenceDecode(buf), label);
}

test('decodeTextBuffer matches the detector for crafted edge cases', () => {
  const cases = {
    empty: Buffer.alloc(0),
    ascii: Buffer.from('# Title\n\nplain text with tabs\tand CRLF\r\n'),
    asciiControls: Buffer.from('a\x00b\x07c\x7f\x0b\x0c'),
    nullsUtf16Pattern: Buffer.from('a\x00b\x00c\x00d\x00e\x00f\x00g\x00h\x00'.repeat(20)),
    metaShiftJis: Buffer.from('<html><head><meta charset="shift_jis"></head><body>hello \\ ~</body></html>'),
    metaIso2022jp: Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=iso-2022-jp">x'),
    metaEucKr: Buffer.from('<?xml version="1.0" encoding="euc-kr"?><a>b</a>'),
    metaUtf16: Buffer.from('<meta charset="utf-16"><p>x</p>'),
    iso2022jpEscapes: Buffer.from([0x1B, 0x24, 0x42, 0x46, 0x7C, 0x4B, 0x5C, 0x1B, 0x28, 0x42, 0x0A]),
    shiftOut: Buffer.from('a\x0eb\x0fc'),
    hz: Buffer.from('~{<:Ky2;S{#,NpJ)l6HK!#~}'),
    utf7: Buffer.from('Hi Mom -+Jjo--!'),
    utf8Bom: Buffer.from('﻿# BOM title\n'),
    utf8Japanese: Buffer.from('# 日本語ドキュメント\n本文です。\n'),
    utf16leBom: Buffer.from([0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]),
    utf16beBom: Buffer.from([0xFE, 0xFF, 0x00, 0x41, 0x00, 0x42]),
    shiftJisBytes: Buffer.from([0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4, 0x0A, 0x93, 0xFA, 0x96, 0x7B]),
    eucJpBytes: Buffer.from([0xA4, 0xA2, 0xA4, 0xA4, 0xA4, 0xA6, 0x0A, 0xC6, 0xFC, 0xCB, 0xDC]),
    latin1Bytes: Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x20, 0x6E, 0x61, 0xEF, 0x76, 0x65]),
    pdfMagic: Buffer.from('%PDF-1.4\n1 0 obj\n'),
  };
  for (const [label, buf] of Object.entries(cases)) assertSame(buf, label);
});

test('decodeTextBuffer matches the detector for random ASCII and near-ASCII input', () => {
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let i = 0; i < 400; i++) {
    const len = rand() % 600;
    const buf = Buffer.alloc(len);
    // Mostly printable ASCII, sometimes any 7-bit byte, rarely a high byte.
    for (let j = 0; j < len; j++) {
      const r = rand() % 100;
      buf[j] = r < 85 ? 0x20 + (rand() % 95) : r < 99 ? rand() % 128 : 0x80 + (rand() % 128);
    }
    assertSame(buf, `random #${i}`);
  }
});

test('decodeTextBuffer matches the detector for every text file in the repo docs', () => {
  const dirs = ['sample-docs', 'docs', 'tests'].map((d) => join(ROOT, d));
  let checked = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || statSync(full).size > 2 * 1024 * 1024) continue;
      assertSame(readFileSync(full), full);
      checked++;
    }
  };
  for (const dir of dirs) { try { walk(dir); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
  assert.ok(checked > 0);
});
