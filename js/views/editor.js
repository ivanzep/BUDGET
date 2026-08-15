import { api } from '../api.js';
import {
  state, setProject, newProject, addVersion, removeVersion, duplicateVersion, addArea, removeArea,
} from '../state.js';
import {
  lineTotal, finishLineTotal, linesForVersion, versionTotal, feeAmounts, totalSqft, costPerSf,
} from '../calc.js';
import { escapeHtml, formatCurrency, toast, uid, resizeImageFile } from '../util.js';
import { openModal, closeModal } from '../modal.js';
import { FINISHES_FIELD_MAP } from '../config.js';

let container;
// rowId -> { catKey, subKey } for budget lines, populated on each render of the lines table.
let lineGroupKeys = new Map();
// rowId -> catKey for finish lines
let finishGroupKeys = new Map();
// Which top-level editor tab is showing: 'info' | 'areas' | 'budget' | 'fees'
let activeTab = 'info';

export async function renderEditor(el, id) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';

  if (id === 'new') {
    setProject(newProject());
    activeTab = 'info';
  } else if (!state.project.id || state.project.id !== id) {
    try {
      const raw = await api.loadProject(id);
      setProject(fromWire(raw));
      activeTab = 'budget';
    } catch (err) {
      container.innerHTML = `<p class="error">Could not load project: ${escapeHtml(err.message)}</p>`;
      return;
    }
  }

  await ensureCatalogs();
  draw();
}

async function ensureCatalogs() {
  try {
    if (!state.budgetCatalog) state.budgetCatalog = await api.getBudgetCatalog();
    if (!state.finishesCatalog) state.finishesCatalog = await api.getFinishesCatalog();
  } catch (err) {
    toast(`Catalog load failed: ${err.message}`, true);
    state.budgetCatalog = state.budgetCatalog || [];
    state.finishesCatalog = state.finishesCatalog || [];
  }
}

function fromWire(raw) {
  const info = raw.info || {};
  info.versions = info.versions && info.versions.length ? info.versions : [{ id: uid('v'), name: 'Version 1' }];
  const lines = (raw.lines || []).map((l) => ({ ...l, _rowId: uid('l') }));
  const finishLines = (raw.finishLines || []).map((l) => ({
    ...l,
    _rowId: uid('f'),
    fields: safeParse(l.fieldsJson),
  }));
  return { id: raw.id, info, lines, finishLines };
}

function safeParse(json) {
  try { return json ? JSON.parse(json) : {}; } catch { return {}; }
}

// Fill in areaId on any line that predates the Areas feature.
function backfillAreaIds() {
  const firstAreaId = state.project.info.areas[0]?.id;
  if (!firstAreaId) return;
  state.project.lines.forEach((l) => { if (!l.areaId) l.areaId = firstAreaId; });
  state.project.finishLines.forEach((l) => { if (!l.areaId) l.areaId = firstAreaId; });
}

const EDITOR_TABS = [
  { id: 'info', label: 'Project Info' },
  { id: 'areas', label: 'Areas / Levels' },
  { id: 'budget', label: 'Budget & Finishes' },
  { id: 'fees', label: 'GC Fees & Adjustments' },
];

