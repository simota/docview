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
    const h1 = page.locator('#viewer h1');
    await expect(h1).toBeVisible();
  });

  test('displays YAML with syntax highlighting', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');

    const yamlItem = page.locator('.filetree-item[data-type="file"]', { hasText: 'config.yaml' });
    await yamlItem.click();

    await page.waitForSelector('#viewer .json-tree, #viewer .data-view');
    const treeOrSource = page.locator('#viewer .json-tree, #viewer .data-view').first();
    await expect(treeOrSource).toBeVisible();
  });

  test('displays JSON tree view', async ({ page }) => {
    await page.goto('/#file=data.json');
    await page.waitForSelector('#viewer .json-tree');
    const jsonTree = page.locator('#viewer .json-tree');
    await expect(jsonTree).toBeVisible();
  });

  test('file search modal opens with Cmd+P', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.keyboard.press('Meta+p');

    const overlay = page.locator('.search-overlay');
    await expect(overlay).toBeVisible();
  });

  test('theme toggle works', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('md-viewer-theme', 'light'));
    await page.reload();
    await page.waitForSelector('.filetree-item');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.locator('#btn-theme').click();

    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('breadcrumb updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');

    const firstFile = page.locator('.filetree-item[data-type="file"]').first();
    const fileName = await firstFile.locator('.filetree-name').textContent();
    await firstFile.click();

    await page.waitForSelector('#breadcrumb .breadcrumb-item');
    const breadcrumb = page.locator('#breadcrumb');
    await expect(breadcrumb).toContainText(fileName ?? '');
  });
});
