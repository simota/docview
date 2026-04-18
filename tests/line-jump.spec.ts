import { test, expect } from '@playwright/test';

test.describe('Line jump (URL hash &line=)', () => {
  test('deep link with &line=N highlights and centers that line', async ({ page }) => {
    await page.goto('/#file=app.log&line=25');
    await page.waitForSelector('.line-row[data-line="25"]');
    const row = page.locator('.line-row[data-line="25"]');
    await expect(row).toHaveClass(/line-highlighted/);
    // Row should be inside the viewport.
    const box = await row.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 800;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(viewportHeight);
  });

  test('range syntax &line=10-15 highlights every line in the range', async ({ page }) => {
    await page.goto('/#file=settings.ini&line=10-15');
    await page.waitForSelector('.line-row[data-line="10"].line-highlighted');
    for (let n = 10; n <= 15; n++) {
      await expect(page.locator(`.line-row[data-line="${n}"]`)).toHaveClass(/line-highlighted/);
    }
    // Outside the range must NOT be highlighted.
    await expect(page.locator('.line-row[data-line="9"]')).not.toHaveClass(/line-highlighted/);
    await expect(page.locator('.line-row[data-line="16"]')).not.toHaveClass(/line-highlighted/);
  });

  test('clicking a line number updates the hash and copies a sharable link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#file=settings.ini');
    await page.waitForSelector('.line-num[data-line="7"]');
    await page.locator('.line-num[data-line="7"]').click();
    await expect(page).toHaveURL(/#file=settings\.ini&line=7$/);
    await expect(page.locator('.line-row[data-line="7"]')).toHaveClass(/line-highlighted/);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/#file=settings\.ini&line=7$/);
    // A toast confirms the copy.
    await expect(page.locator('#copy-toast')).toBeVisible();
  });

  test('shift-click on a second line creates a range link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#file=settings.ini');
    await page.waitForSelector('.line-num[data-line="5"]');
    await page.locator('.line-num[data-line="5"]').click();
    await page.locator('.line-num[data-line="12"]').click({ modifiers: ['Shift'] });
    await expect(page).toHaveURL(/#file=settings\.ini&line=5-12$/);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/#file=settings\.ini&line=5-12$/);
  });

  test('shift-click preserves the original anchor for subsequent range expansion', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#file=settings.ini');
    await page.waitForSelector('.line-num[data-line="12"]');

    await page.locator('.line-num[data-line="12"]').click();
    await page.locator('.line-num[data-line="5"]').click({ modifiers: ['Shift'] });
    await expect(page).toHaveURL(/#file=settings\.ini&line=5-12$/);

    await page.locator('.line-num[data-line="20"]').click({ modifiers: ['Shift'] });
    await expect(page).toHaveURL(/#file=settings\.ini&line=12-20$/);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/#file=settings\.ini&line=12-20$/);
  });

  test('changing only the line hash on the same file scrolls without reloading', async ({ page }) => {
    await page.goto('/#file=settings.ini&line=3');
    await page.waitForSelector('.line-row[data-line="3"].line-highlighted');
    await page.evaluate(() => {
      location.hash = '#file=settings.ini&line=40';
    });
    await expect(page.locator('.line-row[data-line="40"]')).toHaveClass(/line-highlighted/);
    await expect(page.locator('.line-row[data-line="3"]')).not.toHaveClass(/line-highlighted/);
  });

  test('filenames containing `%` survive the hash round-trip (no double decode)', async ({ page }) => {
    // parseHash must not re-decode a URLSearchParams-extracted value — otherwise
    // `100%.ini` encoded as `100%25.ini` would be corrupted back to `100%.ini`
    // via one decode, then the second decode would throw on any `%X` pattern.
    await page.goto('/#file=' + encodeURIComponent('100%.ini') + '&line=2');
    await page.waitForSelector('.line-row[data-line="2"]');
    await expect(page.locator('.line-row[data-line="2"]')).toHaveClass(/line-highlighted/);
    // Breadcrumb should show the real filename, not a broken one.
    await expect(page.locator('#breadcrumb')).toContainText('100%.ini');
  });

  test('log table row numbers reflect original file line, not entry index', async ({ page }) => {
    // access.log has an unparseable line at file-line 3. The 3rd table row
    // must therefore be labeled `4`, and its data-line must be 4 — otherwise
    // clicking it would create a link to the wrong line.
    await page.goto('/#file=access.log');
    const rows = page.locator('.log-view tbody tr');
    await expect(rows).toHaveCount(4);
    // Row 0 → original line 1, row 1 → 2, row 2 → 4 (skipped 3), row 3 → 5
    await expect(rows.nth(0)).toHaveAttribute('data-line', '1');
    await expect(rows.nth(1)).toHaveAttribute('data-line', '2');
    await expect(rows.nth(2)).toHaveAttribute('data-line', '4');
    await expect(rows.nth(3)).toHaveAttribute('data-line', '5');
    // The `#` cell shows the same original line number.
    await expect(rows.nth(2).locator('.log-line-num')).toHaveText('4');
  });
});
