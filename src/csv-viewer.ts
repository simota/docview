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

  // Row-number header (not sortable — excluded from sort by col-index offset)
  const rowNumTh = `<th class="csv-row-num-header" aria-label="Row number">#</th>`;
  const ths = rowNumTh + fields.map((f, i) => `<th data-col="${esc(f)}" data-col-index="${i}" role="columnheader" aria-sort="none"><label class="csv-col-check"><input type="checkbox" data-col-select="${i}" checked></label>${esc(f)}<span class="sort-indicator" aria-hidden="true"></span></th>`).join('');
  const trs = rows.map((row, i) => {
    const tds = fields.map((f) => {
      const val = String(row[f] ?? '');
      return `<td title="${esc(val)}">${esc(val)}</td>`;
    }).join('');
    return `<tr data-row-index="${i}"><td class="csv-row-num">${i + 1}</td>${tds}</tr>`;
  }).join('');

  return `<div class="csv-view">
    <div class="csv-info">
      <span>${rows.length} rows &times; ${fields.length} columns</span>
      <span class="csv-col-actions">
        <button class="csv-col-toggle-all" title="全列の選択を切替">全選択</button>
        <button class="csv-copy-cols" title="選択した列をコピー">選択列をコピー</button>
      </span>
    </div>
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

function updateSortHeaders(
  ths: Element[],
  activeTh: Element,
  direction: 'ascending' | 'descending',
): void {
  ths.forEach((h) => {
    h.setAttribute('aria-sort', 'none');
    h.classList.remove('sort-asc', 'sort-desc');
  });
  activeTh.setAttribute('aria-sort', direction);
  activeTh.classList.add(direction === 'ascending' ? 'sort-asc' : 'sort-desc');
}

function compareRows(
  a: Element,
  b: Element,
  colIndex: number,
  colType: 'number' | 'date' | 'string',
): number {
  const aText = (a.children[colIndex]?.textContent ?? '').trim();
  const bText = (b.children[colIndex]?.textContent ?? '').trim();
  if (colType === 'number') return parseNum(aText) - parseNum(bText);
  if (colType === 'date') return Date.parse(aText) - Date.parse(bText);
  return aText.localeCompare(bText);
}

export function initCsvSort(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // チェックボックスクリック時はソートしない
    if (target.closest('.csv-col-check')) return;

    const th = target.closest('.csv-sortable th');
    if (!th) return;
    // Skip the row-number header (no aria-sort attribute)
    if (!th.hasAttribute('aria-sort')) return;

    const table = th.closest('table')!;
    const ths = Array.from(table.querySelectorAll('thead th'));
    const thIndex = ths.indexOf(th as HTMLTableCellElement);
    if (thIndex < 0) return;
    // Data columns start at td index 1 (index 0 is the row-number cell)
    const colIndex = thIndex;

    const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    updateSortHeaders(ths.filter((h) => h.hasAttribute('aria-sort')), th, direction);

    const tbody = table.querySelector('tbody')!;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const colType = detectColumnType(rows, colIndex);

    rows.sort((a, b) => {
      const cmp = compareRows(a, b, colIndex, colType);
      return direction === 'ascending' ? cmp : -cmp;
    });

    rows.forEach((row) => tbody.appendChild(row));
  });
}

function updateColumnHighlight(table: HTMLTableElement): void {
  const checkboxes = table.querySelectorAll<HTMLInputElement>('input[data-col-select]');
  const selected = new Set<number>();
  checkboxes.forEach((cb) => {
    if (cb.checked) selected.add(Number(cb.dataset.colSelect));
  });

  // ヘッダー: index 0 は行番号列なのでデータ列は +1 オフセット
  const ths = table.querySelectorAll('thead th');
  ths.forEach((th, i) => th.classList.toggle('csv-col-selected', selected.has(i - 1)));

  // セル: index 0 は行番号列
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach((row) => {
    const tds = row.querySelectorAll('td');
    tds.forEach((td, i) => td.classList.toggle('csv-col-selected', selected.has(i - 1)));
  });
}

function getSelectedColumnData(table: HTMLTableElement): string {
  const checkboxes = table.querySelectorAll<HTMLInputElement>('input[data-col-select]');
  const selected: number[] = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) selected.push(Number(cb.dataset.colSelect));
  });
  if (!selected.length) return '';

  // data-col-index はデータ列の 0-based インデックス、th は +1 オフセット
  const ths = table.querySelectorAll('thead th');
  const headerLine = selected.map((i) => ths[i + 1]?.getAttribute('data-col') ?? '').join('\t');

  const rows = table.querySelectorAll('tbody tr');
  const lines = [headerLine];
  rows.forEach((row) => {
    const tds = row.querySelectorAll('td');
    // td[0] is row-number; data cells start at td[1]
    lines.push(selected.map((i) => (tds[i + 1]?.textContent ?? '').trim()).join('\t'));
  });
  return lines.join('\n');
}

export function initCsvColumnCopy(): void {
  document.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (!cb.matches('input[data-col-select]')) return;
    const table = cb.closest('table');
    if (table) updateColumnHighlight(table);
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // 全選択/全解除トグル
    if (target.closest('.csv-col-toggle-all')) {
      const wrap = target.closest('.csv-view');
      if (!wrap) return;
      const table = wrap.querySelector('table');
      if (!table) return;
      const checkboxes = table.querySelectorAll<HTMLInputElement>('input[data-col-select]');
      const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
      checkboxes.forEach((cb) => (cb.checked = !allChecked));
      updateColumnHighlight(table);
      return;
    }

    // 選択列をコピー
    if (target.closest('.csv-copy-cols')) {
      const wrap = target.closest('.csv-view');
      if (!wrap) return;
      const table = wrap.querySelector('table');
      if (!table) return;
      const data = getSelectedColumnData(table);
      if (!data) return;
      const btn = target.closest('.csv-copy-cols') as HTMLButtonElement;
      navigator.clipboard.writeText(data).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'コピーしました';
        btn.classList.add('csv-copy-cols--done');
        setTimeout(() => {
          btn.textContent = orig;
          btn.classList.remove('csv-copy-cols--done');
        }, 1500);
      });
      return;
    }
  });
}
