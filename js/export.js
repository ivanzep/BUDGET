import { lineTotal, finishLineTotal, linesForVersion, versionTotal, categoryTotals, allCategories } from './calc.js';
import { csvEscape, downloadBlob, formatCurrency } from './util.js';

function safeName(project) {
  return (project.info.name || 'project').replace(/[^a-z0-9\-_]+/gi, '_');
}

export function exportCSV(project) {
  const rows = [
    ['Section', 'Version', 'Category', 'Item ID', 'Description', 'Unit', 'Unit Cost Material', 'Unit Cost Labor', 'Markup %', 'Qty', 'Notes', 'Line Total'],
  ];
  project.info.versions.forEach((v) => {
    linesForVersion(project.lines, v.id).forEach((l) => {
      rows.push([
        'Budget', v.name, l.category, l.itemId, l.description, l.unit,
        l.unitCostMaterial, l.unitCostLabor, l.markupPct, l.qty, l.notes,
        lineTotal(l).toFixed(2),
      ]);
    });
    linesForVersion(project.finishLines, v.id).forEach((l) => {
      rows.push([
        'Finishes', v.name, l.category || '', l.itemId, l.description, l.unit || '',
        '', '', '', l.qty, l.notes, finishLineTotal(l).toFixed(2),
      ]);
    });
  });
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeName(project)}_budget.csv`);
}

export function exportExcel(project) {
  if (typeof XLSX === 'undefined') {
    alert('Excel export library did not load. Check your internet connection and try again.');
    return;
  }
  const wb = XLSX.utils.book_new();

  // Summary sheet: category rows x version columns
  const cats = allCategories(project);
  const summaryHeader = ['Category', ...project.info.versions.map((v) => v.name)];
  const summaryRows = cats.map((cat) => [
    cat,
    ...project.info.versions.map((v) => categoryTotals(project, v.id)[cat] || 0),
  ]);
  const grandRow = ['Grand Total (Budget + Finishes)', ...project.info.versions.map((v) => versionTotal(project, v.id).total)];
  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows, [], grandRow]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // One sheet per version with full line detail
  project.info.versions.forEach((v) => {
    const header = ['Category', 'Item ID', 'Description', 'Unit', 'Unit Cost Material', 'Unit Cost Labor', 'Markup %', 'Qty', 'Notes', 'Line Total'];
    const rows = linesForVersion(project.lines, v.id).map((l) => [
      l.category, l.itemId, l.description, l.unit, Number(l.unitCostMaterial) || 0,
      Number(l.unitCostLabor) || 0, Number(l.markupPct) || 0, Number(l.qty) || 0, l.notes,
      Number(lineTotal(l).toFixed(2)),
    ]);
    const finHeader = ['Item ID', 'Description', 'Unit', 'Unit Price', 'Qty', 'Notes', 'Line Total'];
    const finRows = linesForVersion(project.finishLines, v.id).map((l) => [
      l.itemId, l.description, l.unit || '', Number(l.unitPrice) || 0, Number(l.qty) || 0, l.notes,
      Number(finishLineTotal(l).toFixed(2)),
    ]);
    const aoa = [
      ['Budget Lines'], header, ...rows,
      [], ['Interior Finishes'], finHeader, ...finRows,
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, sheet, v.name.slice(0, 31) || 'Version');
  });

  XLSX.writeFile(wb, `${safeName(project)}_budget.xlsx`);
}

export async function exportPDF(elementId, project) {
  if (typeof html2pdf === 'undefined') {
    alert('PDF export library did not load. Check your internet connection and try again.');
    return;
  }
  const el = document.getElementById(elementId);
  if (!el) return;
  await html2pdf()
    .set({
      margin: 10,
      filename: `${safeName(project)}_budget.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'letter', orientation: 'landscape' },
    })
    .from(el)
    .save();
}

export { formatCurrency };
