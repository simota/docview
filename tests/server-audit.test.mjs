import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = isAbsolute(process.execPath) ? process.execPath
  : process.env.PATH.split(delimiter).map((dir) => join(dir, process.execPath)).find(existsSync);
let fixture;
let docs;

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'docview-server-audit-'));
  docs = join(fixture, 'docs');
  await mkdir(docs);
  await writeFile(join(docs, 'target.md'), '# Target\n');
  await writeFile(join(docs, '.env'), 'VISIBLE=before\n');
  await writeFile(join(fixture, 'outside.md'), 'OUTSIDE_AUDIT_SECRET [target](target.md)\n');
  await writeFile(join(fixture, 'outside.png'), 'outside image');
  await symlink(join(fixture, 'outside.md'), join(docs, 'external.md'));
  await symlink(join(fixture, 'outside.md'), join(docs, '.docview.css'));
  await symlink(join(fixture, 'outside.png'), join(docs, 'external.png'));
  await symlink(join(docs, 'target.md'), join(docs, 'internal.md'));
});
after(async () => { await rm(fixture, { recursive: true, force: true }); });

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(t, { args = [], env = {}, directory = docs } = {}) {
  const port = await availablePort();
  const child = fork(join(ROOT, 'server.mjs'), [directory, '--port', String(port), ...args], {
    cwd: ROOT,
    execPath: NODE,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.on('message', (message) => {
      if (message.type === 'listening') { clearTimeout(timer); resolve(); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  return { child, base, request: (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) }) };
}

test('malformed raw percent escapes return 400 and leave the server running', async (t) => {
  const server = await startServer(t);
  const response = await server.request('/api/raw/%ZZ');
  assert.equal(response.status, 400);
  assert.equal((await server.request('/api/info')).status, 200);
});

test('diagram requests validate JSON shape before invoking renderers', async (t) => {
  const server = await startServer(t);
  for (const body of ['null', '[]', '{"type":"d2","source":{}}', '{"type":"d2","source":42}']) {
    const response = await server.request('/api/diagram', { method: 'POST', body });
    assert.equal(response.status, 400, body);
  }
  assert.equal((await server.request('/api/info')).status, 200);
});

test('directory scanners and custom CSS respect the same symlink boundary as file reads', async (t) => {
  const server = await startServer(t);
  assert.equal((await server.request('/api/file?path=external.md')).status, 403);
  assert.deepEqual(await (await server.request('/api/search?q=OUTSIDE_AUDIT_SECRET')).json(), []);
  const backlinks = await (await server.request('/api/backlinks?path=target.md')).json();
  assert.ok(!backlinks.some((item) => item.path === 'external.md'));
  const { tree } = await (await server.request('/api/tree')).json();
  assert.ok(!tree.some((item) => item.path.startsWith('external.')));
  assert.ok(tree.some((item) => item.path === 'internal.md'), 'in-root symlinks remain usable');
  const gallery = await (await server.request('/api/gallery?path=.')).json();
  assert.ok(!gallery.items.some((item) => item.path === 'external.png'));
  assert.equal((await server.request('/api/custom-css')).status, 403);
});

test('private IPv6 literals, including IPv4-mapped addresses, are refused before connecting', async (t) => {
  const server = await startServer(t);
  for (const host of ['[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[fe90::1]']) {
    const response = await server.request('/api/remote?url=' + encodeURIComponent(`http://${host}/file.md`));
    assert.equal(response.status, 403, host);
  }
});

test('remote requests can connect to IPv6 when private access is explicitly enabled', async (t) => {
  const remote = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    res.end('# IPv6 works');
  });
  try {
    remote.listen(0, '::1');
    await once(remote, 'listening');
  } catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) { t.skip('IPv6 loopback unavailable'); return; }
    throw error;
  }
  t.after(() => new Promise((resolve) => remote.close(resolve)));
  const server = await startServer(t, { args: ['--allow-private-remote'] });
  const response = await server.request('/api/remote?url=' + encodeURIComponent(`http://[::1]:${remote.address().port}/file.md`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '# IPv6 works');
});

