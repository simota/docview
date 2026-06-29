/**
 * image-meta.mjs — 画像メタデータ抽出ヘルパー
 * EXIF/color/dimensions/AI provenance/C2PA を best-effort で抽出。
 * 各抽出は独立した try/catch で包み、失敗は null を返す（500 にしない）。
 *
 * NFR-2: 巨大画像でも全バイトをメモリに載せない。寸法/色はヘッダスライス、
 * EXIF/GPS/color は exifr にパスを渡して範囲読み、PNG text チャンクは
 * ストリーム走査（IDAT を読み飛ばす）、C2PA は c2pa-node の FileAsset(path)。
 */

import { open } from 'node:fs/promises';

// 単一チャンクとして許容する最大サイズ（暴走防止 / メモリ上限）。
const MAX_TEXT_CHUNK = 16 * 1024 * 1024;

// 既知の AI ツール名（大文字小文字不問でマッチ）
const AI_TOOL_PATTERNS = [
  'stable diffusion', 'midjourney', 'dall-e', 'dall·e', 'comfyui', 'novelai', 'adobe firefly',
  'gpt-image', 'gpt-4o', 'openai', 'imagen', 'gemini', 'flux', 'ideogram', 'leonardo',
];

function matchesAiTool(str) {
  if (!str) return false;
  const lower = str.toLowerCase();
  return AI_TOOL_PATTERNS.some((p) => lower.includes(p));
}

// C2PA validation_status のコードを分類する。
// c2pa は success コード（.validated/.trusted/.match/notRevoked）も status に載せるため、
// length===0 で判定すると正常な画像まで「失敗」になる。さらに、改ざん（integrity 失敗）と
// 「署名者がトラストリスト外（untrusted）」は意味が異なるので分離する。
const C2PA_SUCCESS_RE = /(\.validated|\.trusted|\.match|not[_]?revoked)$/i;
function classifyC2paValidation(validationStatus) {
  const codes = (validationStatus ?? []).map((s) => s?.code).filter(Boolean);
  const nonSuccess = codes.filter((c) => !C2PA_SUCCESS_RE.test(c));
  const trustIssues = nonSuccess.filter((c) => /untrusted/i.test(c));
  const failures = nonSuccess.filter((c) => !/untrusted/i.test(c));
  return {
    integrityOk: failures.length === 0, // 改ざん系の失敗コードが無い
    signerTrusted: trustIssues.length === 0, // トラストリスト外の署名者でない
    statusCodes: codes,
    failureCodes: failures,
  };
}

// --- 寸法パーサー (ヘッダのみ読む) ---

function parsePngDimensions(buf) {
  // PNG シグネチャ(8) + IHDR チャンク長(4) + 'IHDR'(4) + width(4) + height(4)
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  const width  = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth   = buf[24];
  const colorType  = buf[25];
  const hasAlpha   = colorType === 4 || colorType === 6;
  return { width, height, bitDepth, colorType, hasAlpha };
}

function parseJpegDimensions(buf) {
  // SOFn マーカをスキャン
  let i = 0;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)) {
      if (i + 8 < buf.length) {
        const height = buf.readUInt16BE(i + 5);
        const width  = buf.readUInt16BE(i + 7);
        return { width, height };
      }
    }
    i += 2 + len;
  }
  return null;
}

function parseGifDimensions(buf) {
  if (buf.length < 10) return null;
  const sig = buf.slice(0, 6).toString('ascii');
  if (!sig.startsWith('GIF')) return null;
  const width  = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return { width, height };
}

