import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const DIR = '/tmp/md-test-docs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Regression suite for the chokidar v5 / security bug-fix batch:
 *  - live reload via SSE (watcher was completely dead with glob patterns)
 *  - breadcrumb XSS via filename
 *  - /api/file 404 (missing) vs 403 (traversal) split in safePath
 *  - wiki links with dangerous URL schemes
 *  - --remote-max-size lower-bound validation
 */
test.describe('Regression: bug-fix suite', () => {
  test('live reload: editing the open .md file re-renders via SSE', async ({ page }) => {
    const file = join(DIR, 'live-reload.md');
    writeFileSync(file, '# Live Reload v1\n');

    // Wait for the EventSource connection so the server has registered this
    // client before the file changes — avoids a write-before-subscribe race.
    const sseConnected = page.waitForResponse((res) => res.url().includes('/api/watch'));
    await page.goto('/#file=live-reload.md');
    await expect(page.locator('#viewer h1')).toContainText('Live Reload v1');
    await sseConnected;

    writeFileSync(file, '# Live Reload v2\n');
    await expect(page.locator('#viewer h1')).toContainText('Live Reload v2', { timeout: 15000 });
  });

  // NOTE: an `add → file tree refresh` variant was intentionally omitted: the
  // add/unlink broadcast refreshes the tree in EVERY connected page, which
  // destabilizes parallel tests interacting with the tree (context menu spec).
  // The chokidar v5 watcher pipeline is already exercised by the change test.

  test('breadcrumb escapes HTML in path segments (filename XSS)', async ({ page }) => {
    const evilName = '<img src=x onerror=window.__xss=1>.md';
    await page.goto('/#file=' + encodeURIComponent(evilName));
    await page.waitForSelector('#breadcrumb .breadcrumb-item');

    // The payload must appear as literal text, never as a parsed element.
    await expect(page.locator('#breadcrumb')).toContainText(evilName);
    await expect(page.locator('#breadcrumb img')).toHaveCount(0);
    const xss = await page.evaluate(() => (window as unknown as Record<string, unknown>)['__xss']);
    expect(xss).toBeUndefined();
  });

  test('GET /api/file → 404 for missing paths inside the root', async ({ request }) => {
    for (const p of ['no-such-file-xyz.md', 'subdir/no-such-file-xyz.md']) {
      const res = await request.get('/api/file?path=' + encodeURIComponent(p));
      expect(res.status(), `path=${p}`).toBe(404);
    }
  });

  test('GET /api/file → 403 for path traversal (existing and missing targets)', async ({ request }) => {
    for (const p of ['../../etc/hosts', '../../no-such-file-outside-xyz', '../md-test-docs-sibling']) {
      const res = await request.get('/api/file?path=' + encodeURIComponent(p));
      expect(res.status(), `path=${p}`).toBe(403);
    }
  });

  test('wiki links with dangerous URL schemes render as plain text', async ({ page }) => {
    await page.goto('/#file=wiki.md');
    await page.waitForSelector('#viewer h1');

    // Positive control: a normal wiki link still becomes an anchor.
    await expect(page.locator('#viewer a.wiki-link[href="README.md"]')).toHaveCount(1);

    // Dangerous schemes must not produce an anchor at all…
    await expect(page.locator('#viewer a', { hasText: 'javascript:alert(1)' })).toHaveCount(0);
    await expect(page.locator('#viewer a', { hasText: 'data:text/html' })).toHaveCount(0);
    // …but the target text stays visible as plain text.
    await expect(page.locator('#viewer')).toContainText('javascript:alert(1)');
  });

  test('--remote-max-size below 1 is rejected at startup', async () => {
    const result = await new Promise<{ exitCode: number; killed: boolean; stderr: string }>((resolvePromise) => {
      execFile(
        'node',
        ['server.mjs', DIR, '--remote-max-size', '0', '--port', '4099'],
        { cwd: ROOT, timeout: 10000 },
        (err, _stdout, stderr) => resolvePromise({
          exitCode: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          // If the process had to be timeout-killed, the server started up
          // instead of rejecting the flag — that is the pre-fix behavior.
          killed: Boolean(err?.killed),
          stderr,
        }),
      );
    });
    expect(result.killed).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('remote-max-size');
  });
});
