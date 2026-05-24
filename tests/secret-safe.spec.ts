import { test, expect, type Page } from '@playwright/test';

const RAW_SECRET = 'dv_live_ABC1234567890SECRETKEY';

async function openFile(page: Page, fileName: string, query = '') {
  await page.goto(`/${query}`);
  await page.waitForSelector('.filetree-item[data-type="file"]');
  await page.locator('.filetree-name', { hasText: new RegExp(`^${fileName.replace('.', '\\.')}$`) }).click();
}

test.describe('Secret-Safe Review Mode', () => {
  test('normal mode leaves values visible', async ({ page }) => {
    await openFile(page, 'secrets.json');

    await expect(page.locator('#viewer')).toContainText(RAW_SECRET);
    await expect(page.locator('#viewer')).not.toContainText('[REDACTED]');
  });

  test('secretSafe query masks JSON tree and source values', async ({ page }) => {
    await openFile(page, 'secrets.json', '?secretSafe=1');

    await expect(page.locator('#viewer')).toContainText('[REDACTED]');
    await expect(page.locator('#viewer')).not.toContainText(RAW_SECRET);

    await page.locator('.json-toggle-btn', { hasText: 'Source' }).click();
    await expect(page.locator('#viewer')).toContainText('[REDACTED]');
    await expect(page.locator('#viewer')).not.toContainText(RAW_SECRET);
  });

  test('secretSafe query masks config, markdown, and CSV rendering', async ({ page }) => {
    await openFile(page, 'secrets.env', '?secretSafe=1');
    await expect(page.locator('#viewer')).toContainText('[REDACTED]');
    await expect(page.locator('#viewer')).not.toContainText(RAW_SECRET);

    await openFile(page, 'secrets.md', '?secretSafe=1');
    await expect(page.locator('#viewer')).toContainText('[REDACTED]');
    await expect(page.locator('#viewer')).not.toContainText(RAW_SECRET);

    await openFile(page, 'secrets.csv', '?secretSafe=1');
    await expect(page.locator('#viewer .csv-table')).toContainText('[REDACTED]');
    await expect(page.locator('#viewer')).not.toContainText(RAW_SECRET);
  });

  test('secretSafe query masks full-text search context', async ({ page }) => {
    await page.goto('/?secretSafe=1');
    await page.waitForSelector('.filetree-item');
    await page.locator('body').click();
    await page.keyboard.press('Meta+Shift+F');
    await expect(page.locator('.search-modal')).toBeVisible();

    await page.locator('.search-input').fill('API_KEY');

    const active = page.locator('.search-item.active');
    await expect(active).toContainText('[REDACTED]');
    await expect(active).not.toContainText(RAW_SECRET);
  });
});
