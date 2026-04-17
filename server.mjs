import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, resolve, relative, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import chokidar from 'chokidar';
import jschardet from 'jschardet';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(__dirname, 'dist');

// --- Friendly error reporting ---

const ERROR_HINTS = {
  EACCES: {
    title: 'アクセス権限エラー (EACCES)',
    meaning: 'ファイル・ディレクトリ、またはポートへのアクセスが許可されていません。',
    causes: [
      '1024 未満のポート (80, 443 など) を管理者権限なしで使おうとしている',
      '対象ディレクトリやファイルに読み取り権限がない',
    ],
    fixes: [
      '--port 4000 のように 1024 以上のポート番号を指定してください',
      'ls -la <ディレクトリ> で権限を確認してください (自分が読めるか)',
      '別のディレクトリに移動するか、権限を付与してから再実行してください',
    ],
  },
  EADDRINUSE: {
    title: 'ポートが既に使われています (EADDRINUSE)',
    meaning: '指定したポートは他のプロセスが使用中です。',
    causes: [
      '別の docview / 開発サーバが同じポートで起動している',
      '前回の起動プロセスが終了しきれていない',
    ],
    fixes: [
      'docview --port 4001 のように別のポートを指定してください',
      'lsof -i :<port> (macOS/Linux) で使用中のプロセスを特定できます',
      'Windows の場合: netstat -ano | findstr :<port>',
    ],
  },
  ENOENT: {
    title: 'ファイル・ディレクトリが見つかりません (ENOENT)',
    meaning: '指定したパスが存在しません。',
    causes: ['パス名の打ち間違い', 'ファイルが移動・削除された'],
    fixes: [
      'ls で対象のパスが存在するか確認してください',
      '相対パスは現在のディレクトリ (pwd) を基準にします',
      'スペースを含むパスは引用符で囲ってください: docview "My Docs"',
    ],
  },
  EADDRNOTAVAIL: {
    title: 'バインドできないアドレスです (EADDRNOTAVAIL)',
    meaning: '指定したネットワークアドレスがこのマシンで利用できません。',
    causes: ['ホスト名やIPが間違っている', 'ネットワーク設定の問題'],
    fixes: ['localhost または 127.0.0.1 を使用してください'],
  },
  EMFILE: {
    title: 'ファイルディスクリプタが不足しています (EMFILE)',
    meaning: 'OS が許可するオープン可能なファイル数の上限に達しました。',
    causes: ['非常に大量のファイルを監視しようとしている'],
    fixes: [
      'ulimit -n 10240 で上限を引き上げてください (macOS/Linux)',
      'docview <ディレクトリ> でファイル数の少ないディレクトリを指定してください',
    ],
  },
};

function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function formatFriendlyError(err) {
  const code = err && err.code;
  const hint = code && ERROR_HINTS[code];
  const lines = [];
  lines.push('');
  lines.push('  エラーが発生しました');
  lines.push('  ───────────────────────────────');
  if (hint) {
    lines.push(`  種類:  ${hint.title}`);
    lines.push(`  説明:  ${hint.meaning}`);
    lines.push('');
    lines.push('  考えられる原因:');
    hint.causes.forEach((c) => lines.push(`    - ${c}`));
    lines.push('');
    lines.push('  解決方法:');
    hint.fixes.forEach((f) => lines.push(`    - ${f}`));
  } else {
    lines.push(`  ${err && err.message ? err.message : String(err)}`);
    if (code) lines.push(`  コード: ${code}`);
    lines.push('');
    lines.push('  このエラーの意味が分からない場合は、下の検索リンクを開いてみてください。');
  }
  lines.push('');
  lines.push('  この問題の解決策を検索:');
  lines.push(`    ${searchUrl(`node.js ${code || (err && err.message) || 'error'}`)}`);
  if (err && err.message) {
    lines.push('');
    lines.push('  元のエラーメッセージ (そのまま検索にも使えます):');
    lines.push(`    ${err.message}`);
  }
  lines.push('  ───────────────────────────────');
  lines.push('');
  return lines.join('\n');
}

function reportAndExit(err, { exitCode = 1 } = {}) {
  try {
    process.stderr.write(formatFriendlyError(err));
  } catch {
    console.error(err);
  }
  process.exit(exitCode);
}

process.on('uncaughtException', (err) => reportAndExit(err));
process.on('unhandledRejection', (err) => reportAndExit(err instanceof Error ? err : new Error(String(err))));

// --- Encoding detection helpers ---

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

