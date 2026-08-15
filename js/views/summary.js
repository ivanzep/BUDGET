import { api } from '../api.js';
import { state, setProject } from '../state.js';
import {
  versionTotal, categoryGroups, categoryTotal, subcategoryTotal, feeAmounts, totalSqft, costPerSf,
  areaTotal, linesForVersion, lineTotal,
} from '../calc.js';
import { escapeHtml, formatCurrency, toast } from '../util.js';
import { exportCSV, exportExcel, exportPDF } from '../export.js';

export async function renderSummary(container, id, readonly) {
  container.innerHTML = '<p>Loading...</p>';
  if (!state.project.id || state.project.id !== id) {
    try {
      const raw = await api.loadProject(id);
      setProject(fromWire(raw));
    } catch (err) {
      container.innerHTML = `<p class="error">Could not load project: ${escapeHtml(err.message)}</p>`;
      return;
    }
  }
  draw(container, readonly);
}

function fromWire(raw) {
  const info = raw.info || {};
  info.versions = info.versions || [];
  return { id: raw.id, info, lines: raw.lines || [], finishLines: raw.finishLines || [] };
}

function draw(container, readonly) {
  const p = state.project;
  const groups = categoryGroups(p);
  const versions = p.info.versions;
  const areas = p.info.areas || [];
  const sqft = totalSqft(p);
  const shareUrl = `${location.origin}${location.pathname}#/summary/${p.id}?readonly=1`;

  container.innerHTML = `
    <div class="view-header no-print">
      <h2>Summary &amp; Comparison</h2>
      <div class="actions">
        ${readonly ? '' : `<a class="btn" href="#/edit/${p.id}">Back to Editor</a>`}
        <button class="btn" id="btn-print">Print</button>
        <button class="btn" id="btn-pdf">Export PDF</button>
        <button class="btn" id="btn-xlsx">Export Excel</button>
        <button class="btn" id="btn-csv">Export CSV</button>
        <button class="btn" id="btn-share">Copy Share Link</button>
      </div>
    </div>

    <div id="print-area">
      <div class="print-header">
        ${p.info.logoUrl ? `<img src="${p.info.logoUrl}" class="print-logo" alt="logo">` : ''}
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

      <h3>Top-Line Comparison</h3>
      <table class="table compare-table">
        <thead>
          <tr><th>Category</th>${versions.map((v) => `<th>${escapeHtml(v.name)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${groups
            .map(({ category, subcategories }) => {
              const catValues = versions.map((v) => categoryTotal(p, v.id, category));
              const catMin = Math.min(...catValues);
              const catRow = `<tr class="subtotal-row"><td>${escapeHtml(category)}</td>${catValues
                .map((val) => `<td class="${val === catMin ? 'best' : ''}">${formatCurrency(val)}</td>`)
                .join('')}</tr>`;
              const subRows = subcategories
                .map((sub) => {
                  const values = versions.map((v) => subcategoryTotal(p, v.id, category, sub));
                  const min = Math.min(...values);
                  return `<tr><td class="indent">${escapeHtml(sub)}</td>${values
                    .map((val) => `<td class="${val === min ? 'best' : ''}">${formatCurrency(val)}</td>`)
                    .join('')}</tr>`;
                })
                .join('');
              return subRows + catRow;
            })
            .join('')}
          <tr class="subtotal-row">
            <td>Interior Finishes Subtotal</td>
            ${versions.map((v) => `<td>${formatCurrency(versionTotal(p, v.id).finishes)}</td>`).join('')}
          </tr>
          <tr class="subtotal-row">
            <td>Hard Cost Subtotal</td>
            ${versions.map((v) => `<td>${formatCurrency(versionTotal(p, v.id).total)}</td>`).join('')}
          </tr>
          <tr>
            <td>Overhead</td>
            ${versions.map((v) => `<td>${formatCurrency(feeAmounts(p, v.id).overhead)}</td>`).join('')}
          </tr>
          <tr>
            <td>GC Company Margin</td>
            ${versions.map((v) => `<td>${formatCurrency(feeAmounts(p, v.id).gcMargin)}</td>`).join('')}
          </tr>
          <tr>
            <td>PM / Supervision</td>
            ${versions.map((v) => `<td>${formatCurrency(feeAmounts(p, v.id).pm)}</td>`).join('')}
          </tr>
          <tr>
            <td>Insurance</td>
            ${versions.map((v) => `<td>${formatCurrency(feeAmounts(p, v.id).insurance)}</td>`).join('')}
          </tr>
          <tr>
            <td>Contingency Reserve</td>
            ${versions.map((v) => `<td>${formatCurrency(feeAmounts(p, v.id).contingency)}</td>`).join('')}
          </tr>
          <tr class="grand-row">
            <td>Grand Total</td>
            ${(() => {
              const totals = versions.map((v) => feeAmounts(p, v.id).grandTotal);
              const min = Math.min(...totals);
              return totals.map((t) => `<td class="${t === min ? 'best' : ''}">${formatCurrency(t)}</td>`).join('');
            })()}
          </tr>
          ${
            sqft > 0
              ? `<tr class="sf-row"><td>$ / SF (${sqft.toLocaleString()} SF)</td>${versions
                  .map((v) => `<td>${formatCurrency(costPerSf(feeAmounts(p, v.id).grandTotal, sqft))}</td>`)
                  .join('')}</tr>`
              : ''
          }
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

      ${versions
        .map(
          (v) => `
        <div class="version-detail">
          <h3>${escapeHtml(v.name)} — Line Detail</h3>
          ${renderDetailTable(linesForVersion(p.lines, v.id), areas)}
          ${p.finishLines.some((l) => l.versionId === v.id) ? `<h4>Interior Finishes</h4>${renderFinishDetailTable(linesForVersion(p.finishLines, v.id), areas)}` : ''}
        </div>`
        )
        .join('')}

      ${p.info.notes ? `<h3>Notes</h3><p>${escapeHtml(p.info.notes)}</p>` : ''}
    </div>
  `;

  container.querySelector('#btn-print').addEventListener('click', () => window.print());
  container.querySelector('#btn-pdf').addEventListener('click', () => exportPDF('print-area', p));
  container.querySelector('#btn-xlsx').addEventListener('click', () => exportExcel(p));
  container.querySelector('#btn-csv').addEventListener('click', () => exportCSV(p));
  container.querySelector('#btn-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('Read-only share link copied to clipboard');
    } catch {
      prompt('Copy this link:', shareUrl);
    }
  });
}

function areaName(areas, areaId) {
  return areas.find((a) => a.id === areaId)?.name || '';
}

function renderDetailTable(lines, areas) {
  if (!lines.length) return '<p class="muted">No budget lines.</p>';
  return `
    <table class="table">
      <thead><tr><th>Category</th><th>Subcategory</th><th>Description</th><th>Area</th><th>Unit</th><th>Qty</th><th>Notes</th><th>Total</th></tr></thead>
      <tbody>
        ${lines
          .map((l) => {
            return `<tr><td>${escapeHtml(l.category)}</td><td>${escapeHtml(l.subcategory)}</td><td>${escapeHtml(l.description)}</td><td>${escapeHtml(areaName(areas, l.areaId))}</td><td>${escapeHtml(l.unit)}</td><td>${escapeHtml(l.qty)}</td><td>${escapeHtml(l.notes)}</td><td>${formatCurrency(lineTotal(l))}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderFinishDetailTable(lines, areas) {
  if (!lines.length) return '';
  return `
    <table class="table">
      <thead><tr><th>Description</th><th>Area</th><th>Unit Price</th><th>Qty</th><th>Notes</th><th>Total</th></tr></thead>
      <tbody>
        ${lines
          .map((l) => {
            const total = (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
            return `<tr><td>${escapeHtml(l.description)}</td><td>${escapeHtml(areaName(areas, l.areaId))}</td><td>${formatCurrency(l.unitPrice)}</td><td>${escapeHtml(l.qty)}</td><td>${escapeHtml(l.notes)}</td><td>${formatCurrency(total)}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}
