import { test, expect } from '@playwright/test';

test.describe('JSONL table row numbers + jump (non-chunked)', () => {
  test('renders valid rows with their original source line numbers', async ({ page }) => {
    await page.goto('/#file=events-small.jsonl');
    await page.waitForSelector('.csv-table tbody tr');

    // `#` header present.
    await expect(page.locator('.csv-table .csv-row-num-header')).toHaveText('#');

    // 10 valid rows (the invalid line is skipped).
    await expect(page.locator('.csv-table tbody tr')).toHaveCount(10);

    // The invalid source line 6 is skipped without renumbering lines 7..11.
    await expect(page.locator('.csv-table tbody tr .csv-row-num')).toHaveText([
      '1', '2', '3', '4', '5', '7', '8', '9', '10', '11',
    ]);
    await expect(page.locator('.csv-row-jump-input')).toHaveAttribute('max', '11');
    await expect(page.locator('.csv-table tr[data-line="6"]')).toHaveCount(0);
    await expect(page.locator('.csv-table tr[data-line="7"] td').nth(1)).toHaveText('6');

    // Skipped-line banner is shown.
    await expect(page.locator('.csv-info--warn')).toContainText('Skipped 1 invalid line(s): 6');
  });

  test('toolbar "行へ移動" input jumps to and highlights the row', async ({ page }) => {
    await page.goto('/#file=events-small.jsonl');
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
    await page.goto('/#file=events-small.jsonl');
    await page.waitForSelector('.csv-row-jump-input');

    await page.locator('.csv-row-jump-input').fill('8');
    await page.locator('.csv-row-jump-input').press('Enter');

    await expect(page.locator('.csv-table tr[data-line="8"]')).toHaveClass(/line-highlighted/);
  });

  test('out-of-range jump clamps to the last row', async ({ page }) => {
    await page.goto('/#file=events-small.jsonl');
    await page.waitForSelector('.csv-row-jump-input');

    await page.locator('.csv-row-jump-input').fill('999');
    await page.locator('.csv-row-jump-btn').click();

    const lastRow = page.locator('.csv-table tbody tr').last();
    await expect(lastRow).toHaveAttribute('data-line', '11');
    await expect(lastRow).toHaveClass(/line-highlighted/);
    await expect(lastRow.locator('td').nth(1)).toHaveText('10');
  });

  test('deep link with &line=N highlights the matching JSONL row', async ({ page }) => {
    await page.goto('/#file=events-small.jsonl&line=7');
    await page.waitForSelector('.csv-table tr[data-line="7"]');
    await expect(page.locator('.csv-table tr[data-line="7"]')).toHaveClass(/line-highlighted/);
    // Source line 7 contains event 6 because line 6 is invalid.
    await expect(page.locator('.csv-table tr[data-line="7"] td').nth(2)).toHaveText('event-6');
  });
});

test.describe('JSONL chunked table row numbers + jump (paginated, >5MB)', () => {
  test('renders the paginated chunked view with global row numbers', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    // Chunked view shows pagination controls.
    await page.waitForSelector('.chunk-pagination');
    await expect(page.locator('.chunk-page-input').first()).toBeVisible();

    // Row-number column present; page 1 starts at global row 1.
    await expect(page.locator('.csv-table .csv-row-num-header').first()).toHaveText('#');
    await expect(
      page.locator('.chunk-tbody tr').first().locator('.csv-row-num'),
    ).toHaveText('1');
    // First page holds PAGE_SIZE (1000) rows ending at global row 1000.
    await expect(
      page.locator('.chunk-tbody tr').last().locator('.csv-row-num'),
    ).toHaveText('1000');
  });

  test('next page continues global row numbering (1001…)', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    await page.waitForSelector('.chunk-tbody tr');

    await page.locator('.chunk-page-btn[data-page="next"]').first().click();

    await expect(
      page.locator('.chunk-tbody tr').first().locator('.csv-row-num'),
    ).toHaveText('1001');
  });

  test('row jump navigates to the right page and highlights the row', async ({ page }) => {
    await page.goto('/#file=events.jsonl');
    await page.waitForSelector('.chunk-row-jump-input');

    await page.locator('.chunk-row-jump-input').fill('1500');
    await page.locator('.chunk-row-jump-btn').click();

    const row = page.locator('.chunk-tbody tr[data-line="1500"]');
    await expect(row).toHaveClass(/line-highlighted/);
    // Page indicator moved to page 2.
    await expect(page.locator('.chunk-page-input').first()).toHaveValue('2');
  });

  test('deep link with &line=N opens the page and highlights the row', async ({ page }) => {
    await page.goto('/#file=events.jsonl&line=2500');
    await page.waitForSelector('.chunk-tbody tr[data-line="2500"]');
    await expect(page.locator('.chunk-tbody tr[data-line="2500"]')).toHaveClass(/line-highlighted/);
  });
});
