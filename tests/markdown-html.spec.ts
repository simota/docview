import { test, expect, type Page } from '@playwright/test';

async function openDocument(page: Page, path: string, content: string) {
  await page.route('**/api/file?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('path') === path) {
      await route.fulfill({ contentType: 'text/plain; charset=utf-8', body: content });
    } else {
      await route.continue();
    }
  });
  await page.goto(`/#file=${encodeURIComponent(path)}`);
}

test.describe('Raw HTML in markdown', () => {
  test('renders common inline and block HTML', async ({ page }) => {
    await openDocument(page, 'raw-html.md', [
      '# Raw HTML',
      '',
      '<div align="center" class="hero">',
      '  <img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E" width="120" alt="logo">',
      '</div>',
      '',
      '<details>',
      '<summary>More</summary>',
      '',
      'Hidden **markdown** body',
      '',
      '</details>',
      '',
      'Press <kbd>Ctrl</kbd>+<kbd>C</kbd> and see<br>next line.',
      '',
      '<a href="https://example.com" target="_blank">ext</a>',
      '',
      '```html',
      '<div class="in-code">not rendered</div>',
      '```',
    ].join('\n'));

    const body = page.locator('#viewer');
    await expect(body.locator('h1')).toContainText('Raw HTML');
    await expect(body.locator('div.hero[align="center"] img[alt="logo"]')).toHaveAttribute('width', '120');
    await expect(body.locator('details > summary')).toHaveText('More');
    await expect(body.locator('details strong')).toHaveText('markdown');
    await expect(body.locator('kbd')).toHaveCount(2);
    await expect(body.locator('br')).toHaveCount(1);
    await expect(body.locator('a[href="https://example.com"]')).toHaveAttribute('target', '_blank');
    await expect(body.locator('div.in-code')).toHaveCount(0);
    await expect(body.locator('.code-block code')).toContainText('<div class="in-code">not rendered</div>');
  });

  test('strips scripts, event handlers, javascript: URLs and page-level styles', async ({ page }) => {
    await openDocument(page, 'unsafe-html.md', [
      '# Unsafe',
      '',
      '<script>window.__mdXss = "script"</script>',
      '',
      '<img src="x" onerror="window.__mdXss = \'onerror\'" alt="bad">',
      '',
      '<a href="javascript:window.__mdXss=\'href\'" id="js-link">click</a>',
      '',
      '<style>body { display: none !important; }</style>',
      '',
      '<form action="https://example.com"><input name="q"></form>',
      '',
      '<iframe src="https://example.com"></iframe>',
    ].join('\n'));

    const body = page.locator('#viewer');
    await expect(body.locator('h1')).toContainText('Unsafe');
    await expect(body.locator('script, style, form, iframe')).toHaveCount(0);
    await expect(body.locator('img[alt="bad"]')).not.toHaveAttribute('onerror');
    await expect(body.locator('#js-link')).not.toHaveAttribute('href');
    await expect(page.locator('body')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __mdXss?: string }).__mdXss)).toBeUndefined();
  });

  test('keeps math, diagrams and alerts intact after sanitizing', async ({ page }) => {
    await openDocument(page, 'mixed.md', [
      '# Mixed',
      '',
      'Inline $\\sqrt{x^2+1}$ math.',
      '',
      '> [!NOTE]',
      '> An alert.',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n'));

    const body = page.locator('#viewer');
    await expect(body.locator('.katex math annotation')).toHaveText('\\sqrt{x^2+1}');
    await expect(body.locator('.katex-html svg path').first()).toBeAttached();
    await expect(body.locator('.markdown-alert, [class*="alert"]').first()).toContainText('An alert.');
    await expect(body.locator('.mermaid-rendered svg').first()).toBeVisible({ timeout: 15000 });
  });

  test('keeps positioned raw HTML inside the document area', async ({ page }) => {
    await openDocument(page, 'overlay.md', [
      '# Overlay',
      '',
      '<div id="fake-screen" style="position:fixed;inset:0;z-index:2147483647;background:white">偽の画面</div>',
      '',
      '<div id="fake-abs" style="position:absolute;top:-2000px;left:-2000px;width:9999px;height:9999px;z-index:2147483647">x</div>',
      '',
      '<div id="pop" popover>popover</div>',
    ].join('\n'));

    const body = page.locator('#viewer');
    await expect(body.locator('#fake-screen')).toBeAttached();
    await expect(body.locator('#pop')).not.toHaveAttribute('popover');
    const hits = await page.evaluate(() => {
      const hit = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!el && !el.closest('#fake-screen, #fake-abs');
      };
      return {
        toolbar: hit('#btn-search'),
        sidebar: hit('#btn-sidebar'),
        toggle: hit('#viewer .json-toggle-btn[data-view="source"]'),
      };
    });
    expect(hits).toEqual({ toolbar: true, sidebar: true, toggle: true });
  });

  test('keeps heading ids that collide with document properties', async ({ page }) => {
    await openDocument(page, 'anchors.md', [
      '# Title',
      '',
      '## Location',
      '',
      '<h2 id="cookie">raw</h2>',
      '',
      '<img name="getElementById" id="getElementById" src="x" alt="clobber">',
    ].join('\n'));

    const body = page.locator('#viewer');
    await expect(body.locator('h1#title a.header-anchor')).toHaveAttribute('href', '#title');
    await expect(body.locator('h2#location a.header-anchor')).toHaveAttribute('href', '#location');
    await expect(page.locator('.toc-link[href="#location"]')).toBeAttached();
    await expect(body.locator('h2', { hasText: 'raw' })).not.toHaveAttribute('id');
    await expect(body.locator('img[alt="clobber"]')).not.toHaveAttribute('id');
    await expect(body.locator('img[alt="clobber"]')).not.toHaveAttribute('name');
    expect(await page.evaluate(() => [...document.querySelectorAll('#viewer *')].some((el) =>
      [...el.attributes].some((a) => a.name.startsWith('data-md-heading-id'))))).toBe(false);
  });
});
