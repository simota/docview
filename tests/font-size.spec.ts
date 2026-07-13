import { expect, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'docview.fontSize';

async function resetFontSize(page: Page) {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#btn-font-size')).toBeVisible();
}

async function setSlider(page: Page, value: number) {
  await page.locator('#font-size-slider').evaluate((element, next) => {
    const slider = element as HTMLInputElement;
    slider.value = String(next);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await expect(page.locator('#font-size-output')).toHaveText(`${value}%`);
}

async function computedFontSize(page: Page, selector = '#viewer') {
  return page.locator(selector).evaluate((element) => getComputedStyle(element).fontSize);
}

test.beforeEach(async ({ page }) => {
  await resetFontSize(page);
});

test('defaults to 100% and preserves the 15.5px desktop baseline', async ({ page }) => {
  await expect(page.locator('#font-size-output')).toHaveText('100%');
  await expect(page.locator('#btn-font-size')).toHaveAttribute('aria-label', 'Text size: 100%');
  expect(await computedFontSize(page)).toBe('15.5px');
});

test('keeps the 14.5px mobile baseline and controls inside a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await computedFontSize(page)).toBe('14.5px');

  await page.locator('#btn-font-size').click();
  await setSlider(page, 200);
  await expect(page.locator('#font-size-output')).toHaveText('200%');
  const bounds = await page.evaluate(() => {
    const trigger = document.querySelector('#btn-font-size')!.getBoundingClientRect();
    const popover = document.querySelector('#font-size-popover')!.getBoundingClientRect();
    return {
      trigger: { left: trigger.left, right: trigger.right },
      popover: { left: popover.left, right: popover.right },
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(bounds.trigger.left).toBeGreaterThanOrEqual(0);
  expect(bounds.trigger.right).toBeLessThanOrEqual(bounds.viewport);
  expect(bounds.popover.left).toBeGreaterThanOrEqual(0);
  expect(bounds.popover.right).toBeLessThanOrEqual(bounds.viewport);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewport);

  const reset = page.locator('#btn-font-size-reset');
  await expect(reset).toBeVisible();
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.locator('#font-size-output')).toHaveText('100%');
  expect(await computedFontSize(page)).toBe('14.5px');
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('100');
});

test('enforces 50..200 in steps of 10 and keeps Reset reachable at 200%', async ({ page }) => {
  const slider = page.locator('#font-size-slider');
  await expect(slider).toHaveAttribute('min', '50');
  await expect(slider).toHaveAttribute('max', '200');
  await expect(slider).toHaveAttribute('step', '10');

  await page.locator('#btn-font-size').click();
  await page.locator('#btn-font-size-decrease').click();
  await expect(page.locator('#font-size-output')).toHaveText('90%');
  await page.locator('#btn-font-size-increase').click();
  await expect(page.locator('#font-size-output')).toHaveText('100%');
  await setSlider(page, 50);
  await expect(page.locator('#btn-font-size-decrease')).toBeDisabled();
  await setSlider(page, 200);
  await expect(page.locator('#btn-font-size-increase')).toBeDisabled();
  await page.locator('#btn-font-size-reset').click();
  await expect(page.locator('#font-size-output')).toHaveText('100%');
});

test('persists a valid value and rejects malformed stored values canonically', async ({ page }) => {
  await setSlider(page, 130);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('130');
  await page.reload();
  await expect(page.locator('#font-size-output')).toHaveText('130%');

  for (const invalid of [' 100 ', '0100', '100px', '105', '49', '210', '', 'NaN']) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, invalid]);
    await page.reload();
    await expect(page.locator('#font-size-output')).toHaveText('100%');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  }
});

test('synchronizes existing and newly created split viewers', async ({ page }) => {
  await page.locator('.filetree-item[data-path="README.md"]').click();
  await expect(page.locator('#viewer h1')).toContainText('Hello DocView');
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#viewer-right')).toBeVisible();

  await setSlider(page, 140);
  const existing = await Promise.all([
    computedFontSize(page),
    computedFontSize(page, '#viewer-right'),
  ]);
  expect(existing[0]).toBe(existing[1]);

  await page.keyboard.press('Control+\\');
  await expect(page.locator('#viewer-right')).toHaveCount(0);
  await setSlider(page, 130);
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#viewer-right')).toBeVisible();
  const created = await Promise.all([
    computedFontSize(page),
    computedFontSize(page, '#viewer-right'),
  ]);
  expect(created[0]).toBe(created[1]);
  expect(created[0]).not.toBe('15.5px');
});

