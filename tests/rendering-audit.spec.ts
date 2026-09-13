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

test.describe('Rendering audit regressions', () => {
  for (const scriptsEnabled of [true, false]) {
    test(`HTML capture cannot execute document scripts in the parent origin (preview scripts ${scriptsEnabled ? 'enabled' : 'disabled'})`, async ({ page }) => {
      await openDocument(page, 'page.html', `<!doctype html><html><body>
        <h1>Sandbox capture</h1>
        <script>
          const generated = document.createElement('p');
          generated.id = 'dynamic-content';
          generated.textContent = 'Generated inside opaque preview';
          document.body.appendChild(generated);
          try { parent.document.body.dataset.captureSandboxViolation = 'true'; } catch {}
        </script>
      </body></html>`);
      await expect(page.frameLocator('.html-preview-frame').locator('h1')).toHaveText('Sandbox capture');
      if (!scriptsEnabled) await page.locator('.html-scripts-toggle').click();
      await expect(page.locator('body')).not.toHaveAttribute('data-capture-sandbox-violation');
      await page.evaluate(() => {
        document.addEventListener('load', (event) => {
          const frame = event.target;
          if (!(frame instanceof HTMLIFrameElement) || !frame.classList.contains('html-capture-temp-frame')) return;
          document.body.dataset.captureHasDynamicContent = String(!!frame.contentDocument?.querySelector('#dynamic-content'));
          document.body.dataset.captureAllowsScripts = String(frame.sandbox.contains('allow-scripts'));
        }, true);
      });

      const download = page.waitForEvent('download');
      await page.locator('.html-screenshot-btn').click();
      expect((await download).suggestedFilename()).toMatch(/\.png$/);
      await expect(page.locator('body')).not.toHaveAttribute('data-capture-sandbox-violation');
      await expect(page.locator('body')).toHaveAttribute('data-capture-has-dynamic-content', String(scriptsEnabled));
      await expect(page.locator('body')).toHaveAttribute('data-capture-allows-scripts', 'false');
      await expect(page.locator('.html-capture-temp-frame')).toHaveCount(0);
    });
  }

  test('HTML capture preserves script-rendered canvas pixels without replaying scripts', async ({ page }) => {
    await openDocument(page, 'canvas.html', `<!doctype html><html><body>
      <canvas id="chart" width="40" height="30"></canvas>
      <script>
        const chart = document.getElementById('chart');
        const context = chart.getContext('2d');
        context.fillStyle = 'rgb(255, 0, 0)';
        context.fillRect(0, 0, 40, 30);
      </script>
    </body></html>`);
    await expect(page.frameLocator('.html-preview-frame').locator('#chart')).toBeVisible();
    await page.evaluate(() => {
      document.addEventListener('load', (event) => {
        const frame = event.target;
        if (!(frame instanceof HTMLIFrameElement) || !frame.classList.contains('html-capture-temp-frame')) return;
        const image = frame.contentDocument?.querySelector('#chart');
        if (!image || image.tagName !== 'IMG') return;
        const sample = document.createElement('canvas');
        sample.width = 1;
        sample.height = 1;
        const context = sample.getContext('2d')!;
        context.drawImage(image as HTMLImageElement, 0, 0);
        document.body.dataset.captureCanvasPixel = Array.from(context.getImageData(0, 0, 1, 1).data).join(',');
      }, true);
    });
    const download = page.waitForEvent('download');
    await page.locator('.html-screenshot-btn').click();
    await download;
    await expect(page.locator('body')).toHaveAttribute('data-capture-canvas-pixel', '255,0,0,255');
  });

  test('HTML preview preserves URL encoding for local images and styles', async ({ page }) => {
    const paths: string[] = [];
    await page.route('**/api/raw/**', async (route) => {
      paths.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
      });
    });
    await openDocument(page, 'html-assets/relative.html', `<!doctype html><html><body>
      <img id="encoded" src="image%20name.svg">
      <img id="literal-percent" src="100%25.svg">
      <div id="css" style="background-image: url('image%20name.svg')">CSS</div>
      <div id="css-quote" style="background-image: url('image%27name.svg')">Quoted filename</div>
    </body></html>`);
    const frame = page.frameLocator('.html-preview-frame');
    await expect(frame.locator('#encoded')).toHaveAttribute('src', '/api/raw/html-assets/image%20name.svg');
    await expect(frame.locator('#literal-percent')).toHaveAttribute('src', '/api/raw/html-assets/100%25.svg');
    await expect(frame.locator('#css')).toHaveCSS('background-image', /\/api\/raw\/html-assets\/image%20name\.svg/);
    await expect(frame.locator('#css-quote')).toHaveCSS('background-image', /\/api\/raw\/html-assets\/image%27name\.svg/);
    await expect.poll(() => paths).toContain('/api/raw/html-assets/image%20name.svg');
  });

  test('Marp accepts a root boolean directive with a YAML comment', async ({ page }) => {
    await openDocument(page, 'marp-deck.md', '---\nmarp: true # present this deck\n---\n\n# Commented directive\n');
    await expect(page.locator('#viewer h1')).toContainText('Commented directive');
    await expect(page.locator('#btn-slides')).toBeVisible();
  });

  test('Marp does not treat a nested field or block scalar as its global directive', async ({ page }) => {
    await openDocument(page, 'marp-deck.md', '---\nmetadata:\n  marp: true\ndescription: |\n  marp: true\n---\n\n# Ordinary markdown\n');
    await expect(page.locator('#viewer h1')).toContainText('Ordinary markdown');
    await expect(page.locator('#btn-slides')).toBeHidden();
  });

  test('wiki links add the Markdown extension before fragments and inspect the filename', async ({ page }) => {
    await openDocument(page, 'README.md', '# Wiki links\n\n[[Target#details]]\n\n[[folder.with.dots/Target]]\n\n[[#details]]\n');
    const links = page.locator('#viewer .wiki-link');
    await expect(links.nth(0)).toHaveAttribute('href', 'Target.md#details');
    await expect(links.nth(1)).toHaveAttribute('href', 'folder.with.dots/Target.md');
    await expect(links.nth(2)).toHaveAttribute('href', '#details');
  });

  test('invalid Mermaid retains its source without leaving an error diagram outside the viewer', async ({ page }) => {
    await openDocument(page, 'README.md', '# Broken diagram\n\n```mermaid\nflowchart TD\nA --> [\n```\n');
    await expect(page.locator('#viewer pre.mermaid-error')).toContainText('A --> [');
    await expect(page.locator('body > div[id^="dmermaid-"]')).toHaveCount(0);
  });
});
