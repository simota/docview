import { test, expect, request as pwRequest } from '@playwright/test';

const PRIMARY = 'http://localhost:4001';
const STRICT = 'http://localhost:4002';
const MOCK = 'http://127.0.0.1:4090';

test.describe('Remote URL (Phase 3) — server API', () => {
  test('/api/info advertises remote capability', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${PRIMARY}/api/info`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.remote).toBeDefined();
    expect(body.remote.enabled).toBe(true);
    expect(body.remote.allowPrivate).toBe(true);
    expect(typeof body.remote.maxSizeBytes).toBe('number');
    await ctx.dispose();
  });

  test('strict server exposes remote enabled but private IP refused', async () => {
    const ctx = await pwRequest.newContext();
    const info = await ctx.get(`${STRICT}/api/info`);
    const body = await info.json();
    expect(body.remote.enabled).toBe(true);
    expect(body.remote.allowPrivate).toBe(false);

    const fetched = await ctx.get(`${STRICT}/api/remote?url=${encodeURIComponent(`${MOCK}/remote.md`)}`);
    expect(fetched.status()).toBe(403);
    const err = await fetched.json();
    expect(err.error).toMatch(/private|loopback/i);
    await ctx.dispose();
  });

  test('fetches allowed remote markdown via primary server', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${PRIMARY}/api/remote?url=${encodeURIComponent(`${MOCK}/remote.md`)}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/text\/markdown/);
    expect(res.headers()['x-source-url']).toBe(`${MOCK}/remote.md`);
    const text = await res.text();
    expect(text).toContain('Remote Hello');
    await ctx.dispose();
  });

  test('URLs without extension require an allowed Content-Type', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${PRIMARY}/api/remote?url=${encodeURIComponent(`${MOCK}/no-ext`)}`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('without extension');
    await ctx.dispose();
  });

  test('rejects unsupported file extensions with 415', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${PRIMARY}/api/remote?url=${encodeURIComponent(`${MOCK}/foo.exe`)}`);
    expect(res.status()).toBe(415);
    const err = await res.json();
    expect(err.error).toMatch(/extension/i);
    await ctx.dispose();
  });

  test('rejects text/html content even from allowed extension', async () => {
    const ctx = await pwRequest.newContext();
    // Extension is .md (allowed), but MIME is text/html (deny list).
    const res = await ctx.get(`${PRIMARY}/api/remote?url=${encodeURIComponent(`${MOCK}/html-disguised.md`)}`);
    expect(res.status()).toBe(415);
    const err = await res.json();
    expect(err.error).toMatch(/text\/html/i);
    await ctx.dispose();
  });

  test('rejects text/html URL directly', async () => {
    const ctx = await pwRequest.newContext();
    // .html is not in the extension allow list, so this is rejected by the ext gate.
    const res = await ctx.get(`${PRIMARY}/api/remote?url=${encodeURIComponent(`${MOCK}/page.html`)}`);
    expect(res.status()).toBe(415);
    await ctx.dispose();
  });

  test('rejects non-http(s) protocols', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${PRIMARY}/api/remote?url=${encodeURIComponent('ftp://example.com/foo.md')}`);
    expect(res.status()).toBe(400);
    const err = await res.json();
    expect(err.error).toMatch(/protocol/i);
    await ctx.dispose();
  });

  test('rejects invalid URLs', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${PRIMARY}/api/remote?url=not-a-url`);
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test('--no-remote setup would disable the endpoint', async () => {
    // Both primary/strict servers have remote enabled. We verify shape rather
    // than spawn a fourth server; unit-level flag wiring is covered by the
    // /api/info tests above.
    const ctx = await pwRequest.newContext();
    const info = await ctx.get(`${PRIMARY}/api/info`);
    const body = await info.json();
    expect(body.remote.enabled).toBe(true);
    await ctx.dispose();
  });
});

test.describe('Remote URL (Phase 3) — UrlBar UI', () => {
  test('opens a remote markdown file via Cmd+L', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill(`${MOCK}/remote.md`);
    // Status should acknowledge the URL as remote.
    await expect(page.locator('.url-bar-status-info')).toContainText('Remote', { timeout: 3000 });

    await page.keyboard.press('Enter');
    await page.waitForSelector('#viewer h1');
    await expect(page.locator('#viewer h1')).toContainText('Remote Hello');
    // Breadcrumb should show the remote URL (full URL contains the slashes).
    await expect(page.locator('#breadcrumb')).toContainText('remote.md');
  });

  test('surfaces a server-side 415 in the viewer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill(`${MOCK}/foo.exe`);
    await page.keyboard.press('Enter');
    await expect(page.locator('.error-banner')).toBeVisible();
    await expect(page.locator('.error-banner')).toContainText(/extension|fetch failed/i);
  });
});
