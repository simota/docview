import { test, expect } from '@playwright/test';

test.describe('Crontab viewer', () => {
  test('renders crontab as a preview table with jobs and env vars', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();

    await page.waitForSelector('#viewer .cron-view', { timeout: 10000 });
    await expect(page.locator('#viewer .cron-view')).toBeVisible();

    // 5 cron jobs (daily, weekday, @weekly, @reboot, invalid). Comments/blank lines excluded.
    await expect(page.locator('#viewer .cron-table tbody tr')).toHaveCount(5);

    // 2 environment variables (SHELL, MAILTO).
    await expect(page.locator('#viewer .cron-env-list li')).toHaveCount(2);
    await expect(page.locator('#viewer .cron-env-name').first()).toHaveText('SHELL');
  });

  test('shows human-readable descriptions and switches language', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const dailyRow = page.locator('#viewer .cron-table tbody tr').first();
    await expect(dailyRow.locator('.cron-sched code')).toHaveText('0 3 * * *');

    // Default language is Japanese: ja description visible, en hidden.
    await expect(dailyRow.locator('.cron-desc-ja')).toBeVisible();
    await expect(dailyRow.locator('.cron-desc-en')).toBeHidden();
    await expect(dailyRow.locator('.cron-desc-ja')).toHaveText('次において実施03:00');

    // Toggle to English.
    await page.locator('#viewer .cron-lang-btn[data-lang="en"]').click();
    await expect(dailyRow.locator('.cron-desc-en')).toBeVisible();
    await expect(dailyRow.locator('.cron-desc-ja')).toBeHidden();
    await expect(dailyRow.locator('.cron-desc-en')).toHaveText('At 03:00');
  });

  test('computes next execution times for valid jobs', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const rows = page.locator('#viewer .cron-table tbody tr');

    // Daily job has at least one computed next-run timestamp (YYYY-MM-DD HH:mm).
    const dailyNext = rows.nth(0).locator('.cron-next .cron-next-item');
    await expect(dailyNext.first()).toBeVisible();
    await expect(dailyNext.first()).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

    // @reboot job (4th) has no next-run — shows a dash.
    const rebootRow = rows.nth(3);
    await expect(rebootRow.locator('.cron-next .cron-next-na')).toBeVisible();
    await expect(rebootRow.locator('.cron-desc-ja')).toHaveText('システム起動時に実行');
  });

  test('switches next-run timezone between JST and UTC', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const view = page.locator('#viewer .cron-view');
    const dailyRow = page.locator('#viewer .cron-table tbody tr').first();

    // Default is JST: JST runs visible, UTC runs hidden.
    await expect(view).toHaveAttribute('data-tz', 'jst');
    await expect(dailyRow.locator('.cron-next-jst .cron-next-item').first()).toBeVisible();
    await expect(dailyRow.locator('.cron-next-utc')).toBeHidden();
    await expect(page.locator('#viewer .cron-tz-btn.active')).toHaveText('JST');

    // Toggle to UTC.
    await page.locator('#viewer .cron-tz-btn[data-tz="utc"]').click();
    await expect(view).toHaveAttribute('data-tz', 'utc');
    await expect(dailyRow.locator('.cron-next-utc .cron-next-item').first()).toBeVisible();
    await expect(dailyRow.locator('.cron-next-jst')).toBeHidden();
    await expect(page.locator('#viewer .cron-tz-btn.active')).toHaveText('UTC');
  });

  test('visualizes the daily run hours as a 24h timeline', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const rows = page.locator('#viewer .cron-table tbody tr');

    // Each timeline has 24 segments.
    const dailyTl = rows.nth(0).locator('.cron-tl-bar .cron-tl-seg');
    await expect(dailyTl).toHaveCount(24);

    // "0 3 * * *" → exactly one active segment, at hour 3.
    const dailyActive = rows.nth(0).locator('.cron-tl-seg.active');
    await expect(dailyActive).toHaveCount(1);
    await expect(dailyActive).toHaveAttribute('data-h', '3');

    // "*/15 9-17 * * 1-5" → active hours 9..17 (9 segments).
    await expect(rows.nth(1).locator('.cron-tl-seg.active')).toHaveCount(9);

    // @reboot (4th) has no timeline — shows a dash.
    await expect(rows.nth(3).locator('.cron-tl-na')).toBeVisible();
  });

  test('renders a file-wide day-of-week × hour heatmap', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const hm = page.locator('#viewer .cron-heatmap');
    await expect(hm).toBeVisible();

    // 7 day rows, each a 24-cell strip.
    await expect(hm.locator('.cron-hm-cells')).toHaveCount(7);
    await expect(hm.locator('.cron-hm-row').first().locator('.cron-hm-cell')).toHaveCount(24);

    // "*/15 9-17 * * 1-5" → Monday(d=1) 9h is active.
    await expect(hm.locator('.cron-hm-cell[data-d="1"][data-h="9"]')).toHaveClass(/active/);
    // "0 3 * * *" (dow *) → Sunday(d=0) 3h is active.
    await expect(hm.locator('.cron-hm-cell[data-d="0"][data-h="3"]')).toHaveClass(/active/);
    // Saturday(d=6) 9h has no job (weekday-only check + daily is at 3h) → inactive.
    await expect(hm.locator('.cron-hm-cell[data-d="6"][data-h="9"]')).not.toHaveClass(/active/);
  });

  test('grades the heatmap shading into levels by job count', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^dense\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-heatmap');

    const hm = page.locator('#viewer .cron-heatmap');

    // Monday(d=1) 9h has 3 jobs (max) → top level 5; Tuesday(d=2) 9h has 1 → a lower level.
    await expect(hm.locator('.cron-hm-cell[data-d="1"][data-h="9"]')).toHaveAttribute('data-level', '5');
    const tueLevel = await hm.locator('.cron-hm-cell[data-d="2"][data-h="9"]').getAttribute('data-level');
    expect(Number(tueLevel)).toBeGreaterThan(0);
    expect(Number(tueLevel)).toBeLessThan(5);

    // The legend exposes the 5 graduated swatches.
    await expect(hm.locator('.cron-hm-legend .cron-hm-sw')).toHaveCount(5);
  });

  test('ranks jobs by execution frequency', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^dense\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const freq = page.locator('#viewer .cron-freq');
    await expect(freq).toBeVisible();

    // 3 valid jobs ranked; the weekday job (most frequent) is first.
    await expect(freq.locator('.cron-freq-row')).toHaveCount(3);
    await expect(freq.locator('.cron-freq-row').first().locator('.cron-freq-sched')).toHaveText('0 9 * * 1-5');
  });

  test('warns about simultaneous (same-minute) job collisions', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^collide\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    const collide = page.locator('#viewer .cron-collide--warn');
    await expect(collide).toBeVisible();
    // A 3-way collision occurs at 12:00 on weekdays.
    await expect(collide.locator('.cron-col-list li .cron-col-count', { hasText: '3ジョブ' }).first()).toBeVisible();
  });

  test('reports no collisions when minutes do not overlap', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^dense\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    // dense.crontab fires at :00 / :30 / :45 — no two jobs share a minute.
    await expect(page.locator('#viewer .cron-collide--ok')).toBeVisible();
  });

  test('flags an unparseable schedule', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    // The invalid "99 99 * * *" row (5th) is marked .cron-invalid.
    await expect(page.locator('#viewer .cron-table tbody tr.cron-invalid')).toHaveCount(1);
    await expect(page.locator('#viewer .cron-table tbody tr.cron-invalid .cron-desc-ja')).toHaveText('解析できないスケジュール');
  });

  test('detects an extension-less crontab file by name', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^crontab$/ }).click();

    await page.waitForSelector('#viewer .cron-view', { timeout: 10000 });
    await expect(page.locator('#viewer .cron-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#viewer .cron-env-list li')).toHaveCount(1);
  });

  test('toggles to raw source view', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');
    await page.locator('.filetree-name', { hasText: /^tasks\.crontab$/ }).click();
    await page.waitForSelector('#viewer .cron-view');

    await page.locator('#viewer .json-toggle-btn[data-view="source"]').click();
    await expect(page.locator('#viewer .json-view-source .data-view')).toBeVisible();
    await expect(page.locator('#viewer .json-view-source')).toContainText('0 3 * * * /usr/local/bin/backup.sh');
  });
});
