import { test, expect } from '@playwright/test';

test.describe('Office and iWork files', () => {
  test('Office and iWork files appear in the file tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');

    await expect(page.locator('.filetree-item[data-path="budget.xlsx"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="legacy.xls"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="deck.pptx"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="slides.ppt"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="ledger.numbers"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="report.pages"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="keynote.key"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="keynote.key"]')).toHaveAttribute('data-type', 'file');
  });

  test('shows an explicit WebView limitation for Excel files', async ({ page }) => {
    await page.goto('/#file=budget.xlsx');

    await expect(page.locator('#viewer .office-preview')).toBeVisible();
    await expect(page.locator('#viewer .office-preview')).toContainText('Excel ファイル');
    await expect(page.locator('#viewer .office-preview')).toContainText('WebView では Excel ファイルを直接プレビューできません');
    await expect(page.locator('#viewer .office-preview-open-app')).toBeVisible();
    await expect(page.locator('#viewer .office-preview-action[href]')).toHaveAttribute('href', '/api/raw/budget.xlsx');
  });

  test('shows an explicit WebView limitation for PowerPoint files', async ({ page }) => {
    await page.goto('/#file=deck.pptx');

    await expect(page.locator('#viewer .office-preview')).toBeVisible();
    await expect(page.locator('#viewer .office-preview')).toContainText('PowerPoint ファイル');
    await expect(page.locator('#viewer .office-preview')).toContainText('WebView では PowerPoint ファイルを直接プレビューできません');
  });

  test('shows an explicit WebView limitation for iWork files and package directories', async ({ page }) => {
    await page.goto('/#file=ledger.numbers');

    await expect(page.locator('#viewer .office-preview')).toBeVisible();
    await expect(page.locator('#viewer .office-preview')).toContainText('Numbers ファイル');
    await expect(page.locator('#viewer .office-preview-open-app')).toBeVisible();
    await expect(page.locator('#viewer .office-preview-action[href]')).toHaveAttribute('href', '/api/raw/ledger.numbers');

    await page.goto('/#file=keynote.key');
    await expect(page.locator('#viewer .office-preview')).toBeVisible();
    await expect(page.locator('#viewer .office-preview')).toContainText('Keynote ファイル');
    await expect(page.locator('#viewer .office-preview-open-app')).toBeVisible();
    await expect(page.locator('#viewer .office-preview-action[href]')).toHaveCount(0);
  });

  test('/api/file serves document files as binary and omits line counts from metadata', async ({ request }) => {
    const xlsx = await request.get('/api/file?path=budget.xlsx');
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const pptx = await request.get('/api/file?path=deck.pptx');
    expect(pptx.status()).toBe(200);
    expect(pptx.headers()['content-type']).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');

    const numbers = await request.get('/api/file?path=ledger.numbers');
    expect(numbers.status()).toBe(200);
    expect(numbers.headers()['content-type']).toContain('application/vnd.apple.numbers');

    const meta = await request.get('/api/file/meta?path=budget.xlsx');
    expect(meta.status()).toBe(200);
    const body = await meta.json();
    expect(body.ext).toBe('.xlsx');
    expect(body.lines).toBeUndefined();

    const packageMeta = await request.get('/api/file/meta?path=keynote.key');
    expect(packageMeta.status()).toBe(200);
    const packageBody = await packageMeta.json();
    expect(packageBody.ext).toBe('.key');
    expect(packageBody.isDirectory).toBe(true);
    expect(packageBody.lines).toBeUndefined();
  });

  test('search APIs do not scan document binary contents', async ({ request }) => {
    const globalSearch = await request.get('/api/search?q=docview-xlsx-fixture');
    expect(globalSearch.status()).toBe(200);
    const globalBody = await globalSearch.json();
    expect(globalBody.results ?? globalBody).toEqual([]);

    const fileSearch = await request.get('/api/file/search?path=budget.xlsx&q=docview');
    expect(fileSearch.status()).toBe(415);

    const iWorkSearch = await request.get('/api/file/search?path=ledger.numbers&q=docview');
    expect(iWorkSearch.status()).toBe(415);
  });

  test('/api/open resolves document files safely without opening during dry-run', async ({ request }) => {
    const trustedHeaders = {
      Origin: 'http://localhost:4001',
      'Sec-Fetch-Site': 'same-origin',
    };

    const opened = await request.post('/api/open', {
      headers: trustedHeaders,
      data: { path: 'budget.xlsx', dryRun: true },
    });
    expect(opened.status()).toBe(200);
    const body = await opened.json();
    expect(body.ok).toBe(true);
    expect(body.path).toBe('budget.xlsx');
    expect(body.dryRun).toBe(true);
    expect(typeof body.opener).toBe('string');

    const packageOpened = await request.post('/api/open', {
      headers: trustedHeaders,
      data: { path: 'keynote.key', dryRun: true },
    });
    expect(packageOpened.status()).toBe(200);
    const packageBody = await packageOpened.json();
    expect(packageBody.ok).toBe(true);
    expect(packageBody.path).toBe('keynote.key');

    const traversal = await request.post('/api/open', {
      headers: trustedHeaders,
      data: { path: '../package.json', dryRun: true },
    });
    expect(traversal.status()).toBe(403);

    const directory = await request.post('/api/open', {
      headers: trustedHeaders,
      data: { path: 'images', dryRun: true },
    });
    expect(directory.status()).toBe(400);

    const unsupported = await request.post('/api/open', {
      headers: trustedHeaders,
      data: { path: 'videos/notes.mkv', dryRun: true },
    });
    expect(unsupported.status()).toBe(415);

    const noOrigin = await request.post('/api/open', {
      data: { path: 'budget.xlsx', dryRun: true },
    });
    expect(noOrigin.status()).toBe(403);

    const crossOrigin = await request.post('/api/open', {
      headers: { Origin: 'http://evil.example' },
      data: { path: 'budget.xlsx', dryRun: true },
    });
    expect(crossOrigin.status()).toBe(403);
  });
});
