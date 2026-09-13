import type { SecretMasker } from './secret-mask';

export function renderJsonlTable(content: string, path: string, maskValue?: SecretMasker): string {
  const lines = content.split('\n');

  if (!content.trim()) {
    return `<p class="error-banner">No data found in ${esc(path)}</p>`;
  }

  const rows: Record<string, unknown>[] = [];
  const parseErrors: number[] = [];
  const rowLines: number[] = [];

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        rows.push(obj as Record<string, unknown>);
        rowLines.push(i + 1);
      } else {
        parseErrors.push(i + 1);
      }
    } catch {
      parseErrors.push(i + 1);
    }
  });

  if (!rows.length) {
    return `<p class="error-banner">No valid JSON objects found in ${esc(path)}</p>`;
  }

  // Collect all keys preserving insertion order
  const fieldSet = new LinkedSet<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      fieldSet.add(key);
    }
  }
  const fields = fieldSet.values();

  const errorBanner =
    parseErrors.length > 0
      ? `<div class="csv-info csv-info--warn">Skipped ${parseErrors.length} invalid line(s): ${parseErrors.slice(0, 10).join(', ')}${parseErrors.length > 10 ? '…' : ''}</div>`
      : '';

  // Row-number header (not sortable — has no aria-sort, so initCsvSort skips it).
  const rowNumTh = `<th class="csv-row-num-header" aria-label="Row number">#</th>`;
  const ths =
    rowNumTh +
    fields
      .map(
        (f) =>
          `<th data-col="${esc(f)}" role="columnheader" aria-sort="none">${esc(f)}<span class="sort-indicator" aria-hidden="true"></span></th>`,
      )
      .join('');

  const trs = rows
    .map((row, i) => {
      const tds = fields
        .map((f) => {
          const val = Object.hasOwn(row, f) ? row[f] : undefined;
          const cell =
            val === undefined || val === null
              ? ''
              : typeof val === 'object'
                ? esc(maskValue ? maskValue(JSON.stringify(val), f) : JSON.stringify(val))
                : esc(maskValue ? maskValue(String(val), f) : String(val));
          return `<td>${cell}</td>`;
        })
        .join('');
      // Keep source line numbers even when blank or invalid lines were skipped.
      return `<tr data-row-index="${i}" data-line="${rowLines[i]}"><td class="csv-row-num">${rowLines[i]}</td>${tds}</tr>`;
    })
    .join('');

  return `<div class="csv-view">
    <div class="csv-info">
      <span>${rows.length} rows &times; ${fields.length} columns</span>
      <span class="csv-row-jump">
        <label class="csv-row-jump-label">行へ移動
          <input class="csv-row-jump-input" type="number" min="1" max="${rowLines[rowLines.length - 1]}" inputmode="numeric" placeholder="#" aria-label="移動する行番号">
        </label>
        <button class="csv-row-jump-btn" type="button">移動</button>
      </span>
    </div>
    ${errorBanner}
    <div class="csv-table-wrap">
      <table class="csv-table csv-sortable">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Insertion-order preserving set using Map. */
class LinkedSet<T> {
  private readonly map = new Map<T, true>();
  add(v: T): void {
    this.map.set(v, true);
  }
  values(): T[] {
    return Array.from(this.map.keys());
  }
}
