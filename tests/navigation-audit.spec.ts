import { test, expect, type Page, type Route } from '@playwright/test';
import { resolveLocator } from '../src/locator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function ready(page: Page, path = 'README.md') {
  await page.goto(`/#file=${encodeURIComponent(path)}`);
  await expect(page.locator('.filetree-item').first()).toBeVisible();
  await expect(page.locator('#viewer .loading-skeleton')).toHaveCount(0);
  await expect(page.locator('#viewer')).not.toBeEmpty();
}

function fileRoute(path: string) {
  return (url: URL) => url.pathname === '/api/file' && url.searchParams.get('path') === path;
}

async function markdown(route: Route, title: string) {
  await route.fulfill({ status: 200, contentType: 'text/plain', body: `# ${title}\n` });
}

test.describe('Navigation audit regressions', () => {
  test('ignores invalid recent-file storage without breaking startup', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('docview-recent', '{"bad":"value"}'));
    await ready(page);
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  });

  for (const action of ['clear', 'close', 'switch'] as const) {
    test(`invalidates pending full-text search when users ${action}`, async ({ page }) => {
      await ready(page);
      const requested = deferred();
      const release = deferred();
      const finished = deferred();
      await page.route('**/api/search?*', async (route) => {
        requested.resolve();
        await release.promise;
        await route.fulfill({ json: [{ path: 'old-result.md', line: 1, text: 'needle' }] });
        finished.resolve();
      });
      await page.keyboard.press('Meta+Shift+f');
      await page.locator('.search-input').fill('needle');
      await requested.promise;
      if (action === 'clear') await page.locator('.search-input').fill('');
      if (action === 'close') {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Meta+Shift+f');
      }
      if (action === 'switch') await page.getByRole('tab', { name: 'Files', exact: true }).click();
      release.resolve();
      await finished.promise;
      await settle(page);
      await expect(page.locator('.search-item[data-path="old-result.md"]')).toHaveCount(0);
    });
  }

  test('refreshes filename matches when a delayed file index arrives', async ({ page }) => {
    await ready(page);
    const requested = deferred();
    const release = deferred();
    await page.route('**/api/tree', async (route) => {
      requested.resolve();
      await release.promise;
      await route.fulfill({ json: { root: 'docs', tree: [{ name: 'late.md', path: 'late.md', type: 'file' }] } });
    });
    await page.keyboard.press('Meta+p');
    await requested.promise;
    await page.locator('.search-input').fill('late.md');
    await expect(page.locator('.search-empty')).toHaveText('No files found');
    release.resolve();
    await expect(page.locator('.search-item')).toContainText('late.md');
  });

  test('rechecks a previously missing file when submitting the URL bar', async ({ page }) => {
    await ready(page);
    let exists = false;
    await page.route(fileRoute('created-after-validation.md'), async (route) => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ status: exists ? 200 : 404 });
      } else {
        await markdown(route, 'Created after validation');
      }
    });
    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('created-after-validation.md');
    await expect(page.locator('.url-bar-status-error')).toContainText('File not found');
    exists = true;
    await page.keyboard.press('Enter');
    await expect(page.locator('#viewer h1')).toContainText('Created after validation');
  });

  test('does not navigate after closing a URL bar with a pending submit', async ({ page }) => {
    await ready(page);
    const requested = deferred();
    const release = deferred();
    const finished = deferred();
    await page.route(fileRoute('cancelled.md'), async (route) => {
      if (route.request().method() === 'HEAD') {
        requested.resolve();
        await release.promise;
        await route.fulfill({ status: 200 });
        finished.resolve();
      } else {
        await markdown(route, 'Cancelled navigation');
      }
    });
    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('cancelled.md');
    await page.keyboard.press('Enter');
    await requested.promise;
    await page.keyboard.press('Escape');
    release.resolve();
    await finished.promise;
    await settle(page);
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
    await expect(page).toHaveURL(/#file=README\.md$/);
  });

  test('keeps the newest right-pane document after a slower request resolves', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Meta+\\');
    await expect(page.locator('#viewer-right h1')).toContainText('Hello DocView');
    const requested = deferred();
    const release = deferred();
    const finished = deferred();
    await page.route(fileRoute('slides.md'), async (route) => {
      requested.resolve();
      await release.promise;
      await markdown(route, 'Stale right pane');
      finished.resolve();
    });
    await page.locator('.filetree-item[data-path="slides.md"]').click();
    await requested.promise;
    await page.locator('.filetree-item[data-path="README.md"]').click();
    await expect(page.locator('#viewer-right h1')).toContainText('Hello DocView');
    release.resolve();
    await finished.promise;
    await settle(page);
    await expect(page.locator('#viewer-right h1')).toContainText('Hello DocView');
  });

  test('discards loads belonging to a split pane that was closed and reopened', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Meta+\\');
    await expect(page.locator('#viewer-right h1')).toContainText('Hello DocView');
    const requested = deferred();
    const release = deferred();
    const finished = deferred();
    await page.route(fileRoute('slides.md'), async (route) => {
      requested.resolve();
      await release.promise;
      await markdown(route, 'Closed pane response');
      finished.resolve();
    });
    await page.locator('.filetree-item[data-path="slides.md"]').click();
    await requested.promise;
    await page.keyboard.press('Meta+\\');
    await page.keyboard.press('Meta+\\');
    await expect(page.locator('#viewer-right h1')).toContainText('Hello DocView');
    release.resolve();
    await finished.promise;
    await settle(page);
    await expect(page.locator('#viewer-right h1')).toContainText('Hello DocView');
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  });

  test('distinguishes separate requests for the same main-pane path', async ({ page }) => {
    await ready(page, 'slides.md');
    const requested = deferred();
    const release = deferred();
    const finished = deferred();
    let calls = 0;
    await page.route(fileRoute('README.md'), async (route) => {
      if (++calls === 1) {
        requested.resolve();
        await release.promise;
        await markdown(route, 'Older version');
        finished.resolve();
      } else await markdown(route, 'Newest version');
    });
    await page.locator('.filetree-item[data-path="README.md"]').click();
    await requested.promise;
    await page.locator('.filetree-item[data-path="slides.md"]').click();
    await page.locator('.filetree-item[data-path="README.md"]').click();
    await expect(page.locator('#viewer h1')).toContainText('Newest version');
    release.resolve();
    await finished.promise;
    await settle(page);
    await expect(page.locator('#viewer h1')).toContainText('Newest version');
  });

  for (const type of ['svg', 'pdf', 'xlsx'] as const) {
    test(`discards a stale ${type} preview after navigating to Markdown`, async ({ page }) => {
      await ready(page);
      const requested = deferred();
      const release = deferred();
      const finished = deferred();
      const path = `delayed.${type}`;
      await page.route((url) => url.searchParams.get('path') === path, async (route) => {
        requested.resolve();
        await release.promise;
        if (type === 'xlsx') await route.fulfill({ json: { size: 12, mtime: '2025-01-01' } });
        else await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
        finished.resolve();
      });
      await page.evaluate((file) => { location.hash = `file=${file}`; }, path);
      await requested.promise;
      await page.locator('.filetree-item[data-path="README.md"]').click();
      await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
      release.resolve();
      await finished.promise;
      await settle(page);
      await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
      await expect(page.locator('#breadcrumb')).toContainText('README.md');
    });
  }

  test('resolves encoded relative links, root paths, image paths, and email links', async ({ page }) => {
    await page.route(fileRoute('docs/start.md'), (route) => route.fulfill({ body: '# Source\n\n[Next](../next%20doc.md#destination)\n\n[Email](mailto:hello@example.com)\n\n![Image](/pictures/a%20b.png)' }));
    await page.route(fileRoute('next doc.md'), (route) => markdown(route, 'Destination'));
    await ready(page, 'docs/start.md');
    await expect(page.locator('#viewer a', { hasText: 'Email' })).toHaveAttribute('href', 'mailto:hello@example.com');
    await expect(page.locator('#viewer img')).toHaveAttribute('src', '/api/file?path=pictures%2Fa%20b.png');
    await page.locator('#viewer').getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.locator('#viewer h1')).toContainText('Destination');
    await expect(page).toHaveURL(/#file=next%20doc\.md$/);
  });

  test('large shared line ranges only highlight actual rendered rows', async ({ page }) => {
    await ready(page, 'settings.ini');
    await page.evaluate(() => { location.hash = 'file=settings.ini&line=1-999999999999'; });
    await expect(page.locator('#viewer .line-row.line-highlighted').first()).toBeVisible();
    await expect(page.locator('#viewer .line-row.line-highlighted')).toHaveCount(await page.locator('#viewer .line-row').count());
  });
});

