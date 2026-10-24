import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '/tmp/md-test-docs';

/**
 * Regression suite for the frontend audit batch:
 *  - markdown: wiki link inside a link label, unterminated leading `---`
 *  - routing: heading anchors named like app routes (#file, #album)
 *  - scroll memory across SSE live reload
 *  - find bar: hidden Tree/Source copy, case folding that changes length
 *  - search modal: Shift while typing, IME composition keys
 *  - failed SVG load, YAML alias masking, UTF-8 BOM in JSONL/CSV
 */

async function openHash(page: Page, file: string, query = '') {
  await page.goto(`/${query}#file=${encodeURIComponent(file)}`);
}

test.describe('Frontend audit regressions', () => {
  test('a wiki link inside a link label does not abort rendering', async ({ page }) => {
    await openHash(page, 'audit-wiki-label.md');
    await expect(page.locator('#viewer h1')).toContainText('After Wiki');
    await expect(page.locator('#viewer a[href="http://example.com"]')).toHaveText('y');
    await expect(page.locator('#viewer .error-banner')).toHaveCount(0);
  });

  test('a leading --- without a closing fence is a rule, not front matter', async ({ page }) => {
    await openHash(page, 'audit-unclosed-fm.md');
    await expect(page.locator('#viewer h1')).toContainText('Unclosed Title');
    await expect(page.locator('#viewer .markdown-body')).toContainText('Body paragraph should render.');
    await expect(page.locator('#viewer .markdown-body hr')).toHaveCount(1);
  });

  test('closed front matter is still hidden', async ({ page }) => {
    await openHash(page, 'audit-closed-fm.md');
    await expect(page.locator('#viewer h1')).toContainText('Closed Title');
    await expect(page.locator('#viewer .markdown-body')).not.toContainText('title: meta');
  });

  test('a heading anchor named #file scrolls in-page instead of routing', async ({ page }) => {
    await openHash(page, 'audit-heading-route.md');
    await expect(page.locator('#viewer h1')).toContainText('Heading Route');
    await page.locator('#viewer a', { hasText: 'go to file section' }).click();
    await expect(page.locator('#viewer h2#file')).toBeInViewport();
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('file')).toBe('audit-heading-route.md');
  });

  test('live reload keeps the scroll position of the open file', async ({ page }) => {
    const file = join(DIR, 'audit-scroll.md');
    const original = readFileSync(file, 'utf-8');
    const sseConnected = page.waitForResponse((res) => res.url().includes('/api/watch'));
    await openHash(page, 'audit-scroll.md');
    await expect(page.locator('#viewer h1')).toContainText('Scroll Memory');
    await sseConnected;

    const viewer = page.locator('#viewer');
    await viewer.evaluate((el) => { el.scrollTop = 3000; });
    await expect.poll(() => viewer.evaluate((el) => el.scrollTop)).toBe(3000);

    // Hold the reload response for a few frames so the loading skeleton is
    // laid out (on a fast loopback the fetch can beat the next frame).
    await page.route(/\/api\/file\?path=audit-scroll\.md$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    try {
      writeFileSync(file, original + '\nEdited marker paragraph.\n');
      await expect(page.locator('#viewer')).toContainText('Edited marker paragraph.', { timeout: 15000 });
      await expect.poll(() => viewer.evaluate((el) => el.scrollTop)).toBe(3000);
    } finally {
      writeFileSync(file, original);
    }
  });

  test('find bar counts only the visible Tree/Source view', async ({ page }) => {
    await openHash(page, 'audit-find.yaml');
    await expect(page.locator('#viewer .json-view-tree')).toContainText('zqfindtoken');
    await page.locator('#viewer').click();
    await page.keyboard.press('/');
    await page.locator('.find-input').fill('zqfindtoken');
    await expect(page.locator('.find-info')).toHaveText('1/1');
  });

  test('find bar ranges stay aligned after characters whose lower case is longer', async ({ page }) => {
    await openHash(page, 'audit-find-length.md');
    await expect(page.locator('#viewer h1')).toContainText('Find');
    await page.locator('#viewer').click();
    await page.keyboard.press('/');
    await page.locator('.find-input').fill('end');
    await expect(page.locator('.find-info')).toHaveText('1/1');
    const current = await page.evaluate(() => {
      const ranges = CSS.highlights.get('find-current');
      return ranges ? [...ranges].map((r) => r.toString()) : [];
    });
    expect(current).toEqual(['end']);
  });

  test('Shift while typing keeps the search mode; a lone Shift tap still toggles it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.search-overlay');
    const tabFiles = page.locator('.search-tab', { hasText: 'Files' });
    const tabFulltext = page.locator('.search-tab', { hasText: 'Full text' });
    await expect(tabFiles).toHaveAttribute('aria-selected', 'true');

    // Typing a capital: Shift is held while another key is pressed.
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyO');
    await page.keyboard.up('Shift');
    await page.keyboard.type('ther');
    await expect(page.locator('.search-overlay input')).toHaveValue('Other');
    await expect(tabFiles).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Shift');
    await expect(tabFulltext).toHaveAttribute('aria-selected', 'true');
  });

  test('Escape and Enter during IME composition do not act on the search modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.filetree-item');
    await page.keyboard.press('Meta+p');
    const input = page.locator('.search-overlay input');
    await input.fill('README');
    await expect(page.locator('.search-item').first()).toBeVisible();
    for (const key of ['Escape', 'Enter']) {
      await input.dispatchEvent('keydown', { key, isComposing: true, bubbles: true });
    }
    await expect(page.locator('.search-overlay')).toBeVisible();
    expect(new URL(page.url()).hash).not.toContain('README');
  });

  test('a failed SVG load replaces the previous document with an error', async ({ page }) => {
    await openHash(page, 'audit-find-length.md');
    await expect(page.locator('#viewer h1')).toContainText('Find');
    await page.evaluate(() => { location.hash = '#file=missing-audit.svg'; });
    await expect(page.locator('#viewer .error-banner')).toContainText('missing-audit.svg');
    await expect(page.locator('#viewer h1')).toHaveCount(0);
  });

  test('secret-safe YAML tree does not resolve aliases to masked secrets', async ({ page }) => {
    await openHash(page, 'audit-secret-alias.yaml', '?secretSafe=1');
    await expect(page.locator('#viewer .json-view-tree')).toContainText('other');
    await expect(page.locator('#viewer')).not.toContainText('hunter2-alias');
    await expect(page.locator('#viewer .json-view-tree')).toContainText('[REDACTED]');
  });

  test('UTF-8 BOM is stripped from text and record responses', async ({ request }) => {
    const full = await request.get('/api/file?path=audit-bom.csv');
    expect((await full.text()).startsWith('id,name')).toBe(true);
    const records = await request.get('/api/file?path=audit-bom.csv&offset=0&limit=10&records=1');
    expect((await records.text()).split('\n')[0]).toBe('id,name');
    const lines = await request.get('/api/file?path=audit-bom.jsonl&offset=0&limit=1');
    expect(JSON.parse(await lines.text())).toEqual({ a: 1 });
  });

  test('UTF-8 BOM does not hide the first line from anchored regex search', async ({ request }) => {
    const res = await request.get('/api/search?regex=1&q=' + encodeURIComponent('^id,name$'));
    const results = await res.json() as { path: string; line: number }[];
    expect(results).toContainEqual(expect.objectContaining({ path: 'audit-bom.csv', line: 1 }));
  });
});
