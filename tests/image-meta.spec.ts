/**
 * image-meta.spec.ts — /api/image/meta エンドポイント + ImageMetaPanel UI の E2E テスト
 * ACs: AC-1,2,3,4,5,9,11,12,13,14,15,16
 */
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const BASE = 'http://localhost:4001';
const DIR = '/tmp/md-test-docs';

// ---------------------------------------------------------------------------
// フィクスチャ生成（テスト実行前に一度だけ書き込む）
// ---------------------------------------------------------------------------
// 1×1 RGBA PNG — minimal valid
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000a49444154789c6260000000020001e221bc330000000049454e44ae' +
  '426082',
  'hex',
);

/** PNG with tEXt chunk `parameters` (SD-style AI metadata). */
function makePngWithText(key: string, value: string): Buffer {
  // PNG signature
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');

  // IHDR chunk: 1×1 RGBA
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // colorType RGBA
  const ihdrChunk = buildPngChunk('IHDR', ihdrData);

  // tEXt chunk: key NUL value
  const keyBuf = Buffer.from(key, 'latin1');
  const valBuf = Buffer.from(value, 'latin1');
  const textData = Buffer.concat([keyBuf, Buffer.from([0]), valBuf]);
  const textChunk = buildPngChunk('tEXt', textData);

  // Minimal IDAT (1×1 RGBA pixel: filter 0 + RGBA=0)
  const pixelRow = Buffer.from([0, 0, 0, 0, 0]); // filter_type + 4 bytes
  const idatData = deflateSync(pixelRow);
  const idatChunk = buildPngChunk('IDAT', idatData);

  // IEND
  const iendChunk = buildPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, textChunk, idatChunk, iendChunk]);
}

function buildPngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// CRC-32 implementation (IEEE polynomial)
function crc32(buf: Buffer): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
}

// Tiny SVG
const TINY_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>');

// Corrupt/truncated PNG: first 20 bytes of a PNG (incomplete)
const CORRUPT_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// Plain text file (non-image)
const TEXT_FILE = Buffer.from('hello world');

// Write fixtures
mkdirSync(join(DIR, 'img-meta-fixtures'), { recursive: true });
writeFileSync(join(DIR, 'img-meta-fixtures', 'plain.png'), TINY_PNG);
writeFileSync(join(DIR, 'img-meta-fixtures', 'ai-sd.png'), makePngWithText('parameters', 'steps: 20, sampler: Euler a, CFG scale: 7, model: v1-5'));
writeFileSync(join(DIR, 'img-meta-fixtures', 'corrupt.png'), CORRUPT_PNG);
writeFileSync(join(DIR, 'img-meta-fixtures', 'dim.svg'), TINY_SVG);
writeFileSync(join(DIR, 'img-meta-fixtures', 'plain.txt'), TEXT_FILE);
// C2PA-bearing PNG: valid PNG header + appended JUMBF/C2PA signature bytes incl.
// trainedAlgorithmicMedia + an AI generator (gpt-image). c2pa-node cannot fully parse
// this synthetic blob (parsed=false), so it exercises the byte-scan detection path
// — the exact case that previously mis-reported "✗ 検証失敗" and missed the AI flag.
const C2PA_AI_PNG = Buffer.concat([
  TINY_PNG,
  Buffer.from('jumbf urn:c2pa:test c2pa.assertions c2pa.actions digitalSourceType trainedAlgorithmicMedia claim_generator gpt-image openai', 'latin1'),
]);
writeFileSync(join(DIR, 'img-meta-fixtures', 'c2pa-ai.png'), C2PA_AI_PNG);
// False-positive trap: NO C2PA, but a generic Comment tEXt that coincidentally mentions
// AI tool names (openai/gemini/flux). Must NOT be flagged AI (precision regression guard).
const FP_WORDS_PNG = makePngWithText('Comment', 'Notes: visited the Gemini observatory; flux density chart; see openai.com');
writeFileSync(join(DIR, 'img-meta-fixtures', 'fp-words.png'), FP_WORDS_PNG);

