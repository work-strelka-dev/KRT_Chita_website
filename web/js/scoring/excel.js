// @ts-check
// Выгрузка рейтинга площадок в Excel (формат SpreadsheetML 2003, как в исходной карте).

/** @typedef {import('./model.js').RankingRow} RankingRow */

const HEADERS = [
  'Место в рейтинге', 'Номер площадки', 'Название', 'Градостроительная политика',
  'Площадь, га', 'Градпотенциал, тыс. м²', 'Интегральный балл города',
  'Интегральный балл инвестора', 'Итог до нормировки', 'Итоговый балл 0–10',
  'Вес города', 'Вес инвестора',
];
const FILE_NAME = 'Рейтинг_площадок_КРТ.xls';

/** @param {unknown} value */
export function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** @param {unknown} value @param {boolean} numeric @param {string} [style] */
export function excelCell(value, numeric, style) {
  const type = numeric && value != null && value !== '' && !isNaN(Number(value)) ? 'Number' : 'String';
  const content = type === 'Number' ? Number(value) : value;
  return '<Cell' + (style ? ' ss:StyleID="' + style + '"' : '') + '><Data ss:Type="'
    + type + '">' + xmlEscape(content == null ? '' : content) + '</Data></Cell>';
}

/** @param {RankingRow[]} rows */
export function rankingWorkbook(rows) {
  let table = '<Row>' + HEADERS.map((h) => excelCell(h, false, 'Header')).join('') + '</Row>';
  rows.forEach((r) => {
    table += '<Row>'
      + excelCell(r.rank, true) + excelCell(r.plot_number, false) + excelCell(r.name, false)
      + excelCell(r.status, false) + excelCell(r.area_ha, true) + excelCell(r.potential_thsqm, true)
      + excelCell(r.city_score, true) + excelCell(r.investor_score, true)
      + excelCell(r.combined_raw == null ? '' : r.combined_raw.toFixed(3), true)
      + excelCell(r.combined_score == null ? '' : r.combined_score.toFixed(3), true)
      + excelCell(r.city_weight, true) + excelCell(r.investor_weight, true) + '</Row>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<?mso-application progid="Excel.Sheet"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
    + 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
    + '<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EDEF" '
    + 'ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Рейтинг площадок"><Table>'
    + table + '</Table></Worksheet></Workbook>';
}

/** @param {RankingRow[]} rows */
export function downloadKrtRankingExcel(rows) {
  const blob = new Blob(['\uFEFF', rankingWorkbook(rows)], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
