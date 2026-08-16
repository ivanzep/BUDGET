// Pure content builders for the Print/Export report -- one per selectable
// section, each a standalone function of (project, versionId) -> HTML
// string. Kept independent of any view's internal module state (editor.js,
// summary.js) so print.js can compose them without a circular import, and
// so the exact same section renders identically no matter which tab or
// page opened the preview.
import { escapeHtml, formatCurrency } from './util.js';
import {
  linesForVersion, lineTotal, lineUnitCost, feeAmounts, totalSqft, costPerSf,
  categoryGroups, categoryTotal, subcategoryTotal, areaTotal, versionTotal,
} from './calc.js';
import { visibleColumnOrder, BUDGET_COLUMN_LABELS } from './tableSettings.js';

const FEE_KEYS = [
  { key: 'overhead', label: 'Overhead' },
  { key: 'gcMargin', label: 'GC Company Margin' },
  { key: 'pm', label: 'PM/Supervision' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'contingency', label: 'Contingency Reserve' },
];

// Always shown at the top of the report, above whichever sections are
// enabled -- not itself a toggleable section since every report needs to
// say what project it's for.
export function buildHeaderHtml(p, includeLogo) {
  return `
    <div class="print-header">
      ${includeLogo && p.info.logoUrl ? `<img src="${p.info.logoUrl}" class="print-logo" alt="logo">` : ''}
      <div>
        <h1>${escapeHtml(p.info.name || 'Untitled Project')}</h1>
        <div class="print-meta">
          ${p.info.client ? `Client: ${escapeHtml(p.info.client)}<br>` : ''}
          ${p.info.address ? `Address: ${escapeHtml(p.info.address)}<br>` : ''}
          ${p.info.date ? `Date: ${escapeHtml(p.info.date)}<br>` : ''}
          ${p.info.projectNumber ? `Project #: ${escapeHtml(p.info.projectNumber)}` : ''}
        </div>
      </div>
    </div>
  `;
}

function buildInfoSection(p) {
  return `
    <h3>Project Info</h3>
    <table class="table">
      <tbody>
        ${p.info.client ? `<tr><th>Client</th><td>${escapeHtml(p.info.client)}</td></tr>` : ''}
        ${p.info.address ? `<tr><th>Address</th><td>${escapeHtml(p.info.address)}</td></tr>` : ''}
        ${p.info.projectNumber ? `<tr><th>Project #</th><td>${escapeHtml(p.info.projectNumber)}</td></tr>` : ''}
        ${p.info.date ? `<tr><th>Date</th><td>${escapeHtml(p.info.date)}</td></tr>` : ''}
      </tbody>
    </table>
    ${p.info.notes ? `<h4>Notes</h4><p>${escapeHtml(p.info.notes)}</p>` : ''}
  `;
}

function buildAreasSection(p) {
  const areas = p.info.areas || [];
  if (!areas.length) return '<h3>Areas / Levels</h3><p class="muted">No areas defined.</p>';
  return `
    <h3>Areas / Levels</h3>
    <table class="table">
      <thead><tr><th>Name</th><th>Square Footage</th></tr></thead>
      <tbody>${areas.map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.sqft || '')}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

const BUDGET_CELL_VALUES = {
  devCostCode: (l) => l.devCostCode || '',
  budgetCode: (l) => l.itemId || '',
  description: (l) => l.description || '',
  costType: (l) => l.costType || '',
  unit: (l) => l.unit || '',
  area: (l, areaMap) => areaMap.get(l.areaId) || '',
  unitCost: (l) => formatCurrency(lineUnitCost(l)),
  markup: (l) => (l.markupPct === '' || l.markupPct == null ? '' : `${l.markupPct}%`),
  qty: (l) => (l.qty ?? ''),
  notes: (l) => l.notes || '',
  total: (l) => formatCurrency(lineTotal(l)),
};

