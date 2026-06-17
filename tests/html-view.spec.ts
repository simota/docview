import { test, expect } from '@playwright/test';

test.describe('HTML view (sandboxed iframe)', () => {
  test('renders .html in a sandboxed iframe with Preview/Source toggle', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    // Toggle buttons present.
    await expect(page.locator('.json-toggle-btn', { hasText: 'Preview' })).toBeVisible();
    await expect(page.locator('.json-toggle-btn', { hasText: 'Source' })).toBeVisible();

    // Scripts are enabled by default, but allow-same-origin remains absent.
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', 'allow-scripts');

    // Content renders inside the frame.
    await expect(page.frameLocator('.html-preview-frame').locator('#hello')).toHaveText('Hello HTML');
  });

  test('scripts are enabled by default', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    await expect(page.frameLocator('.html-preview-frame').locator('#hello')).toBeVisible();
    await expect(page.frameLocator('.html-preview-frame').locator('#js-ran')).toHaveText('js executed');

    await expect(page.locator('.html-scripts-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('scripts toggle disables JavaScript execution for the file', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    await page.locator('.html-scripts-toggle').click();

    await expect(page.locator('.html-scripts-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', '');

    await expect(page.frameLocator('.html-preview-frame').locator('#hello')).toBeVisible();
    await expect(page.frameLocator('.html-preview-frame').locator('#js-ran')).toHaveCount(0);
  });

  test('Source toggle shows the highlighted HTML source', async ({ page }) => {
    await page.goto('/#file=page.html');
    await page.waitForSelector('.html-preview-frame');

    await page.locator('.json-toggle-btn', { hasText: 'Source' }).click();
    const source = page.locator('.json-view-source');
    await expect(source).toBeVisible();
    await expect(source).toContainText('Hello HTML');
  });

  test('Preview resolves relative linked CSS and CSS asset URLs from the HTML file directory', async ({ page }) => {
    await page.goto('/#file=page-with-assets.html');
    await page.waitForSelector('.html-preview-frame');

    const target = page.frameLocator('.html-preview-frame').locator('#linked-style-target');
    await expect(target).toHaveCSS('color', 'rgb(14, 116, 144)');
    await expect(target).toHaveCSS('background-image', /\/api\/raw\/html-assets\/badge\.svg/);
  });

  test('Preview resolves relative image URLs from the HTML file directory', async ({ page }) => {
    await page.goto('/#file=html-assets/relative.html');
    await page.waitForSelector('.html-preview-frame');

    const frame = page.frameLocator('.html-preview-frame');
    await expect(frame.locator('#asset-title')).toHaveText('Relative asset fixture');
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect.poll(async () =>
      frame.locator('#relative-badge').evaluate((img: HTMLImageElement) =>
        img.complete ? img.naturalWidth : 0,
      ),
    ).toBe(24);
  });

  test('Preview allows external stylesheets inside the sandboxed document', async ({ page }) => {
    await page.goto('/#file=page-with-external-style.html');
    await page.waitForSelector('.html-preview-frame');

    const target = page.frameLocator('.html-preview-frame').locator('#external-style-target');
    await expect(target).toHaveCSS('color', 'rgb(147, 51, 234)');
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  test('external scripts that generate preview styling run by default', async ({ page }) => {
    await page.goto('/#file=page-with-external-script.html');
    await page.waitForSelector('.html-preview-frame');

    const target = page.frameLocator('.html-preview-frame').locator('#external-script-target');
    await expect(page.locator('.html-preview-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(target).toHaveCSS('color', 'rgb(22, 163, 74)');
  });

  test('.html files appear in the file tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');
    await expect(page.locator('.filetree-item[data-path="page.html"]')).toHaveCount(1);
  });
});
