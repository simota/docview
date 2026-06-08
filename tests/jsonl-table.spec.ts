import { test, expect } from '@playwright/test';

test.describe('JSONL table row numbers + jump', () => {
  test('renders a row-number column counting only valid rows', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    await page.waitForSelector('.csv-table tbody tr');

    // `#` header present.
    await expect(page.locator('.csv-table .csv-row-num-header')).toHaveText('#');

    // 10 valid rows (the invalid line is skipped).
    await expect(page.locator('.csv-table tbody tr')).toHaveCount(10);

    // Row-number cells run 1..10 in order.
    await expect(page.locator('.csv-table tbody tr').first().locator('.csv-row-num')).toHaveText('1');
    await expect(page.locator('.csv-table tbody tr').last().locator('.csv-row-num')).toHaveText('10');

    // Skipped-line banner is shown.
    await expect(page.locator('.csv-info--warn')).toContainText('Skipped 1 invalid line');
  });

  test('toolbar "行へ移動" input jumps to and highlights the row', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    await page.waitForSelector('.csv-row-jump-input');

    await page.locator('.csv-row-jump-input').fill('5');
    await page.locator('.csv-row-jump-btn').click();

    const row = page.locator('.csv-table tr[data-line="5"]');
    await expect(row).toHaveClass(/line-highlighted/);

    // The highlighted row is scrolled into view.
    const box = await row.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 800;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(viewportHeight);
  });

  test('pressing Enter in the jump input also jumps', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    await page.waitForSelector('.csv-row-jump-input');

    await page.locator('.csv-row-jump-input').fill('8');
    await page.locator('.csv-row-jump-input').press('Enter');

    await expect(page.locator('.csv-table tr[data-line="8"]')).toHaveClass(/line-highlighted/);
  });

  test('out-of-range jump clamps to the last row', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    await page.waitForSelector('.csv-row-jump-input');

    await page.locator('.csv-row-jump-input').fill('999');
    await page.locator('.csv-row-jump-btn').click();

    await expect(page.locator('.csv-table tr[data-line="10"]')).toHaveClass(/line-highlighted/);
  });

  test('deep link with &line=N highlights the matching JSONL row', async ({ page }) => {
    await page.goto('/#file=events.jsonl&line=7');
    await page.waitForSelector('.csv-table tr[data-line="7"]');
    await expect(page.locator('.csv-table tr[data-line="7"]')).toHaveClass(/line-highlighted/);
  });
});