// Grouped by category (like the editor's grid), for one version, using the
// same column order/visibility the user set up in the Budget Lines grid.
function buildBudgetSection(p, versionId) {
  const lines = linesForVersion(p.lines, versionId);
  if (!lines.length) return '<h3>Budget Lines</h3><p class="muted">No budget lines.</p>';
  const areaMap = new Map((p.info.areas || []).map((a) => [a.id, a.name]));
  const cols = visibleColumnOrder(p);
  const groups = new Map();
  lines.forEach((l) => {
    const cat = l.category || 'Uncategorized';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(l);
  });
  let grand = 0;
  const bodyHtml = Array.from(groups.entries())
    .map(([cat, catLines]) => {
      let catTotal = 0;
      const itemRows = catLines
        .map((l) => {
          catTotal += lineTotal(l);
          return `<tr>${cols.map((c) => `<td>${escapeHtml(String(BUDGET_CELL_VALUES[c](l, areaMap)))}</td>`).join('')}</tr>`;
        })
        .join('');
      grand += catTotal;
      return `<tr class="print-cat-row"><td colspan="${cols.length}"><strong>${escapeHtml(cat)}</strong> <span class="muted">(${formatCurrency(catTotal)})</span></td></tr>${itemRows}`;
    })
    .join('');
  return `
    <h3>Budget Lines</h3>
    <table class="table">
      <thead><tr>${cols.map((c) => `<th>${escapeHtml(BUDGET_COLUMN_LABELS[c] || c)}</th>`).join('')}</tr></thead>
      <tbody>${bodyHtml}<tr class="print-grand-row"><td colspan="${cols.length}"><strong>Total: ${formatCurrency(grand)}</strong></td></tr></tbody>
    </table>
  `;
}

