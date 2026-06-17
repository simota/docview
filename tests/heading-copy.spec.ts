import { test, expect } from '@playwright/test';

test.describe('Heading copy reference (path#heading)', () => {
  test('each markdown heading gets a copy-reference button', async ({ page }) => {
    await page.goto('/#file=README.md');
    const heading = page.locator('.markdown-body h1', { hasText: 'Hello DocView' });
    await expect(heading).toBeVisible();
    await expect(heading.locator('.heading-copy-btn')).toHaveCount(1);
  });

  test('clicking the button copies "path#heading" and shows a toast', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#file=README.md');
    const btn = page.locator('.markdown-body h1 .heading-copy-btn');
    await expect(btn).toHaveCount(1);
    // Button is hover-revealed (opacity:0); force the click without hover.
    await btn.click({ force: true });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('README.md#Hello DocView');
    await expect(page.locator('#copy-toast')).toBeVisible();
  });

  test('button reference uses the nested file path', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#file=subdir/README.md');
    const btn = page.locator('.markdown-body h1 .heading-copy-btn');
    await expect(btn).toHaveCount(1);
    await btn.click({ force: true });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('subdir/README.md#Subdir Readme');
  });
});
