import { createServer } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(__dirname, 'dist');

// Parse CLI args
const args = process.argv.slice(2);
let targetDir = process.cwd();
let initialFile = null;
let port = 4000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[++i], 10);
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
  '.json', '.yaml', '.yml', '.csv', '.tsv',
  // Config
  '.toml', '.ini', '.conf', '.env', '.cfg', '.properties',
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

// HTTP server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'");
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

    try {
      const fileStat = await stat(resolved);
      const mtime = fileStat.mtime.toISOString();
      const ext = extname(resolved).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        const content = await readFile(resolved);
        const mime = IMAGE_MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=5', 'X-File-Mtime': mtime });
        res.end(content);
      } else {
        const content = await readFile(resolved, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Mtime': mtime });
        res.end(content);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
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
              const content = await readFile(fullPath, 'utf-8');
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
            const content = await readFile(fullPath, 'utf-8');
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
    let body = '';
    for await (const chunk of req) body += chunk;

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

server.listen(port, () => {
  console.log(`\n  DocView`);
  console.log(`  ───────────────────────────────`);
  console.log(`  Watching:  ${targetDir}`);
  if (initialFile) console.log(`  File:      ${initialFile}`);
  console.log(`  Server:    http://localhost:${port}/`);
  console.log(`  ───────────────────────────────\n`);
});
