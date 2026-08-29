import { test, expect } from '@playwright/test';

// Fixture: /tmp/md-test-docs/manual.pdf (created by tests/setup.ts).
test.describe('PDF files', () => {
  test('PDF appears in the file tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await expect(page.locator('.filetree-item[data-path="manual.pdf"]')).toHaveCount(1);
  });

  test('/api/file streams application/pdf with Range support and same-origin framing', async ({ request }) => {
    const res = await request.get('/api/file?path=manual.pdf');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['accept-ranges']).toBe('bytes');
    expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers()['content-security-policy']).toBeUndefined();
    expect(res.headers()['x-file-mtime']).toBeTruthy();

    const partial = await request.get('/api/file?path=manual.pdf', { headers: { Range: 'bytes=0-3' } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()['content-range']).toMatch(/^bytes 0-3\/\d+$/);
    expect(await partial.text()).toBe('%PDF');
  });

  test('/api/raw serves PDF for download / new-tab actions', async ({ request }) => {
    const res = await request.get('/api/raw/manual.pdf');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('renders the PDF in an iframe with open / download actions', async ({ page }) => {
    await page.goto('/#file=manual.pdf');
    const frame = page.locator('#viewer .pdf-view__frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', '/api/file?path=manual.pdf');
    await expect(page.locator('#viewer .pdf-view__action[target="_blank"]')).toHaveAttribute('href', '/api/file?path=manual.pdf');
    await expect(page.locator('#viewer .pdf-view-open-app')).toBeVisible();
    await expect(page.locator('#viewer .pdf-view__action[download]')).toHaveAttribute('href', '/api/raw/manual.pdf');
    await expect(page.locator('.filetree-item[data-path="manual.pdf"]')).toHaveClass(/active/);
  });

  test('PDF is treated as binary: no line count, no text search', async ({ request }) => {
    const meta = await (await request.get('/api/file/meta?path=manual.pdf')).json();
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.lines).toBeUndefined();

    const inFile = await request.get('/api/file/search?path=manual.pdf&q=PDF');
    expect(inFile.status()).toBe(415);

    const global = await request.get('/api/search?q=DOCVIEWPDFTOKEN');
    expect(global.status()).toBe(200);
    const hits = await global.json();
    expect(hits.filter((h: { path: string }) => h.path.endsWith('.pdf'))).toHaveLength(0);
  });
});
