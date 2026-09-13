import { parse, parseDocument, visit, isScalar } from 'yaml';
import { isLikelySecretKey, maskSecrets, REDACTED, type SecretMasker } from './secret-mask';

/** Mask block values too; a line-based assignment matcher cannot see them. */
export function maskYamlSecrets(content: string): string {
  try {
    const doc = parseDocument(content);
    if (doc.errors.length) return maskSecrets(content);
    visit(doc, {
      Pair(_key, pair) {
        if (isScalar(pair.key) && isLikelySecretKey(String(pair.key.value))) {
          const original = pair.value;
          const replacement = doc.createNode(REDACTED);
          if (original && typeof original === 'object' && 'anchor' in original && typeof original.anchor === 'string') {
            replacement.anchor = original.anchor;
          }
          pair.value = replacement;
        }
      },
      Scalar(_key, node) {
        if (typeof node.value === 'string') node.value = maskSecrets(node.value);
      },
    });
    return doc.toString();
  } catch {
    return maskSecrets(content);
  }
}

export function renderYamlTree(yamlStr: string, maskValue?: SecretMasker): string {
  try {
    const data = parse(yamlStr);
    return `<div class="json-tree">${renderNode(data, '', true, maskValue)}</div>`;
  } catch {
    return '';
  }
}

function renderNode(value: unknown, key: string, isRoot = false, maskValue?: SecretMasker, ancestors = new Set<object>()): string {
  const keyHtml = !isRoot ? `<span class="jt-key">${esc(key)}</span><span class="jt-colon">: </span>` : '';

  if (maskValue && isLikelySecretKey(key)) {
    return `<div class="jt-line">${keyHtml}<span class="jt-str">${REDACTED}</span></div>`;
  }

  if (value === null || value === undefined) return `<div class="jt-line">${keyHtml}<span class="jt-null">null</span></div>`;
  if (typeof value === 'boolean') return `<div class="jt-line">${keyHtml}<span class="jt-bool">${value}</span></div>`;
  if (typeof value === 'number') return `<div class="jt-line">${keyHtml}<span class="jt-num">${esc(maskValue ? maskValue(String(value), key) : String(value))}</span></div>`;
  if (typeof value === 'string') return `<div class="jt-line">${keyHtml}<span class="jt-str">"${esc(maskValue ? maskValue(value, key) : value)}"</span></div>`;

  if (typeof value === 'object') {
    if (ancestors.has(value)) return `<div class="jt-line">${keyHtml}<span class="jt-str">[Circular reference]</span></div>`;
    ancestors = new Set(ancestors).add(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `<div class="jt-line">${keyHtml}<span class="jt-bracket">[]</span></div>`;
    const items = value.map((v, i) => renderNode(v, String(i), false, maskValue, ancestors)).join('');
    return `<details class="jt-group" open>
      <summary class="jt-line">${keyHtml}<span class="jt-bracket">[</span><span class="jt-count">${value.length} items</span></summary>
      <div class="jt-children">${items}</div>
      <div class="jt-line"><span class="jt-bracket">]</span></div>
    </details>`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `<div class="jt-line">${keyHtml}<span class="jt-bracket">{}</span></div>`;
    const items = entries.map(([k, v]) => renderNode(v, k, false, maskValue, ancestors)).join('');
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
