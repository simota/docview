export type SecretMasker = (value: string, key?: string) => string;

export const REDACTED = '[REDACTED]';

const SECRET_KEY_RE =
  /(?:^|[_\-\s.])(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth[_-]?token|bearer|cookie|session)(?:$|[_\-\s.])/i;

const KEY_VALUE_RE =
  /(["']?)(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth[_-]?token|cookie|session)(\1\s*[:=]\s*)(["']?)([^"',\s}\]]{3,}|[^"',\n}\]]{8,})(\4)/gi;

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
  return typeof key === 'string' && SECRET_KEY_RE.test(key);
}

export function maskSecretValue(value: string, key?: string): string {
  if (!value) return value;
  if (isLikelySecretKey(key)) return REDACTED;
  return maskSecrets(value);
}

export function maskSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(KEY_VALUE_RE, (_match, keyQuote, key, sep, valueQuote, _value, closeQuote) => `${keyQuote}${key}${sep}${valueQuote}${REDACTED}${closeQuote}`)
    .replace(BEARER_RE, (_match, prefix) => `${prefix}${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(HEX_SECRET_RE, REDACTED)
    .replace(TOKENISH_RE, (match) => {
      if (!/[A-Z]/.test(match) && !/[+/=_-]/.test(match)) return match;
      return REDACTED;
    });
}