test('locator ignores zero and overflowing line targets', () => {
  for (const line of ['0', '0-2', '9007199254740993', '1-999999999999999999999']) {
    expect(resolveLocator(`#file=README.md&line=${line}`, 'https://docview.test')).toEqual({ kind: 'local', path: 'README.md', line: null, lineEnd: null });
  }
});

test('remote Markdown keeps its URL as the base for links and images', async ({ page }) => {
  await ready(page);
  await page.route('https://docs.example.test/**', (route) => route.abort());
  await page.route('**/api/remote?*', (route) => route.fulfill({ body: '# Remote\n\n[Guide](../guide.md)\n\n![Diagram](./diagram.png)' }));
  await page.keyboard.press('Meta+l');
  await page.locator('.url-bar-input').fill('https://docs.example.test/manual/readme.md');
  await page.keyboard.press('Enter');
  await expect(page.locator('#viewer h1')).toContainText('Remote');
  await expect(page.locator('#viewer').getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute('href', 'https://docs.example.test/guide.md');
  await expect(page.locator('#viewer img')).toHaveAttribute('src', 'https://docs.example.test/manual/diagram.png');
});

test('a remote response cannot replace a subsequently selected local file', async ({ page }) => {
  await ready(page);
  const requested = deferred();
  const release = deferred();
  const finished = deferred();
  await page.route('**/api/remote?*', async (route) => {
    requested.resolve();
    await release.promise;
    await markdown(route, 'Stale remote');
    finished.resolve();
  });
  await page.keyboard.press('Meta+l');
  await page.locator('.url-bar-input').fill('https://docs.example.test/late.md');
  await page.keyboard.press('Enter');
  await requested.promise;
  await page.locator('.filetree-item[data-path="README.md"]').click();
  await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  release.resolve();
  await finished.promise;
  await settle(page);
  await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
});

test('TOC preserves heading IDs containing literal HTML entities', async ({ page }) => {
  await page.route(fileRoute('entity-heading.md'), (route) => route.fulfill({ body: '<h2 id="literal&amp;copy;">Heading with entity</h2>' }));
  await ready(page, 'entity-heading.md');
  await expect(page.locator('#viewer h2')).toHaveAttribute('id', 'literal&copy;');
  await expect(page.locator('.toc-link', { hasText: 'Heading with entity' })).toHaveAttribute('data-target', 'literal&copy;');
});

test('renders video files in the right pane with a media player', async ({ page }) => {
  await ready(page, 'videos/clip1.mp4');
  await expect(page.locator('#viewer video')).toBeAttached();
  await page.keyboard.press('Meta+\\');
  await expect(page.locator('#viewer-right video')).toHaveAttribute('src', '/api/file?path=videos%2Fclip1.mp4');
});

test('renders locally selected video files with a media player', async ({ page }) => {
  await ready(page);
  await page.locator('#file-input').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('000000186674797069736f6d', 'hex') });
  await expect(page.locator('#viewer video')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('#viewer video')).toHaveAttribute('controls', '');
});

