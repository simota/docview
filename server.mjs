import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  '.json', '.yaml', '.yml',
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

// Safe path resolution (prevent traversal)
function safePath(reqPath) {
  const resolved = resolve(targetDir, reqPath);
  if (!resolved.startsWith(targetDir)) return null;
  return resolved;
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

  // CORS headers for dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

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
      res.end(JSON.stringify({ root: rootName, path: targetDir, tree }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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

    const resolved = safePath(filePath);
    if (!resolved) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    try {
      const ext = extname(resolved).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        const content = await readFile(resolved);
        const mime = IMAGE_MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=5' });
        res.end(content);
      } else {
        const content = await readFile(resolved, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
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
    res.end(JSON.stringify({ dir: targetDir, root: basename(targetDir), initialFile }));
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
    const lowerQuery = query.toLowerCase();

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
                if (lines[i].toLowerCase().includes(lowerQuery)) {
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
      res.end(JSON.stringify({ error: err.message }));
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

  // Static files
  await serveStatic(res, url.pathname);
});

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
