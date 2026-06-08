import { test, expect } from '@playwright/test';

test.describe('HTML view (sandboxed iframe)', () => {
  test('renders .html in a sandboxed iframe with Preview/Source toggle', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    // Toggle buttons present.
    await expect(page.locator('.json-toggle-btn', { hasText: 'Preview' })).toBeVisible();
    await expect(page.locator('.json-toggle-btn', { hasText: 'Source' })).toBeVisible();

    // Iframe is sandboxed (empty value = maximal restriction) by default.
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', '');

    // Content renders inside the frame.
    await expect(page.frameLocator('.html-preview-frame').locator('#hello')).toHaveText('Hello HTML');
  });

  test('scripts are disabled by default', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    // The inline <script> must NOT have run (no #js-ran element).
    await expect(page.frameLocator('.html-preview-frame').locator('#hello')).toBeVisible();
    await expect(page.frameLocator('.html-preview-frame').locator('#js-ran')).toHaveCount(0);

    // Toggle reflects the disabled state.
    await expect(page.locator('.html-scripts-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('scripts toggle enables JavaScript execution for the file', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    await page.locator('.html-scripts-toggle').click();

    // Toggle now reports enabled and the iframe gains allow-scripts (only).
    await expect(page.locator('.html-scripts-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', 'allow-scripts');

    // The script now runs and appends #js-ran.
    await expect(page.frameLocator('.html-preview-frame').locator('#js-ran')).toHaveText('js executed');
  });

  test('Source toggle shows the highlighted HTML source', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    await page.locator('.json-toggle-btn', { hasText: 'Source' }).click();
    const source = page.locator('.json-view-source');
    await expect(source).toBeVisible();
    await expect(source).toContainText('Hello HTML');
  });

  test('.html files appear in the file tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');
    await expect(page.locator('.filetree-item[data-path="page.html"]')).toHaveCount(1);
  });
});
