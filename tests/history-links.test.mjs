// Server tests for the Git history API (/api/git/log, /api/git/show) and the
// broken-link checker (/api/links/check).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fixture;
let repo;
let plain;
let hasGit = true;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z' } });
}

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'docview-history-links-'));
  repo = join(fixture, 'repo');
  plain = join(fixture, 'plain');
  await mkdir(join(repo, 'docs'), { recursive: true });
  await mkdir(join(plain, 'guide'), { recursive: true });
  await mkdir(join(plain, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(fixture, 'outside.md'), 'outside\n');

  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }
  if (hasGit) {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Tester');
    git(repo, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(repo, 'docs', 'a.md'), 'one\ntwo\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'first version');
    await writeFile(join(repo, 'docs', 'a.md'), 'one\ntwo\nthree\n');
    git(repo, 'commit', '-qam', 'second version');
    await appendFile(join(repo, 'docs', 'a.md'), 'working tree\n');
    await writeFile(join(repo, 'docs', 'new.md'), 'untracked\n');
    await symlink(join(fixture, 'outside.md'), join(repo, 'docs', 'escape.md'));
  }

  await writeFile(join(plain, 'index.md'), [
    '# Index',
    '[ok](guide/intro.md) [gone](guide/missing.md) [web](https://example.com) [top](#index)',
    '![logo](img/logo.png)',
    '[[intro]] [[guide/intro]]',
    '`[code](not-a-link.md)`',
    '```',
    '[fenced](also-not.md)',
    '```',
    '[ref]: ./nowhere.md',
    '[heading](guide/intro.md#section) [encoded](guide/my%20notes.md)',
    '',
  ].join('\n'));
  await writeFile(join(plain, 'guide', 'intro.md'), '# Intro\n[back](../index.md)\n');
  await writeFile(join(plain, 'guide', 'my notes.md'), '# Notes\n');
  await writeFile(join(plain, 'node_modules', 'pkg', 'readme.md'), '[skip](absent.md)\n');
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

async function startServer(t, directory) {
  const port = await availablePort();
  const child = fork(join(ROOT, 'server.mjs'), [directory, '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    child.on('message', (message) => {
      if (message.type === 'listening') { clearTimeout(timer); resolve(); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  return (path) => fetch(base + path, { signal: AbortSignal.timeout(8000) });
}

test('git log lists commits for a tracked file and reports working-tree status', async (t) => {
  if (!hasGit) return t.skip('git not installed');
  const request = await startServer(t, repo);
  const res = await request('/api/git/log?path=docs/a.md');
  assert.equal(res.status, 200);
  const log = await res.json();
  assert.equal(log.git, true);
  assert.equal(log.status, 'modified');
  assert.deepEqual(log.commits.map((c) => c.subject), ['second version', 'first version']);
  assert.match(log.commits[0].hash, /^[0-9a-f]{40}$/);
  assert.equal(log.commits[0].author, 'Tester');

  const limited = await (await request('/api/git/log?path=docs/a.md&limit=1')).json();
  assert.equal(limited.commits.length, 1);

  const untracked = await (await request('/api/git/log?path=docs/new.md')).json();
  assert.deepEqual(untracked, { git: true, status: 'untracked', commits: [] });
});

test('git show returns file content at HEAD, HEAD~N and a commit hash', async (t) => {
  if (!hasGit) return t.skip('git not installed');
  const request = await startServer(t, repo);
  const head = await request('/api/git/show?path=docs/a.md&rev=HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-security-policy'), 'sandbox');
  assert.equal(await head.text(), 'one\ntwo\nthree\n');
  assert.equal(await (await request('/api/git/show?path=docs/a.md&rev=HEAD~1')).text(), 'one\ntwo\n');
  const { commits } = await (await request('/api/git/log?path=docs/a.md')).json();
  assert.equal(await (await request(`/api/git/show?path=docs/a.md&rev=${commits[1].short}`)).text(), 'one\ntwo\n');
  assert.equal((await request('/api/git/show?path=docs/new.md')).status, 404);
});

test('git endpoints reject unsafe revisions and paths outside the root', async (t) => {
  if (!hasGit) return t.skip('git not installed');
  const request = await startServer(t, repo);
  for (const rev of ['--output=/tmp/x', 'HEAD:../../etc/passwd', 'main', 'HEAD^', '']) {
    if (rev === '') continue;
    const res = await request(`/api/git/show?path=docs/a.md&rev=${encodeURIComponent(rev)}`);
    assert.equal(res.status, 400, rev);
  }
  assert.equal((await request('/api/git/show?path=../outside.md')).status, 403);
  assert.equal((await request('/api/git/log?path=docs/escape.md')).status, 403);
  assert.equal((await request('/api/git/show?path=docs')).status, 400);
  assert.equal((await request('/api/git/log')).status, 400);
});

test('git status maps changed files to served-root paths, including from a subfolder root', async (t) => {
  if (!hasGit) return t.skip('git not installed');
  const request = await startServer(t, repo);
  const status = await (await request('/api/git/status')).json();
  assert.equal(status.git, true);
  assert.equal(status.files['docs/a.md'], 'modified');
  assert.equal(status.files['docs/new.md'], 'untracked');

  const sub = await startServer(t, join(repo, 'docs'));
  const subStatus = await (await sub('/api/git/status')).json();
  assert.equal(subStatus.files['a.md'], 'modified');
  assert.equal(subStatus.files['docs/a.md'], undefined);
});

test('git status is unavailable outside a repository', async (t) => {
  const request = await startServer(t, plain);
  assert.deepEqual(await (await request('/api/git/status')).json(), { git: false, files: {}, truncated: false });
});

test('git log degrades to git:false outside a repository', async (t) => {
  const request = await startServer(t, plain);
  const res = await request('/api/git/log?path=index.md');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.git, false);
  assert.deepEqual(body.commits, []);
});

test('link check reports missing relative targets the way the viewer resolves them', async (t) => {
  const request = await startServer(t, plain);
  const res = await request('/api/links/check');
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.scannedFiles, 3); // node_modules is skipped
  const broken = result.broken.map((b) => `${b.source}:${b.line} ${b.kind} ${b.link} -> ${b.target}`);
  assert.deepEqual(broken, [
    'index.md:2 link guide/missing.md -> guide/missing.md',
    'index.md:3 image img/logo.png -> img/logo.png',
    'index.md:4 wiki [[intro]] -> intro.md',
    'index.md:9 reference ./nowhere.md -> nowhere.md',
  ]);
  // Wiki links resolve relative to the source; a same-name file elsewhere is offered as a fix.
  assert.deepEqual(result.broken[2].suggestions, ['guide/intro.md']);
});

test('link check can be scoped to a folder or a document and stays inside the root', async (t) => {
  const request = await startServer(t, plain);
  const scoped = await (await request('/api/links/check?path=guide')).json();
  assert.equal(scoped.scannedFiles, 2);
  assert.deepEqual(scoped.broken, []);
  const single = await (await request('/api/links/check?path=index.md')).json();
  assert.equal(single.scannedFiles, 1);
  assert.equal(single.broken.length, 4);
  assert.equal((await request('/api/links/check?path=../')).status, 403);
  assert.equal((await request('/api/links/check?path=nope')).status, 404);
});