function draw() {
  const p = state.project;
  backfillAreaIds();
  const activeVersion = p.info.versions.find((v) => v.id === state.activeVersionId) || p.info.versions[0];
  state.activeVersionId = activeVersion.id;
  const areas = p.info.areas;

  container.innerHTML = `
    <div class="view-header">
      <h2>${p.id ? 'Edit Project' : 'New Project'}</h2>
      <div class="actions">
        ${p.id ? `<a class="btn" href="#/summary/${p.id}">Summary / Compare</a>` : ''}
        <button class="btn btn-primary" id="save-project">Save Project</button>
      </div>
    </div>

    <div class="editor-tabs">
      ${EDITOR_TABS.map((t) => `<button class="tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>

    <section class="card">
      ${activeTab === 'info' ? renderInfoTab(p) : ''}
      ${activeTab === 'areas' ? renderAreasTab(areas) : ''}
      ${activeTab === 'budget' ? renderBudgetTab(p, activeVersion, areas) : ''}
      ${activeTab === 'fees' ? renderFeesTab(p, activeVersion) : ''}
    </section>
  `;

  wireEvents(activeVersion);
}

function renderInfoTab(p) {
  return `
    <h3>Project Info</h3>
    <div class="form-grid">
      <label>Project Name <input type="text" id="f-name" value="${escapeHtml(p.info.name)}"></label>
      <label>Client <input type="text" id="f-client" value="${escapeHtml(p.info.client)}"></label>
      <label>Date <input type="date" id="f-date" value="${escapeHtml(p.info.date)}"></label>
      <label>Project # <input type="text" id="f-projectNumber" value="${escapeHtml(p.info.projectNumber)}"></label>
      <label>Address <input type="text" id="f-address" value="${escapeHtml(p.info.address)}"></label>
      <label>Logo URL <input type="text" id="f-logoUrl" placeholder="https://..." value="${escapeHtml(p.info.logoUrl)}"></label>
      <label>Or upload logo <input type="file" id="f-logoFile" accept="image/*"></label>
      <label class="full">Notes <textarea id="f-notes" rows="2">${escapeHtml(p.info.notes)}</textarea></label>
    </div>
    ${p.info.logoUrl ? `<img src="${p.info.logoUrl}" alt="logo preview" class="logo-preview">` : ''}
  `;
}

function renderAreasTab(areas) {
  return `
    <h3>Areas / Levels <button class="btn btn-sm btn-primary" id="add-area">+ Add Area</button></h3>
    <p class="muted">Break the project into levels or sections (e.g. Main House, ADU, Site) to get $/SF by area. Budget lines are assigned to an area on the Budget &amp; Finishes tab.</p>
    <table class="table">
      <thead><tr><th>Name</th><th>Square Footage</th><th></th></tr></thead>
      <tbody>
        ${areas
          .map(
            (a) => `
          <tr>
            <td><input type="text" data-area-field="name" data-area="${a.id}" value="${escapeHtml(a.name)}"></td>
            <td><input type="number" data-area-field="sqft" data-area="${a.id}" value="${a.sqft ?? ''}" style="width:8em"></td>
            <td><button class="link-btn danger" data-remove-area="${a.id}" ${areas.length <= 1 ? 'disabled' : ''}>Remove</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderVersionBar(p, activeVersion) {
  return `
    <div class="version-bar">
      <div class="version-tabs">
        ${p.info.versions
          .map(
            (v) => `<button class="tab ${v.id === activeVersion.id ? 'active' : ''}" data-version="${v.id}">${escapeHtml(v.name)}</button>`
          )
          .join('')}
      </div>
      <div class="version-tools">
        <button class="btn btn-sm" id="add-version">+ Version</button>
        <button class="btn btn-sm" id="rename-version">Rename</button>
        <button class="btn btn-sm" id="dup-version">Duplicate</button>
        <button class="btn btn-sm danger" id="remove-version" ${p.info.versions.length <= 1 ? 'disabled' : ''}>Remove</button>
      </div>
    </div>
  `;
}

function renderBudgetTab(p, activeVersion, areas) {
  return `
    ${renderVersionBar(p, activeVersion)}

    <h3>Budget Lines <button class="btn btn-sm btn-primary" id="add-budget-line">+ Add Item</button></h3>
    ${renderLinesTable(linesForVersion(p.lines, activeVersion.id), areas)}

    <h3>Interior Finishes <button class="btn btn-sm btn-primary" id="add-finish-line">+ Add Finish</button></h3>
    ${renderFinishTable(linesForVersion(p.finishLines, activeVersion.id), areas)}

    <div class="totals-box" id="totals-box">${totalsBoxHtml(p, activeVersion.id)}</div>

    <h3>GC Fees &amp; Adjustments <a href="#" data-tab="fees" class="link-btn">Edit on GC Fees tab</a></h3>
    <div class="totals-box fees-box">${feesBoxHtml(p, activeVersion.id)}</div>
  `;
}

function renderFeesTab(p, activeVersion) {
  return `
    ${renderVersionBar(p, activeVersion)}

    <h3>GC Fees &amp; Adjustments</h3>
    <p class="muted">Computed off the Hard Cost Subtotal (budget lines + interior finishes) for this version.</p>
    <div class="form-grid" id="fees-form">
      <label>Overhead % <input type="number" step="0.1" data-fee="overheadPct" value="${activeVersion.overheadPct ?? 0}"></label>
      <label>GC Company Margin % <input type="number" step="0.1" data-fee="gcMarginPct" value="${activeVersion.gcMarginPct ?? 0}"></label>
      <label>PM/Supervision $ / month <input type="number" step="1" data-fee="pmMonthlyRate" value="${activeVersion.pmMonthlyRate ?? 0}"></label>
      <label>PM/Supervision months <input type="number" step="0.5" data-fee="pmMonths" value="${activeVersion.pmMonths ?? 0}"></label>
      <label>Insurance $ / month <input type="number" step="1" data-fee="insuranceMonthlyRate" value="${activeVersion.insuranceMonthlyRate ?? 0}"></label>
      <label>Insurance months <input type="number" step="0.5" data-fee="insuranceMonths" value="${activeVersion.insuranceMonths ?? 0}"></label>
      <label>Contingency Reserve % <input type="number" step="0.1" data-fee="contingencyPct" value="${activeVersion.contingencyPct ?? 0}"></label>
    </div>
    <div class="totals-box fees-box">${feesBoxHtml(p, activeVersion.id)}</div>
  `;
}

function totalsBoxHtml(p, versionId) {
  const t = versionTotal(p, versionId);
  return `Budget: <strong>${formatCurrency(t.budget)}</strong> &nbsp;|&nbsp; Finishes: <strong>${formatCurrency(t.finishes)}</strong> &nbsp;|&nbsp; Hard Cost Subtotal: <strong>${formatCurrency(t.total)}</strong>`;
}

function feesBoxHtml(p, versionId) {
  const f = feeAmounts(p, versionId);
  const sqft = totalSqft(p);
  return `
    Overhead: <strong>${formatCurrency(f.overhead)}</strong> &nbsp;|&nbsp;
    GC Margin: <strong>${formatCurrency(f.gcMargin)}</strong> &nbsp;|&nbsp;
    PM/Supervision: <strong>${formatCurrency(f.pm)}</strong> &nbsp;|&nbsp;
    Insurance: <strong>${formatCurrency(f.insurance)}</strong> &nbsp;|&nbsp;
    Contingency: <strong>${formatCurrency(f.contingency)}</strong><br>
    <span style="font-size:1.1rem">Grand Total: <strong>${formatCurrency(f.grandTotal)}</strong></span>
    ${sqft > 0 ? ` &nbsp;|&nbsp; ${formatCurrency(costPerSf(f.grandTotal, sqft))} / SF (${sqft} SF total)` : ' &nbsp;|&nbsp; <span class="muted">Add square footage under Areas for $/SF</span>'}
  `;
}

function groupLines(lines) {
  const map = new Map();
  lines.forEach((l) => {
    const cat = l.category || 'Uncategorized';
    const sub = l.subcategory || '';
    if (!map.has(cat)) map.set(cat, new Map());
    const subMap = map.get(cat);
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub).push(l);
  });
  return map;
}

function renderLinesTable(lines, areas) {
  lineGroupKeys = new Map();
  if (!lines.length) return '<p class="muted">No budget lines yet.</p>';
  const groups = groupLines(lines);
  let catIdx = 0;
  const groupHtml = [];
  groups.forEach((subMap, category) => {
    const catKey = `c${catIdx++}`;
    let catTotal = 0;
    let subIdx = 0;
    const subHtml = [];
    subMap.forEach((items, subcategory) => {
      const subKey = `${catKey}-s${subIdx++}`;
      let subTotal = 0;
      const itemRows = items
        .map((l) => {
          subTotal += lineTotal(l);
          lineGroupKeys.set(l._rowId, { catKey, subKey });
          return itemRowHtml(l, areas);
        })
        .join('');
      catTotal += subTotal;
      subHtml.push(`
        ${subcategory ? `<tr class="group-row sub-row"><td colspan="7">${escapeHtml(subcategory)}</td><td class="subtotal-cell" data-subcat-total="${subKey}">${formatCurrency(subTotal)}</td><td></td></tr>` : ''}
        ${itemRows}
      `);
    });
    groupHtml.push(`
      <tr class="group-row cat-row"><td colspan="7"><strong>${escapeHtml(category)}</strong></td><td class="subtotal-cell" data-cat-total="${catKey}"><strong>${formatCurrency(catTotal)}</strong></td><td></td></tr>
      ${subHtml.join('')}
    `);
  });
  return `
    <table class="table grouped-table">
      <thead><tr><th>Description</th><th>Unit</th><th>Area</th><th>Unit $ (M+L)</th><th>Markup %</th><th>Qty</th><th>Notes</th><th>Total</th><th></th></tr></thead>
      <tbody>${groupHtml.join('')}</tbody>
    </table>
  `;
}

function itemRowHtml(l, areas) {
  return `
    <tr data-line-id="${l._rowId}">
      <td>${escapeHtml(l.description)}</td>
      <td>${escapeHtml(l.unit)}</td>
      <td>
        <select data-field="areaId" data-line="${l._rowId}">
          ${areas.map((a) => `<option value="${a.id}" ${l.areaId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </td>
      <td>${formatCurrency((Number(l.unitCostMaterial) || 0) + (Number(l.unitCostLabor) || 0))}</td>
      <td><input type="number" class="qty-input" data-field="markupPct" data-line="${l._rowId}" value="${l.markupPct ?? 0}" step="1" style="width:4.5em"></td>
      <td><input type="number" class="qty-input" data-field="qty" data-line="${l._rowId}" value="${l.qty ?? 1}" step="0.01" style="width:5em"></td>
      <td><input type="text" class="notes-input" data-field="notes" data-line="${l._rowId}" value="${escapeHtml(l.notes || '')}"></td>
      <td>${formatCurrency(lineTotal(l))}</td>
      <td><button class="link-btn danger" data-remove-line="${l._rowId}">Remove</button></td>
    </tr>`;
}

function renderFinishTable(lines, areas) {
  finishGroupKeys = new Map();
  if (!lines.length) return '<p class="muted">No finishes selected yet.</p>';
  const map = new Map();
  lines.forEach((l) => {
    const cat = l.category || 'Uncategorized';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(l);
  });
  let catIdx = 0;
  const groupHtml = [];
  map.forEach((items, category) => {
    const catKey = `f${catIdx++}`;
    let catTotal = 0;
    const rows = items
      .map((l) => {
        catTotal += finishLineTotal(l);
        finishGroupKeys.set(l._rowId, catKey);
        return finishRowHtml(l, areas);
      })
      .join('');
    groupHtml.push(`
      <tr class="group-row cat-row"><td colspan="5"><strong>${escapeHtml(category)}</strong></td><td class="subtotal-cell" data-fcat-total="${catKey}"><strong>${formatCurrency(catTotal)}</strong></td><td></td></tr>
      ${rows}
    `);
  });
  return `
    <table class="table grouped-table">
      <thead><tr><th>Description</th><th>Unit Price</th><th>Area</th><th>Qty</th><th>Notes</th><th>Total</th><th></th></tr></thead>
      <tbody>${groupHtml.join('')}</tbody>
    </table>
  `;
}

function finishRowHtml(l, areas) {
  return `
    <tr data-line-id="${l._rowId}">
      <td>${escapeHtml(l.description)}</td>
      <td>${formatCurrency(l.unitPrice)}</td>
      <td>
        <select data-field="areaId" data-fline="${l._rowId}">
          ${areas.map((a) => `<option value="${a.id}" ${l.areaId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </td>
      <td><input type="number" class="qty-input" data-field="qty" data-fline="${l._rowId}" value="${l.qty ?? 1}" step="0.01" style="width:5em"></td>
      <td><input type="text" class="notes-input" data-field="notes" data-fline="${l._rowId}" value="${escapeHtml(l.notes || '')}"></td>
      <td>${formatCurrency(finishLineTotal(l))}</td>
      <td><button class="link-btn danger" data-remove-fline="${l._rowId}">Remove</button></td>
    </tr>`;
}

function wireEvents(activeVersion) {
  const p = state.project;

  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      activeTab = btn.dataset.tab;
      draw();
    });
  });

  container.querySelector('#f-name')?.addEventListener('input', (e) => (p.info.name = e.target.value));
  container.querySelector('#f-client')?.addEventListener('input', (e) => (p.info.client = e.target.value));
  container.querySelector('#f-date')?.addEventListener('input', (e) => (p.info.date = e.target.value));
  container.querySelector('#f-projectNumber')?.addEventListener('input', (e) => (p.info.projectNumber = e.target.value));
  container.querySelector('#f-address')?.addEventListener('input', (e) => (p.info.address = e.target.value));
  container.querySelector('#f-notes')?.addEventListener('input', (e) => (p.info.notes = e.target.value));
  container.querySelector('#f-logoUrl')?.addEventListener('change', (e) => {
    p.info.logoUrl = e.target.value;
    draw();
  });
  container.querySelector('#f-logoFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    p.info.logoUrl = await resizeImageFile(file);
    draw();
  });

  container.querySelector('#add-area')?.addEventListener('click', () => {
    addArea();
    draw();
  });
  container.querySelectorAll('[data-remove-area]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeArea(btn.dataset.removeArea);
      draw();
    });
  });
  container.querySelectorAll('[data-area]').forEach((input) => {
    input.addEventListener('input', () => {
      const area = p.info.areas.find((a) => a.id === input.dataset.area);
      if (!area) return;
      area[input.dataset.areaField] = input.value;
      patchFeesBox();
    });
  });

  container.querySelectorAll('[data-version]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeVersionId = btn.dataset.version;
      draw();
    });
  });

  container.querySelector('#add-version')?.addEventListener('click', () => {
    const name = prompt('Version name:', `Version ${p.info.versions.length + 1}`);
    if (name === null) return;
    addVersion(name);
    draw();
  });
  container.querySelector('#rename-version')?.addEventListener('click', () => {
    const name = prompt('Rename version:', activeVersion.name);
    if (name === null || !name.trim()) return;
    activeVersion.name = name.trim();
    p.lines.filter((l) => l.versionId === activeVersion.id).forEach((l) => (l.versionName = name.trim()));
    p.finishLines.filter((l) => l.versionId === activeVersion.id).forEach((l) => (l.versionName = name.trim()));
    draw();
  });
  container.querySelector('#dup-version')?.addEventListener('click', () => {
    duplicateVersion(activeVersion.id);
    draw();
  });
  container.querySelector('#remove-version')?.addEventListener('click', () => {
    if (!confirm(`Remove "${activeVersion.name}" and all its lines?`)) return;
    removeVersion(activeVersion.id);
    draw();
  });

  container.querySelector('#add-budget-line')?.addEventListener('click', () => openBudgetPicker(activeVersion));
  container.querySelector('#add-finish-line')?.addEventListener('click', () => openFinishPicker(activeVersion));

  container.querySelectorAll('[data-remove-line]').forEach((btn) => {
    btn.addEventListener('click', () => {
      p.lines = p.lines.filter((l) => l._rowId !== btn.dataset.removeLine);
      draw();
    });
  });
  container.querySelectorAll('[data-remove-fline]').forEach((btn) => {
    btn.addEventListener('click', () => {
      p.finishLines = p.finishLines.filter((l) => l._rowId !== btn.dataset.removeFline);
      draw();
    });
  });

  container.querySelectorAll('[data-line]').forEach((input) => {
    const evt = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(evt, () => {
      const line = p.lines.find((l) => l._rowId === input.dataset.line);
      if (!line) return;
      line[input.dataset.field] = input.value;
      patchLineRow(line, input.dataset.field === 'areaId');
    });
  });
  container.querySelectorAll('[data-fline]').forEach((input) => {
    const evt = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(evt, () => {
      const line = p.finishLines.find((l) => l._rowId === input.dataset.fline);
      if (!line) return;
      line[input.dataset.field] = input.value;
      patchFinishRow(line);
    });
  });

  container.querySelectorAll('[data-fee]').forEach((input) => {
    input.addEventListener('input', () => {
      activeVersion[input.dataset.fee] = input.value;
      patchFeesBox();
    });
  });

  container.querySelector('#save-project')?.addEventListener('click', saveProject);
}

// Patch a single budget line's total, its subcategory/category subtotals, and
// the overall totals — without a full re-render (keeps input focus intact).
// Area changes move a line between groups only after the next full redraw,
// so those trigger a full draw() instead.
function patchLineRow(line, movedGroup) {
  if (movedGroup) { draw(); return; }
  const row = container.querySelector(`tr[data-line-id="${line._rowId}"]`);
  if (row) {
    const totalCell = row.querySelector('td:nth-last-child(2)');
    if (totalCell) totalCell.textContent = formatCurrency(lineTotal(line));
  }
  const keys = lineGroupKeys.get(line._rowId);
  if (keys) {
    const p = state.project;
    const versionLines = linesForVersion(p.lines, state.activeVersionId);
    const subTotal = versionLines
      .filter((l) => lineGroupKeys.get(l._rowId)?.subKey === keys.subKey)
      .reduce((s, l) => s + lineTotal(l), 0);
    const catTotal = versionLines
      .filter((l) => lineGroupKeys.get(l._rowId)?.catKey === keys.catKey)
      .reduce((s, l) => s + lineTotal(l), 0);
    const subCell = container.querySelector(`[data-subcat-total="${keys.subKey}"]`);
    if (subCell) subCell.textContent = formatCurrency(subTotal);
    const catCell = container.querySelector(`[data-cat-total="${keys.catKey}"]`);
    if (catCell) catCell.innerHTML = `<strong>${formatCurrency(catTotal)}</strong>`;
  }
  patchTotalsAndFees();
}

function patchFinishRow(line) {
  const row = container.querySelector(`tr[data-line-id="${line._rowId}"]`);
  if (row) {
    const totalCell = row.querySelector('td:nth-last-child(2)');
    if (totalCell) totalCell.textContent = formatCurrency(finishLineTotal(line));
  }
  const catKey = finishGroupKeys.get(line._rowId);
  if (catKey) {
    const p = state.project;
    const catTotal = linesForVersion(p.finishLines, state.activeVersionId)
      .filter((l) => finishGroupKeys.get(l._rowId) === catKey)
      .reduce((s, l) => s + finishLineTotal(l), 0);
    const catCell = container.querySelector(`[data-fcat-total="${catKey}"]`);
    if (catCell) catCell.innerHTML = `<strong>${formatCurrency(catTotal)}</strong>`;
  }
  patchTotalsAndFees();
}

function patchTotalsAndFees() {
  const box = container.querySelector('#totals-box');
  if (box) box.innerHTML = totalsBoxHtml(state.project, state.activeVersionId);
  patchFeesBox();
}

function patchFeesBox() {
  container.querySelectorAll('.fees-box').forEach((box) => {
    box.innerHTML = feesBoxHtml(state.project, state.activeVersionId);
  });
}

function openBudgetPicker(activeVersion) {
  const catalog = state.budgetCatalog || [];
  const defaultAreaId = state.project.info.areas[0]?.id;
  const body = openModal(`
    <h3>Add Budget Item</h3>
    <input type="text" id="picker-search" placeholder="Search category or description..." class="full">
    <div id="picker-results" class="picker-results"></div>
  `);
  const renderResults = (filter = '') => {
    const f = filter.toLowerCase();
    const items = catalog.filter(
      (c) => !f || `${c.Category} ${c.Subcategory} ${c.Description}`.toLowerCase().includes(f)
    );
    body.querySelector('#picker-results').innerHTML = items
      .slice(0, 200)
      .map(
        (c, i) => `
        <div class="picker-row" data-idx="${catalog.indexOf(c)}">
          <div><strong>${escapeHtml(c.Description)}</strong><br><span class="muted">${escapeHtml(c.Category)} / ${escapeHtml(c.Subcategory || '')}</span></div>
          <div>${formatCurrency((Number(c['Unit Cost (Material)']) || 0) + (Number(c['Unit Cost (Labor)']) || 0))} / ${escapeHtml(c.Unit || '')}</div>
        </div>`
      )
      .join('') || '<p class="muted">No matches.</p>';
    body.querySelectorAll('.picker-row').forEach((row) => {
      row.addEventListener('click', () => {
        const c = catalog[Number(row.dataset.idx)];
        state.project.lines.push({
          _rowId: uid('l'),
          versionId: activeVersion.id,
          versionName: activeVersion.name,
          areaId: defaultAreaId,
          itemId: c['Item ID'] || '',
          category: c.Category || '',
          subcategory: c.Subcategory || '',
          description: c.Description || '',
          unit: c.Unit || '',
          unitCostMaterial: Number(c['Unit Cost (Material)']) || 0,
          unitCostLabor: Number(c['Unit Cost (Labor)']) || 0,
          markupPct: Number(c['Default Markup %']) || 0,
          qty: 1,
          notes: '',
        });
        closeModal();
        draw();
      });
    });
  };
  renderResults();
  body.querySelector('#picker-search').addEventListener('input', (e) => renderResults(e.target.value));
}

function openFinishPicker(activeVersion) {
  const catalog = state.finishesCatalog || [];
  const map = FINISHES_FIELD_MAP;
  const defaultAreaId = state.project.info.areas[0]?.id;
  const body = openModal(`
    <h3>Add Interior Finish</h3>
    <input type="text" id="picker-search" placeholder="Search description or category..." class="full">
    <div id="picker-results" class="picker-results"></div>
  `);
  const renderResults = (filter = '') => {
    const f = filter.toLowerCase();
    const items = catalog.filter((c) => {
      const desc = `${c[map.category] || ''} ${c[map.description] || ''}`.toLowerCase();
      return !f || desc.includes(f);
    });
    body.querySelector('#picker-results').innerHTML = items
      .slice(0, 200)
      .map(
        (c) => `
        <div class="picker-row" data-idx="${catalog.indexOf(c)}">
          <div><strong>${escapeHtml(c[map.description] || '')}</strong><br><span class="muted">${escapeHtml(c[map.category] || '')} ${escapeHtml(c[map.vendor] || '')}</span></div>
          <div>${formatCurrency(c[map.price])} / ${escapeHtml(c[map.unit] || 'ea')}</div>
        </div>`
      )
      .join('') || '<p class="muted">No matches.</p>';
    body.querySelectorAll('.picker-row').forEach((row) => {
      row.addEventListener('click', () => {
        const c = catalog[Number(row.dataset.idx)];
        state.project.finishLines.push({
          _rowId: uid('f'),
          versionId: activeVersion.id,
          versionName: activeVersion.name,
          areaId: defaultAreaId,
          itemId: c[map.id] || '',
          category: c[map.category] || '',
          description: c[map.description] || '',
          unit: c[map.unit] || '',
          unitPrice: Number(c[map.price]) || 0,
          qty: 1,
          notes: '',
          fields: c,
        });
        closeModal();
        draw();
      });
    });
  };
  renderResults();
  body.querySelector('#picker-search').addEventListener('input', (e) => renderResults(e.target.value));
}

function toWire(project) {
  return {
    id: project.id,
    info: project.info,
    lines: project.lines.map(({ _rowId, ...rest }) => rest),
    finishLines: project.finishLines.map(({ _rowId, fields, ...rest }) => ({
      ...rest,
      fieldsJson: JSON.stringify(fields || {}),
    })),
  };
}

async function saveProject() {
  const p = state.project;
  if (!p.info.name.trim()) {
    toast('Project name is required', true);
    return;
  }
  try {
    const result = await api.saveProject(toWire(p));
    p.id = result.id;
    toast('Project saved');
    history.replaceState(null, '', `#/edit/${p.id}`);
    draw();
  } catch (err) {
    toast(`Save failed: ${err.message}`, true);
  }
}