test('opening a file with no OS opener returns an error without terminating the server', async (t) => {
  const server = await startServer(t, { env: { PATH: fixture } });
  const response = await server.request('/api/open', {
    method: 'POST',
    headers: { Origin: server.base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'target.md' }),
  });
  assert.equal(response.status, 500);
  assert.equal((await server.request('/api/info')).status, 200);
});

test('JSON bodies preserve UTF-8 filenames across request chunks and cap actual bytes', async (t) => {
  await writeFile(join(docs, '日本語.md'), '# Japanese\n');
  const server = await startServer(t);
  const body = Buffer.from(JSON.stringify({ path: '日本語.md', dryRun: true }));
  const split = body.indexOf(Buffer.from('日')) + 1;
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(server.base + '/api/open', {
      method: 'POST',
      headers: { Origin: server.base, 'Content-Type': 'application/json' },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => req.end(body.subarray(split)), 50);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.path, '日本語.md');
  const oversized = await server.request('/api/open', {
    method: 'POST',
    headers: { Origin: server.base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '日'.repeat(6000), dryRun: true }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await server.request('/api/info')).status, 200);
});

test('ZIP entries remain unique when a real name collides with a generated suffix', async (t) => {
  await mkdir(join(docs, 'duplicates'), { recursive: true });
  await writeFile(join(docs, 'photo.png'), 'first');
  await writeFile(join(docs, 'photo (1).png'), 'second');
  await writeFile(join(docs, 'duplicates', 'photo.png'), 'third');
  const server = await startServer(t);
  for (const paths of [
    ['photo.png', 'photo (1).png', 'duplicates/photo.png'],
    ['photo.png', 'duplicates/photo.png', 'photo (1).png'],
  ]) {
    const response = await server.request('/api/download-zip', { method: 'POST', body: JSON.stringify({ paths }) });
    assert.equal(response.status, 200);
    const zip = Buffer.from(await response.arrayBuffer());
    const names = [];
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const size = zip.readUInt32LE(offset + 18);
      const nameSize = zip.readUInt16LE(offset + 26);
      const extraSize = zip.readUInt16LE(offset + 28);
      names.push(zip.subarray(offset + 30, offset + 30 + nameSize).toString());
      offset += 30 + nameSize + extraSize + size;
    }
    assert.equal(new Set(names).size, 3, names.join(', '));
  }
});

test('CSV record pagination and search keep quoted multiline fields intact', async (t) => {
  await writeFile(join(docs, 'multiline.csv'), 'id,message\n1,"hello\nworld"\n2,ordinary\n');
  const server = await startServer(t);
  const page = await server.request('/api/file?path=multiline.csv&records=1&offset=1&limit=1');
  assert.equal(page.headers.get('x-total-lines'), '3');
  assert.equal(await page.text(), '1,"hello\nworld"');
  const search = await (await server.request('/api/file/search?path=multiline.csv&records=1&q=world')).json();
  assert.equal(search.totalLines, 3);
  assert.equal(search.headerLine, 'id,message');
  assert.deepEqual(search.matches, [{ lineNum: 1, text: '1,"hello\nworld"' }]);
  const headerOnly = await (await server.request('/api/file/search?path=multiline.csv&records=1&q=message')).json();
  assert.equal(headerOnly.totalMatches, 0);
  const physical = await server.request('/api/file?path=multiline.csv&offset=1&limit=1');
  assert.equal(await physical.text(), '1,"hello');
});

test('CSV record pagination detects semicolon delimiters before splitting quoted newlines', async (t) => {
  await writeFile(join(docs, 'semicolon.csv'), 'id;message\n1;"hello\nworld"\n2;ordinary\n');
  const server = await startServer(t);
  const page = await server.request('/api/file?path=semicolon.csv&records=1&offset=1&limit=1');
  assert.equal(page.headers.get('x-total-lines'), '3');
  assert.equal(await page.text(), '1;"hello\nworld"');
  const search = await (await server.request('/api/file/search?path=semicolon.csv&records=1&q=world')).json();
  assert.equal(search.headerLine, 'id;message');
  assert.deepEqual(search.matches, [{ lineNum: 1, text: '1;"hello\nworld"' }]);
});

