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

  const ths = fields.map((f) => `<th data-col="${esc(f)}">${esc(f)}</th>`).join('');
  const trs = rows.map((row) => {
    const tds = fields.map((f) => `<td>${esc(String(row[f] ?? ''))}</td>`).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  return `<div class="csv-view">
    <div class="csv-info">${rows.length} rows &times; ${fields.length} columns</div>
    <div class="csv-table-wrap">
      <table class="csv-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
