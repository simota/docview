export type SecretMasker = (value: string, key?: string) => string;

export const REDACTED = '[REDACTED]';

const SECRET_KEY_RE =
  /(?:^|[_\-\s.])(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth[_-]?token|bearer|cookie|session)(?:$|[_\-\s.])/i;

// Match keys separately so quoted and structured values can be consumed whole.
const KEY_VALUE_RE = /(["']?)([A-Za-z_][A-Za-z0-9_.-]*)(\1[ \t]*[:=][ \t]*)/g;

const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const HEX_SECRET_RE = /\b[a-f0-9]{32,}\b/gi;
const TOKENISH_RE = /\b(?=[A-Za-z0-9._~+/=-]{28,}\b)(?=[A-Za-z0-9._~+/=-]*[A-Za-z])(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]+\b/g;

export function isSecretSafeModeEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('secretSafe') ?? params.get('safe');
    if (flag && /^(1|true|on|yes)$/i.test(flag)) return true;
    if (flag && /^(0|false|off|no)$/i.test(flag)) return false;
    return window.localStorage.getItem('docview.secretSafeMode') === 'true';
  } catch {
    return false;
  }
}

export function withSecretSafeParam(url: string): string {
  if (!isSecretSafeModeEnabled()) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}secretSafe=1`;
}

export function isLikelySecretKey(key: string | undefined): boolean {
  if (typeof key !== 'string') return false;
  const normalized = key.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return SECRET_KEY_RE.test(normalized);
}

export function maskSecretValue(value: string, key?: string): string {
  if (!value) return value;
  if (isLikelySecretKey(key)) return REDACTED;
  return maskSecrets(value);
}

/** Redact the entire assigned value, including spaces, escapes and containers. */
function maskKeyValues(text: string): string {
  const re = new RegExp(KEY_VALUE_RE.source, 'g');
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (!isLikelySecretKey(match[2])) continue;
    const start = re.lastIndex;
    const first = text[start];
    if (first === undefined || /[\r\n]/.test(first)) continue;
    let end = start;
    let quote = '';
    const stack: string[] = [];
    if (first === '"' || first === "'") quote = first;
    if (quote) {
      end++;
      while (end < text.length) {
        if (text[end] === '\\') { end += 2; continue; }
        if (text[end++] === quote) break;
      }
    } else if (first === '{' || first === '[') {
      for (; end < text.length; end++) {
        const ch = text[end];
        if (quote) {
          if (ch === '\\') { end++; continue; }
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') {
          stack.pop();
          if (!stack.length) { end++; break; }
        }
      }
    } else if (!match[1] && /(?:authorization|cookie)$/i.test(match[2])) {
      // Header values include schemes and multiple cookies separated by spaces.
      while (end < text.length && !/[\r\n]/.test(text[end])) end++;
    } else {
      while (end < text.length && !/[\s,;&}\]"']/.test(text[end])) end++;
    }
    if (end === start) continue;
    const valueQuote = first === '"' || first === "'" ? first : '';
    out += text.slice(last, start) + valueQuote + REDACTED + valueQuote;
    last = end;
    re.lastIndex = end;
  }
  return out + text.slice(last);
}

export function maskSecrets(text: string): string {
  if (!text) return text;
  return maskKeyValues(text)
    .replace(BEARER_RE, (_match, prefix) => `${prefix}${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(HEX_SECRET_RE, REDACTED)
    .replace(TOKENISH_RE, (match) => {
      if (!/[A-Z]/.test(match) && !/[+/=_-]/.test(match)) return match;
      return REDACTED;
    });
}
