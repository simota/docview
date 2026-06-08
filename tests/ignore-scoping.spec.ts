import { test, expect } from '@playwright/test';

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

function flatten(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.path);
    if (n.children) flatten(n.children, acc);
  }
  return acc;
}

test.describe('ignore-aware scoping', () => {
  test('built-in build/dependency dirs are excluded from the tree', async ({ request }) => {
    const res = await request.get('/api/tree');
    expect(res.ok()).toBeTruthy();
    const { tree } = await res.json();
    const paths = flatten(tree as TreeNode[]);

    for (const dir of ['dist', 'vendor', 'coverage', 'node_modules']) {
      expect(paths.some((p) => p === dir || p.startsWith(dir + '/'))).toBe(false);
    }
  });

  test('hidden dotfiles like .env stay visible in the tree', async ({ request }) => {
    const res = await request.get('/api/tree');
    const { tree } = await res.json();
    const paths = flatten(tree as TreeNode[]);
    expect(paths).toContain('.env');
  });

  test('.docviewignore patterns exclude matching dir and file', async ({ request }) => {
    const res = await request.get('/api/tree');
    const { tree } = await res.json();
    const paths = flatten(tree as TreeNode[]);
    // `custom-ignored` dir and `ignore-me.md` file are listed in .docviewignore.
    expect(paths.some((p) => p === 'custom-ignored' || p.startsWith('custom-ignored/'))).toBe(false);
    expect(paths).not.toContain('ignore-me.md');
  });

  test('search does not return hits from excluded directories', async ({ request }) => {
    const res = await request.get('/api/search?q=IGNOREDBUILDARTIFACT');
    expect(res.ok()).toBeTruthy();
    const results = (await res.json()) as Array<{ path: string }>;
    expect(results).toHaveLength(0);
  });

  test('search does not return hits from .docviewignore matches', async ({ request }) => {
    const customRes = await request.get('/api/search?q=CUSTOMIGNORED');
    expect((await customRes.json()) as unknown[]).toHaveLength(0);

    const fileRes = await request.get('/api/search?q=IGNOREMEFILE');
    expect((await fileRes.json()) as unknown[]).toHaveLength(0);
  });

  test('search still finds content in non-ignored files (sanity)', async ({ request }) => {
    const res = await request.get('/api/search?q=VISIBLE_DOTENV_TOKEN');
    const results = (await res.json()) as Array<{ path: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path === '.env')).toBe(true);
  });
});
