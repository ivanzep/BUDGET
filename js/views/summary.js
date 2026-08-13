import { api } from '../api.js';
import { state, setProject } from '../state.js';
import { versionTotal, categoryTotals, allCategories, linesForVersion } from '../calc.js';
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
  const cats = allCategories(p);
  const versions = p.info.versions;
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
          ${cats
            .map((cat) => {
              const values = versions.map((v) => categoryTotals(p, v.id)[cat] || 0);
              const min = Math.min(...values);
              return `<tr><td>${escapeHtml(cat)}</td>${values
                .map((val) => `<td class="${val === min ? 'best' : ''}">${formatCurrency(val)}</td>`)
                .join('')}</tr>`;
            })
            .join('')}
          <tr class="subtotal-row">
            <td>Budget Subtotal</td>
            ${versions.map((v) => `<td>${formatCurrency(versionTotal(p, v.id).budget)}</td>`).join('')}
          </tr>
          <tr class="subtotal-row">
            <td>Interior Finishes Subtotal</td>
            ${versions.map((v) => `<td>${formatCurrency(versionTotal(p, v.id).finishes)}</td>`).join('')}
          </tr>
          <tr class="grand-row">
            <td>Grand Total</td>
            ${(() => {
              const totals = versions.map((v) => versionTotal(p, v.id).total);
              const min = Math.min(...totals);
              return totals.map((t) => `<td class="${t === min ? 'best' : ''}">${formatCurrency(t)}</td>`).join('');
            })()}
          </tr>
        </tbody>
      </table>

      ${versions
        .map(
          (v) => `
        <div class="version-detail">
          <h3>${escapeHtml(v.name)} — Line Detail</h3>
          ${renderDetailTable(linesForVersion(p.lines, v.id))}
          ${p.finishLines.some((l) => l.versionId === v.id) ? `<h4>Interior Finishes</h4>${renderFinishDetailTable(linesForVersion(p.finishLines, v.id))}` : ''}
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

function renderDetailTable(lines) {
  if (!lines.length) return '<p class="muted">No budget lines.</p>';
  return `
    <table class="table">
      <thead><tr><th>Category</th><th>Description</th><th>Unit</th><th>Qty</th><th>Notes</th><th>Total</th></tr></thead>
      <tbody>
        ${lines
          .map((l) => {
            const total =
              (Number(l.qty) || 0) *
              ((Number(l.unitCostMaterial) || 0) + (Number(l.unitCostLabor) || 0)) *
              (1 + (Number(l.markupPct) || 0) / 100);
            return `<tr><td>${escapeHtml(l.category)}</td><td>${escapeHtml(l.description)}</td><td>${escapeHtml(l.unit)}</td><td>${escapeHtml(l.qty)}</td><td>${escapeHtml(l.notes)}</td><td>${formatCurrency(total)}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderFinishDetailTable(lines) {
  if (!lines.length) return '';
  return `
    <table class="table">
      <thead><tr><th>Description</th><th>Unit Price</th><th>Qty</th><th>Notes</th><th>Total</th></tr></thead>
      <tbody>
        ${lines
          .map((l) => {
            const total = (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
            return `<tr><td>${escapeHtml(l.description)}</td><td>${formatCurrency(l.unitPrice)}</td><td>${escapeHtml(l.qty)}</td><td>${escapeHtml(l.notes)}</td><td>${formatCurrency(total)}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}
