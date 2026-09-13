import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDimensions, buildDimensions, parsePngTextChunks } from '../lib/image-meta.mjs';

test('lossy WebP dimensions do not use the lossless minus-one encoding', () => {
  const header = Buffer.alloc(30);
  header.write('RIFF', 0);
  header.write('WEBPVP8 ', 8);
  header.writeUInt32LE(10, 16);
  header.set([0x9d, 0x01, 0x2a], 23);
  header.writeUInt16LE(63, 26);
  header.writeUInt16LE(127, 28);
  assert.deepEqual(parseDimensions(header, '.webp'), { width: 63, height: 127 });
});

test('a complete lossless WebP dimension header needs only 25 bytes', () => {
  const header = Buffer.alloc(25);
  header.write('RIFF', 0);
  header.write('WEBPVP8L', 8);
  header.writeUInt32LE(5, 16);
  header[20] = 0x2f;
  header.writeUInt32LE((126 << 14) | 62, 21);
  assert.deepEqual(parseDimensions(header, '.webp'), { width: 63, height: 127 });
});

test('responsive SVG percentages use the viewBox instead of treating percent as pixels', () => {
  const svg = Buffer.from('<svg width="100%" height="100%" viewBox="0 0 640 480"/>');
  assert.deepEqual(parseDimensions(svg, '.svg'), { width: 640, height: 480, isSvg: true });
  assert.deepEqual(parseDimensions(Buffer.from('<svg width = "12.5px" height = "5px"/>'), '.svg'),
    { width: 12.5, height: 5, isSvg: true });
});

test('incomplete or incorrectly typed PNG dimension headers are ignored', () => {
  const header = Buffer.alloc(33);
  header.set(Buffer.from('89504e470d0a1a0a', 'hex'));
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(20, 16);
  header.writeUInt32BE(10, 20);
  header[24] = 8;
  header[25] = 6;
  assert.equal(parseDimensions(header.subarray(0, 24), '.png'), null);
  assert.equal(parseDimensions(header.subarray(0, 25), '.png'), null);
  assert.equal(parseDimensions(header, '.png').width, 20);
  header.write('tEXt', 12);
  assert.equal(parseDimensions(header, '.png'), null);
});

test('truncated PNG text chunks cannot become provenance metadata', () => {
  const data = Buffer.from('parameters\0untrusted truncated text');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 20, 0);
  header.write('tEXt', 4);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), header, data]);
  assert.deepEqual(parsePngTextChunks(png), {});
});

test('invalid dimensions cannot recurse indefinitely or yield negative ratios', () => {
  for (const width of [NaN, Infinity, -Infinity, -1, 0]) {
    assert.equal(buildDimensions({ width, height: 100 }, '.svg'), null);
  }
  assert.deepEqual(buildDimensions({ width: 100, height: 50, isSvg: true }, '.svg'), {
    width: 100, height: 50, aspectRatio: '2:1', megapixels: 'N/A',
  });
});

test('metadata extraction degrades gracefully when the optional C2PA module cannot resolve', async () => {
  // data: modules can load node: imports, but cannot resolve package imports.
  // This exercises an unavailable native dependency regardless of the host install.
  const source = await readFile(new URL('../lib/image-meta.mjs', import.meta.url));
  const isolated = await import(`data:text/javascript;base64,${source.toString('base64')}`);
  assert.equal(await isolated.readC2pa(Buffer.alloc(0), 'image/png'), null);
  assert.equal(isolated.detectAiProvenance({}, {}, null, {
    detected: true, trainedAlgorithmicMedia: true, generators: [],
  }).c2pa.verifyState, 'unparsed');
});
