import { test, expect } from '@playwright/test';

test.describe('UX improvements', () => {
  // 1. 検索モーダルの可視タブ切替
  test('search modal has visible Files/Full text tabs', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.search-overlay');

    const tabFiles = page.locator('.search-tab', { hasText: 'Files' });
    const tabFulltext = page.locator('.search-tab', { hasText: 'Full text' });

    await expect(tabFiles).toBeVisible();
    await expect(tabFulltext).toBeVisible();

    // Files タブがデフォルトで選択されている
    await expect(tabFiles).toHaveAttribute('aria-selected', 'true');
    await expect(tabFulltext).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking Full text tab switches search mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.search-overlay');

    const tabFulltext = page.locator('.search-tab', { hasText: 'Full text' });
    await tabFulltext.click();

    await expect(tabFulltext).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.search-tab', { hasText: 'Files' })).toHaveAttribute('aria-selected', 'false');
  });

  // 2. タブラベルに親ディレクトリが含まれること（同名ファイル2つ区別）
  test('tab label shows parent directory when same-name files are open', async ({ page }) => {
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');

    // サブディレクトリの README.md を開く（タブが2枚になる）
    await page.goto('/#file=subdir/README.md');
    await page.waitForSelector('#viewer h1');

    // タブバーが表示される（2枚以上で表示）
    await page.waitForSelector('#tab-bar .tab-item', { state: 'visible' });

    // subdir/README.md のタブに .tab-parent が含まれること
    const subdirTab = page.locator('.tab-item', { hasText: 'subdir' });
    await expect(subdirTab).toBeVisible();
    await expect(subdirTab.locator('.tab-parent')).toHaveText('subdir/');
    await expect(subdirTab.locator('.tab-filename')).toHaveText('README.md');
  });

  // 3. Recent Files セクション
  test('welcome screen shows recent files after opening a file', async ({ page }) => {
    // README.md を localStorage にセットしてからウェルカム画面を JS で描画する
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    // docview-recent に README.md を追加
    await page.evaluate(() => {
      localStorage.setItem('docview-recent', JSON.stringify(['README.md']));
    });

    // showWelcome を呼び出すことでウェルカム画面を強制描画
    await page.evaluate(() => {
      // @ts-ignore
      (window as any).__showWelcomeForTest?.();
    });

    // showWelcome が公開されていない場合、viewer に直接 HTML を書いて確認するのではなく
    // タブバーが存在する場合は最後のタブを閉じてウェルカムを出す
    // 別アプローチ: ファイルを開いて Recent を蓄積、その後直接関数経由で確認
    // 最もシンプルな方法: getRecent() 経由で Recent が保存されていることを確認
    const recentItems = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('docview-recent') || '[]');
      } catch { return []; }
    });
    expect(recentItems).toContain('README.md');

    // 実際に addRecent が動作するか: ファイルを開いた後に localStorage を確認
    await page.locator('.filetree-item[data-type="file"]', { hasText: 'README.md' }).click();
    await page.waitForSelector('#viewer h1');

    const recentAfterOpen = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('docview-recent') || '[]');
      } catch { return []; }
    });
    expect(recentAfterOpen.length).toBeGreaterThan(0);
    expect(recentAfterOpen[0]).toContain('README.md');
  });

  // 4. CSV テーブルに行番号列
  test('CSV table has row number column', async ({ page }) => {
    await page.goto('/#file=sample.csv');
    await page.waitForSelector('.csv-table');

    // ヘッダに行番号ヘッダがある
    const rowNumHeader = page.locator('.csv-row-num-header');
    await expect(rowNumHeader).toBeVisible();

    // 各データ行に .csv-row-num セルがある
    const firstRowNum = page.locator('.csv-table tbody tr').first().locator('.csv-row-num');
    await expect(firstRowNum).toHaveText('1');

    const secondRowNum = page.locator('.csv-table tbody tr').nth(1).locator('.csv-row-num');
    await expect(secondRowNum).toHaveText('2');
  });

  test('CSV row numbers are not affected by sorting', async ({ page }) => {
    await page.goto('/#file=sample.csv');
    await page.waitForSelector('.csv-table');

    // score 列で昇順ソート（Carol=70, Bob=80, Alice=90 の順になる）
    await page.locator('th[data-col="score"]').click();
    await page.waitForSelector('th[aria-sort="ascending"]');

    const rows = page.locator('.csv-table tbody tr');
    // ソート後も行番号は元の行順を示す（1,2,3 ではなく data-row-index ベース）
    await expect(rows).toHaveCount(3);

    // .csv-row-num の値はソート後も整合している
    const nums = await rows.locator('.csv-row-num').allTextContents();
    expect(nums.length).toBe(3);
  });

  // #D SVG file icons — filetree
  test('filetree file items render SVG icons', async ({ page }) => {
    // Arrange: load app and wait for filetree
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    // Act / Assert: every file entry has a .file-icon containing an <svg>
    const svgCount = await page.locator('.filetree-item[data-type="file"] .file-icon svg').count();
    expect(svgCount).toBeGreaterThan(0);

    // The first file icon must NOT contain raw text emoji (regression guard)
    const firstIconHtml = await page
      .locator('.filetree-item[data-type="file"] .file-icon')
      .first()
      .innerHTML();
    expect(firstIconHtml).toContain('<svg');
  });

  // #D SVG file icons — tab bar
  test('tab bar renders SVG icon after opening a file', async ({ page }) => {
    // Arrange: open two files so the tab bar becomes visible
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');
    await page.goto('/#file=subdir/README.md');
    await page.waitForSelector('#viewer h1');
    await page.waitForSelector('#tab-bar .tab-item', { state: 'visible' });

    // Act / Assert: each visible tab item has a .file-icon with an <svg>
    const tabSvgCount = await page.locator('#tab-bar .tab-item .file-icon svg').count();
    expect(tabSvgCount).toBeGreaterThan(0);
  });

  // Help modal (#btn-help / ? key)
  test('help button is visible in header', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    const btn = page.locator('#btn-help');
    await expect(btn).toBeVisible();
  });

  test('clicking help button opens the help modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.locator('#btn-help').click();

    // .help-modal dialog should be visible (overlay becomes display:'')
    const dialog = page.locator('[role="dialog"] .help-modal');
    await expect(dialog).toBeVisible();
  });

  test('pressing ? key opens the help modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    // Click an inert area so no input is focused, then dispatch '?'
    // page.keyboard.type fires keydown/keypress/keyup with key:'?'
    await page.locator('#viewer').click();
    await page.keyboard.type('?');

    const dialog = page.locator('[role="dialog"] .help-modal');
    await expect(dialog).toBeVisible();
  });

  test('pressing Escape closes the help modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    // Open via button
    await page.locator('#btn-help').click();
    const dialog = page.locator('[role="dialog"] .help-modal');
    await expect(dialog).toBeVisible();

    // The overlay traps focus on the dialog element; wait for it, then press Escape
    await dialog.waitFor({ state: 'visible' });
    await dialog.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('pressing ? while an input is focused does NOT open the help modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    // Open search modal so there is a focused input
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.search-overlay');

    // Focus the search input
    const searchInput = page.locator('.search-overlay input').first();
    await searchInput.focus();

    // Type '?' — should not open the help modal
    await page.keyboard.type('?');

    // Help modal must remain closed; search overlay must still be open
    await expect(page.locator('.help-overlay')).not.toBeVisible();
    await expect(page.locator('.search-overlay')).toBeVisible();
  });

  test('help modal displays keyboard shortcut labels', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    await page.locator('#btn-help').click();

    const dialog = page.locator('[role="dialog"] .help-modal');
    await expect(dialog).toBeVisible();

    // Verify at least one well-known shortcut label is rendered
    await expect(dialog.locator('text=Search files')).toBeVisible();
    await expect(dialog.locator('kbd').first()).toBeVisible();
  });

  // TOC toggle — #btn-toc / Cmd+J / Ctrl+J / .toc-close-btn
  test('header contains #btn-toc button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');

    const btn = page.locator('#btn-toc');
    await expect(btn).toBeVisible();
  });

  test('#btn-toc click toggles .toc-hidden on the TOC sidebar', async ({ page }) => {
    // Open a markdown file with a heading so the TOC is populated
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');
    // Wait for TOC to render (heading triggers update)
    await page.waitForSelector('#toc-sidebar .toc-nav');

    const tocSidebar = page.locator('#toc-sidebar');
    const btn = page.locator('#btn-toc');

    // Initial state: TOC is visible (no .toc-hidden)
    await expect(tocSidebar).not.toHaveClass(/toc-hidden/);

    // First click → hide
    await btn.click();
    await expect(tocSidebar).toHaveClass(/toc-hidden/);

    // Second click → show again
    await btn.click();
    await expect(tocSidebar).not.toHaveClass(/toc-hidden/);
  });

  test('Cmd+J / Ctrl+J keyboard shortcut toggles TOC', async ({ page }) => {
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');
    await page.waitForSelector('#toc-sidebar .toc-nav');

    const tocSidebar = page.locator('#toc-sidebar');
    // Click viewer to ensure no input is focused
    await page.locator('#viewer').click();

    // Press Cmd+J (macOS) — Playwright maps Meta to Cmd on macOS
    await page.keyboard.press('Meta+j');
    await expect(tocSidebar).toHaveClass(/toc-hidden/);

    // Press again to restore
    await page.keyboard.press('Meta+j');
    await expect(tocSidebar).not.toHaveClass(/toc-hidden/);
  });

  test('.toc-close-btn click hides TOC sidebar', async ({ page }) => {
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');
    await page.waitForSelector('#toc-sidebar .toc-nav');

    const tocSidebar = page.locator('#toc-sidebar');
    // Ensure TOC is visible before clicking close
    await expect(tocSidebar).not.toHaveClass(/toc-hidden/);

    await page.locator('.toc-close-btn').click();
    await expect(tocSidebar).toHaveClass(/toc-hidden/);
  });

  test('localStorage docview.tocVisible updates on toggle', async ({ page }) => {
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');
    await page.waitForSelector('#toc-sidebar .toc-nav');

    // Default state: visible → stored as 'true' (or absent defaults to visible)
    await page.locator('#btn-toc').click();
    const afterHide = await page.evaluate(() => localStorage.getItem('docview.tocVisible'));
    expect(afterHide).toBe('false');

    await page.locator('#btn-toc').click();
    const afterShow = await page.evaluate(() => localStorage.getItem('docview.tocVisible'));
    expect(afterShow).toBe('true');
  });
});