function parseWebpDimensions(buf) {
  if (buf.length < 30) return null;
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  if (buf.slice(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunkType = buf.slice(12, 16).toString('ascii');
  if (chunkType === 'VP8 ' && buf.length >= 30) {
    const width  = (buf.readUInt16LE(26) & 0x3fff) + 1;
    const height = (buf.readUInt16LE(28) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunkType === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    const width  = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunkType === 'VP8X' && buf.length >= 30) {
    const width  = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
    return { width, height };
  }
  return null;
}

function parseBmpDimensions(buf) {
  if (buf.length < 26) return null;
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) return null; // 'BM'
  const width  = buf.readInt32LE(18);
  const height = Math.abs(buf.readInt32LE(22));
  return { width, height };
}

function parseSvgDimensions(buf) {
  // 先頭 2KB 以内の <svg> タグを読む
  const text = buf.slice(0, 2048).toString('utf-8');
  const svgMatch = text.match(/<svg[^>]*>/i);
  if (!svgMatch) return null;
  const tag = svgMatch[0];
  const wMatch = tag.match(/\bwidth=["']([0-9.]+)/i);
  const hMatch = tag.match(/\bheight=["']([0-9.]+)/i);
  if (wMatch && hMatch) {
    return { width: parseFloat(wMatch[1]), height: parseFloat(hMatch[1]), isSvg: true };
  }
  const vbMatch = tag.match(/viewBox=["']([0-9.\s,-]+)/i);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      return { width: parseFloat(parts[2]), height: parseFloat(parts[3]), isSvg: true };
    }
  }
  return null;
}

export function parseDimensions(buf, ext) {
  try {
    switch (ext) {
      case '.png':  return parsePngDimensions(buf);
      case '.jpg':
      case '.jpeg': return parseJpegDimensions(buf);
      case '.gif':  return parseGifDimensions(buf);
      case '.webp': return parseWebpDimensions(buf);
      case '.bmp':  return parseBmpDimensions(buf);
      case '.svg':  return parseSvgDimensions(buf);
      default: return null;
    }
  } catch {
    return null;
  }
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

export function buildDimensions(raw, ext) {
  if (!raw || !raw.width || !raw.height) return null;
  const { width, height } = raw;
  const g = gcd(width, height);
  const aspectRatio = `${width / g}:${height / g}`;
  const megapixels = raw.isSvg ? 'N/A' : parseFloat((width * height / 1e6).toFixed(2));
  return { width, height, aspectRatio, megapixels };
}

// --- PNG テキストチャンクリーダー ---

// 1 つの tEXt/iTXt チャンク data をデコードして chunks に格納（buffer 版・stream 版で共用）。
function decodePngTextChunk(type, data, chunks) {
  if (type === 'tEXt') {
    const nul = data.indexOf(0);
    if (nul !== -1) {
      const key = data.slice(0, nul).toString('latin1');
      const val = data.slice(nul + 1).toString('latin1');
      chunks[key] = val;
    }
  } else if (type === 'iTXt') {
    const nul = data.indexOf(0);
    if (nul !== -1) {
      const key = data.slice(0, nul).toString('latin1');
      // iTXt: keyword NUL compression_flag(1) compression_method(1) language NUL translated_keyword NUL text
      const rest = data.slice(nul + 1);
      const compFlag = rest[0];
      let textStart = 2;
      const ln = rest.indexOf(0, 2);
      if (ln !== -1) textStart = ln + 1;
      const tkn = rest.indexOf(0, textStart);
      if (tkn !== -1) textStart = tkn + 1;
      const val = compFlag === 0 ? rest.slice(textStart).toString('utf-8') : '[compressed]';
      chunks[key] = val;
    }
  }
}

export function parsePngTextChunks(buf) {
  const chunks = {};
  if (buf.length < 8) return chunks;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return chunks;
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    if (type === 'IEND') break;
    const data = buf.slice(pos + 8, pos + 8 + length);
    decodePngTextChunk(type, data, chunks);
    pos += 12 + length;
  }
  return chunks;
}

/**
 * NFR-2: PNG をストリーム走査し tEXt/iTXt のみバッファする。IDAT 等は data を
 * 読まずに seek でスキップするため、巨大 PNG でも全体をメモリに載せない。
 * AC-9: text チャンクは IDAT の前後どちらにあっても捕捉する（完全性を維持）。
 */
export async function parsePngTextChunksFromFile(path) {
  const chunks = {};
  let fh = null;
  try {
    fh = await open(path, 'r');
    const sig = Buffer.alloc(8);
    const sigRead = await fh.read(sig, 0, 8, 0);
    if (sigRead.bytesRead < 8) return chunks;
    if (sig.readUInt32BE(0) !== 0x89504e47 || sig.readUInt32BE(4) !== 0x0d0a1a0a) return chunks;
    let pos = 8;
    const head = Buffer.alloc(8); // chunk length(4) + type(4)
    for (;;) {
      const r = await fh.read(head, 0, 8, pos);
      if (r.bytesRead < 8) break;
      const length = head.readUInt32BE(0);
      const type = head.toString('ascii', 4, 8);
      pos += 8;
      if (type === 'IEND') break;
      if ((type === 'tEXt' || type === 'iTXt') && length > 0 && length <= MAX_TEXT_CHUNK) {
        const data = Buffer.alloc(length);
        const dr = await fh.read(data, 0, length, pos);
        if (dr.bytesRead === length) decodePngTextChunk(type, data, chunks);
      }
      pos += length + 4; // data + CRC を skip（読み飛ばし）
    }
  } catch {
    /* best-effort */
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
  return chunks;
}

// バイト署名スキャンによる C2PA 検出。c2pa-node の完全パース（read）は実画像で
// しばしば失敗する（例: OpenAI gpt-image の C2PA は v0.5.26 で "missing data box"）。
// JUMBF/C2PA は規格上バイナリ内に "jumbf"/"c2pa"/"urn:c2pa" 等の識別子を持ち、
// AI 由来は digitalSourceType=trainedAlgorithmicMedia として埋め込まれるため、
// パースに依存せず存在・AI由来・生成元を確実に検出する（参照: check_metadata.py のbyte scan）。
// NFR-2: 1MB ウィンドウのストリーム走査（境界跨ぎ対策に overlap）。上限でIOを抑制。
const C2PA_SCAN_CAP = 64 * 1024 * 1024;
export async function detectC2paFromBytes(path) {
  const result = { detected: false, trainedAlgorithmicMedia: false, generators: [] };
  let fh = null;
  try {
    fh = await open(path, 'r');
    const CHUNK = 1024 * 1024;
    const OVERLAP = 128;
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    let carry = '';
    while (pos < C2PA_SCAN_CAP) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
      if (bytesRead <= 0) break;
      const text = carry + buf.toString('latin1', 0, bytesRead);
      const lower = text.toLowerCase();
      if (!result.detected &&
          (lower.includes('jumbf') || lower.includes('urn:c2pa') ||
           text.includes('c2pa.claim') || text.includes('c2pa.signature') ||
           text.includes('c2pa.assertions'))) {
        result.detected = true;
      }
      // trainedAlgorithmicMedia は C2PA/XMP 固有語 → 由来情報の存在を含意（検出トリガ兼AIシグナル）。
      if (lower.includes('trainedalgorithmicmedia')) {
        result.trainedAlgorithmicMedia = true;
        result.detected = true;
      }
      for (const g of AI_TOOL_PATTERNS) {
        if (lower.includes(g) && !result.generators.includes(g)) result.generators.push(g);
      }
      carry = text.slice(-OVERLAP);
      pos += bytesRead;
      if (bytesRead < CHUNK) break;
    }
  } catch {
    /* best-effort */
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
  // 精度ゲート: 生成元名（openai/flux/gemini 等の一般語を含む）は C2PA を検出した
  // ファイルでのみ AI シグナルとして扱う。非C2PA画像の偶然の単語一致を誤検出しない。
  // （非C2PAのAI由来は PNG tEXt の SD/ComfyUI params と EXIF Software の経路が担当）
  if (!result.detected) result.generators = [];
  return result;
}

// --- EXIF 抽出 (exifr) ---

// input: ファイルパス（推奨・exifr が範囲読み）または Buffer のどちらでも可。
export async function extractExif(input, ext) {
  const exifFormats = new Set(['.jpg', '.jpeg', '.tiff', '.tif', '.heic', '.heif']);
  if (!exifFormats.has(ext)) return { exif: null, color: null, gps: null, raw: {} };

  let exifData = null;
  let gpsData = null;
  let raw = {};
  // 遅延ロード: 画像メタ要求時のみ exifr を読み込む（サーバ起動を重くしない）。
  let exifr;
  try {
    exifr = (await import('exifr')).default;
  } catch {
    return { exif: null, color: null, gps: null, raw: {} };
  }
  try {
    // input がパスの場合、exifr は必要なヘッダ範囲のみ読む（NFR-2）。
    exifData = await exifr.parse(input, {
      tiff: true, exif: true, gps: true, icc: true, xmp: true,
      translateKeys: true, translateValues: true, reviveValues: true,
      chunked: true,
    });
    if (exifData) raw = { ...exifData };
  } catch { /* best-effort */ }

  try {
    gpsData = await exifr.gps(input);
  } catch { /* best-effort */ }

  const exif = exifData ? {
    make:             exifData.Make ?? null,
    model:            exifData.Model ?? null,
    lensModel:        exifData.LensModel ?? null,
    iso:              exifData.ISO ?? null,
    exposureTime:     exifData.ExposureTime != null ? String(exifData.ExposureTime) : null,
    fNumber:          exifData.FNumber ?? null,
    focalLength:      exifData.FocalLength ?? null,
    dateTimeOriginal: exifData.DateTimeOriginal?.toISOString?.() ?? exifData.DateTimeOriginal ?? null,
    orientation:      exifData.Orientation ?? null,
  } : null;

  const hasAnyExif = exif && Object.values(exif).some((v) => v != null);

  const color = exifData ? {
    bitDepth:    null,
    colorSpace:  exifData.ColorSpace ?? exifData.colorSpace ?? null,
    iccProfile:  exifData.ProfileDescription ?? exifData.iccProfile?.profileDescription ?? null,
    hasAlpha:    null,
    compression: null,
  } : null;

  const gps = gpsData ? {
    lat: gpsData.latitude,
    lon: gpsData.longitude,
    mapUrl: `https://www.openstreetmap.org/?mlat=${gpsData.latitude}&mlon=${gpsData.longitude}`,
  } : null;

  return { exif: hasAnyExif ? exif : null, color, gps, raw };
}

// --- PNG 固有の color/format 情報 ---

export function extractPngColorInfo(buf, pngInfo) {
  if (!pngInfo) return null;
  const colorTypeNames = { 0: 'Grayscale', 2: 'RGB', 3: 'Indexed', 4: 'Grayscale+Alpha', 6: 'RGBA' };
  return {
    bitDepth:    pngInfo.bitDepth ?? null,
    colorSpace:  colorTypeNames[pngInfo.colorType] ?? null,
    iccProfile:  null, // PNG ICC is in iCCP chunk — skipped for now (best-effort)
    hasAlpha:    pngInfo.hasAlpha ?? false,
    compression: 'DEFLATE',
  };
}

// --- AI provenance 検出 ---

export function detectAiProvenance(pngChunks, exifRaw, c2paResult, c2paBytes) {
  const indicators = [];
  let isLikelyAiGenerated = false;

  // ① SD/ComfyUI PNG tEXt
  if (pngChunks.parameters) {
    indicators.push({ source: 'png-text', label: 'Stable Diffusion parameters', detail: pngChunks.parameters.slice(0, 500) });
    isLikelyAiGenerated = true;
  }
  if (pngChunks.workflow || pngChunks.prompt) {
    const detail = pngChunks.workflow ? pngChunks.workflow.slice(0, 200) : pngChunks.prompt.slice(0, 200);
    indicators.push({ source: 'png-text', label: 'ComfyUI workflow/prompt', detail });
    isLikelyAiGenerated = true;
  }
  // NovelAI: 明示的な "novelai" シグネチャを要求する。汎用の Comment チャンク（多くの
  // PNG が持つ）の存在だけでは判定しない（誤検出防止）。
  const naiSig = (pngChunks['novelai_comment'] && String(pngChunks['novelai_comment'])) ||
    ['Software', 'Source', 'Comment', 'Title', 'Description']
      .map((k) => pngChunks[k])
      .find((v) => v && /novelai/i.test(String(v)));
  if (naiSig) {
    indicators.push({ source: 'png-text', label: 'NovelAI metadata', detail: String(naiSig).slice(0, 200) });
    isLikelyAiGenerated = true;
  }

  // ② EXIF/XMP Software
  const software = exifRaw?.Software ?? exifRaw?.software ?? null;
  if (software && matchesAiTool(software)) {
    indicators.push({ source: 'exif-software', label: 'AI software detected', detail: software });
    isLikelyAiGenerated = true;
  }

  // ③ C2PA — 存在検出はバイト走査が信頼でき(c2pa-nodeの完全パースは実画像でよく失敗する)、
  // 暗号検証は c2pa-node がパースできた時のみ best-effort で付与する。
  let c2paSummary = null;
  const parsed = !!c2paResult?.active_manifest;
  const bytesDetected = !!c2paBytes?.detected;
  if (parsed || bytesDetected) {
    const activeManifest = c2paResult?.active_manifest;
    const issuer = activeManifest?.signature_info?.issuer ?? null;
    const claimGenerator = activeManifest?.claim_generator ?? null;
    const assertions = (activeManifest?.assertions ?? []).map((a) => a.label ?? String(a));
    const statusCodes = (c2paResult?.validation_status ?? []).map((s) => s?.code).filter(Boolean);

    // verifyState: parsed のときだけ integrity/trust を判定。parse 不能なら 'unparsed'（≠改ざん）。
    let verifyState;
    if (parsed) {
      const { integrityOk, signerTrusted } = classifyC2paValidation(c2paResult.validation_status);
      verifyState = !integrityOk ? 'failed' : signerTrusted ? 'verified' : 'untrusted';
    } else {
      verifyState = 'unparsed'; // C2PA は在るが本ツールでは詳細検証不可（例: missing data box）
    }

    c2paSummary = { detected: true, parsed, verifyState, statusCodes, issuer, claimGenerator, assertions };

    // 存在自体を indicator に（参照実装同様、来歴情報の検出を可視化）
    const gens = c2paBytes?.generators ?? [];
    const genDetail = gens.length ? `生成元: ${gens.join(', ')}` : (claimGenerator || '来歴情報あり');
    indicators.push({ source: 'c2pa', label: 'C2PA Content Credentials 検出', detail: genDetail });
  }

  // C2PA 由来の AI 判定（parse 可否に依存しない）。
  // ③-a: digitalSourceType=trainedAlgorithmicMedia（バイト走査 or パース済みアサーション）
  const parsedTrained = (c2paResult?.active_manifest?.assertions ?? [])
    .filter((a) => a.label === 'c2pa.actions')
    .some((aa) => (aa.data?.actions ?? []).some((act) => act.digitalSourceType === 'trainedAlgorithmicMedia'));
  if (c2paBytes?.trainedAlgorithmicMedia || parsedTrained) {
    indicators.push({ source: 'c2pa', label: 'C2PA: trainedAlgorithmicMedia (AI生成)', detail: 'digitalSourceType=trainedAlgorithmicMedia' });
    isLikelyAiGenerated = true;
  }
  // ③-b: claim_generator / バイト中の生成元が既知 AI ツール
  const c2paGen = c2paResult?.active_manifest?.claim_generator ?? null;
  if (c2paGen && matchesAiTool(c2paGen)) {
    indicators.push({ source: 'c2pa', label: 'AI tool claim generator', detail: c2paGen });
    isLikelyAiGenerated = true;
  }
  if ((c2paBytes?.generators ?? []).length > 0) {
    indicators.push({ source: 'c2pa', label: 'AI 生成元シグネチャ', detail: c2paBytes.generators.join(', ') });
    isLikelyAiGenerated = true;
  }

  return {
    isLikelyAiGenerated,
    indicators,
    c2pa: c2paSummary,
  };
}

// --- C2PA 読み取り (ネイティブバインディング失敗時は null) ---

// input: ファイルパス（FileAsset でディスクから読む・NFR-2）または Buffer。
export async function readC2pa(input, mimeType) {
  try {
    const { createC2pa } = await import('c2pa-node');
    const c2pa = createC2pa();
    const asset = typeof input === 'string'
      ? { path: input, mimeType }
      : { buffer: input, mimeType };
    const result = await c2pa.read(asset);
    return result;
  } catch {
    // NFR-5: c2pa-node が使えない場合は縮退
    return null;
  }
}

// --- human readable サイズ ---

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