/**
 * Detect encoding from a buffer and return a TextDecoder-compatible label.
 */
function detectEncoding(buf) {
  // BOM detection
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8';
  if (buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le';
  if (buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be';

  const detected = jschardet.detect(buf);
  if (!detected || !detected.encoding) return 'utf-8';
  const key = detected.encoding.toLowerCase().replace(/[_\s]/g, match => match === '_' ? '_' : '-');
  return ENCODING_MAP[key] || 'utf-8';
}

/**
 * Read a file and decode to UTF-8 string, auto-detecting encoding.
 */
async function readFileText(filePath) {
  const buf = await readFile(filePath);
  const encoding = detectEncoding(buf);
  if (encoding === 'utf-8') return buf.toString('utf-8');
  const decoder = new TextDecoder(encoding);
  return decoder.decode(buf);
}

/**
 * Create a Readable stream of UTF-8 text from a file, auto-detecting encoding.
 * For UTF-8 files, uses createReadStream directly.
 * For non-UTF-8 files, reads the entire file, decodes, and wraps as a stream.
 */
async function createTextReadStream(filePath) {
  // Sample first 4KB to detect encoding
  const { open } = await import('node:fs/promises');
  const fh = await open(filePath, 'r');
  try {
    const sample = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(sample, 0, 4096, 0);
    const encoding = detectEncoding(sample.subarray(0, bytesRead));
    if (encoding === 'utf-8') {
      return createReadStream(filePath, { encoding: 'utf-8' });
    }
    // Non-UTF-8: read full file, decode, return as stream
    const buf = await readFile(filePath);
    const text = new TextDecoder(encoding).decode(buf);
    return Readable.from([text]);
  } finally {
    await fh.close();
  }
}

// Parse CLI args
const args = process.argv.slice(2);
let targetDir = process.cwd();
let initialFile = null;
let port = 4000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    const raw = args[++i];
    // Strict integer match: reject "4e3", "1.5", "80abc", empty, etc.
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      reportAndExit(Object.assign(
        new Error(`ポート番号が不正です: "${raw}" (1〜65535 の整数を指定してください)`),
        { code: 'EINVALIDPORT' },
      ));
    }
    const parsed = Number(raw);
    if (parsed < 1 || parsed > 65535) {
      reportAndExit(Object.assign(
        new Error(`ポート番号が範囲外です: "${raw}" (1〜65535 の整数を指定してください)`),
        { code: 'EINVALIDPORT' },
      ));
    }
    port = parsed;
  } else if (!args[i].startsWith('-')) {
    const resolved = resolve(args[i]);
    try {
      const s = await stat(resolved);
      if (s.isFile()) {
        targetDir = dirname(resolved);
        initialFile = basename(resolved);
      } else {
        targetDir = resolved;
      }
    } catch {
      // Path doesn't exist yet — treat as directory
      targetDir = resolved;
    }
  }
}

const SUPPORTED_EXTENSIONS = new Set([
  // Markdown
  '.md', '.markdown', '.mdx', '.txt',
  // Data
  '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.csv', '.tsv',
  // Config
  '.toml', '.ini', '.conf', '.env', '.cfg', '.properties',
  // Logs
  '.log',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};

// SSE clients
const sseClients = new Set();

// File tree builder
async function buildTree(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    // Skip hidden dirs but allow hidden files with supported extensions (e.g. .env)
    if (entry.isDirectory() && entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, base);
      if (children.length > 0) {
        items.push({ name: entry.name, path: relPath, type: 'dir', children });
      }
    } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      items.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }

  // Sort: dirs first, then files, alphabetically
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

// Safe path resolution (prevent traversal + symlink bypass)
async function safePath(reqPath) {
  const resolved = resolve(targetDir, reqPath);
  // Check string prefix with trailing separator to prevent /docs-secret bypass
  const safePrefix = targetDir.endsWith('/') ? targetDir : targetDir + '/';
  if (resolved !== targetDir && !resolved.startsWith(safePrefix)) return null;
  try {
    // Resolve symlinks to real path and re-check
    const real = await realpath(resolved);
    const realBase = await realpath(targetDir);
    const realPrefix = realBase.endsWith('/') ? realBase : realBase + '/';
    if (real !== realBase && !real.startsWith(realPrefix)) return null;
    return real;
  } catch {
    return null;
  }
}

