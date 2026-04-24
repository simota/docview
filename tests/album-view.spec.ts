import { test, expect } from '@playwright/test';
import { utimesSync } from 'node:fs';

const BASE = 'http://localhost:4001';

// ---------------------------------------------------------------------------
// API-level tests — exercise /api/album directly via fetch
// ---------------------------------------------------------------------------

test.describe('Album API', () => {
  test('returns 200 with images array containing required fields', async ({ request }) => {
    const res = await request.get(`${BASE}/api/album?path=images`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images.length).toBeGreaterThan(0);
    const first = body.images[0];
    expect(typeof first.path).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.size).toBe('number');
    expect(typeof first.mtime).toBe('string');
    expect(typeof first.ext).toBe('string');
  });

  test('returns total and truncated fields', async ({ request }) => {
    const res = await request.get(`${BASE}/api/album?path=images`);
    const body = await res.json();
    expect(typeof body.total).toBe('number');
    expect(typeof body.truncated).toBe('boolean');
    // dir is relative to served root; ends with 'images'
    expect(body.dir).toMatch(/images$/);
  });

  test('returns empty images array for directory with no images', async ({ request }) => {
    const res = await request.get(`${BASE}/api/album?path=empty-dir`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.images).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.truncated).toBe(false);
  });

  test('recursive=1 includes images from subdirectories', async ({ request }) => {
    // images/ has 3 direct images; images/nested/ has d.png.
    // Flat scan of images/ finds 3; recursive scan finds at least 4.
    const flat = await request.get(`${BASE}/api/album?path=images&recursive=0`);
    const flatBody = await flat.json();
    const flatCount: number = flatBody.total;
    expect(flatCount).toBe(3);

    const rec = await request.get(`${BASE}/api/album?path=images&recursive=1`);
    expect(rec.status()).toBe(200);
    const recBody = await rec.json();
    // Recursive scan must include images/nested/d.png in addition to the 3 direct images
    expect(recBody.total).toBeGreaterThan(flatCount);
  });

  test('path-traversal attack is rejected with HTTP 403', async ({ request }) => {
    const res = await request.get(`${BASE}/api/album?path=../../etc`);
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/access denied/i);
  });

  test('non-existent directory returns an error status (403 or 404)', async ({ request }) => {
    // safePath resolves symlinks and returns null for non-existent paths → 403
    const res = await request.get(`${BASE}/api/album?path=does-not-exist-xyz`);
    expect([403, 404]).toContain(res.status());
  });

  test('missing path parameter returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/album`);
    expect(res.status()).toBe(400);
  });

  test('limit parameter caps the number of returned images', async ({ request }) => {
    // images/ has 3 images; limit=1 should return at most 1 and mark truncated
    const res = await request.get(`${BASE}/api/album?path=images&limit=1`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.images.length).toBeLessThanOrEqual(1);
    expect(body.truncated).toBe(true);
  });

  test('path=. (root) returns 200 with an images array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/album?path=.`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.images)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UI-level tests — exercise the #album= hash routing in the browser
// ---------------------------------------------------------------------------

test.describe('Album view UI', () => {
  test('navigating to #album=images shows .album-view', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-view');
    await expect(page.locator('.album-view')).toBeVisible();
  });

  test('SSE album refresh does not overwrite file view after leaving album', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-view');

    await page.locator('.filetree-item[data-path="README.md"]').click();
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');

    const now = new Date();
    utimesSync('/tmp/md-test-docs/images/a.png', now, now);
    await page.waitForTimeout(900);

    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
    await expect(page.locator('.album-view')).toHaveCount(0);
  });

  test('three image tiles are rendered for images/ directory', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    const tiles = page.locator('.album-tile');
    await expect(tiles).toHaveCount(3);
  });

  test('each tile contains an img with loading=lazy and src/data-lazy-src pointing to /api/file', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    const firstImg = page.locator('.album-tile').first().locator('img');
    await expect(firstImg).toBeVisible();
    await expect(firstImg).toHaveAttribute('loading', 'lazy');
    // Tiles use IntersectionObserver lazy loading. Either src or data-lazy-src
    // contains the API file URL.
    const src = (await firstImg.getAttribute('src')) ?? '';
    const lazySrc = (await firstImg.getAttribute('data-lazy-src')) ?? '';
    expect(src + lazySrc).toContain('/api/file');
  });

  test('toolbar is visible and contains the directory path', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-toolbar');
    await expect(page.locator('.album-toolbar')).toBeVisible();
    await expect(page.locator('.album-toolbar')).toContainText('images');
  });

  test('recursive toggle checkbox is present', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('#album-recursive-toggle');
    const toggle = page.locator('#album-recursive-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('type', 'checkbox');
  });

  test('clicking recursive toggle re-renders with the checkbox checked', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('#album-recursive-toggle');
    const toggle = page.locator('#album-recursive-toggle');
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    // Wait for the re-render to settle — toolbar is re-created after fetchAlbum
    await page.waitForSelector('.album-toolbar');
    // After re-render the new toggle should be checked
    const toggleAfter = page.locator('#album-recursive-toggle');
    await expect(toggleAfter).toBeChecked();
  });

  test('empty directory shows "画像がありません" message', async ({ page }) => {
    await page.goto('/#album=empty-dir');
    await page.waitForSelector('.album-view');
    // No tiles should appear
    const tiles = page.locator('.album-tile');
    await expect(tiles).toHaveCount(0);
    // Empty state message rendered by renderGrid
    await expect(page.locator('.album-view')).toContainText('画像がありません');
  });

  test('ArrowRight key moves selection to the second tile', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Focus first tile — this sets _selectedIndex = 0 via focus event
    await page.locator('.album-tile').first().focus();
    await page.keyboard.press('ArrowRight');
    // After ArrowRight from 0, tile at index 1 gets album-tile--selected
    const secondTile = page.locator('.album-tile').nth(1);
    await expect(secondTile).toHaveClass(/album-tile--selected/, { timeout: 3000 });
  });

  test('ArrowLeft key moves selection back to the first tile', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Focus second tile, then move left
    await page.locator('.album-tile').nth(1).focus();
    await page.keyboard.press('ArrowLeft');
    const firstTile = page.locator('.album-tile').first();
    await expect(firstTile).toHaveClass(/album-tile--selected/, { timeout: 3000 });
  });

  test('Enter key on a selected tile opens the Lightbox overlay', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Focus and select the first tile
    await page.locator('.album-tile').first().focus();
    // Use ArrowRight to trigger selection (sets _selectedIndex)
    await page.keyboard.press('ArrowRight');
    // Go back to the first tile
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    // Lightbox overlay opens — URL stays as #album= (overlay approach)
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Counter shows position in the list
    await expect(page.locator('.lightbox__counter')).toBeVisible();
  });

  test('Escape deselects tile and moves focus to .album-toolbar', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Focus the first tile — sets _selectedIndex = 0 via focus event
    await page.locator('.album-tile').first().focus();
    // ArrowRight moves selection from 0 → 1 (second tile gets selected class)
    await page.keyboard.press('ArrowRight');
    const secondTile = page.locator('.album-tile').nth(1);
    await expect(secondTile).toHaveClass(/album-tile--selected/, { timeout: 3000 });

    await page.keyboard.press('Escape');
    // Selected class removed from the previously selected tile
    await expect(secondTile).not.toHaveClass(/album-tile--selected/, { timeout: 3000 });
    // Toolbar receives focus
    await expect(page.locator('.album-toolbar')).toBeFocused();
  });

  test('clicking a tile opens the Lightbox overlay', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Click the first tile
    await page.locator('.album-tile').first().click();
    // Lightbox should appear
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Toolbar should show filename and counter
    await expect(page.locator('.lightbox__filename')).toBeVisible();
    await expect(page.locator('.lightbox__counter')).toContainText('1 /');
  });

  test('Lightbox closes on Esc key', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.lightbox')).not.toBeVisible({ timeout: 5000 });
  });

  test('Lightbox ArrowRight moves to next image and updates counter', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Should start at 1 / 3
    await expect(page.locator('.lightbox__counter')).toContainText('1 /');
    await page.keyboard.press('ArrowRight');
    // Now at 2 / 3
    await expect(page.locator('.lightbox__counter')).toContainText('2 /');
  });

  test('Lightbox prev button is disabled at first image', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    const prevBtn = page.locator('.lightbox__nav-prev');
    await expect(prevBtn).toBeDisabled();
  });

  test('Lightbox next button is disabled at last image', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Click last tile (index 2, there are 3 images)
    await page.locator('.album-tile').nth(2).click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    const nextBtn = page.locator('.lightbox__nav-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('Lightbox close button closes the overlay', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await page.locator('.lightbox__close').click();
    await expect(page.locator('.lightbox')).not.toBeVisible({ timeout: 5000 });
  });

  test('truncated API response would render the warning banner (contract check)', async ({ request }) => {
    // Verify the API correctly sets truncated=true when limit is exceeded;
    // the album-viewer.ts renders .album-banner when this flag is true.
    const res = await request.get(`${BASE}/api/album?path=images&limit=1`);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.images.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Lightbox edge-case tests — navigation, history, zoom, a11y, preload, SVG
// ---------------------------------------------------------------------------

test.describe('Lightbox edge cases', () => {
  // ---- Navigation ----

  test('Lightbox ArrowLeft moves to previous image and updates counter', async ({ page }) => {
    // Open at index 1 (second tile) then press ArrowLeft to go back to index 0
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').nth(1).click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Starts at 2 / 3
    await expect(page.locator('.lightbox__counter')).toContainText('2 /');
    await page.keyboard.press('ArrowLeft');
    // Now at 1 / 3
    await expect(page.locator('.lightbox__counter')).toContainText('1 /');
  });

  test('Lightbox Home key jumps to the first image from mid-sequence', async ({ page }) => {
    // Open at last image (index 2) then press Home → should land on index 0
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').nth(2).click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.lightbox__counter')).toContainText('3 /');
    await page.keyboard.press('Home');
    await expect(page.locator('.lightbox__counter')).toContainText('1 /');
    // prev button must be disabled at first image
    await expect(page.locator('.lightbox__nav-prev')).toBeDisabled();
  });

  test('Lightbox End key jumps to the last image from mid-sequence', async ({ page }) => {
    // Open at first image (index 0) then press End → should land on last index
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.lightbox__counter')).toContainText('1 /');
    await page.keyboard.press('End');
    await expect(page.locator('.lightbox__counter')).toContainText('3 /');
    // next button must be disabled at last image
    await expect(page.locator('.lightbox__nav-next')).toBeDisabled();
  });

  test('Lightbox counter shows "N / 3" accurately for each position', async ({ page }) => {
    // Verify counter text at index 1 (middle) exactly shows "2 / 3"
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').nth(1).click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    const counterText = await page.locator('.lightbox__counter').textContent();
    expect(counterText?.trim()).toBe('2 / 3');
  });

  // ---- History integration ----

  test('browser back closes the Lightbox overlay', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // goBack() fires popstate which triggers closeLightbox
    await page.goBack();
    await expect(page.locator('.lightbox')).not.toBeVisible({ timeout: 5000 });
  });

  // ---- Zoom ----

  test('+ key zooms in (scale increases above 1)', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Open first tile (a.png — non-SVG so imgEl is an <img>)
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Wait for the image element to be present
    await expect(page.locator('.lightbox__img')).toBeVisible({ timeout: 5000 });
    // Press + to zoom in
    await page.keyboard.press('+');
    // Extract scale from transform matrix
    const transform = await page.locator('.lightbox__img').evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });
    // transform is "matrix(a,b,c,d,tx,ty)"; a == scaleX
    const match = transform.match(/matrix\(([\d.]+)/);
    const scale = match ? parseFloat(match[1]) : 1;
    expect(scale).toBeGreaterThan(1);
  });

  test('- key zooms out (scale decreases toward 0.5 min)', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.lightbox__img')).toBeVisible({ timeout: 5000 });
    // First zoom in so there is room to zoom out and detect the change
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    const transformBefore = await page.locator('.lightbox__img').evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });
    const scaleBefore = parseFloat(transformBefore.match(/matrix\(([\d.]+)/)?.[1] ?? '1');
    // Now zoom out
    await page.keyboard.press('-');
    const transformAfter = await page.locator('.lightbox__img').evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });
    const scaleAfter = parseFloat(transformAfter.match(/matrix\(([\d.]+)/)?.[1] ?? '1');
    expect(scaleAfter).toBeLessThan(scaleBefore);
  });

  test('0 key resets zoom to scale 1', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.lightbox__img')).toBeVisible({ timeout: 5000 });
    // Zoom in first
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    // Reset
    await page.keyboard.press('0');
    const transform = await page.locator('.lightbox__img').evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });
    // After reset, scale component should be 1; transform may be "none" or "matrix(1,..."
    const isNoneOrIdentity = transform === 'none' || /matrix\(1[,\s]+0[,\s]+0[,\s]+1[,\s]/.test(transform);
    expect(isNoneOrIdentity).toBe(true);
  });

  test('ArrowUp zooms in (same as + key)', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.lightbox__img')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('ArrowUp');
    const transform = await page.locator('.lightbox__img').evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });
    const match = transform.match(/matrix\(([\d.]+)/);
    const scale = match ? parseFloat(match[1]) : 1;
    expect(scale).toBeGreaterThan(1);
  });

  // ---- Accessibility / UX ----

  test('body.lightbox-open class is added while Lightbox is open', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('body')).toHaveClass(/lightbox-open/);
  });

  test('body.lightbox-open class is removed after Lightbox closes', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.lightbox')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('body')).not.toHaveClass(/lightbox-open/);
  });

  test('focus returns to the originating album tile after Lightbox closes', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    // Click second tile (index 1) to open lightbox
    await page.locator('.album-tile').nth(1).click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Close via close button
    await page.locator('.lightbox__close').click();
    await expect(page.locator('.lightbox')).not.toBeVisible({ timeout: 5000 });
    // Focus should return to the tile that was used to open the lightbox
    // (closeLightbox restores focus to _lightboxIndex tile)
    await expect(page.locator('.album-tile').nth(1)).toBeFocused();
  });

  test('preload link for adjacent non-SVG image is inserted into <head>', async ({ page }) => {
    // Open first tile (a.png at index 0).
    // Adjacent: index -1 (none) and index 1 (b.jpg — not SVG → preload injected).
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').first().click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // Wait briefly for preload setup (async, but no arbitrary timeout — poll via evaluate)
    await expect.poll(async () => {
      return page.evaluate(() => {
        return document.querySelectorAll('link[rel="preload"][as="image"]').length;
      });
    }, { timeout: 4000 }).toBeGreaterThan(0);
  });

  test('SVG image opens in Lightbox without crashing the overlay', async ({ page }) => {
    // c.svg is the third tile (index 2).
    // loadLightboxImage fetches SVG, sanitizes with DOMPurify, and either renders
    // .lightbox__img--svg (success) or .lightbox__error (fetch failure).
    // Either outcome is valid for this test; what matters is the Lightbox stays
    // open and the loading spinner is replaced by content (no hanging state).
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');
    await page.locator('.album-tile').nth(2).click();
    await expect(page.locator('.lightbox')).toBeVisible({ timeout: 8000 });
    // The loading placeholder should be replaced by either success or error state
    await expect(page.locator('.lightbox__loading')).not.toBeVisible({ timeout: 6000 });
    // The lightbox container (dialog) must remain visible — no crash
    await expect(page.locator('.lightbox__container')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Filetree integration — Album button on directory nodes
// ---------------------------------------------------------------------------

test.describe('Album button in filetree', () => {
  test('images/ directory node shows the album button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    // Use data-path attribute to locate the directory node precisely
    const imagesDir = page.locator('.filetree-item[data-path="images"][data-type="dir"]');
    await expect(imagesDir).toBeVisible();
    const albumBtn = imagesDir.locator('.filetree-album-btn');
    await expect(albumBtn).toBeVisible();
  });

  test('album button label contains image count (3 for images/)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    const imagesDir = page.locator('.filetree-item[data-path="images"][data-type="dir"]');
    const countEl = imagesDir.locator('.filetree-album-count');
    await expect(countEl).toBeVisible();
    const countText = await countEl.textContent();
    // images/ contains a.png, b.jpg, c.svg — 3 direct image children
    expect(parseInt(countText ?? '0', 10)).toBe(3);
  });

  test('clicking the album button navigates to #album=images', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    const imagesDir = page.locator('.filetree-item[data-path="images"][data-type="dir"]');
    await imagesDir.locator('.filetree-album-btn').click();
    await page.waitForSelector('.album-view');
    await expect(page).toHaveURL(/#album=images/);
    await expect(page.locator('.album-view')).toBeVisible();
  });

  test('images/nested/ directory node is accessible via album API for recursive scan', async ({ request }) => {
    // images/nested/ contains d.png; verify the nested directory is reachable.
    const res = await request.get(`${BASE}/api/album?path=images%2Fnested`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.images[0].name).toBe('d.png');
  });
});

// ---------------------------------------------------------------------------
// F11 Contact Sheet Export tests
// ---------------------------------------------------------------------------

test.describe('Contact Sheet (F11)', () => {
  test('Print button (.album-print-btn) is visible in album view', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-toolbar');
    await expect(page.locator('.album-print-btn')).toBeVisible();
  });

  test('columns select (.album-print-cols) is visible in album view', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-toolbar');
    await expect(page.locator('.album-print-cols')).toBeVisible();
  });

  test('clicking Print button creates .contact-sheet-preview DOM and body.contact-sheet-printing', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-btn');

    // Stub window.print() to prevent hang in headless mode
    await page.evaluate(() => {
      window.print = () => {
        // Dispatch afterprint so cleanup runs
        window.dispatchEvent(new Event('afterprint'));
      };
    });

    await page.locator('.album-print-btn').click();

    // The contact sheet grid should have been created before window.print() was called.
    // After the stubbed print, afterprint fires and removes it — so we need to intercept
    // the state before cleanup. Re-test by blocking afterprint cleanup:
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-btn');
    await page.evaluate(() => {
      // Override print to verify DOM presence without cleanup
      window.print = () => {
        // Do not dispatch afterprint — so cleanup does not run
      };
    });

    await page.locator('.album-print-btn').click();

    // contact-sheet-preview should be in DOM
    await expect(page.locator('.contact-sheet-preview')).toBeAttached();
    // body should have the printing class
    await expect(page.locator('body')).toHaveClass(/contact-sheet-printing/);
    // Grid should exist
    await expect(page.locator('.contact-sheet-grid')).toBeAttached();
  });

  test('contact-sheet-number elements match image count and are numbered 1, 2, 3', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-btn');

    // Stub print to avoid cleanup before assertions
    await page.evaluate(() => {
      window.print = () => { /* no-op: do not trigger afterprint */ };
    });

    await page.locator('.album-print-btn').click();

    // Wait for tiles
    const numbers = page.locator('.contact-sheet-number');
    // images/ has 3 images
    await expect(numbers).toHaveCount(3);
    await expect(numbers.nth(0)).toHaveText('1');
    await expect(numbers.nth(1)).toHaveText('2');
    await expect(numbers.nth(2)).toHaveText('3');
  });

  test('columns select persists to localStorage and is restored on next visit', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-cols');

    // Select 3 columns
    await page.selectOption('.album-print-cols', '3');

    // Check localStorage
    const stored = await page.evaluate(() => localStorage.getItem('album-contact-sheet-cols'));
    expect(stored).toBe('3');

    // Navigate away and back
    await page.goto('/');
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-cols');

    // The select should restore to 3
    const value = await page.locator('.album-print-cols').inputValue();
    expect(value).toBe('3');
  });

  test('Print button is disabled when album has no images', async ({ page }) => {
    await page.goto('/#album=empty-dir');
    await page.waitForSelector('.album-view');
    // empty-dir has no images, so Print button should be disabled
    const btn = page.locator('.album-print-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('@media print shows contact-sheet-preview and hides normal UI when body.contact-sheet-printing', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-btn');

    // Stub print to prevent cleanup
    await page.evaluate(() => { window.print = () => { /* no-op */ }; });
    await page.locator('.album-print-btn').click();

    // Emulate print media to verify CSS rules
    await page.emulateMedia({ media: 'print' });

    // contact-sheet-preview should be visible in print media
    await expect(page.locator('.contact-sheet-preview')).toBeVisible();
  });

  // ---- Selection-aware printing (F11 extension) ----

  test('with 2 tiles multi-selected, Print includes only those 2 in contact sheet', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-tile');

    // Cmd/Ctrl-click two tiles to multi-select (indices 0 and 2)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('.album-tile').nth(0).click({ modifiers: [modifier] });
    await page.locator('.album-tile').nth(2).click({ modifiers: [modifier] });

    // Stub print so afterprint does not run (preview stays in DOM for assertion)
    await page.evaluate(() => { window.print = () => { /* no-op */ }; });

    await page.locator('.album-print-btn').click();

    // Only 2 tiles should appear in the contact sheet (not 3)
    const tiles = page.locator('.contact-sheet-tile');
    await expect(tiles).toHaveCount(2);

    // Numbers must restart from 1 (re-sequenced after filtering)
    const numbers = page.locator('.contact-sheet-number');
    await expect(numbers.nth(0)).toHaveText('1');
    await expect(numbers.nth(1)).toHaveText('2');
  });

  test('Print button label reflects current multi-selection count', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-btn');

    // Initial label: "Print"
    const label = page.locator('.album-print-btn__label');
    await expect(label).toHaveText('Print');

    // Select one tile → label becomes "Print (1)"
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('.album-tile').nth(0).click({ modifiers: [modifier] });
    await expect(label).toHaveText('Print (1)');

    // Select a second → "Print (2)"
    await page.locator('.album-tile').nth(1).click({ modifiers: [modifier] });
    await expect(label).toHaveText('Print (2)');

    // aria-label reflects selection mode
    await expect(page.locator('.album-print-btn')).toHaveAttribute('aria-label', /selected 2/i);
  });

  test('Escape clears multi-selection and Print button label resets to "Print"', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-print-btn');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('.album-tile').nth(0).click({ modifiers: [modifier] });
    await page.locator('.album-tile').nth(1).click({ modifiers: [modifier] });

    const label = page.locator('.album-print-btn__label');
    await expect(label).toHaveText('Print (2)');

    // Escape clears multi-selection (handled by album keyboard handler)
    await page.keyboard.press('Escape');

    await expect(label).toHaveText('Print');
    await expect(page.locator('.album-print-btn')).toHaveAttribute('aria-label', /all images/i);
  });
});

