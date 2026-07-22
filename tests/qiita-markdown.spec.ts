import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const FIXTURE = 'qiita-markdown.md';

test.beforeAll(() => {
  writeFileSync('/tmp/md-test-docs/' + FIXTURE, `# Qiita Markdown

:::note info
Informational **note**.
:::

:::note
Default informational note.
:::

:::note warn
Warning note.
:::

:::note alert
Danger note.
:::

\`\`\`typescript:app.ts
const message: string = "hello";
\`\`\`

\`\`\`typescript:<img/src=x/onerror=alert(1)>.ts
const safe: boolean = true;
\`\`\`

\`\`\`markdown
:::note alert
This stays inside the fence.
:::
\`\`\`

\`\`\`typescript
const ordinary: number = 42;
\`\`\`
`);
});

async function openWithTheme(page: import('@playwright/test').Page, theme: 'light' | 'qiita') {
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem('md-viewer-theme', selectedTheme);
  }, theme);
  await page.goto('/#file=' + FIXTURE);
  await expect(page.locator('#viewer .markdown-body h1')).toContainText('Qiita Markdown');
}

test.describe('Qiita Markdown syntax', () => {
  test('renders Qiita notes and filename fences only with the Qiita theme', async ({ page }) => {
    await openWithTheme(page, 'qiita');

    await expect(page.locator('.custom-block.info').nth(0)).toContainText('Informational note.');
    await expect(page.locator('.custom-block.info').nth(1)).toContainText('Default informational note.');
    await expect(page.locator('.custom-block.warning')).toContainText('Warning note.');
    await expect(page.locator('.custom-block.danger')).toContainText('Danger note.');
    await expect(page.locator('.custom-block:not(.details)')).toHaveCount(4);

    const namedFence = page.locator('.code-block', { has: page.locator('.code-filename', { hasText: 'app.ts' }) });
    await expect(namedFence.locator('.code-filename')).toHaveText('app.ts');
    await expect(namedFence.locator('code .hljs-keyword')).toContainText('const');

    const escapedFilename = page.locator('.code-filename', { hasText: '<img/src=x/onerror=alert(1)>.ts' });
    await expect(escapedFilename).toHaveText('<img/src=x/onerror=alert(1)>.ts');
    await expect(page.locator('.code-block img')).toHaveCount(0);

    const markdownFence = page.locator('.code-block', { hasText: 'This stays inside the fence.' });
    await expect(markdownFence).toContainText(':::note alert');

    const ordinaryFence = page.locator('.code-block', { hasText: 'const ordinary' });
    await expect(ordinaryFence.locator('code .hljs-keyword').first()).toContainText('const');
  });

  test('keeps Qiita-specific syntax literal with the light theme', async ({ page }) => {
    await openWithTheme(page, 'light');

    await expect(page.locator('.custom-block:not(.details)')).toHaveCount(0);
    await expect(page.locator('#viewer .json-view-tree.markdown-body')).toContainText(':::note info');
    await expect(page.locator('.code-filename')).toHaveCount(0);
    await expect(page.locator('.code-lang', { hasText: 'typescript:app.ts' })).toHaveCount(1);
    await expect(page.locator('.code-block', { hasText: 'const message' })).toContainText('const message');
    await expect(page.locator('.code-block', { hasText: 'const ordinary' }).locator('code .hljs-keyword').first()).toContainText('const');
  });
});