test('ignore patterns support literal-safe single-character wildcards', async (t) => {
  const directory = join(fixture, 'ignore');
  await mkdir(directory);
  await writeFile(join(directory, '.docviewignore'), '?hide.md\n');
  await writeFile(join(directory, 'xhide.md'), 'hidden');
  await writeFile(join(directory, 'xxhide.md'), 'visible');
  const server = await startServer(t, { directory });
  const { tree } = await (await server.request('/api/tree')).json();
  assert.deepEqual(tree.map((item) => item.path), ['xxhide.md']);
});

test('watcher broadcasts changes to supported hidden files such as .env', async (t) => {
  const server = await startServer(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(server.base + '/api/watch', { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  // Let Chokidar finish its initial traversal; retry the mutation while waiting
  // so the assertion depends on the event, not a fixed startup delay.
  const interval = setInterval(() => { void writeFile(join(docs, '.env'), `VISIBLE=${Date.now()}\n`); }, 200);
  const timeout = setTimeout(() => controller.abort(), 4000);
  t.after(() => { clearInterval(interval); clearTimeout(timeout); });
  let events = '';
  while (!events.includes('"path":".env"')) {
    const { value, done } = await reader.read();
    if (done) break;
    events += Buffer.from(value).toString();
  }
  assert.match(events, /"event":"change","path":"\.env"/);
});

test('CLI rejects an unsafe remote byte limit instead of silently disabling the cap', async () => {
  const child = spawn(NODE, [join(ROOT, 'server.mjs'), docs, '--remote-max-size', '9'.repeat(400)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill(), 5000);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timeout);
  assert.equal(signal, null);
  assert.notEqual(code, 0);
  assert.match(stderr, /remote-max-size/);
});

test('pathological regex searches time out without blocking other HTTP requests', async (t) => {
  const directory = join(fixture, 'regex');
  await mkdir(directory);
  await writeFile(join(directory, 'slow.md'), 'a'.repeat(60) + '!\n');
  const server = await startServer(t, { directory });
  const searching = server.request('/api/search?regex=1&q=' + encodeURIComponent('(a{1,2})+$'));
  await new Promise((resolve) => setTimeout(resolve, 150));
  const info = await fetch(server.base + '/api/info', { signal: AbortSignal.timeout(700) });
  assert.equal(info.status, 200);
  const response = await searching;
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too long/);
  const normal = await server.request('/api/search?regex=1&q=' + encodeURIComponent('^a+!$'));
  assert.equal(normal.status, 200);
  assert.deepEqual((await normal.json()).map(({ path, line }) => ({ path, line })), [{ path: 'slow.md', line: 1 }]);
});

test('CLI opens the configured server exactly once and stops its child on SIGTERM', { skip: process.platform !== 'linux' }, async (t) => {
  const directory = join(fixture, 'localhost:1234');
  const executables = join(fixture, 'executables');
  const log = join(fixture, 'opened-urls.txt');
  await mkdir(directory);
  await mkdir(executables);
  await writeFile(join(executables, 'xdg-open'), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$DOCVIEW_OPEN_LOG"\n');
  await chmod(join(executables, 'xdg-open'), 0o755);
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(NODE, [join(ROOT, 'bin/mdv.mjs'), directory, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, PATH: executables + delimiter + process.env.PATH, DOCVIEW_OPEN_LOG: log },
    stdio: 'ignore',
  });
  t.after(async () => {
    await fetch(base + '/api/shutdown', { method: 'POST', headers: { 'x-docview-shutdown': '1' }, signal: AbortSignal.timeout(1000) }).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  });
  let opened = '';
  const deadline = Date.now() + 5000;
  while (!opened && Date.now() < deadline) {
    opened = await readFile(log, 'utf8').catch(() => '');
    if (!opened) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(opened, `http://localhost:${port}/\n`);
  assert.equal((await fetch(base + '/api/info', { signal: AbortSignal.timeout(1000) })).status, 200);
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  await assert.rejects(fetch(base + '/api/info', { signal: AbortSignal.timeout(1000) }));
});