test('keeps keyboard shortcuts, UI, CSS, and storage on the same state path', async ({ page }) => {
  await page.keyboard.press('Control+=');
  await expect(page.locator('#font-size-output')).toHaveText('110%');
  await expect(page.locator('#workspace')).toHaveCSS('--docview-font-scale', '1.1');
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('110');

  await page.keyboard.press('Control+-');
  await expect(page.locator('#font-size-output')).toHaveText('100%');
  await setSlider(page, 150);
  await page.keyboard.press('Control+0');
  await expect(page.locator('#font-size-output')).toHaveText('100%');
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('100');
});

test('does not consume text-size shortcuts from editable controls', async ({ page }) => {
  await page.evaluate(() => {
    for (const [tag, id] of [['input', 'guard-input'], ['textarea', 'guard-textarea'], ['select', 'guard-select']]) {
      const control = document.createElement(tag);
      control.id = id;
      if (control instanceof HTMLSelectElement) control.append(new Option('Option'));
      document.body.append(control);
    }
    const editable = document.createElement('div');
    editable.id = 'guard-contenteditable';
    editable.contentEditable = 'true';
    editable.tabIndex = 0;
    document.body.append(editable);
  });
  await setSlider(page, 130);
  await page.locator('#btn-font-size').click();

  for (const selector of ['#guard-input', '#guard-textarea', '#guard-select', '#guard-contenteditable', '#font-size-slider']) {
    await page.locator(selector).focus();
    for (const shortcut of ['Control+=', 'Control+-', 'Control+0']) await page.keyboard.press(shortcut);
    await expect(page.locator('#font-size-output')).toHaveText('130%');
  }
});

test('exposes dialog semantics, announces changes, and restores focus on Escape', async ({ page }) => {
  const trigger = page.locator('#btn-font-size');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-controls', 'font-size-popover');
  await trigger.click();

  await expect(page.getByRole('dialog', { name: 'Text size' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Text size' })).toBeFocused();
  const liveStatus = page.locator('#font-size-status');
  await expect(liveStatus).toHaveAttribute('aria-live', 'polite');
  await expect(liveStatus).toContainText('100%');
  await setSlider(page, 120);
  await expect(page.locator('#font-size-slider')).toHaveAttribute('aria-valuetext', '120%');
  await expect(liveStatus).toContainText('100%');
  await page.locator('#btn-font-size-increase').click();
  await expect(liveStatus).toContainText('130%');
  await page.keyboard.press('Escape');
  await expect(page.locator('#font-size-popover')).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator('#workspace').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#font-size-popover')).toBeHidden();
});

test('keeps Text size and Theme popovers mutually exclusive without losing size', async ({ page }) => {
  const fontPopover = page.locator('#font-size-popover');
  const themeMenu = page.locator('#theme-menu');
  await page.locator('#btn-font-size').click();
  await expect(fontPopover).toBeVisible();
  await page.locator('#btn-theme').click();
  await expect(fontPopover).toBeHidden();
  await expect(themeMenu).toBeVisible();
  await page.locator('#btn-font-size').click();
  await expect(themeMenu).toBeHidden();

  await setSlider(page, 130);
  await page.locator('#btn-theme').click();
  await themeMenu.locator('[data-theme-value="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#font-size-output')).toHaveText('130%');
  await expect(page.locator('#workspace')).toHaveCSS('--docview-font-scale', '1.3');
});

test('continues rendering when font-size storage get, remove, or set throws', async ({ page }) => {
  await page.addInitScript((key) => {
    const mode = new URLSearchParams(location.search).get('storageFault');
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (candidate) {
      if (candidate === key && mode === 'get') throw new DOMException('blocked', 'SecurityError');
      if (candidate === key && mode === 'remove') return 'invalid';
      return getItem.call(this, candidate);
    };
    Storage.prototype.setItem = function (candidate, value) {
      if (candidate === key && mode === 'set') throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, candidate, value);
    };
    Storage.prototype.removeItem = function (candidate) {
      if (candidate === key && mode === 'remove') throw new DOMException('blocked', 'SecurityError');
      return removeItem.call(this, candidate);
    };
  }, STORAGE_KEY);

  for (const mode of ['get', 'remove']) {
    await page.goto(`/?storageFault=${mode}`);
    await expect(page.locator('#font-size-output')).toHaveText('100%');
    await expect(page.locator('#viewer')).toBeVisible();
  }
  await page.goto('/?storageFault=set');
  await page.locator('#btn-font-size').click();
  await page.locator('#btn-font-size-increase').click();
  await expect(page.locator('#font-size-output')).toHaveText('110%');
});
