import { test, expect, type Page } from '@playwright/test';

async function openFullTextSearch(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.filetree-item');
  await page.locator('body').click();
  await page.keyboard.press('Meta+Shift+F');
  await expect(page.locator('.search-modal')).toBeVisible();
}

test.describe('Full-text search context', () => {
  test('full-text search shows surrounding context for a hit', async ({ page }) => {
    await openFullTextSearch(page);

    const input = page.locator('.search-input');
    await input.fill('line number 25');

    const hitLine = page.locator('.search-item.active .search-context-line--hit');
    await expect(hitLine).toContainText('25');
    await expect(hitLine).toContainText('line number 25');
    await expect(page.locator('.search-item.active .search-context-line')).toHaveCount(41);
    await expect(page.locator('.search-item.active .search-context-num').first()).toHaveText('5');
    await expect(page.locator('.search-item.active .search-context-num').last()).toHaveText('45');
    await expect(hitLine.locator('mark')).toBeVisible();
  });

  test('clicking a full-text result opens the matched line', async ({ page }) => {
    await openFullTextSearch(page);

    await page.locator('.search-input').fill('line number 25');
    await page.locator('.search-item.active').click();

    await expect(page).toHaveURL(/#file=app\.log&line=25$/);
    await expect(page.locator('.line-row[data-line="25"]')).toHaveClass(/line-highlighted/);
  });

  test('pressing Enter on the active result opens the matched line', async ({ page }) => {
    await openFullTextSearch(page);

    await page.locator('.search-input').fill('line number');
    const results = page.locator('.search-item');
    await expect(results).toHaveCount(50);

    await page.locator('.search-input').press('ArrowDown');
    await expect(results.nth(1)).toHaveClass(/active/);
    await expect(results.nth(1)).toHaveAttribute('data-line', '2');

    await page.locator('.search-input').press('Enter');

    await expect(page).toHaveURL(/#file=app\.log&line=2$/);
    await expect(page.locator('.line-row[data-line="2"]')).toHaveClass(/line-highlighted/);
  });

  test('moving to the next hit keeps the active context visible', async ({ page }) => {
    await openFullTextSearch(page);

    await page.locator('.search-input').fill('line number');
    const results = page.locator('.search-item');
    await expect(results).toHaveCount(50);

    await page.locator('.search-input').press('ArrowDown');
    const active = results.nth(1);
    await expect(active).toHaveClass(/active/);
    await expect(active.locator('.search-context-line--hit')).toContainText('line number 2');
    await expect(active.locator('.search-context-num').first()).toHaveText('1');
    await expect(active.locator('.search-context-num').nth(1)).toHaveText('2');
  });
});