// MIME types for static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Serve static file from dist
async function serveStatic(res, urlPath) {
  let filePath = join(distDir, urlPath === '/' ? 'index.html' : urlPath);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA fallback
    filePath = join(distDir, 'index.html');
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// --- Line-range reading helpers ---

/**
 * Read a range of lines from a file using streams (never loads full file).
 * Returns the requested lines and the total line count.
 */
async function readLineRange(filePath, offset, limit) {
  const inputStream = await createTextReadStream(filePath);
  return new Promise((resolve, reject) => {
    const lines = [];
    let lineNum = 0;
    const rl = createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      if (lineNum >= offset && lines.length < limit) {
        lines.push(line);
      }
      lineNum++;
      // Optimisation: once we have our lines, we still need total count,
      // so we keep counting but skip storing.
    });
    rl.on('close', () => resolve({ lines, totalLines: lineNum }));
    rl.on('error', reject);
  });
}

/**
 * Estimate total line count. For small files (< 1 MB) count exactly.
 * For larger files, sample the first 8 KB and extrapolate.
 */
async function estimateLineCount(filePath, fileSize) {
  const EXACT_THRESHOLD = 1024 * 1024; // 1 MB
  if (fileSize <= EXACT_THRESHOLD) {
    const inputStream = await createTextReadStream(filePath);
    return new Promise((resolve, reject) => {
      let count = 0;
      const rl = createInterface({
        input: inputStream,
        crlfDelay: Infinity,
      });
      rl.on('line', () => count++);
      rl.on('close', () => resolve(count));
      rl.on('error', reject);
    });
  }
  // Sample first 8 KB
  const SAMPLE = 8192;
  const buf = Buffer.alloc(SAMPLE);
  const { open } = await import('node:fs/promises');
  const fh = await open(filePath, 'r');
  try {
    const { bytesRead } = await fh.read(buf, 0, SAMPLE, 0);
    const encoding = detectEncoding(buf.subarray(0, bytesRead));
    const sample = encoding === 'utf-8'
      ? buf.toString('utf-8', 0, bytesRead)
      : new TextDecoder(encoding).decode(buf.subarray(0, bytesRead));
    const newlines = (sample.match(/\n/g) || []).length;
    if (newlines === 0) return 1;
    const avgLineBytes = bytesRead / newlines;
    return Math.round(fileSize / avgLineBytes);
  } finally {
    await fh.close();
  }
}

/**
 * Search lines in a file matching a query string (case-insensitive).
 * Streams through the file and collects matching lines with pagination.
 * For CSV, always includes the header (line 0) in the response metadata.
 */
async function searchFileLines(filePath, query, offset, limit) {
  const lowerQuery = query.toLowerCase();
  const inputStream = await createTextReadStream(filePath);
  return new Promise((resolve, reject) => {
    const matches = [];
    let lineNum = 0;
    let totalMatches = 0;
    let headerLine = null;

    const rl = createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      // Capture header (line 0) for CSV
      if (lineNum === 0) {
        headerLine = line;
      }

      if (line.toLowerCase().includes(lowerQuery)) {
        if (totalMatches >= offset && matches.length < limit) {
          matches.push({ lineNum, text: line });
        }
        totalMatches++;
      }
      lineNum++;
    });

    rl.on('close', () => resolve({ matches, totalMatches, totalLines: lineNum, headerLine }));
    rl.on('error', reject);
  });
}

