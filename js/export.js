import {
  lineTotal, finishLineTotal, linesForVersion, versionTotal, categoryGroups, categoryTotal,
  subcategoryTotal, feeAmounts, totalSqft, costPerSf,
} from './calc.js';
import { csvEscape, downloadBlob, formatCurrency } from './util.js';

function safeName(project) {
  return (project.info.name || 'project').replace(/[^a-z0-9\-_]+/gi, '_');
}

function areaName(project, areaId) {
  return (project.info.areas || []).find((a) => a.id === areaId)?.name || '';
}

export function exportCSV(project) {
  const rows = [
    ['Section', 'Version', 'Category', 'Subcategory', 'Item ID', 'Description', 'Cost Type', 'Area', 'Unit', 'Unit Cost Material', 'Unit Cost Labor', 'Markup %', 'Qty', 'Notes', 'Line Total'],
  ];
  project.info.versions.forEach((v) => {
    linesForVersion(project.lines, v.id).forEach((l) => {
      rows.push([
        'Budget', v.name, l.category, l.subcategory, l.itemId, l.description, l.costType || '', areaName(project, l.areaId), l.unit,
        l.unitCostMaterial, l.unitCostLabor, l.markupPct, l.qty, l.notes,
        lineTotal(l).toFixed(2),
      ]);
    });
    linesForVersion(project.finishLines, v.id).forEach((l) => {
      rows.push([
        'Finishes', v.name, l.category || '', '', l.itemId, l.description, '', areaName(project, l.areaId), l.unit || '',
        '', '', '', l.qty, l.notes, finishLineTotal(l).toFixed(2),
      ]);
    });
    const f = feeAmounts(project, v.id);
    rows.push(['Fee', v.name, 'Overhead', '', '', '', '', '', '', '', '', '', '', '', f.overhead.toFixed(2)]);
    rows.push(['Fee', v.name, 'GC Company Margin', '', '', '', '', '', '', '', '', '', '', '', f.gcMargin.toFixed(2)]);
    rows.push(['Fee', v.name, 'PM / Supervision', '', '', '', '', '', '', '', '', '', '', '', f.pm.toFixed(2)]);
    rows.push(['Fee', v.name, 'Insurance', '', '', '', '', '', '', '', '', '', '', '', f.insurance.toFixed(2)]);
    rows.push(['Fee', v.name, 'Contingency Reserve', '', '', '', '', '', '', '', '', '', '', '', f.contingency.toFixed(2)]);
    rows.push(['Total', v.name, 'Grand Total', '', '', '', '', '', '', '', '', '', '', '', f.grandTotal.toFixed(2)]);
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
  const versions = project.info.versions;
  const sqft = totalSqft(project);

  // Summary sheet: category > subcategory rows x version columns, then fees + grand total
  const groups = categoryGroups(project);
  const summaryHeader = ['Category', ...versions.map((v) => v.name)];
  const summaryRows = [];
  groups.forEach(({ category, subcategories }) => {
    subcategories.forEach((sub) => {
      summaryRows.push([`  ${sub}`, ...versions.map((v) => subcategoryTotal(project, v.id, category, sub))]);
    });
    summaryRows.push([category, ...versions.map((v) => categoryTotal(project, v.id, category))]);
  });
  summaryRows.push(['Interior Finishes Subtotal', ...versions.map((v) => versionTotal(project, v.id).finishes)]);
  summaryRows.push(['Hard Cost Subtotal', ...versions.map((v) => versionTotal(project, v.id).total)]);
  summaryRows.push(['Overhead', ...versions.map((v) => feeAmounts(project, v.id).overhead)]);
  summaryRows.push(['GC Company Margin', ...versions.map((v) => feeAmounts(project, v.id).gcMargin)]);
  summaryRows.push(['PM / Supervision', ...versions.map((v) => feeAmounts(project, v.id).pm)]);
  summaryRows.push(['Insurance', ...versions.map((v) => feeAmounts(project, v.id).insurance)]);
  summaryRows.push(['Contingency Reserve', ...versions.map((v) => feeAmounts(project, v.id).contingency)]);
  summaryRows.push(['Grand Total', ...versions.map((v) => feeAmounts(project, v.id).grandTotal)]);
  if (sqft > 0) {
    summaryRows.push([`$ / SF (${sqft} SF)`, ...versions.map((v) => costPerSf(feeAmounts(project, v.id).grandTotal, sqft))]);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // One sheet per version with full line detail
  versions.forEach((v) => {
    const header = ['Category', 'Subcategory', 'Item ID', 'Description', 'Cost Type', 'Area', 'Unit', 'Unit Cost Material', 'Unit Cost Labor', 'Markup %', 'Qty', 'Notes', 'Line Total'];
    const rows = linesForVersion(project.lines, v.id).map((l) => [
      l.category, l.subcategory, l.itemId, l.description, l.costType || '', areaName(project, l.areaId), l.unit, Number(l.unitCostMaterial) || 0,
      Number(l.unitCostLabor) || 0, Number(l.markupPct) || 0, Number(l.qty) || 0, l.notes,
      Number(lineTotal(l).toFixed(2)),
    ]);
    const finHeader = ['Item ID', 'Description', 'Area', 'Unit', 'Unit Price', 'Qty', 'Notes', 'Line Total'];
    const finRows = linesForVersion(project.finishLines, v.id).map((l) => [
      l.itemId, l.description, areaName(project, l.areaId), l.unit || '', Number(l.unitPrice) || 0, Number(l.qty) || 0, l.notes,
      Number(finishLineTotal(l).toFixed(2)),
    ]);
    const f = feeAmounts(project, v.id);
    const aoa = [
      ['Budget Lines'], header, ...rows,
      [], ['Interior Finishes'], finHeader, ...finRows,
      [],
      ['Fees & Adjustments'],
      ['Hard Cost Subtotal', f.hardCost],
      ['Overhead', f.overhead],
      ['GC Company Margin', f.gcMargin],
      ['PM / Supervision', f.pm],
      ['Insurance', f.insurance],
      ['Contingency Reserve', f.contingency],
      ['Grand Total', f.grandTotal],
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