test('Markdown shared-file hash links retain application routing', async ({ page }) => {
  await page.route(fileRoute('shared-link.md'), (route) => route.fulfill({ body: '# Shared links\n\n[Shared file](#file=settings.ini&line=2)' }));
  await ready(page, 'shared-link.md');
  await page.locator('#viewer').getByRole('link', { name: 'Shared file', exact: true }).click();
  await expect(page).toHaveURL(/#file=settings\.ini&line=2$/);
  await expect(page.locator('#viewer .line-row[data-line="2"]')).toHaveClass(/line-highlighted/);
});

test('a completed same-file heading jump does not replay after another navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      if (this.id === 'destination') {
        const root = document.documentElement;
        root.dataset.headingScrolls = String(Number(root.dataset.headingScrolls ?? '0') + 1);
      }
      original.call(this, options);
    };
  });
  await page.route(fileRoute('heading-source.md'), (route) => route.fulfill({ body: '# Source\n\n[Jump](./heading-source.md#destination)\n\n## Destination' }));
  await ready(page, 'heading-source.md');
  await page.locator('#viewer').getByRole('link', { name: 'Jump', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-heading-scrolls', '1');
  await page.locator('.filetree-item[data-path="README.md"]').click();
  await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  await page.evaluate(() => { location.hash = 'file=heading-source.md'; });
  await expect(page.locator('#viewer h1')).toContainText('Source');
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-heading-scrolls', '1');
});

test('choosing a URL-bar suggestion invalidates an earlier pending submission', async ({ page }) => {
  await ready(page);
  const requested = deferred();
  const release = deferred();
  const finished = deferred();
  await page.route('**/api/tree', (route) => route.fulfill({ json: {
    root: 'docs', tree: [{ name: 'pending-choice.md', path: 'pending-choice.md', type: 'file' }],
  } }));
  await page.route(fileRoute('pending'), async (route) => {
    if (route.request().method() === 'HEAD') {
      requested.resolve();
      await release.promise;
      await route.fulfill({ status: 200 });
      finished.resolve();
    } else await markdown(route, 'Wrong previous submission');
  });
  try {
    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('pending');
    await expect(page.locator('.url-bar-suggest-item')).toContainText('pending-choice.md');
    await page.keyboard.press('Enter');
    await requested.promise;
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.url-bar-input')).toHaveValue('pending-choice.md');
    release.resolve();
    await finished.promise;
    await settle(page);
    await expect(page.locator('.url-bar-overlay')).toBeVisible();
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  } finally {
    release.resolve();
  }
});