// HTTP server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'");
  // CORS restricted to same origin (no external access)
  const origin = req.headers.origin;
  if (origin && (origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (url.pathname === '/api/tree') {
    try {
      const tree = await buildTree(targetDir);
      const rootName = basename(targetDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ root: rootName, tree }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // File metadata (size, line count) — lightweight, no full read
  if (url.pathname === '/api/file/meta') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }
    const resolved = await safePath(filePath);
    if (!resolved) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }
    try {
      const fileStat = await stat(resolved);
      const ext = extname(resolved).toLowerCase();
      const meta = {
        size: fileStat.size,
        mtime: fileStat.mtime.toISOString(),
        ext,
      };
      // For text files > 0 bytes, estimate line count from a sample
      if (!IMAGE_EXTENSIONS.has(ext) && fileStat.size > 0) {
        meta.lines = await estimateLineCount(resolved, fileStat.size);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(meta));
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
    }
    return;
  }

  if (url.pathname === '/api/file') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }

    const resolved = await safePath(filePath);
    if (!resolved) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    // Line-range parameters (optional — omit for full file)
    const offsetParam = url.searchParams.get('offset');
    const limitParam = url.searchParams.get('limit');
    const hasRange = offsetParam !== null || limitParam !== null;

    try {
      const fileStat = await stat(resolved);
      const mtime = fileStat.mtime.toISOString();
      const ext = extname(resolved).toLowerCase();

      if (IMAGE_EXTENSIONS.has(ext)) {
        const content = await readFile(resolved);
        const mime = IMAGE_MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=5', 'X-File-Mtime': mtime });
        res.end(content);
      } else if (hasRange) {
        // Streaming line-range read — never loads the full file into memory
        const offset = Math.max(0, parseInt(offsetParam || '0', 10) || 0);
        const limit = Math.max(1, parseInt(limitParam || '1000', 10) || 1000);
        const { lines, totalLines } = await readLineRange(resolved, offset, limit);

        const headers = {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-File-Mtime': mtime,
          'X-Total-Lines': String(totalLines),
          'X-Chunk-Offset': String(offset),
          'X-Chunk-Limit': String(limit),
          'X-Has-More': String(offset + lines.length < totalLines),
          'Access-Control-Expose-Headers': 'X-File-Mtime, X-Total-Lines, X-Chunk-Offset, X-Chunk-Limit, X-Has-More',
        };
        res.writeHead(200, headers);
        res.end(lines.join('\n'));
      } else {
        const content = await readFileText(resolved);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Mtime': mtime });
        res.end(content);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
    }
    return;
  }

  // In-file search — stream grep with pagination (for chunked mode)
  if (url.pathname === '/api/file/search') {
    const filePath = url.searchParams.get('path');
    const query = url.searchParams.get('q');
    if (!filePath || !query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path or q parameter' }));
      return;
    }
    const resolved = await safePath(filePath);
    if (!resolved) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }
    try {
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '1000', 10) || 1000);
      const { matches, totalMatches, totalLines, headerLine } = await searchFileLines(resolved, query, offset, limit);

      const body = JSON.stringify({ matches, totalMatches, totalLines, headerLine });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Total-Matches': String(totalMatches),
        'X-Total-Lines': String(totalLines),
      });
      res.end(body);
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Search failed' }));
    }
    return;
  }

  if (url.pathname === '/api/watch') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: connected\n\n');

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ root: basename(targetDir), initialFile }));
    return;
  }

  if (url.pathname === '/api/search') {
    const query = url.searchParams.get('q');
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing q parameter' }));
      return;
    }

    const results = [];
    const useRegex = url.searchParams.get('regex') === '1';
    let matcher;
    if (useRegex) {
      // Reject patterns likely to cause catastrophic backtracking (ReDoS)
      if (query.length > 200 || /(\.\*){3,}|(\([^)]*\+\)[^)]*\+)/.test(query)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Regex pattern too complex' }));
        return;
      }
      try {
        matcher = new RegExp(query, 'i');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid regex pattern' }));
        return;
      }
    } else {
      const lowerQuery = query.toLowerCase();
      matcher = { test: (s) => s.toLowerCase().includes(lowerQuery) };
    }

    async function searchDir(dir) {
      if (results.length >= 100) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= 100) return;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else {
          const ext = extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext) && !IMAGE_EXTENSIONS.has(ext)) {
            try {
              const content = await readFileText(fullPath);
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && results.length < 100; i++) {
                if (matcher.test(lines[i])) {
                  results.push({
                    path: relative(targetDir, fullPath),
                    line: i + 1,
                    text: lines[i],
                  });
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
    }

    try {
      await searchDir(targetDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  if (url.pathname === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    watcher.close();
    server.close(() => process.exit(0));
    return;
  }

  if (url.pathname === '/api/custom-css') {
    const cssPath = join(targetDir, '.docview.css');
    try {
      const content = await readFile(cssPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }

  if (url.pathname === '/api/backlinks') {
    const targetPath = url.searchParams.get('path');
    if (!targetPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }

    const MARKDOWN_LIKE = new Set(['.md', '.markdown', '.mdx', '.txt']);
    const targetName = basename(targetPath).replace(/\.[^.]+$/, '');
    const backlinks = [];

    function isLinkToTarget(link, sourcePath) {
      if (!link) return false;
      const linkPath = link.split('#')[0].replace(/^\.\//, '');
      if (!linkPath) return false;
      if (linkPath === targetPath) return true;
      const sourceDir = dirname(sourcePath);
      const resolved = join(sourceDir, linkPath).replace(/\\/g, '/');
      if (resolved === targetPath) return true;
      const linkName = basename(linkPath).replace(/\.[^.]+$/, '');
      if (linkName === targetName && !linkPath.includes('/')) return true;
      return false;
    }

    async function scanBacklinks(dir) {
      if (backlinks.length >= 50) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (backlinks.length >= 50) return;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanBacklinks(fullPath);
        } else {
          const ext = extname(entry.name).toLowerCase();
          if (!MARKDOWN_LIKE.has(ext)) continue;
          const relPath = relative(targetDir, fullPath);
          if (relPath === targetPath) continue;
          try {
            const content = await readFileText(fullPath);
            const linkRegex = /\[(?:[^\]]*)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|[^\]]*?)?\]\]/g;
            let match;
            while ((match = linkRegex.exec(content)) !== null) {
              const linkTarget = match[1] || match[2];
              if (isLinkToTarget(linkTarget, relPath)) {
                const line = content.substring(0, match.index).split('\n').length;
                backlinks.push({ path: relPath, line });
                break;
              }
            }
          } catch { /* skip */ }
        }
      }
    }

    try {
      await scanBacklinks(targetDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(backlinks));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/diagram') {
    // Body size limit (1 MB) to prevent memory exhaustion
    const MAX_BODY = 1024 * 1024;
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
    }

    let data;
    try { data = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const { type, source } = data;
    if (!type || !source) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing type or source' }));
      return;
    }

    // Whitelist diagram types to prevent SSRF via URL path injection
    const ALLOWED_DIAGRAM_TYPES = new Set(['d2', 'plantuml', 'ditaa']);
    if (!ALLOWED_DIAGRAM_TYPES.has(type)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unsupported diagram type: ${type}` }));
      return;
    }

    // Try local CLI first
    const localSvg = await tryLocalDiagramCLI(type, source);
    if (localSvg) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(localSvg);
      return;
    }

    // Fallback to Kroki
    const krokiUrl = process.env.KROKI_URL || 'https://kroki.io';
    try {
      const krokiRes = await fetch(`${krokiUrl}/${type}/svg`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: source,
        signal: AbortSignal.timeout(15000),
      });
      if (krokiRes.ok) {
        const svg = await krokiRes.text();
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(svg);
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Diagram rendering failed' }));
      }
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Diagram service unavailable' }));
    }
    return;
  }

  // Static files
  await serveStatic(res, url.pathname);
});

// Diagram CLI helper
function tryLocalDiagramCLI(type, source) {
  const commands = {
    d2: ['d2', ['-', '-']],
    plantuml: ['plantuml', ['-tsvg', '-pipe']],
  };
  const cmd = commands[type];
  if (!cmd) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd[0], cmd[1], { timeout: 15000 });
      let out = '';
      proc.stdout.on('data', (d) => { out += d; });
      proc.on('close', (code) => { resolve(code === 0 && out ? out : null); });
      proc.on('error', () => resolve(null));
      proc.stdin.write(source);
      proc.stdin.end();
    } catch { resolve(null); }
  });
}

// File watcher
const mdGlobs = [...SUPPORTED_EXTENSIONS].map((ext) => `**/*${ext}`);
const watcher = chokidar.watch(mdGlobs, {
  cwd: targetDir,
  ignoreInitial: true,
  ignored: ['**/node_modules/**', '**/.*'],
});

function broadcast(event, filePath) {
  const data = JSON.stringify({ event, path: filePath });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

watcher.on('change', (path) => broadcast('change', path));
watcher.on('add', (path) => broadcast('add', path));
watcher.on('unlink', (path) => broadcast('unlink', path));
watcher.on('error', (err) => {
  // Non-fatal: continue running but inform the user
  process.stderr.write(formatFriendlyError(err));
});

async function killExistingDocview(p) {
  try {
    const res = await fetch(`http://localhost:${p}/api/tree`);
    if (res.ok) {
      console.log(`  Stopping existing DocView on port ${p}...`);
      await fetch(`http://localhost:${p}/api/shutdown`).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch {
    // No server running — good
  }
}

await killExistingDocview(port);

server.on('error', (err) => reportAndExit(err));

server.listen(port, () => {
  console.log(`\n  DocView`);
  console.log(`  ───────────────────────────────`);
  console.log(`  Watching:  ${targetDir}`);
  if (initialFile) console.log(`  File:      ${initialFile}`);
  console.log(`  Server:    http://localhost:${port}/`);
  console.log(`  ───────────────────────────────\n`);
  if (process.send) process.send({ type: 'listening', port });
});
