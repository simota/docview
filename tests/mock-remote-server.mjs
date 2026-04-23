// Mock remote HTTP server for Phase 3 E2E tests.
// Listens on 127.0.0.1 so DocView's private-IP guard can be exercised on
// servers started without --allow-private-remote. Ports are passed via --port.
import { createServer } from 'node:http';

const portIdx = process.argv.indexOf('--port');
const port = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : 4090;

const REMOTE_MD = `# Remote Hello

This document was served by the mock remote server.
`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url.pathname === '/remote.md') {
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Last-Modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
    });
    res.end(REMOTE_MD);
    return;
  }

  if (url.pathname === '/no-ext') {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    res.end('# Markdown without extension\n');
    return;
  }

  if (url.pathname === '/page.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>Should be blocked</h1></body></html>');
    return;
  }

  if (url.pathname === '/foo.exe') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(Buffer.from([0x4d, 0x5a]));
    return;
  }

  // Markdown served as HTML MIME — extension allow, MIME deny → 415 expected.
  if (url.pathname === '/html-disguised.md') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('# hidden html');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  // Silence — let playwright detect readiness through /health
});
