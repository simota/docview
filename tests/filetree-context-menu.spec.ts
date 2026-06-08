import { test, expect, type Locator } from '@playwright/test';

// Headless Chromium does not emit a `contextmenu` event from a synthetic
// right-click (`click({button:'right'})`), so we dispatch the event directly —
// this is exactly the event a real right-click produces, which our handler binds.
function rightClick(locator: Locator) {
  return locator.dispatchEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 });
}

test.describe('File tree right-click context menu', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('right-click a file shows the menu with the expected items', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));

    const menu = page.locator('.filetree-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.filetree-context-item', { hasText: /^パスをコピー$/ })).toBeVisible();
    await expect(menu.locator('.filetree-context-item', { hasText: 'ファイル名をコピー' })).toBeVisible();
    await expect(menu.locator('.filetree-context-item', { hasText: '絶対パスをコピー' })).toBeVisible();
    await expect(menu.locator('.filetree-context-item', { hasText: '分割ビューで開く' })).toBeVisible();
  });

  test('"パスをコピー" copies the relative path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));
    await page.locator('.filetree-context-item', { hasText: /^パスをコピー$/ }).click();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('README.md');
  });

  test('"ファイル名をコピー" copies the basename', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');
    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));
    await page.locator('.filetree-context-item', { hasText: 'ファイル名をコピー' }).click();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('README.md');
  });

  test('"絶対パスをコピー" copies an absolute path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');
    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));
    await page.locator('.filetree-context-item', { hasText: '絶対パスをコピー' }).click();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.startsWith('/')).toBe(true);
    expect(clip.endsWith('/README.md')).toBe(true);
  });

  test('"分割ビューで開く" opens the file in the right pane', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');
    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));
    await page.locator('.filetree-context-item', { hasText: '分割ビューで開く' }).click();

    await expect(page.locator('#viewer-pane-right')).toBeVisible();
    await expect(page.locator('#viewer-right')).toContainText('Hello DocView');
  });

  test('directory menu omits "分割ビューで開く"', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="dir"]');
    await rightClick(page.locator('.filetree-item[data-type="dir"]').first());

    const menu = page.locator('.filetree-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.filetree-context-item', { hasText: /^パスをコピー$/ })).toBeVisible();
    await expect(menu.locator('.filetree-context-item', { hasText: '分割ビューで開く' })).toHaveCount(0);
  });

  test('menu closes on outside click and Escape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));
    await expect(page.locator('.filetree-context-menu')).toBeVisible();
    await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.filetree-context-menu')).toHaveCount(0);

    await rightClick(page.locator('.filetree-item[data-path="README.md"]'));
    await expect(page.locator('.filetree-context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.filetree-context-menu')).toHaveCount(0);
  });
});
