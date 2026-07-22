import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const FIXTURE = 'qiita-markdown.md';
const MERMAID_FIXTURE = 'qiita-mermaid.md';

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
**TL;DR（本記事の要約）**

- **導入の目的:** 過剰な通知からユーザーを保護し、Web Pushを有用な機能として維持するための仕組み。

- **判定の仕組み:** 「サイト滞在時間あたりのPush送信数」「権限プロンプト表示数」「Site Engagement Scoreと滞在時間」を毎日計算。過剰なサイトを「disruptive」と判定（初期方式）。

- **レート制限値:** 制限値は**毎分1,000件を下回らない値**（下限値）。超えた場合は**HTTP 429 Too Many Requests**を返却。

- **ペナルティ期間:** 判定回数に応じて**1日 → 7日 → 14日**と段階的に延長。42日間連続で非disruptive状態を維持するとリセット。

- **対象範囲: Push APIのみ**（サイトを開いている間のNotifications APIによる通知表示は引き続き利用可能）。ほぼすべてのWebサイトは影響を受けないとされています。
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
const longLine = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
\`\`\`

## Section heading

### Subsection heading

Paragraph with [an external link](https://example.com) and \`inline code\`.

> Quoted text.

| Name | Description |
| --- | --- |
| Qiita | A deliberately long table cell that verifies the table remains independently scrollable. |

:::details More information
Hidden details.
:::

---

Footnote reference.[^1]

[^1]: Footnote content.
`);
  writeFileSync('/tmp/md-test-docs/' + MERMAID_FIXTURE, `# Mermaid

\`\`\`mermaid
flowchart TD
  A[Web通知の組み合わせ] --> B[Push API<br/>メッセージのバックグラウンド受信]
  A --> C[Notifications API<br/>画面への通知表示]
  B -->|サーバーからの配信時| D[★ 今回のレート制限対象]
  C -->|サイト開いている間| E[引き続き利用可能]
\`\`\`
`);
});

async function openWithTheme(page: import('@playwright/test').Page, theme: 'light' | 'qiita', fixture = FIXTURE) {
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem('md-viewer-theme', selectedTheme);
  }, theme);
  await page.goto('/#file=' + fixture);
  const heading = fixture === FIXTURE ? 'Qiita Markdown' : 'Mermaid';
  await expect(page.locator('#viewer .markdown-body h1')).toContainText(heading);
}