// ---------------------------------------------------------------------------
// API テスト（Playwright request fixture）
// ---------------------------------------------------------------------------
test.describe('GET /api/image/meta — API', () => {
  // AC-1: 有効な画像 → 200 + スキーマキー一致
  test('AC-1: valid PNG returns 200 with required schema keys', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/plain.png`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({
      path: expect.any(String),
      basic: expect.objectContaining({ size: expect.any(Number), sizeHuman: expect.any(String), mtime: expect.any(String), ext: '.png', mime: expect.any(String) }),
    });
    expect('dimensions' in body).toBe(true);
    expect('exif' in body).toBe(true);
    expect('color' in body).toBe(true);
    expect('gps' in body).toBe(true);
    expect('ai' in body).toBe(true);
    expect('raw' in body).toBe(true);
  });

  // C2PA byte-scan detection: present-but-unparseable C2PA must be DETECTED (not missed),
  // shown as unparsed (not "改ざん検証失敗"), and trainedAlgorithmicMedia/AI-generator must
  // set isLikelyAiGenerated. Regression guard for the gpt-image "missing data box" bug.
  test('C2PA byte-scan: detects unparseable C2PA + AI provenance', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/c2pa-ai.png`);
    expect(resp.status()).toBe(200);
    const { ai } = await resp.json();
    expect(ai.c2pa).not.toBeNull();
    expect(ai.c2pa.detected).toBe(true);
    // c2pa-node cannot parse the synthetic blob → unparsed, NOT a tampering "failed"
    expect(ai.c2pa.verifyState).toBe('unparsed');
    // trainedAlgorithmicMedia + gpt-image in the bytes → AI flag must be set
    expect(ai.isLikelyAiGenerated).toBe(true);
  });

  // Precision: a non-C2PA image whose text coincidentally names AI tools must NOT be
  // flagged AI, and must not report a C2PA section. Guards the kaizen precision fix.
  test('precision: AI-tool words without C2PA are not flagged', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/fp-words.png`);
    expect(resp.status()).toBe(200);
    const { ai } = await resp.json();
    expect(ai.isLikelyAiGenerated).toBe(false);
    expect(ai.c2pa).toBeNull();
  });

  // AC-2a: path パラメータなし → 400
  test('AC-2a: missing path → 400', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta`);
    expect(resp.status()).toBe(400);
  });

  // AC-2b: 存在しないファイル → 404
  test('AC-2b: nonexistent file → 404', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=does-not-exist-xyz.png`);
    expect(resp.status()).toBe(404);
  });

  // AC-2c: 非画像ファイル → 415
  test('AC-2c: non-image extension → 415', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/plain.txt`);
    expect(resp.status()).toBe(415);
  });

  // AC-3/14: EXIF なし PNG → 200 で exif null
  test('AC-3/14: PNG with no EXIF → 200, exif is null', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/plain.png`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.exif).toBeNull();
  });

  // AC-3/14: 破損PNG → 200 (500 にならない)
  test('AC-3/14: corrupt/truncated PNG → 200 not 500', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/corrupt.png`);
    expect(resp.status()).toBe(200);
  });

  // AC-5: PNG → dimensions + aspectRatio + megapixels あり
  test('AC-5: PNG returns dimensions with aspectRatio and megapixels', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/plain.png`);
    const body = await resp.json();
    expect(body.dimensions).not.toBeNull();
    expect(body.dimensions).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
      aspectRatio: expect.stringMatching(/\d+:\d+/),
    });
    expect(typeof body.dimensions.megapixels).toBe('number');
  });

  // AC-5: SVG → megapixels "N/A"
  test('AC-5: SVG returns megapixels N/A', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/dim.svg`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.dimensions).not.toBeNull();
    expect(body.dimensions.megapixels).toBe('N/A');
  });

  // AC-9: SD parameters チャンク付き PNG → AI 検出 true + indicator あり
  test('AC-9: PNG with SD parameters tEXt → isLikelyAiGenerated true', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/ai-sd.png`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ai).not.toBeNull();
    expect(body.ai.isLikelyAiGenerated).toBe(true);
    expect(body.ai.indicators.length).toBeGreaterThan(0);
    expect(body.ai.indicators[0].source).toBe('png-text');
  });

  // AC-11: AI マーカーなし普通の PNG → isLikelyAiGenerated false
  test('AC-11: plain PNG without AI markers → isLikelyAiGenerated false', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=img-meta-fixtures/plain.png`);
    const body = await resp.json();
    expect(body.ai).not.toBeNull();
    expect(body.ai.isLikelyAiGenerated).toBe(false);
  });

  // AC-13: path フィールドがリクエストと一致
  test('AC-13: response path matches request path', async ({ request }) => {
    const path = 'img-meta-fixtures/plain.png';
    const resp = await request.get(`${BASE}/api/image/meta?path=${path}`);
    const body = await resp.json();
    expect(body.path).toBe(path);
  });

  // AC-15: パストラバーサル → 403
  test('AC-15: path traversal outside served dir → 403', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/image/meta?path=../etc/passwd`);
    expect(resp.status()).toBe(403);
  });

  // AC-6/8/10 をスキップ — EXIF付きJPEGフィクスチャ、GPS埋め込み、C2PAは
  // 本テスト環境で生成困難なため。AC-6: EXIF付きJPEGが必要 (real camera file)。
  // AC-8: GPS付きJPEGが必要。AC-10: c2pa-node native binding が必要。
  test.skip('AC-6: JPEG with EXIF returns camera metadata [fixture unavailable]', async () => {});
  test.skip('AC-8: JPEG with GPS returns gps object [fixture unavailable]', async () => {});
  test.skip('AC-10: C2PA signed image returns c2pa summary [c2pa-node native binding unavailable in sandbox]', async () => {});
});

// ---------------------------------------------------------------------------
// Panel UI テスト (AC-4, AC-12)
// ---------------------------------------------------------------------------
test.describe('ImageMetaPanel UI', () => {
  // AC-4: 画像を開くと .imp-toggle-btn が存在し、クリックで .imp-panel が開く
  test('AC-4: toggle button exists and opens panel', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');

    // img-meta-fixtures/plain.png をクリック
    await page.locator('.filetree-name', { hasText: 'img-meta-fixtures' }).click();
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^plain\.png$/ }).click();

    // toggle ボタンが存在する
    await expect(page.locator('.imp-toggle-btn')).toBeVisible({ timeout: 10000 });

    // デフォルトで開いている（または閉じている状態からクリックで開く）
    const panel = page.locator('.imp-panel');
    const isOpen = await panel.evaluate((el) => el.classList.contains('imp-panel--open'));
    if (!isOpen) {
      await page.locator('.imp-toggle-btn').click();
    }
    await expect(panel).toHaveClass(/imp-panel--open/);
  });

  // AC-12: Raw セクションはデフォルトで折り畳まれている
  test('AC-12: Raw section is collapsed by default', async ({ page }) => {
    // localStorage をクリアしてデフォルト状態にする
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('image-meta-panel-open'));
    await page.waitForSelector('.filetree-item[data-type="file"]');

    await page.locator('.filetree-name', { hasText: 'img-meta-fixtures' }).click();
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^plain\.png$/ }).click();

    // パネルが開くのを待つ
    await page.waitForSelector('.imp-panel', { timeout: 10000 });
    const panel = page.locator('.imp-panel');
    const isOpen = await panel.evaluate((el) => el.classList.contains('imp-panel--open'));
    if (!isOpen) {
      await page.locator('.imp-toggle-btn').click();
    }

    // Raw セクションが読み込まれるのを待つ
    await page.waitForSelector('.imp-section', { timeout: 10000 });

    // #imp-raw の details 要素が open 属性を持たない（折り畳み）
    const rawDetails = page.locator('#imp-raw');
    await expect(rawDetails).toBeVisible({ timeout: 5000 });
    const rawOpen = await rawDetails.evaluate((el) => el.hasAttribute('open'));
    expect(rawOpen).toBe(false);
  });
});