function buildFinishesSection(p, versionId) {
  const lines = linesForVersion(p.finishLines, versionId);
  if (!lines.length) return '<h3>Interior Finishes</h3><p class="muted">No finishes selected.</p>';
  const areaMap = new Map((p.info.areas || []).map((a) => [a.id, a.name]));
  let total = 0;
  const rows = lines
    .map((l) => {
      const t = (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
      total += t;
      return `<tr><td>${escapeHtml(l.description || '')}</td><td>${escapeHtml(areaMap.get(l.areaId) || '')}</td><td>${escapeHtml(l.unit || '')}</td><td>${formatCurrency(l.unitPrice)}</td><td>${escapeHtml(l.qty ?? '')}</td><td>${escapeHtml(l.notes || '')}</td><td>${formatCurrency(t)}</td></tr>`;
    })
    .join('');
  return `
    <h3>Interior Finishes</h3>
    <table class="table">
      <thead><tr><th>Description</th><th>Area</th><th>Unit</th><th>Unit Price</th><th>Qty</th><th>Notes</th><th>Total</th></tr></thead>
      <tbody>${rows}<tr class="print-grand-row"><td colspan="6"><strong>Total</strong></td><td><strong>${formatCurrency(total)}</strong></td></tr></tbody>
    </table>
  `;
}

function buildFeesSection(p, versionId) {
  const f = feeAmounts(p, versionId);
  const sqft = totalSqft(p);
  return `
    <h3>GC Fees &amp; Adjustments</h3>
    <table class="table">
      <tbody>
        <tr><td>Hard Cost Subtotal</td><td class="num-cell">${formatCurrency(f.hardCost)}</td></tr>
        ${FEE_KEYS.map((fk) => `<tr><td>${escapeHtml(fk.label)}</td><td class="num-cell">${formatCurrency(f[fk.key])}</td></tr>`).join('')}
        <tr class="print-grand-row"><td><strong>Grand Total</strong></td><td class="num-cell"><strong>${formatCurrency(f.grandTotal)}</strong></td></tr>
        ${sqft > 0 ? `<tr><td>Cost / SF (${sqft.toLocaleString()} SF)</td><td class="num-cell">${formatCurrency(costPerSf(f.grandTotal, sqft))}</td></tr>` : ''}
      </tbody>
    </table>
  `;
}

// Multi-version Top-Line Comparison + By Area breakdown -- the one section
// that isn't scoped to a single version, since comparing versions is the
// whole point of it.
function buildSummarySection(p) {
  const groups = categoryGroups(p);
  const versions = p.info.versions;
  const areas = p.info.areas || [];
  const sqft = totalSqft(p);
  return `
    <h3>Top-Line Comparison</h3>
    <table class="table compare-table">
      <thead><tr><th>Category</th>${versions.map((v) => `<th>${escapeHtml(v.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${groups
          .map(({ category, subcategories }) => {
            const catValues = versions.map((v) => categoryTotal(p, v.id, category));
            const catMin = Math.min(...catValues);
            const catRow = `<tr class="subtotal-row"><td>${escapeHtml(category)}</td>${catValues.map((val) => `<td class="${val === catMin ? 'best' : ''}">${formatCurrency(val)}</td>`).join('')}</tr>`;
            const subRows = subcategories
              .map((sub) => {
                const values = versions.map((v) => subcategoryTotal(p, v.id, category, sub));
                const min = Math.min(...values);
                return `<tr><td class="indent">${escapeHtml(sub)}</td>${values.map((val) => `<td class="${val === min ? 'best' : ''}">${formatCurrency(val)}</td>`).join('')}</tr>`;
              })
              .join('');
            return subRows + catRow;
          })
          .join('')}
        <tr class="subtotal-row"><td>Interior Finishes Subtotal</td>${versions.map((v) => `<td>${formatCurrency(versionTotal(p, v.id).finishes)}</td>`).join('')}</tr>
        <tr class="subtotal-row"><td>Hard Cost Subtotal</td>${versions.map((v) => `<td>${formatCurrency(versionTotal(p, v.id).total)}</td>`).join('')}</tr>
        ${FEE_KEYS.map((fk) => `<tr><td>${escapeHtml(fk.label)}</td>${versions.map((v) => `<td>${formatCurrency(feeAmounts(p, v.id)[fk.key])}</td>`).join('')}</tr>`).join('')}
        <tr class="grand-row">
          <td>Grand Total</td>
          ${(() => {
            const totals = versions.map((v) => feeAmounts(p, v.id).grandTotal);
            const min = Math.min(...totals);
            return totals.map((t) => `<td class="${t === min ? 'best' : ''}">${formatCurrency(t)}</td>`).join('');
          })()}
        </tr>
        ${sqft > 0 ? `<tr class="sf-row"><td>$ / SF (${sqft.toLocaleString()} SF)</td>${versions.map((v) => `<td>${formatCurrency(costPerSf(feeAmounts(p, v.id).grandTotal, sqft))}</td>`).join('')}</tr>` : ''}
      </tbody>
    </table>
    ${
      areas.length > 1
        ? `
    <h3>By Area / Level</h3>
    <table class="table compare-table">
      <thead><tr><th>Area</th>${versions.map((v) => `<th>${escapeHtml(v.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${areas
          .map(
            (a) => `
          <tr>
            <td>${escapeHtml(a.name)}${a.sqft ? ` <span class="muted">(${a.sqft} SF)</span>` : ''}</td>
            ${versions
              .map((v) => {
                const total = areaTotal(p, v.id, a.id);
                const perSf = a.sqft ? costPerSf(total, a.sqft) : null;
                return `<td>${formatCurrency(total)}${perSf !== null ? `<br><span class="muted">${formatCurrency(perSf)} / SF</span>` : ''}</td>`;
              })
              .join('')}
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`
        : ''
    }
  `;
}

export const SECTION_DEFS = {
  info: { label: 'Project Info', build: buildInfoSection },
  areas: { label: 'Areas / Levels', build: buildAreasSection },
  budget: { label: 'Budget Lines', build: buildBudgetSection },
  finishes: { label: 'Interior Finishes', build: buildFinishesSection },
  fees: { label: 'GC Fees & Adjustments', build: buildFeesSection },
  summary: { label: 'Summary / Comparison', build: buildSummarySection },
};

export const DEFAULT_SECTION_ORDER = ['info', 'areas', 'budget', 'finishes', 'fees', 'summary'];