test.describe('Qiita Markdown syntax', () => {
  test('renders Qiita notes and filename fences only with the Qiita theme', async ({ page }) => {
    await openWithTheme(page, 'qiita');

    await expect(page.locator('.custom-block.info').nth(0)).toContainText('Informational note.');
    await expect(page.locator('.custom-block.info').nth(1)).toContainText('Default informational note.');
    await expect(page.locator('.custom-block.warning')).toContainText('Warning note.');
    const danger = page.locator('.custom-block.danger');
    await expect(danger).toContainText('TL;DR（本記事の要約）');
    const dangerMetrics = await danger.evaluate((element) => {
      const block = getComputedStyle(element);
      const title = element.querySelector('.custom-block-title')!;
      const icon = getComputedStyle(title, '::before');
      const itemParagraph = getComputedStyle(element.querySelector('li p')!);
      return {
        height: element.getBoundingClientRect().height,
        iconBackground: icon.backgroundColor,
        iconColor: icon.color,
        iconTop: getComputedStyle(title).top,
        itemMargin: `${itemParagraph.marginTop} ${itemParagraph.marginBottom}`,
        leadMargin: getComputedStyle(element.querySelector('.custom-block-title + *')!).marginTop,
        paddingLeft: block.paddingLeft,
        whiteSpace: getComputedStyle(element).whiteSpace,
      };
    });
    expect(dangerMetrics.whiteSpace).toBe('normal');
    expect(dangerMetrics.leadMargin).toBe('0px');
    expect(dangerMetrics.itemMargin).toBe('0px 0px');
    expect(dangerMetrics.paddingLeft).toBe('44px');
    expect(dangerMetrics.iconTop).toBe('21px');
    expect(dangerMetrics.iconBackground).toBe('rgb(172, 43, 22)');
    expect(dangerMetrics.iconColor).toBe('rgb(255, 255, 255)');
    expect(dangerMetrics.height).toBeGreaterThan(400);
    expect(dangerMetrics.height).toBeLessThan(450);
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

    const lightSurface = await page.locator('#viewer .markdown-body').evaluate((element) => {
      const style = getComputedStyle(element);
      return { maxWidth: style.maxWidth, paddingTop: style.paddingTop };
    });
    expect(lightSurface).toEqual({ maxWidth: 'none', paddingTop: '0px' });
  });

  test('matches the Qiita article surface on desktop', async ({ page }) => {
    await openWithTheme(page, 'qiita');

    const surface = await page.locator('#viewer .markdown-body').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        maxWidth: style.maxWidth,
        padding: `${style.paddingTop} ${style.paddingRight}`,
      };
    });
    expect(surface).toEqual({
      background: 'rgb(255, 255, 255)',
      borderRadius: '8px',
      fontSize: '17px',
      lineHeight: '28.9px',
      maxWidth: '820px',
      padding: '32px 56px',
    });
    await expect(page.locator('.markdown-body h1')).toHaveCSS('margin-top', '0px');
    await expect(page.locator('#viewer')).toHaveCSS('background-color', 'rgb(245, 246, 246)');

    const h2 = await page.locator('.markdown-body h2').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        border: `${style.borderBottomWidth} ${style.borderBottomStyle}`,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        margin: `${style.marginTop} ${style.marginBottom}`,
      };
    });
    expect(h2).toEqual({ border: '1px solid', fontSize: '26.01px', lineHeight: '36.414px', margin: '56px 16px' });

    const h3 = await page.locator('.markdown-body h3').evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, margin: `${style.marginTop} ${style.marginBottom}` };
    });
    expect(h3).toEqual({ fontSize: '21.93px', lineHeight: '35.088px', margin: '0px 16px' });

    const link = await page.locator('.markdown-body a', { hasText: 'an external link' }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, decoration: style.textDecorationLine, offset: style.textUnderlineOffset };
    });
    expect(link).toEqual({ color: 'rgb(53, 122, 0)', decoration: 'underline', offset: '8px' });

    const namedFence = page.locator('.code-block', { has: page.locator('.code-filename', { hasText: 'app.ts' }) });
    const codeBlock = await namedFence.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderRadius: style.borderRadius, padding: `${style.paddingTop} ${style.paddingRight}` };
    });
    expect(codeBlock).toEqual({ background: 'rgb(29, 32, 32)', borderRadius: '8px', padding: '8px 16px' });
    await expect(namedFence.locator('.code-filename')).toHaveCSS('background-color', 'rgb(94, 96, 96)');

    const quote = await page.locator('.markdown-body blockquote').evaluate((element) => {
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, '::before');
      return {
        background: style.backgroundColor,
        fontStyle: style.fontStyle,
        margin: `${style.marginTop} ${style.marginBottom}`,
        padding: `${style.paddingTop} ${style.paddingRight}`,
        ruleWidth: before.width,
      };
    });
    expect(quote).toEqual({ background: 'rgba(0, 0, 0, 0)', fontStyle: 'normal', margin: '24px 24px', padding: '8px 16px', ruleWidth: '4px' });

    await expect(page.locator('.custom-block.info').first()).toHaveCSS('background-color', 'rgb(223, 244, 207)');
    await expect(page.locator('.custom-block.warning')).toHaveCSS('background-color', 'rgb(255, 240, 179)');
    await expect(page.locator('.custom-block.danger')).toHaveCSS('background-color', 'rgb(255, 219, 219)');
    await expect(page.locator('.markdown-body table')).toHaveCSS('overflow-x', 'auto');

    const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasPageOverflow).toBe(false);
  });

  test('uses Mermaid default styling with the Qiita theme', async ({ page }) => {
    test.slow();
    await openWithTheme(page, 'qiita', MERMAID_FIXTURE);
    await page.waitForSelector('.mermaid-rendered svg');

    const diagram = page.locator('.mermaid-rendered').first();
    const styles = await diagram.evaluate((element) => {
      const node = element.querySelector<SVGGraphicsElement>('.node rect')!;
      const edge = element.querySelector<SVGGraphicsElement>('.flowchart-link')!;
      const label = element.querySelector<HTMLElement>('.edgeLabel')!;
      return {
        background: getComputedStyle(element).backgroundColor,
        border: getComputedStyle(element).borderTopWidth,
        shadow: getComputedStyle(element).boxShadow,
        nodeFill: getComputedStyle(node).fill,
        nodeStroke: getComputedStyle(node).stroke,
        nodeRadius: getComputedStyle(node).rx,
        edgeStroke: getComputedStyle(edge).stroke,
        labelBackground: getComputedStyle(label).backgroundColor,
      };
    });

    expect(styles).toEqual({
      background: 'rgb(255, 255, 255)',
      border: '0px',
      shadow: 'none',
      nodeFill: 'rgb(236, 236, 255)',
      nodeStroke: 'rgb(147, 112, 219)',
      nodeRadius: '0px',
      edgeStroke: 'rgb(51, 51, 51)',
      labelBackground: 'rgba(232, 232, 232, 0.8)',
    });
  });

  test('keeps the Qiita Source view readable', async ({ page }) => {
    await openWithTheme(page, 'qiita');
    await page.locator('#viewer .json-toggle-btn[data-view="source"]').click();

    await expect(page.locator('#viewer .json-view-tree')).toBeHidden();
    await expect(page.locator('#viewer .json-view-source')).toBeVisible();

    const source = await page.locator('#viewer .json-view-source').evaluate((element) => {
      const wrapper = getComputedStyle(element);
      const pre = getComputedStyle(element.querySelector('pre')!);
      const code = getComputedStyle(element.querySelector('code')!);
      return {
        wrapperBackground: wrapper.backgroundColor,
        wrapperMaxWidth: wrapper.maxWidth,
        preBackground: pre.backgroundColor,
        codeColor: code.color,
      };
    });
    expect(source).toEqual({
      wrapperBackground: 'rgb(255, 255, 255)',
      wrapperMaxWidth: '820px',
      preBackground: 'rgb(29, 32, 32)',
      codeColor: 'rgb(227, 227, 227)',
    });
  });

  test('uses the Qiita mobile card and preserves text scaling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('docview.fontSize', '150'));
    await openWithTheme(page, 'qiita');

    const surface = await page.locator('#viewer .markdown-body').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        padding: `${style.paddingTop} ${style.paddingRight}`,
      };
    });
    expect(surface).toEqual({ borderRadius: '0px', fontSize: '24px', padding: '24px 16px' });

    const longCodeScrollsLocally = await page.locator('.code-block', { hasText: 'const longLine' }).locator('pre').evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(longCodeScrollsLocally).toBe(true);

    await page.locator('#viewer .json-toggle-btn[data-view="source"]').click({ force: true });
    const mobileSource = await page.locator('#viewer .json-view-source').evaluate((element) => {
      const wrapper = getComputedStyle(element);
      const pre = getComputedStyle(element.querySelector('pre')!);
      return { padding: `${wrapper.paddingTop} ${wrapper.paddingRight}`, preBackground: pre.backgroundColor };
    });
    expect(mobileSource).toEqual({ padding: '24px 16px', preBackground: 'rgb(29, 32, 32)' });

    const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasPageOverflow).toBe(false);
  });
});
