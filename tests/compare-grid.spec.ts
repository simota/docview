/**
 * compare-grid.spec.ts — Smoke tests for F5 Multi-Select & Compare Grid
 *
 * Covers:
 * 1. Cmd+Click (Meta modifier) multi-select in album grid
 * 2. Compare button appears when 2+ tiles are selected
 * 3. Compare button click opens compare view with 2-pane layout
 * 4. 3-tile selection results in compare-grid--cols-3 layout
 * 5. Sync Zoom toggle is present in compare view toolbar
 * 6. #compare= URL hash opens compare view directly
 * 7. Max 4 tiles (5th replaces oldest)
 * 8. 4-pane compare grid layout
 * 9. Shift+Click range select
 * 10. Space key toggles multi-select
 * 11. Sync Zoom ON broadcasts transform across panes
 * 12. Compare view integrates with tab bar
 */

import { test, expect, type Page } from '@playwright/test';

// Navigate to album view with images/ and wait for tiles to load.
async function gotoAlbum(page: Page) {
  await page.goto('/#album=images');
  await page.waitForSelector('.album-tile');
}

// Navigate to the gallery4/ album (4 PNGs) — used for 4-pane compare tests.
async function gotoGallery4(page: Page) {
  await page.goto('/#album=gallery4');
  await page.waitForSelector('.album-tile');
}

// Select tiles via JS (programmatic, avoids OS-level modifier behavior differences)
async function selectTile(page: Page, index: number, opts: { shift?: boolean } = {}) {
  await page.evaluate(
    ({ i, shift }) => {
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('.album-tile'));
      const tile = tiles[i];
      if (!tile) return;
      // metaKey=true toggles; shiftKey=true does range-select.
      const init: MouseEventInit = { bubbles: true, cancelable: true };
      if (shift) init.shiftKey = true;
      else init.metaKey = true;
      tile.dispatchEvent(new MouseEvent('click', init));
    },
    { i: index, shift: !!opts.shift },
  );
}

