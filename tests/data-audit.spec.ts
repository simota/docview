import { test, expect, type Page } from '@playwright/test';
import { renderCsvTable, maskCsvSecrets } from '../src/csv-viewer';
import { renderJsonlTable } from '../src/jsonl-viewer';
import { renderJsonTree } from '../src/json-tree';
import { renderYamlTree, maskYamlSecrets } from '../src/yaml-tree';
import { renderCronTable } from '../src/cron-viewer';
import { renderLogTable } from '../src/log-viewer';
import { maskSecrets, maskSecretValue, isLikelySecretKey } from '../src/secret-mask';
import { writeFileSync, rmSync } from 'node:fs';
import Papa from 'papaparse';

async function mockChunk(page: Page, path: string, content: string, totalLines = 2001) {
  await page.route('**/api/file/meta?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('path') !== path) return route.continue();
    await route.fulfill({ json: { size: 6 * 1024 * 1024, lines: totalLines, mtime: '2026-01-01' } });
  });
  await page.route('**/api/file?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('path') !== path) return route.continue();
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    const body = content.split('\n').slice(offset, offset + limit).join('\n');
    await route.fulfill({ body, headers: { 'X-Total-Lines': String(totalLines) } });
  });
}

test.describe('Structured data audit regressions', () => {
  test('CSV preserves identifiers and timestamps and escapes an empty-file path', async ({ page }) => {
    await page.setContent(renderCsvTable('id,time,score\n00123,2026-03-01T12:00:00Z,1e3\n', 'audit.csv'));
    await expect(page.locator('tbody td')).toHaveText(['1', '00123', '2026-03-01T12:00:00Z', '1e3']);
    await page.setContent(renderCsvTable('', '<img src=x onerror="window.injected=true">'));
    await expect(page.locator('img')).toHaveCount(0);
    await expect(page.locator('.error-banner')).toContainText('<img');
  });

  test('CSV still sorts preserved numeric text with blanks and scientific notation', async ({ page }) => {
    await page.route('**/api/file?**', (route) => {
      if (new URL(route.request().url()).searchParams.get('path') !== 'audit.csv') return route.continue();
      return route.fulfill({ body: 'name,score\na,10\nb,2\nc,\nd,1e3\ne,.5\n' });
    });
    await page.goto('/#file=audit.csv');
    await page.locator('th[data-col="score"]').click();
    await expect(page.locator('tbody tr td:nth-child(3)')).toHaveText(['.5', '2', '10', '1e3', '']);
  });

  test('JSONL retains source lines and never reads inherited properties', async ({ page }) => {
    await page.setContent(renderJsonlTable('\n{"toString":"own"}\ninvalid\n\n{"value":2}\n', 'audit.jsonl'));
    await expect(page.locator('.csv-row-num')).toHaveText(['2', '5']);
    await expect(page.locator('.csv-info--warn')).toContainText('invalid line(s): 3');
    await expect(page.locator('tbody tr').last().locator('td').nth(1)).toHaveText('');
    await expect(page.locator('.csv-row-jump-input')).toHaveAttribute('max', '5');
  });

  test('JSON and YAML keep empty keys and safely render recursive YAML aliases', async ({ page }) => {
    await page.setContent(renderJsonTree('{"":"present"}'));
    await expect(page.locator('.jt-key')).toHaveCount(1);
    await page.setContent(renderYamlTree('root: &root\n  self: *root\n  label: hello\n'));
    await expect(page.locator('.json-tree')).toContainText('[Circular reference]');
    await expect(page.locator('.json-tree')).toContainText('hello');
  });

  test('secret masking consumes complete quoted values, short values and nested values', () => {
    expect(maskSecrets('password="two secret words" visible=ok')).toBe('password="[REDACTED]" visible=ok');
    expect(maskSecrets('DB_PASSWORD=ab\napiKey=xy')).toBe('DB_PASSWORD=[REDACTED]\napiKey=[REDACTED]');
    expect(maskSecrets('password="a b"')).toBe('password="[REDACTED]"');
    expect(maskSecrets('Authorization: Bearer tiny-secret\nCookie: a=b; c=d')).toBe('Authorization: [REDACTED]\nCookie: [REDACTED]');
    expect(maskSecrets('{"clientSecret":"a\\\"b,c","public":"keep"}')).toBe('{"clientSecret":"[REDACTED]","public":"keep"}');
    expect(maskSecrets('{"token":["short",{"nested":"hidden"}],"public":1}')).not.toContain('hidden');
    expect(isLikelySecretKey('AWSAccessKey')).toBe(true);
    expect(isLikelySecretKey('tokenizer')).toBe(false);
  });

  test('masked source respects CSV headers and YAML block values', () => {
    expect(maskCsvSecrets('id,apiKey\n001,short-secret\n')).toBe('id,apiKey\n001,[REDACTED]\n');
    expect(maskYamlSecrets('token:\n  - short-secret\npublic: keep\n')).not.toContain('short-secret');
    expect(maskYamlSecrets('password: |\n  first secret\n  second secret\n')).not.toContain('second secret');
    expect(maskYamlSecrets('token: &s\n  value: hidden-secret\npublic: *s\n')).not.toContain('hidden-secret');
  });

  test('cron collision calculations use the displayed JST timezone and disclose the sample cap', () => {
    const html = renderCronTable('0 3 * * * echo one\n0 3 * * * echo two\n', 'audit.crontab');
    expect(html).toMatch(/class="cron-col-time">[^<]*03:00<\/span>/);
    expect(html).toContain('各ジョブ 1500 回まで');
  });

  test('server search masks complete short and quoted secrets in results and context', async ({ request }) => {
    const file = '/tmp/md-test-docs/audit-secrets.env';
    writeFileSync(file, 'AUDIT_PASSWORD=ab\nAUDIT_API_KEY="private, short value"\nAUDIT_AUTHORIZATION=Bearer tiny-secret\n');
    try {
      const response = await request.get('/api/search?q=AUDIT_&secretSafe=1');
      expect(response.ok()).toBe(true);
      const results = await response.json();
      expect(results).toHaveLength(3);
      const serialized = JSON.stringify(results);
      expect(serialized).toContain('[REDACTED]');
      expect(serialized).not.toContain('=ab');
      expect(serialized).not.toContain('private, short value');
      expect(serialized).not.toContain('tiny-secret');
    } finally {
      rmSync(file, { force: true });
    }
  });

  test('CSV search excludes the header from data matches', async ({ request }) => {
    const file = '/tmp/md-test-docs/audit-search.csv';
    writeFileSync(file, 'header-only,label\nrow-one,header-only\nrow-two,public\n');
    try {
      const response = await request.get('/api/file/search?path=audit-search.csv&q=header-only');
      expect(response.ok()).toBe(true);
      const data = await response.json();
      expect(data.headerLine).toBe('header-only,label');
      expect(data.totalMatches).toBe(1);
      expect(data.matches).toEqual([{ lineNum: 1, text: 'row-one,header-only' }]);
      const headerOnly = await request.get('/api/file/search?path=audit-search.csv&q=label');
      expect((await headerOnly.json()).totalMatches).toBe(0);
    } finally {
      rmSync(file, { force: true });
    }
  });

  test('CSV record ranges and searches preserve multiline quoted cells', async ({ request }) => {
    const file = '/tmp/md-test-docs/audit-multiline.csv';
    writeFileSync(file, 'id,description\n001,"first\ncontinued"\n002,"next record"\n');
    try {
      const response = await request.get('/api/file?path=audit-multiline.csv&records=1&offset=1&limit=1');
      expect(response.ok()).toBe(true);
      expect(response.headers()['x-total-lines']).toBe('3');
      expect(Papa.parse(await response.text()).data).toEqual([['001', 'first\ncontinued']]);
      const last = await request.get('/api/file?path=audit-multiline.csv&records=1&offset=2&limit=1');
      expect(Papa.parse(await last.text()).data).toEqual([['002', 'next record']]);
      const search = await request.get('/api/file/search?path=audit-multiline.csv&records=1&q=continued');
      const data = await search.json();
      expect(data.totalLines).toBe(3);
      expect(data.totalMatches).toBe(1);
      expect(data.matches[0].lineNum).toBe(1);
      expect(Papa.parse(data.matches[0].text).data).toEqual([['001', 'first\ncontinued']]);
    } finally {
      rmSync(file, { force: true });
    }
  });

  test('chunked CSV requests records and renders a cell spanning a page boundary intact', async ({ page }) => {
    const file = '/tmp/md-test-docs/audit-multiline.csv';
    writeFileSync(file, 'id,description\n' + Array.from({ length: 1001 }, (_, i) => `${i + 1},"first\ncontinued ${i + 1}"`).join('\n'));
    try {
      await page.route('**/api/file/meta?**', (route) => route.fulfill({ json: { size: 6 * 1024 * 1024, lines: 2003, mtime: '2026-01-01' } }));
      await page.goto('/#file=audit-multiline.csv');
      await expect(page.locator('.chunk-tbody tr')).toHaveCount(1000);
      await expect(page.locator('.chunk-tbody tr').last().locator('td').last()).toHaveText('first\ncontinued 1000');
      await page.locator('.chunk-page-btn[data-page="next"]').first().click();
      await expect(page.locator('.chunk-tbody tr')).toHaveCount(1);
      await expect(page.locator('.chunk-tbody tr').locator('td')).toHaveText(['1001', '1001', 'first\ncontinued 1001']);
    } finally {
      rmSync(file, { force: true });
    }
  });

  test('Laravel logs with CRLF line endings are recognized', async ({ page }) => {
    await page.setContent(renderLogTable('[2026-05-21 11:36:17] local.INFO: hello\r\n[2026-05-21 11:36:18] local.ERROR: failure\r\n', 'audit.log'));
    await expect(page.locator('.laravel-row')).toHaveCount(2);
    await expect(page.locator('.log-level')).toHaveText(['INFO', 'ERROR']);
  });

  test('secret keys mask boolean and container values throughout trees', async ({ page }) => {
    await page.setContent(renderJsonTree('{"apiKey":true,"token":["short"],"public":"keep"}', maskSecretValue));
    await expect(page.locator('.json-tree')).not.toContainText('true');
    await expect(page.locator('.json-tree')).not.toContainText('short');
    await expect(page.locator('.json-tree')).toContainText('keep');
    await page.setContent(renderYamlTree('clientSecret:\n  value: hidden\npublic: keep\n', maskSecretValue));
    await expect(page.locator('.json-tree')).not.toContainText('hidden');
  });

  test('cron preserves command whitespace and rejects missing commands and impossible dates', async ({ page }) => {
    await page.setContent(renderCronTable('0 3 * * * printf "a  b"\n0 3 * * *\n0 0 31 2 * echo invalid\n@reboot\n', 'audit.crontab'));
    expect(await page.locator('.cron-cmd code').first().textContent()).toBe('printf "a  b"');
    await expect(page.locator('tr.cron-invalid')).toHaveCount(3);
  });

  test('chunked CSV masks keyed secrets and preserves semicolon-separated data', async ({ page }) => {
    await mockChunk(page, 'audit.csv', 'id;apiKey;label\n00123;short-secret;public\n', 2);
    await page.goto('/?secretSafe=1#file=audit.csv');
    await expect(page.locator('.chunk-tbody td')).toHaveText(['1', '00123', '[REDACTED]', 'public']);
    await expect(page.locator('#viewer')).not.toContainText('short-secret');
  });

  test('chunked JSONL masks nested keys and preserves actual source line numbers', async ({ page }) => {
    await mockChunk(page, 'audit.jsonl', '\ninvalid\n{"apiKey":"short-secret","nested":{"password":"two words"}}\n', 3);
    await page.goto('/?secretSafe=1#file=audit.jsonl&line=3');
    await expect(page.locator('.chunk-tbody tr')).toHaveAttribute('data-line', '3');
    await expect(page.locator('.chunk-tbody tr')).toHaveClass(/line-highlighted/);
    await expect(page.locator('#viewer')).not.toContainText('short-secret');
    await expect(page.locator('#viewer')).not.toContainText('two words');
  });

  test('chunked deep links use the exact range count when metadata underestimates the file', async ({ page }) => {
    await mockChunk(page, 'audit.jsonl', Array.from({ length: 2001 }, (_, i) => JSON.stringify({ row: i + 1 })).join('\n'), 2001);
    await page.route('**/api/file/meta?**', (route) => route.fulfill({ json: { size: 6 * 1024 * 1024, lines: 10, mtime: '2026-01-01' } }));
    await page.goto('/#file=audit.jsonl&line=1500');
    await expect(page.locator('.chunk-tbody tr[data-line="1500"]')).toHaveClass(/line-highlighted/);
    await expect(page.locator('.chunk-page-input').first()).toHaveValue('2');
  });

  test('chunked search preserves source lines and does not corrupt HTML entities', async ({ page }) => {
    await mockChunk(page, 'audit.jsonl', '{"text":"initial"}', 100);
    await page.route('**/api/file/search?**', (route) => route.fulfill({ json: {
      matches: [{ lineNum: 72, text: '{"text":"<amp> & amp"}' }], totalMatches: 1, totalLines: 100, headerLine: null,
    } }));
    await page.goto('/#file=audit.jsonl');
    await page.locator('.chunk-search-input').fill('amp');
    await page.locator('.chunk-search-input').press('Enter');
    await expect(page.locator('.chunk-tbody tr')).toHaveAttribute('data-line', '73');
    await expect(page.locator('.chunk-tbody td').last()).toHaveText('<amp> & amp');
    await expect(page.locator('.chunk-highlight')).toHaveCount(2);
  });

  test('the newest chunked search wins when responses arrive out of order', async ({ page }) => {
    await mockChunk(page, 'audit.jsonl', '{"text":"initial"}', 100);
    let releaseOld!: () => void;
    let oldRequested!: () => void;
    const requested = new Promise<void>((resolve) => { oldRequested = resolve; });
    const release = new Promise<void>((resolve) => { releaseOld = resolve; });
    await page.route('**/api/file/search?**', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q');
      if (query === 'older') { oldRequested(); await release; }
      await route.fulfill({ json: { matches: [{ lineNum: 1, text: JSON.stringify({ text: query }) }], totalMatches: 1, totalLines: 100, headerLine: null } });
    });
    await page.goto('/#file=audit.jsonl');
    await page.locator('.chunk-search-input').fill('older');
    await page.locator('.chunk-search-input').press('Enter');
    await requested;
    await page.locator('.chunk-search-input').fill('newer');
    await page.locator('.chunk-search-input').press('Enter');
    await expect(page.locator('.chunk-tbody td').last()).toHaveText('newer');
    const oldResponse = page.waitForResponse((response) => response.url().includes('q=older'));
    releaseOld();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(page.locator('.chunk-tbody td').last()).toHaveText('newer');
    await expect(page.locator('.chunk-search-input')).toHaveValue('newer');
  });

  test('chunked page failures display an error instead of leaving a loading row', async ({ page }) => {
    await mockChunk(page, 'audit.jsonl', '{"text":"initial"}', 2001);
    await page.goto('/#file=audit.jsonl');
    await expect(page.locator('.chunk-tbody')).toContainText('initial');
    await page.route('**/api/file?**', (route) => route.fulfill({ status: 500, body: 'failed' }));
    await page.locator('.chunk-page-btn[data-page="next"]').first().click();
    await expect(page.locator('.chunk-tbody .error-banner')).toHaveText('Fetch failed: 500');
    await expect(page.locator('.chunk-page-btn[data-page="prev"]').first()).toBeEnabled();
  });
});
