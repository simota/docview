export function renderJsonTree(json: string): string {
  try {
    const data = JSON.parse(json);
    return `<div class="json-tree">${renderNode(data, '', true)}</div>`;
  } catch {
    return '';
  }
}

function renderNode(value: unknown, key: string, isRoot = false): string {
  const keyHtml = key && !isRoot ? `<span class="jt-key">${escapeHtml(key)}</span><span class="jt-colon">: </span>` : '';

  if (value === null) return `<div class="jt-line">${keyHtml}<span class="jt-null">null</span></div>`;
  if (typeof value === 'boolean') return `<div class="jt-line">${keyHtml}<span class="jt-bool">${value}</span></div>`;
  if (typeof value === 'number') return `<div class="jt-line">${keyHtml}<span class="jt-num">${value}</span></div>`;
  if (typeof value === 'string') return `<div class="jt-line">${keyHtml}<span class="jt-str">"${escapeHtml(value)}"</span></div>`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `<div class="jt-line">${keyHtml}<span class="jt-bracket">[]</span></div>`;
    const items = value.map((v, i) => renderNode(v, String(i))).join('');
    return `<details class="jt-group" open>
      <summary class="jt-line">${keyHtml}<span class="jt-bracket">[</span><span class="jt-count">${value.length} items</span></summary>
      <div class="jt-children">${items}</div>
      <div class="jt-line"><span class="jt-bracket">]</span></div>
    </details>`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `<div class="jt-line">${keyHtml}<span class="jt-bracket">{}</span></div>`;
    const items = entries.map(([k, v]) => renderNode(v, k)).join('');
    return `<details class="jt-group" open>
      <summary class="jt-line">${keyHtml}<span class="jt-bracket">{</span><span class="jt-count">${entries.length} keys</span></summary>
      <div class="jt-children">${items}</div>
      <div class="jt-line"><span class="jt-bracket">}</span></div>
    </details>`;
  }

  return `<div class="jt-line">${keyHtml}<span class="jt-str">${escapeHtml(String(value))}</span></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
