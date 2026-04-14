import { test, expect } from '@playwright/test';

test.describe('DocView E2E', () => {
  test('loads and displays file tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    const items = page.locator('.filetree-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(0);
  });

  test('displays markdown file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    const readmeItem = page.locator('.filetree-item[data-type="file"]', { hasText: 'README.md' });
    await readmeItem.click();
    await page.waitForSelector('#viewer h1');
    await expect(page.locator('#viewer h1')).toBeVisible();
  });

  test('displays YAML with tree view', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^config\.yaml$/ }).click();
    await page.waitForSelector('#viewer .json-tree, #viewer .data-view', { timeout: 10000 });
    await expect(page.locator('#viewer .json-tree, #viewer .data-view').first()).toBeVisible();
  });

  test('displays JSON tree view', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^data\.json$/ }).click();
    await page.waitForSelector('#viewer .json-tree', { timeout: 10000 });
    await expect(page.locator('#viewer .json-tree')).toBeVisible();
  });

  test('file search modal opens with Cmd+P', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    await page.keyboard.press('Meta+p');
    await expect(page.locator('.search-overlay')).toBeVisible();
  });

  test('theme toggle works', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('md-viewer-theme', 'light'));
    await page.reload();
    await page.waitForSelector('.filetree-item');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('breadcrumb updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    const firstFile = page.locator('.filetree-item[data-type="file"]').first();
    const fileName = await firstFile.locator('.filetree-name').textContent();
    await firstFile.click();
    await page.waitForSelector('#breadcrumb .breadcrumb-item');
    await expect(page.locator('#breadcrumb')).toContainText(fileName ?? '');
  });

  test('security headers are present', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toBeTruthy();
  });
});
