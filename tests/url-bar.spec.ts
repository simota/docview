import { test, expect } from '@playwright/test';

test.describe('URL bar (Cmd+L)', () => {
  test('opens with Cmd+L and closes with Esc', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await expect(page.locator('.url-bar-overlay')).toBeVisible();
    await expect(page.locator('.url-bar-input')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.url-bar-overlay')).toBeHidden();
  });

  test('toolbar button opens the URL bar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.locator('#btn-open-url').click();
    await expect(page.locator('.url-bar-overlay')).toBeVisible();
  });

  test('opens a file by relative path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('README.md');
    await page.keyboard.press('Enter');

    await page.waitForSelector('#viewer h1');
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
    await expect(page).toHaveURL(/#file=README\.md/);
  });

  test('opens a file with leading slash path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('/subdir/README.md');
    await page.keyboard.press('Enter');

    await page.waitForSelector('#viewer h1');
    await expect(page.locator('#viewer h1')).toContainText('Subdir Readme');
    await expect(page).toHaveURL(/#file=subdir%2FREADME\.md/);
  });

  test('opens a file with hash fragment including line jump', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('#file=settings.ini&line=25');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/#file=settings\.ini&line=25/);
    await page.waitForSelector('.line-highlighted');
    await expect(page.locator('.line-highlighted').first()).toBeVisible();
  });

  test('same-origin full URL is accepted', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    const origin = page.url().replace(/\/$/, '').replace(/#.*$/, '');
    await page.locator('.url-bar-input').fill(`${origin}/#file=README.md`);
    await page.keyboard.press('Enter');

    await page.waitForSelector('#viewer h1');
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  });

  test('shows an error for a missing file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('does-not-exist.md');
    await page.keyboard.press('Enter');

    await expect(page.locator('.url-bar-status-error')).toContainText('File not found');
    await expect(page.locator('.url-bar-overlay')).toBeVisible();
  });

  test('treats external URLs as remote targets', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('https://example.com/README.md');
    // With remote support enabled, live preview labels the input as remote
    // rather than rejecting it. The actual network fetch is covered by the
    // Phase 3 remote suite.
    await expect(page.locator('.url-bar-status-info')).toContainText('Remote', { timeout: 3000 });
  });

  test('records history and surfaces it on next open', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    await page.evaluate(() => localStorage.removeItem('docview.urlBar.recent'));

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('README.md');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#viewer h1');

    await page.keyboard.press('Meta+l');
    await expect(page.locator('.url-bar-suggest-title', { hasText: 'Recent' })).toBeVisible();
    await expect(page.locator('.url-bar-suggest-item').first()).toContainText('README.md');
  });
});

test.describe('URL bar Phase 2 — UX', () => {
  test('live preview confirms existing path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('README.md');
    await expect(page.locator('.url-bar-status-info')).toContainText('README.md', { timeout: 3000 });
    // The ✓ marker indicates the HEAD check passed.
    await expect(page.locator('.url-bar-status-info')).toContainText('✓');
  });

  test('live preview warns about missing path before submit', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('definitely-not-here.md');
    await expect(page.locator('.url-bar-status-error')).toContainText('File not found', { timeout: 3000 });
    // Modal must remain open — error is shown inline.
    await expect(page.locator('.url-bar-overlay')).toBeVisible();
  });

  test('autocomplete suggests files from the tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('read');

    await expect(page.locator('.url-bar-suggest-title', { hasText: 'Files' })).toBeVisible();
    // README.md and subdir/README.md should both match 'read'.
    const items = page.locator('.url-bar-suggest-item');
    await expect(items).toHaveCount(await items.count());
    await expect(items.filter({ hasText: 'README.md' }).first()).toBeVisible();
    await expect(items.filter({ hasText: 'subdir/README.md' })).toBeVisible();
  });

  test('arrow keys navigate suggestions and Enter opens selection', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-input').fill('sub');
    await expect(page.locator('.url-bar-suggest-item', { hasText: 'subdir/README.md' })).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.url-bar-suggest-item-active')).toHaveText(/subdir\/README\.md/);

    await page.keyboard.press('Enter');
    await page.waitForSelector('#viewer h1');
    await expect(page.locator('#viewer h1')).toContainText('Subdir Readme');
  });

  test('Paste button uses the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.evaluate(() => navigator.clipboard.writeText('README.md'));

    await page.keyboard.press('Meta+l');
    await page.locator('.url-bar-paste').click();
    await expect(page.locator('.url-bar-input')).toHaveValue('README.md');
    // Live preview must kick in after paste.
    await expect(page.locator('.url-bar-status-info')).toContainText('✓', { timeout: 3000 });
  });
});
