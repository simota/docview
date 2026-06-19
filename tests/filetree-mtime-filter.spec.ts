import { test, expect } from '@playwright/test';

// The mtime filter narrows the file tree to files modified within a preset age
// range, combined with the text filter (AND). `archived-old.md` is backdated
// ~400 days in setup.ts; every other fixture is freshly written, so it is the
// discriminator between "すべて" and any time-bounded preset.

test.describe('File tree modification-time filter', () => {
  test('renders the preset dropdown next to the text filter', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    const select = page.locator('.filetree-mtime-filter');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveText([
      'すべて', '今日', '昨日', '過去3日', '過去7日', '過去30日', '過去90日',
    ]);
  });

  test('"すべて" shows both recent and stale files', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="README.md"]')).toHaveCount(1);
  });

  test('"今日" excludes both yesterday and the stale file, keeps today files', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await page.locator('.filetree-mtime-filter').selectOption({ label: '今日' });

    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(0);
    await expect(page.locator('.filetree-item[data-path="edited-yesterday.md"]')).toHaveCount(0);
    await expect(page.locator('.filetree-item[data-path="README.md"]')).toHaveCount(1);
  });

  test('"昨日" includes yesterday and today, still excludes the stale file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await page.locator('.filetree-mtime-filter').selectOption({ label: '昨日' });

    await expect(page.locator('.filetree-item[data-path="edited-yesterday.md"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="README.md"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(0);
  });

  test('"過去3日" includes yesterday, excludes the stale file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await page.locator('.filetree-mtime-filter').selectOption({ label: '過去3日' });

    await expect(page.locator('.filetree-item[data-path="edited-yesterday.md"]')).toHaveCount(1);
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(0);
  });

  test('"過去7日" also excludes the stale file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    await page.locator('.filetree-mtime-filter').selectOption({ label: '過去7日' });
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(0);
  });

  test('switching back to "すべて" restores the stale file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    const select = page.locator('.filetree-mtime-filter');
    await select.selectOption({ label: '今日' });
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(0);

    await select.selectOption({ label: 'すべて' });
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(1);
  });

  test('text filter and mtime filter combine (AND)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');

    // Text matches the stale file, but the time preset excludes it → no result.
    await page.locator('.filetree-filter').fill('archived');
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(1);

    await page.locator('.filetree-mtime-filter').selectOption({ label: '今日' });
    await expect(page.locator('.filetree-item[data-path="archived-old.md"]')).toHaveCount(0);
  });
});
