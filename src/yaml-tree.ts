import { parse } from 'yaml';
import type { SecretMasker } from './secret-mask';

export function renderYamlTree(yamlStr: string, maskValue?: SecretMasker): string {
  try {
    const data = parse(yamlStr);
    return `<div class="json-tree">${renderNode(data, '', true, maskValue)}</div>`;
  } catch {
    return '';
  }
}

function renderNode(value: unknown, key: string, isRoot = false, maskValue?: SecretMasker): string {
  const keyHtml = key && !isRoot ? `<span class="jt-key">${esc(key)}</span><span class="jt-colon">: </span>` : '';

  if (value === null || value === undefined) return `<div class="jt-line">${keyHtml}<span class="jt-null">null</span></div>`;
  if (typeof value === 'boolean') return `<div class="jt-line">${keyHtml}<span class="jt-bool">${value}</span></div>`;
  if (typeof value === 'number') return `<div class="jt-line">${keyHtml}<span class="jt-num">${esc(maskValue ? maskValue(String(value), key) : String(value))}</span></div>`;
  if (typeof value === 'string') return `<div class="jt-line">${keyHtml}<span class="jt-str">"${esc(maskValue ? maskValue(value, key) : value)}"</span></div>`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `<div class="jt-line">${keyHtml}<span class="jt-bracket">[]</span></div>`;
    const items = value.map((v, i) => renderNode(v, String(i), false, maskValue)).join('');
    return `<details class="jt-group" open>
      <summary class="jt-line">${keyHtml}<span class="jt-bracket">[</span><span class="jt-count">${value.length} items</span></summary>
      <div class="jt-children">${items}</div>
      <div class="jt-line"><span class="jt-bracket">]</span></div>
    </details>`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `<div class="jt-line">${keyHtml}<span class="jt-bracket">{}</span></div>`;
    const items = entries.map(([k, v]) => renderNode(v, k, false, maskValue)).join('');
    return `<details class="jt-group" open>
      <summary class="jt-line">${keyHtml}<span class="jt-bracket">{</span><span class="jt-count">${entries.length} keys</span></summary>
      <div class="jt-children">${items}</div>
      <div class="jt-line"><span class="jt-bracket">}</span></div>
    </details>`;
  }

  const rendered = maskValue ? maskValue(String(value), key) : String(value);
  return `<div class="jt-line">${keyHtml}<span class="jt-str">${esc(rendered)}</span></div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
