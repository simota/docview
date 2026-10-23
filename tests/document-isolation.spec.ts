import { test, expect, type Page } from '@playwright/test';

// Served files and remote responses are untrusted. Opened directly in a tab
// (e.g. "open image in new tab", or a link from another site), their scripts
// must not run with the DocView origin, where they could read any served file.

const MOCK = 'http://127.0.0.1:4090';

async function probe(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response?.ok()).toBeTruthy();
  // Give a script (if it runs at all) time to finish its fetch.
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    ran: document.documentElement.getAttribute('data-ran'),
    leak: document.documentElement.getAttribute('data-leak'),
  }));
}

test.describe('Direct document isolation', () => {
  for (const path of ['/api/raw/probe.svg', '/api/file?path=probe.svg']) {
    test(`local SVG does not run scripts: ${path}`, async ({ page }) => {
      expect(await probe(page, path)).toEqual({ ran: null, leak: null });
    });
  }

  for (const path of ['/api/raw/probe.html', '/api/file?path=probe.html']) {
    test(`local HTML runs only in an opaque origin: ${path}`, async ({ page }) => {
      await probe(page, path);
      // The script runs, but its API read must fail (opaque origin).
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-leak'))).toBe('blocked');
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-ran'))).toBe('1');
    });
  }

  for (const remote of ['/probe.svg', '/probe-xml.md', '/probe-pdf-xml.md', '/probe-pdf-list.md']) {
    test(`remote document is sandboxed: ${remote}`, async ({ page }) => {
      const result = await probe(page, `/api/remote?url=${encodeURIComponent(MOCK + remote)}`);
      expect(result).toEqual({ ran: null, leak: null });
    });
  }

  test('images and the in-app SVG view still render', async ({ page }) => {
    await page.goto('/#file=probe.svg');
    await expect(page.locator('#viewer svg, #viewer img').first()).toBeVisible();
    const img = await page.evaluate(async () => {
      const el = new Image();
      el.src = '/api/raw/probe.svg';
      await el.decode();
      return el.naturalWidth;
    });
    expect(img).toBe(10);
  });
});
