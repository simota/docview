// Text decoding helpers: encoding detection (jschardet) and buffer → string.
import { isAscii } from 'node:buffer';
import jschardet from 'jschardet';

const ENCODING_MAP = {
  'utf-8': 'utf-8',
  'ascii': 'utf-8',
  'utf8': 'utf-8',
  'shift_jis': 'shift_jis',
  'shiftjis': 'shift_jis',
  'shift-jis': 'shift_jis',
  'windows-31j': 'shift_jis',
  'cp932': 'shift_jis',
  'euc-jp': 'euc-jp',
  'eucjp': 'euc-jp',
  'iso-2022-jp': 'iso-2022-jp',
  'euc-kr': 'euc-kr',
  'big5': 'big5',
  'gb2312': 'gbk',
  'gb18030': 'gb18030',
  'gbk': 'gbk',
  'windows-1252': 'windows-1252',
  'iso-8859-1': 'windows-1252',
  'iso-8859-2': 'iso-8859-2',
  'ibm866': 'ibm866',
  'koi8-r': 'koi8-r',
};

export function hasUtf8Bom(buf) {
  return buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}

/**
 * Detect encoding from a buffer and return a TextDecoder-compatible label.
 */
export function detectEncoding(buf) {
  // BOM detection
  if (hasUtf8Bom(buf)) return 'utf-8';
  if (buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le';
  if (buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be';

  const detected = jschardet.detect(buf);
  if (!detected || !detected.encoding) return 'utf-8';
  const key = detected.encoding.toLowerCase().replace(/[_\s]/g, match => match === '_' ? '_' : '-');
  return ENCODING_MAP[key] || 'utf-8';
}

/**
 * True when every decoder `detectEncoding` can select yields the same text
 * as UTF-8 for this buffer, so running the (slow) detector is pointless.
 *
 * All possible labels (every ENCODING_MAP value, the utf-8 fallback, and the
 * utf-16 labels which need a non-ASCII BOM) map bytes 0x00–0x7F to the same
 * code points — except ISO-2022-JP, which treats ESC (0x1B), SO (0x0E) and
 * SI (0x0F) as shift sequences. A pure-ASCII buffer without those three bytes
 * therefore decodes identically whatever the detector would have returned.
 */
function decodesAsPlainAscii(buf) {
  return isAscii(buf)
    && buf.indexOf(0x1B) === -1
    && buf.indexOf(0x0E) === -1
    && buf.indexOf(0x0F) === -1;
}

/**
 * Decode a file buffer to a string, auto-detecting its encoding. A UTF-8 BOM
 * is dropped like TextDecoder does for the other encodings: kept, it defeats
 * `^` anchors on line 1 in search and leaks into the first CSV header.
 */
export function decodeTextBuffer(buf) {
  if (decodesAsPlainAscii(buf)) return buf.toString('utf-8');
  const encoding = detectEncoding(buf);
  if (encoding === 'utf-8') return buf.toString('utf-8', hasUtf8Bom(buf) ? 3 : 0);
  return new TextDecoder(encoding).decode(buf);
}
