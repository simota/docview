import Papa from 'papaparse';

export function renderCsvTable(content: string, path: string): string {
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (!result.data.length || !result.meta.fields?.length) {
    return `<p class="error-banner">No data found in ${path}</p>`;
  }

  const fields = result.meta.fields;
  const rows = result.data as Record<string, unknown>[];

  const ths = fields.map((f) => `<th data-col="${esc(f)}" role="columnheader" aria-sort="none">${esc(f)}<span class="sort-indicator" aria-hidden="true"></span></th>`).join('');
  const trs = rows.map((row, i) => {
    const tds = fields.map((f) => `<td>${esc(String(row[f] ?? ''))}</td>`).join('');
    return `<tr data-row-index="${i}">${tds}</tr>`;
  }).join('');

  return `<div class="csv-view">
    <div class="csv-info">${rows.length} rows &times; ${fields.length} columns</div>
    <div class="csv-table-wrap">
      <table class="csv-table csv-sortable">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NUM_RE = /^-?[\d,]+\.?\d*$/;
const DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

function detectColumnType(rows: Element[], colIndex: number): 'number' | 'date' | 'string' {
  let numCount = 0;
  let dateCount = 0;
  const sample = Math.min(rows.length, 20);
  for (let i = 0; i < sample; i++) {
    const text = (rows[i].children[colIndex]?.textContent ?? '').trim();
    if (!text) continue;
    if (NUM_RE.test(text)) numCount++;
    else if (DATE_RE.test(text) && !isNaN(Date.parse(text))) dateCount++;
  }
  if (numCount >= sample * 0.8) return 'number';
  if (dateCount >= sample * 0.8) return 'date';
  return 'string';
}

export function initCsvSort(): void {
  document.addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest('.csv-sortable th');
    if (!th) return;

    const table = th.closest('table')!;
    const thead = table.querySelector('thead')!;
    const tbody = table.querySelector('tbody')!;
    const ths = Array.from(thead.querySelectorAll('th'));
    const colIndex = ths.indexOf(th as HTMLTableCellElement);
    if (colIndex < 0) return;

    // Determine sort direction
    const currentSort = th.getAttribute('aria-sort');
    const direction = currentSort === 'ascending' ? 'descending' : 'ascending';

    // Reset all headers
    ths.forEach((h) => {
      h.setAttribute('aria-sort', 'none');
      h.classList.remove('sort-asc', 'sort-desc');
    });

    // Set active header
    th.setAttribute('aria-sort', direction);
    th.classList.add(direction === 'ascending' ? 'sort-asc' : 'sort-desc');

    // Detect column type from first non-empty value
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const colType = detectColumnType(rows, colIndex);

    rows.sort((a, b) => {
      const aText = (a.children[colIndex]?.textContent ?? '').trim();
      const bText = (b.children[colIndex]?.textContent ?? '').trim();

      let cmp = 0;
      if (colType === 'number') {
        const aNum = parseNum(aText);
        const bNum = parseNum(bText);
        cmp = aNum - bNum;
      } else if (colType === 'date') {
        cmp = Date.parse(aText) - Date.parse(bText);
      } else {
        cmp = aText.localeCompare(bText);
      }
      return direction === 'ascending' ? cmp : -cmp;
    });

    // Re-append sorted rows
    rows.forEach((row) => tbody.appendChild(row));
  });
}
