import { test, expect, type Locator, type Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';

const DIR = '/tmp/md-test-docs/diffcheck';

// Headless Chromium does not emit `contextmenu` from a synthetic right-click.
function rightClick(locator: Locator) {
  return locator.dispatchEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 });
}

async function openFile(page: Page, path: string) {
  await page.goto(`/#file=${encodeURIComponent(path)}`);
  await page.waitForSelector('.filetree-item[data-path]');
  await expect(page.locator('#breadcrumb')).toContainText(path.split('/').pop()!);
}

async function expandFolder(page: Page) {
  const folder = page.locator('.filetree-item[data-path="diffcheck"]');
  if (await page.locator('.filetree-item[data-path="diffcheck/config.dev.yaml"]').count() === 0) await folder.click();
}

test.describe('Diff view', () => {
  test('compares two files from the file tree with word-level highlights', async ({ page }) => {
    await openFile(page, 'diffcheck/config.prod.yaml');
    await expandFolder(page);
    await rightClick(page.locator('.filetree-item[data-path="diffcheck/config.dev.yaml"]'));
    await page.locator('.filetree-context-item', { hasText: '表示中の「config.prod.yaml」と比較' }).click();

    const dialog = page.getByRole('dialog', { name: /差分/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.diff-stats')).toHaveText(/\+3\s*−2\s*2 箇所/);
    await expect(dialog.locator('.diff-word-del')).toHaveText(['8080', 'false']);
    await expect(dialog.locator('.diff-word-add')).toHaveText(['3000', 'true']);
    await expect(dialog.locator('.diff-nav-label')).toHaveText('1 / 2');

    // Unified layout via keyboard, then swap sides.
    await page.keyboard.press('u');
    await expect(dialog.locator('.diff-table--unified')).toBeVisible();
    await dialog.getByRole('button', { name: '比較元と比較先を入れ替え' }).click();
    await expect(dialog.locator('.diff-stats')).toHaveText(/\+2\s*−3/);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('"比較元として選択" then "選択した…と比較" compares any two files', async ({ page }) => {
    await openFile(page, 'README.md');
    await expandFolder(page);
    await rightClick(page.locator('.filetree-item[data-path="diffcheck/config.dev.yaml"]'));
    await page.locator('.filetree-context-item', { hasText: '比較元として選択' }).click();
    await rightClick(page.locator('.filetree-item[data-path="diffcheck/config.prod.yaml"]'));
    await page.locator('.filetree-context-item', { hasText: '選択した「config.dev.yaml」と比較' }).click();
    const dialog = page.getByRole('dialog', { name: /差分/ });
    await expect(dialog.locator('select[data-side="old"]')).toHaveValue('file:diffcheck/config.dev.yaml');
    await expect(dialog.locator('select[data-side="new"]')).toHaveValue('file:diffcheck/config.prod.yaml');
  });

  test('copy patch produces a unified diff and clicking a line number opens the file there', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openFile(page, 'diffcheck/config.prod.yaml');
    await expandFolder(page);
    await rightClick(page.locator('.filetree-item[data-path="diffcheck/config.dev.yaml"]'));
    await page.locator('.filetree-context-item', { hasText: '表示中の' }).click();
    const dialog = page.getByRole('dialog', { name: /差分/ });
    await dialog.getByRole('button', { name: 'パッチをコピー' }).click();
    const patch = await page.evaluate(() => navigator.clipboard.readText());
    expect(patch).toContain('--- a/diffcheck/config.prod.yaml');
    expect(patch).toContain('+++ b/diffcheck/config.dev.yaml');
    expect(patch).toContain('-port: 8080\n');
    expect(patch).toContain('+extra: on\n');

    await dialog.locator('.diff-num--new .diff-line-link', { hasText: '5' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/file=diffcheck%2Fconfig\.dev\.yaml&line=5/);
  });

  test('secret-safe mode masks secrets on both sides of a diff', async ({ page }) => {
    await page.goto('/?secretSafe=1#file=diffcheck%2Fsecret-a.env');
    await page.waitForSelector('.filetree-item[data-path]');
    await expandFolder(page);
    await rightClick(page.locator('.filetree-item[data-path="diffcheck/secret-b.env"]'));
    await page.locator('.filetree-context-item', { hasText: '表示中の' }).click();
    const dialog = page.getByRole('dialog', { name: /差分/ });
    await expect(dialog.locator('.diff-stats')).toContainText('+1');
    await expect(dialog.locator('.diff-body')).not.toContainText('ABC1234567890');
    await expect(dialog.locator('.diff-body')).not.toContainText('XYZ0987654321');
    await expect(dialog.locator('.diff-notice')).toContainText('Secret Safe');
  });

  test('live edits show a change chip and a diff against the version first opened', async ({ page }) => {
    const file = `${DIR}/live.md`;
    const original = readFileSync(file, 'utf8');
    try {
      await openFile(page, 'diffcheck/live.md');
      await expect(page.locator('#viewer')).toContainText('first line');
      await expect(page.locator('#btn-live-changes')).toBeHidden();

      writeFileSync(file, `${original}second line\n`);
      const chip = page.locator('#btn-live-changes');
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText('+1');

      await page.keyboard.press('d');
      const dialog = page.getByRole('dialog', { name: /差分/ });
      await expect(dialog.locator('select[data-side="old"]')).toHaveValue('snap:diffcheck/live.md');
      await expect(dialog.locator('.diff-cell--add')).toContainText('second line');

      // The open diff follows further edits.
      writeFileSync(file, `${original}second line\nthird line\n`);
      await expect(dialog.locator('.diff-stats')).toContainText('+2', { timeout: 10000 });

      // Marking as reviewed resets the baseline.
      await dialog.getByRole('button', { name: '確認済みにする' }).click();
      await expect(dialog.locator('.diff-empty')).toContainText('同一');
      await page.keyboard.press('Escape');
      await expect(chip).toBeHidden();
    } finally {
      writeFileSync(file, original);
    }
  });

  test('outside a Git repository the D shortcut still opens the comparison picker', async ({ page }) => {
    await openFile(page, 'diffcheck/config.prod.yaml');
    await page.keyboard.press('d');
    const dialog = page.getByRole('dialog', { name: /差分/ });
    await expect(dialog.locator('.diff-empty')).toContainText('同一');
    await dialog.locator('select[data-side="old"]').selectOption('__other__');
    const input = dialog.locator('.diff-picker-input');
    await input.fill('diffcheck/config.dev.yaml');
    await input.press('Enter');
    await expect(dialog.locator('.diff-stats')).toHaveText(/\+2\s*−3/);
  });
});

test.describe('Link check', () => {
  test('folder report lists broken links and jumps to the source line', async ({ page }) => {
    await openFile(page, 'README.md');
    await rightClick(page.locator('.filetree-item[data-path="diffcheck"]'));
    await page.locator('.filetree-context-item', { hasText: 'このフォルダのリンク切れをチェック' }).click();
    const dialog = page.getByRole('dialog', { name: /リンクチェック/ });
    await expect(dialog.locator('.linkcheck-summary')).toContainText('リンク切れ 2 件');
    await expect(dialog.locator('.linkcheck-link')).toHaveText(['missing-page.md', 'pics/none.png']);

    await dialog.locator('.linkcheck-line').first().click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/file=diffcheck%2Flinks\.md&line=4/);
  });

  test('the TOC lists the current document\'s broken links', async ({ page }) => {
    await openFile(page, 'diffcheck/links.md');
    const section = page.locator('#brokenlinks-section');
    await expect(section.locator('.brokenlinks-title')).toHaveText('Broken links (2)');
    await expect(section.locator('.brokenlink-item')).toHaveText(['L4 missing-page.md', 'L5 pics/none.png']);
  });
});