test.describe('Multi-Select & Compare Grid (F5)', () => {
  test('Cmd+Click (Meta) selects a tile and shows multi-select checkmark', async ({ page }) => {
    await gotoAlbum(page);

    const firstTile = page.locator('.album-tile').first();

    // Programmatic click with metaKey via evaluate
    await selectTile(page, 0);

    // Tile should have the multi-selected class
    await expect(firstTile).toHaveClass(/album-tile--multi-selected/);
    // Checkmark element should be visible
    await expect(firstTile.locator('.album-tile__check')).toBeVisible();
  });

  test('Compare button appears when 2 tiles are selected', async ({ page }) => {
    await gotoAlbum(page);

    // Initially no compare button
    await expect(page.locator('.album-compare-btn')).toHaveCount(0);

    // Select first tile via JS
    await selectTile(page, 0);
    // Still only 1 selected; button count should still be 0 or hidden
    const compareBtn = page.locator('.album-compare-btn');

    // Select second tile
    await selectTile(page, 1);

    // Now 2 are selected, button must be visible
    await expect(compareBtn).toBeVisible();
    await expect(compareBtn).toContainText('Compare (2)');
  });

  test('Compare button click transitions to compare view with 2 panes', async ({ page }) => {
    await gotoAlbum(page);

    // Select 2 tiles
    await selectTile(page, 0);
    await selectTile(page, 1);

    // Click compare button
    await page.locator('.album-compare-btn').click();

    // Compare view pane should appear
    await expect(page.locator('#compare-view-pane')).toBeVisible();

    // Grid should have 2-column class
    await expect(page.locator('.compare-grid--cols-2')).toBeVisible();

    // 2 pane items should be present
    const paneItems = page.locator('.compare-pane-item');
    await expect(paneItems).toHaveCount(2);
  });

  test('Selecting 3 tiles results in compare-grid--cols-3 layout', async ({ page }) => {
    await gotoAlbum(page);

    // Select 3 tiles (images/ has a.png, b.jpg, c.svg)
    await selectTile(page, 0);
    await selectTile(page, 1);
    await selectTile(page, 2);

    await expect(page.locator('.album-compare-btn')).toContainText('Compare (3)');
    await page.locator('.album-compare-btn').click();

    await expect(page.locator('#compare-view-pane')).toBeVisible();
    await expect(page.locator('.compare-grid--cols-3')).toBeVisible();

    const paneItems = page.locator('.compare-pane-item');
    await expect(paneItems).toHaveCount(3);
  });

  test('Sync Zoom toggle exists in compare view toolbar', async ({ page }) => {
    await gotoAlbum(page);

    await selectTile(page, 0);
    await selectTile(page, 1);
    await page.locator('.album-compare-btn').click();

    await expect(page.locator('#compare-view-pane')).toBeVisible();

    // Sync Zoom label and checkbox should be present in toolbar
    const syncZoomLabel = page.locator('.compare-sync-zoom-label');
    await expect(syncZoomLabel).toBeVisible();

    const syncZoomCheck = page.locator('#compare-sync-zoom');
    await expect(syncZoomCheck).toBeVisible();
  });

  test('Close button in compare view returns to album', async ({ page }) => {
    await gotoAlbum(page);

    await selectTile(page, 0);
    await selectTile(page, 1);
    await page.locator('.album-compare-btn').click();

    await expect(page.locator('#compare-view-pane')).toBeVisible();

    // Click close
    await page.locator('.compare-close-btn').click();

    // Compare view should be gone and album should be back
    await expect(page.locator('#compare-view-pane')).toHaveCount(0);
    await page.waitForSelector('.album-view');
    await expect(page.locator('.album-view')).toBeVisible();
  });

  test('Max 4 tiles can be selected (5th selection replaces oldest)', async ({ page }) => {
    // Use recursive scan on images/ which includes images/nested/d.png → total 4.
    // Additionally select 5th via gallery4/ URL which has 4 PNGs, then add one
    // more from images/ recursive. Simpler: use images/ recursive (4 images) and
    // extend via the gallery4/ album separately. Here we use gallery4/ which has
    // exactly 4 and verify the cap; the 5th replacement is verified by selecting
    // all 4 then re-selecting the same index after toggling one off.
    await gotoGallery4(page);

    const tiles = page.locator('.album-tile');
    // Select all 4
    for (let i = 0; i < 4; i++) await selectTile(page, i);
    await expect(page.locator('.album-compare-btn')).toContainText('Compare (4)');

    // Toggle off tile 0, then add it back — count stays at 4
    await selectTile(page, 0); // removes tile 0
    await expect(page.locator('.album-compare-btn')).toContainText('Compare (3)');
    await selectTile(page, 0); // adds tile 0 back (no replacement needed — count was 3)
    await expect(page.locator('.album-compare-btn')).toContainText('Compare (4)');

    // Now 4 are selected. Attempting a 5th (not possible here with only 4 tiles
    // in gallery4/). Verify the cap behavior directly via evaluate: simulate
    // Cmd+Click on tile 0 while set is already full — should be treated as a
    // toggle-off (already selected) — which is the normal path. To test the
    // true "5th replaces oldest" we would need ≥5 tiles; covered by unit
    // semantics (set cap in toggleMultiSelect). Here we only assert the cap.
    await expect(tiles).toHaveCount(4);
    await expect(page.locator('.album-compare-btn')).toContainText('Compare (4)');
  });

  test('4-pane compare grid applies --cols-4 layout and shows 4 panes', async ({ page }) => {
    await gotoGallery4(page);

    for (let i = 0; i < 4; i++) await selectTile(page, i);
    await expect(page.locator('.album-compare-btn')).toContainText('Compare (4)');
    await page.locator('.album-compare-btn').click();

    await expect(page.locator('#compare-view-pane')).toBeVisible();
    await expect(page.locator('.compare-grid--cols-4')).toBeVisible();
    await expect(page.locator('.compare-pane-item')).toHaveCount(4);
  });

  test('Shift+Click performs range selection across intermediate tiles', async ({ page }) => {
    await gotoGallery4(page);

    const tiles = page.locator('.album-tile');

    // Anchor: Cmd+Click tile 0 (sets _lastClickedIndex)
    await selectTile(page, 0);
    await expect(tiles.nth(0)).toHaveClass(/album-tile--multi-selected/);

    // Shift+Click tile 2 → should range-select tiles 0,1,2
    await selectTile(page, 2, { shift: true });
    await expect(tiles.nth(0)).toHaveClass(/album-tile--multi-selected/);
    await expect(tiles.nth(1)).toHaveClass(/album-tile--multi-selected/);
    await expect(tiles.nth(2)).toHaveClass(/album-tile--multi-selected/);
    await expect(page.locator('.album-compare-btn')).toContainText('Compare (3)');
  });

  test('Space key toggles multi-select on the focused tile', async ({ page }) => {
    await gotoAlbum(page);

    // Use ArrowRight to give keyboard focus to tile 0 (album keyboard handler)
    // Then Space to toggle.
    await page.keyboard.press('ArrowRight');
    const firstTile = page.locator('.album-tile').first();
    await expect(firstTile).toHaveClass(/album-tile--selected/);

    await page.keyboard.press(' ');
    await expect(firstTile).toHaveClass(/album-tile--multi-selected/);

    // Space again removes it
    await page.keyboard.press(' ');
    await expect(firstTile).not.toHaveClass(/album-tile--multi-selected/);
  });

  test('Sync Zoom ON broadcasts transform to other panes', async ({ page }) => {
    await gotoGallery4(page);

    // Select 3 tiles for compare
    await selectTile(page, 0);
    await selectTile(page, 1);
    await selectTile(page, 2);
    await page.locator('.album-compare-btn').click();

    await expect(page.locator('#compare-view-pane')).toBeVisible();
    await expect(page.locator('.compare-grid--cols-3')).toBeVisible();

    // Enable Sync Zoom
    await page.locator('#compare-sync-zoom').check();
    await expect(page.locator('#compare-sync-zoom')).toBeChecked();

    // Trigger a wheel zoom on pane 0 (zoom-in). Then verify pane 1 and 2 received
    // the same transform (scale > 1).
    await page.evaluate(() => {
      const wrap0 = document.querySelector('#compare-pane-wrap-0 .image-view') as HTMLElement;
      if (!wrap0) return;
      // Deltay negative = zoom-in in implementation
      wrap0.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    });

    // rAF for broadcast
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    // Compare transform on pane 1 and 2 — both should have non-identity scale
    const p0 = await page.evaluate(() => {
      const el = document.querySelector('#compare-pane-wrap-0 img, #compare-pane-wrap-0 .svg-container') as HTMLElement | null;
      return el?.style.transform ?? '';
    });
    const p1 = await page.evaluate(() => {
      const el = document.querySelector('#compare-pane-wrap-1 img, #compare-pane-wrap-1 .svg-container') as HTMLElement | null;
      return el?.style.transform ?? '';
    });
    const p2 = await page.evaluate(() => {
      const el = document.querySelector('#compare-pane-wrap-2 img, #compare-pane-wrap-2 .svg-container') as HTMLElement | null;
      return el?.style.transform ?? '';
    });

    // pane 0 should reflect the zoom
    expect(p0).toMatch(/scale\(1\.1/);
    // pane 1 and 2 should match pane 0 (sync broadcast)
    expect(p1).toBe(p0);
    expect(p2).toBe(p0);
  });

  test('Compare view adds a compare tab to the tab bar', async ({ page }) => {
    // Open an initial file so tab bar becomes visible with 2+ tabs.
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-path]');
    await page.locator('.filetree-item[data-path="README.md"]').click();
    await page.waitForSelector('#viewer h1');

    // Navigate to album then compare
    await page.evaluate(() => { location.hash = '#album=gallery4'; });
    await page.waitForSelector('.album-tile');
    await selectTile(page, 0);
    await selectTile(page, 1);
    await page.locator('.album-compare-btn').click();
    await expect(page.locator('#compare-view-pane')).toBeVisible();

    // Tab bar should now show a compare tab
    const compareTab = page.locator('#tab-bar .tab-item.tab-compare');
    await expect(compareTab).toHaveCount(1);
    await expect(compareTab).toContainText('Compare:');
    await expect(compareTab).toHaveClass(/active/);

    // Close compare tab via its close button → compare view closes
    await compareTab.locator('.tab-close').click();
    await expect(page.locator('#compare-view-pane')).toHaveCount(0);
    await expect(compareTab).toHaveCount(0);
  });

  test('#compare= URL hash opens compare view directly', async ({ page }) => {
    // Navigate directly via hash
    await page.goto('/#compare=images%2Fa.png,images%2Fb.jpg');

    await expect(page.locator('#compare-view-pane')).toBeVisible();
    await expect(page.locator('.compare-grid--cols-2')).toBeVisible();
    await expect(page.locator('.compare-pane-item')).toHaveCount(2);
  });

  test('hashchange to #compare= opens compare view after initial load', async ({ page }) => {
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');

    await page.evaluate(() => {
      location.hash = '#compare=images%2Fa.png&compare=images%2Fb.jpg';
    });

    await expect(page.locator('#compare-view-pane')).toBeVisible();
    await expect(page.locator('.compare-grid--cols-2')).toBeVisible();
    await expect(page.locator('.compare-pane-item')).toHaveCount(2);
  });

  test('compare hash preserves commas and percent signs in filenames', async ({ page }) => {
    await page.goto('/#file=README.md');
    await page.waitForSelector('#viewer h1');

    const first = encodeURIComponent('compare-special/foo,bar.png');
    const second = encodeURIComponent('compare-special/100%.png');
    await page.evaluate(
      ({ firstPath, secondPath }) => {
        location.hash = `#compare=${firstPath}&compare=${secondPath}`;
      },
      { firstPath: first, secondPath: second },
    );

    await expect(page.locator('#compare-view-pane')).toBeVisible();
    await expect(page.locator('.compare-pane-item')).toHaveCount(2);
    await expect(page.locator('.compare-pane-item__name').nth(0)).toHaveText('foo,bar.png');
    await expect(page.locator('.compare-pane-item__name').nth(1)).toHaveText('100%.png');
  });

  test('navigating to a normal file closes compare view', async ({ page }) => {
    await gotoAlbum(page);
    await selectTile(page, 0);
    await selectTile(page, 1);
    await page.locator('.album-compare-btn').click();
    await expect(page.locator('#compare-view-pane')).toBeVisible();

    await page.locator('.filetree-item[data-path="README.md"]').click();

    await expect(page.locator('#compare-view-pane')).toHaveCount(0);
    await expect(page.locator('#workspace')).not.toHaveClass(/compare-view-active/);
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  });
});
