import { test, expect } from '@playwright/test';

test.describe('Marp slides', () => {
  test('Slides button appears only for Marp documents', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item[data-type="file"]');

    // Plain markdown with `---` separators but no `marp: true` → no Slides button.
    await page.locator('.filetree-name', { hasText: /^slides\.md$/ }).click();
    await page.waitForSelector('#viewer .markdown-body h1');
    await expect(page.locator('#btn-slides')).toBeHidden();

    // Marp document → Slides button shown.
    await page.locator('.filetree-name', { hasText: /^marp-deck\.md$/ }).click();
    await page.waitForSelector('#viewer .markdown-body h1');
    await expect(page.locator('#btn-slides')).toBeVisible();
  });

  test('Slides button presents a faithful Marp deck and navigates', async ({ page }) => {
    await page.goto('/#file=marp-deck.md');
    await expect(page.locator('#btn-slides')).toBeVisible();

    await page.locator('#btn-slides').click();

    // Marp overlay renders one <svg> slide per `---`-separated section.
    const overlay = page.locator('.marp-slide-overlay');
    await expect(overlay).toBeVisible();
    const slides = overlay.locator('.marpit > svg[data-marpit-svg]');
    await expect(slides).toHaveCount(3);

    // First slide visible, counter shows position.
    await expect(overlay.locator('.slide-counter')).toHaveText('1 / 3');
    await expect(slides.nth(0)).toBeVisible();
    await expect(slides.nth(1)).toBeHidden();

    // gaia theme + paginate directive are applied to the rendered <section>.
    await expect(slides.nth(0).locator('section')).toHaveAttribute('data-theme', 'gaia');
    await expect(slides.nth(0).locator('section')).toHaveAttribute('data-paginate', 'true');

    // Next advances the slide.
    await overlay.locator('[data-act="next"]').click();
    await expect(overlay.locator('.slide-counter')).toHaveText('2 / 3');
    await expect(slides.nth(1)).toBeVisible();
    await expect(slides.nth(0)).toBeHidden();

    // Arrow keys navigate; Escape exits.
    await page.keyboard.press('ArrowRight');
    await expect(overlay.locator('.slide-counter')).toHaveText('3 / 3');
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('Cmd+Shift+S presents Marp deck for Marp files', async ({ page }) => {
    await page.goto('/#file=marp-deck.md');
    await page.waitForSelector('#viewer .markdown-body h1');
    await page.keyboard.press('Meta+Shift+s');
    await expect(page.locator('.marp-slide-overlay')).toBeVisible();
  });
});
