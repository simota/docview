// Unified locator: parses a user-entered string into a navigation target.
//
// Accepted forms:
//   - Local path:        "docs/guide.md", "/docs/guide.md", "./docs/guide.md"
//   - Hash only:         "#file=docs/guide.md&line=42"
//   - Same-origin URL:   "http://localhost:4000/#file=docs/guide.md&line=42"
//   - Remote URL:        "https://example.com/README.md"   (Phase 3)

export type LocatorResult =
  | { kind: 'local'; path: string; line: number | null; lineEnd: number | null }
  | { kind: 'remote'; url: string }
  | { kind: 'invalid'; reason: string };

export function resolveLocator(input: string, currentOrigin?: string): LocatorResult {
  const raw = input.trim();
  if (!raw) return { kind: 'invalid', reason: 'Empty input' };

  if (raw.startsWith('#')) return parseHashFragment(raw);

  const url = tryParseUrl(raw);
  if (url) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'invalid', reason: `Unsupported protocol: ${url.protocol}` };
    }
    const origin = currentOrigin ?? (typeof location !== 'undefined' ? location.origin : '');
    if (origin && url.origin === origin) return parseHashFragment(url.hash || '');
    return { kind: 'remote', url: url.href };
  }

  return { kind: 'local', path: normalizePath(raw), line: null, lineEnd: null };
}

function tryParseUrl(raw: string): URL | null {
  try { return new URL(raw); } catch { return null; }
}

function parseHashFragment(hash: string): LocatorResult {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body) return { kind: 'invalid', reason: 'Empty hash fragment' };
  const params = new URLSearchParams(body);
  const path = params.get('file');
  if (!path) return { kind: 'invalid', reason: "Missing 'file=' parameter in hash" };

  const lineStr = params.get('line');
  let line: number | null = null;
  let lineEnd: number | null = null;
  if (lineStr) {
    const m = lineStr.match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      line = parseInt(m[1], 10);
      if (m[2]) {
        lineEnd = parseInt(m[2], 10);
        if (lineEnd < line) [line, lineEnd] = [lineEnd, line];
      }
    }
  }
  return { kind: 'local', path: normalizePath(path), line, lineEnd };
}

// Server-side path-traversal protection is authoritative — this normalization
// is purely cosmetic so user-entered shapes resolve to the same canonical key.
function normalizePath(p: string): string {
  let out = p.trim();
  if (out.startsWith('/')) out = out.slice(1);
  out = out.replace(/^\.\//, '').replace(/\/+/g, '/');
  return out;
}
