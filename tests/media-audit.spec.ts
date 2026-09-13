import { test, expect, type Page, type Route } from '@playwright/test';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="1" y="20">Ready</text></svg>';
const meta = {
  path: 'media-audit.svg',
  basic: { size: 100, sizeHuman: '100 B', mtime: '2026-01-01T00:00:00Z', ext: '.svg', mime: 'image/svg+xml' },
  dimensions: { width: 100, height: 50, aspectRatio: '2:1', megapixels: 'N/A' },
  exif: null, color: null, gps: null, ai: null, raw: null,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function mockTree(page: Page) {
  await page.route('**/api/info', (route) => route.fulfill({ json: { rootPath: '/media-audit', initialFile: null } }));
  await page.route('**/api/tree', (route) => route.fulfill({ json: {
    root: 'media-audit', path: '/', tree: [
      { name: 'media-audit.svg', path: 'media-audit.svg', type: 'file' },
      { name: 'media-audit', path: 'media-audit', type: 'dir', children: [] },
    ],
  } }));
}

function gallery(names: string[]) {
  return { root: '.', dir: 'media-audit', total: names.length, truncated: false,
    items: names.map((name) => ({ path: `media-audit/${name}`, name, size: 100,
      mtime: '2026-01-01T00:00:00Z', ext: '.svg', kind: 'image' })) };
}

async function fulfillSvg(route: Route) {
  await route.fulfill({ contentType: 'image/svg+xml', body: svg }).catch(() => {});
}

test('SVG metadata displays vector megapixels without failing the whole panel', async ({ page }) => {
  await mockTree(page);
  await page.route('**/api/file?path=media-audit.svg', fulfillSvg);
  await page.route('**/api/image/meta?path=media-audit.svg', (route) => route.fulfill({ json: meta }));
  await page.goto('/#file=media-audit.svg');
  await expect(page.locator('.imp-content')).toBeVisible();
  await expect(page.locator('.imp-table tr').filter({ hasText: 'メガピクセル' })).toContainText('N/A');
  await expect(page.locator('.imp-error')).toHaveCount(0);
});

test('metadata copy reports a rejected clipboard write without a false success', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: () => Promise.reject(new Error('Permission denied')),
    }, configurable: true });
  });
  await mockTree(page);
  await page.route('**/api/file?path=media-audit.svg', fulfillSvg);
  await page.route('**/api/image/meta?path=media-audit.svg', (route) => route.fulfill({ json: meta }));
  await page.goto('/#file=media-audit.svg');
  const copy = page.locator('.imp-copy').first();
  await copy.click();
  await expect(copy).toHaveText('✗');
});

test('lightbox closes while its SVG request is still pending', async ({ page }) => {
  const started = deferred();
  const release = deferred();
  await mockTree(page);
  await page.route('**/api/gallery?**', (route) => route.fulfill({ json: gallery(['slow.svg']) }));
  await page.route('**/api/file?**', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      started.resolve();
      await release.promise;
    }
    await fulfillSvg(route);
  });
  try {
    await page.goto('/#album=media-audit');
    await page.locator('.album-tile').click();
    await started.promise;
    await page.keyboard.press('Escape');
    await expect(page.locator('.lightbox')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/lightbox-open/);
  } finally {
    release.resolve();
  }
});

test('a slow SVG cannot replace the next lightbox image', async ({ page }) => {
  const started = deferred();
  const release = deferred();
  const finished = deferred();
  await mockTree(page);
  await page.route('**/api/gallery?**', (route) => route.fulfill({ json: gallery(['a-slow.svg', 'b-fast.svg']) }));
  await page.route('**/api/file?**', async (route) => {
    const isSlow = route.request().url().includes('a-slow.svg') && route.request().resourceType() === 'fetch';
    if (isSlow) {
      started.resolve();
      await release.promise;
    }
    await route.fulfill({ contentType: 'image/svg+xml', body: svg.replace('Ready', isSlow ? 'Slow' : 'Fast') }).catch(() => {});
    if (isSlow) finished.resolve();
  });
  try {
    await page.goto('/#album=media-audit');
    await page.locator('.album-tile').first().click();
    await started.promise;
    await page.locator('.lightbox__nav-next').click();
    await expect(page.locator('.lightbox__img')).toContainText('Fast');
    release.resolve();
    await finished.promise;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.lightbox__filename')).toHaveText('b-fast.svg');
    await expect(page.locator('.lightbox__img')).toContainText('Fast');
  } finally {
    release.resolve();
  }
});

test('a superseded album request cannot replace the current tile selection', async ({ page }) => {
  const started = deferred();
  const release = deferred();
  const finished = deferred();
  await mockTree(page);
  await page.route('**/api/file?**', fulfillSvg);
  await page.route('**/api/gallery?**', async (route) => {
    const stale = new URL(route.request().url()).searchParams.get('recursive') === '0';
    if (stale) {
      started.resolve();
      await release.promise;
    }
    await route.fulfill({ json: gallery([stale ? 'stale.svg' : 'current.svg']) }).catch(() => {});
    if (stale) finished.resolve();
  });
  try {
    await page.goto('/#album=media-audit');
    await started.promise;
    await page.locator('#album-recursive-toggle').check();
    await expect(page.locator('.album-tile')).toContainText('current.svg');
    release.resolve();
    await finished.promise;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.locator('.album-tile').click();
    await expect(page.locator('.lightbox__filename')).toHaveText('current.svg');
  } finally {
    release.resolve();
  }
});