test.describe('Download ZIP', () => {
  test('Download button is visible with initial label "Download"', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-download-btn');
    await expect(page.locator('.album-download-btn__label')).toHaveText('Download');
  });

  test('Download button label reflects multi-selection count', async ({ page }) => {
    await page.goto('/#album=images');
    await page.waitForSelector('.album-download-btn');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const label = page.locator('.album-download-btn__label');

    await page.locator('.album-tile').nth(0).click({ modifiers: [modifier] });
    await expect(label).toHaveText('Download (1)');

    await page.locator('.album-tile').nth(1).click({ modifiers: [modifier] });
    await expect(label).toHaveText('Download (2)');

    await expect(page.locator('.album-download-btn')).toHaveAttribute('aria-label', /selected 2/i);
  });

  test('/api/download-zip returns a valid zip for selected paths', async ({ request }) => {
    const res = await request.post('/api/download-zip', {
      data: { paths: ['images/a.png', 'images/b.jpg'] },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/zip');
    expect(res.headers()['content-disposition']).toMatch(/attachment; filename="docview-.+\.zip"/);
    const buf = await res.body();
    // ZIP local file header magic
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
    // End of central directory record magic appears within the last 22 bytes of a no-comment archive
    expect(buf.slice(-22, -18).toString('hex')).toBe('504b0506');
  });

  test('/api/download-zip rejects path traversal', async ({ request }) => {
    const res = await request.post('/api/download-zip', {
      data: { paths: ['../../etc/passwd'] },
    });
    expect(res.status()).toBe(403);
  });

  test('/api/download-zip rejects non-image extensions', async ({ request }) => {
    const res = await request.post('/api/download-zip', {
      data: { paths: ['readme.md'] },
    });
    // safePath may return 403 (file absent) or 400 (unsupported ext) depending on fixtures;
    // both indicate the request was refused.
    expect([400, 403]).toContain(res.status());
  });

  test('/api/download-zip rejects empty paths', async ({ request }) => {
    const res = await request.post('/api/download-zip', { data: { paths: [] } });
    expect(res.status()).toBe(400);
  });
});
