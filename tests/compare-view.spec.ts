import { expect, type Page, test } from '@playwright/test';

async function openCompareView(page: Page, leftPath: string, rightPath: string) {
  await page.goto('/');
  await page.waitForSelector('.filetree-item[data-path]');

  await page.locator(`.filetree-item[data-path="${leftPath}"]`).click();
  await page.waitForSelector('#viewer h1, #viewer .line-row, #viewer .csv-table, #viewer .json-tree, #viewer .data-view');

  await page.keyboard.press('Meta+\\');
  await expect(page.locator('#workspace')).toHaveClass(/split-view/);
  await expect(page.locator('#viewer-pane-right')).toBeVisible();

  if (rightPath !== leftPath) {
    await page.locator('#viewer-pane-right').click();
    await page.locator(`.filetree-item[data-path="${rightPath}"]`).click();
    await page.waitForSelector('#viewer-pane-right h1, #viewer-pane-right .line-row, #viewer-pane-right .csv-table, #viewer-pane-right .json-tree, #viewer-pane-right .data-view');
  }
}

async function setLeftScrollTop(page: Page, top: number) {
  await page.locator('#viewer').evaluate((el, value) => {
    (el as HTMLElement).scrollTop = value as number;
  }, top);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function getRightScrollTop(page: Page) {
  return page.locator('#viewer-right').evaluate((el) => (el as HTMLElement).scrollTop);
}

async function getProgressWidth(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => (el as HTMLElement).style.width);
}

async function setRightScrollTop(page: Page, top: number) {
  await page.locator('#viewer-right').evaluate((el, value) => {
    (el as HTMLElement).scrollTop = value as number;
  }, top);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test.describe('Compare view', () => {
  test('pins different files on the left and right panes', async ({ page }) => {
    await openCompareView(page, 'README.md', 'slides.md');

    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
    await expect(page.locator('#viewer-pane-right')).toContainText('Slide 1');
  });

  test('keeps an independent tab stack for the right pane', async ({ page }) => {
    await openCompareView(page, 'README.md', 'app.log');

    await page.locator(`.filetree-item[data-path="slides.md"]`).click();

    const rightTabs = page.locator('#tab-bar-right .tab-item');
    await expect(rightTabs).toHaveCount(3);
    await expect(page.locator('#tab-bar-right .tab-item.active')).toContainText('slides.md');
    await expect(page.locator('#viewer-pane-right')).toContainText('Slide 1');

    await page.locator('#tab-bar-right .tab-item', { hasText: 'app.log' }).click();
    await expect(page.locator('#tab-bar-right .tab-item.active')).toContainText('app.log');
    await expect(page.locator('#viewer-pane-right .line-row[data-line="25"]')).toBeVisible();
    await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  });

  test('toggles sync scroll in compare mode', async ({ page }) => {
    await openCompareView(page, 'settings.ini', 'app.log');

    const syncToggle = page.getByRole('button', { name: /sync scroll/i })
      .or(page.getByRole('switch', { name: /sync scroll/i }))
      .or(page.getByLabel(/sync scroll/i));
    await expect(syncToggle).toBeVisible();

    await syncToggle.click();
    await setLeftScrollTop(page, 220);
    const firstRightTop = await getRightScrollTop(page);

    await syncToggle.click();
    await page.evaluate(() => {
      const left = document.querySelector<HTMLElement>('#viewer');
      const right = document.querySelector<HTMLElement>('#viewer-right');
      if (left) left.scrollTop = 0;
      if (right) right.scrollTop = 0;
    });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await setLeftScrollTop(page, 220);
    const secondRightTop = await getRightScrollTop(page);

    expect(firstRightTop > 0).not.toBe(secondRightTop > 0);
  });

  test('tracks scroll progress independently for each pane', async ({ page }) => {
    await openCompareView(page, 'settings.ini', 'app.log');

    const syncToggle = page.getByRole('button', { name: /sync scroll/i });
    await expect(syncToggle).toHaveAttribute('aria-pressed', 'true');
    await syncToggle.click();
    await expect(syncToggle).toHaveAttribute('aria-pressed', 'false');

    await expect(page.locator('#progress-bar-right')).toHaveCount(1);

    await setLeftScrollTop(page, 220);
    expect(await getProgressWidth(page, '#progress-bar')).not.toBe('0%');
    expect(await getProgressWidth(page, '#progress-bar-right')).toBe('0%');

    await setRightScrollTop(page, 220);
    expect(await getProgressWidth(page, '#progress-bar-right')).not.toBe('0%');
  });

  test('search still opens files while compare view is active', async ({ page }) => {
    await openCompareView(page, 'settings.ini', 'app.log');

    await page.keyboard.press('Meta+p');
    await expect(page.locator('.search-overlay')).toBeVisible();

    await page.locator('.search-input').fill('README.md');
    const activeResult = page.locator('.search-item.active');
    await expect(activeResult).toContainText('README.md');
    await activeResult.click();

    await expect(page.locator('#viewer-pane-right .compare-pane-path')).toContainText('README.md');
    await expect(page.locator('#tab-bar-right .tab-item.active')).toContainText('README.md');
    await expect(page.locator('#viewer .line-row[data-line="25"]')).toBeVisible();
  });

  test('line jump still highlights the requested line in compare view', async ({ page }) => {
    await openCompareView(page, 'settings.ini', 'app.log');

    await page.evaluate(() => {
      location.hash = '#file=settings.ini&line=25';
    });

    await expect(page.locator('#viewer .line-row[data-line="25"]')).toHaveClass(/line-highlighted/);
    await expect(page.locator('#viewer-pane-right .line-row[data-line="25"]')).toBeVisible();
  });
});
