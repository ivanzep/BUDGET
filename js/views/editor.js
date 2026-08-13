import { api } from '../api.js';
import { state, setProject, newProject, addVersion, removeVersion, duplicateVersion } from '../state.js';
import { lineTotal, finishLineTotal, linesForVersion, versionTotal, categoryTotals } from '../calc.js';
import { escapeHtml, formatCurrency, toast, uid, resizeImageFile } from '../util.js';
import { openModal, closeModal } from '../modal.js';
import { FINISHES_FIELD_MAP } from '../config.js';

let container;

export async function renderEditor(el, id) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';

  if (id === 'new') {
    setProject(newProject());
  } else if (!state.project.id || state.project.id !== id) {
    try {
      const raw = await api.loadProject(id);
      setProject(fromWire(raw));
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
  info.versions = info.versions || [{ id: uid('v'), name: 'Version 1' }];
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

function draw() {
  const p = state.project;
  const activeVersion = p.info.versions.find((v) => v.id === state.activeVersionId) || p.info.versions[0];
  state.activeVersionId = activeVersion.id;

  container.innerHTML = `
    <div class="view-header">
      <h2>${p.id ? 'Edit Project' : 'New Project'}</h2>
      <div class="actions">
        ${p.id ? `<a class="btn" href="#/summary/${p.id}">Summary / Compare</a>` : ''}
        <button class="btn btn-primary" id="save-project">Save Project</button>
      </div>
    </div>

    <section class="card">
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
    </section>

    <section class="card">
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

      <h3>Budget Lines <button class="btn btn-sm btn-primary" id="add-budget-line">+ Add Item</button></h3>
      ${renderLinesTable(linesForVersion(p.lines, activeVersion.id))}

      <h3>Interior Finishes <button class="btn btn-sm btn-primary" id="add-finish-line">+ Add Finish</button></h3>
      ${renderFinishTable(linesForVersion(p.finishLines, activeVersion.id))}

      <div class="totals-box">
        ${(() => {
          const t = versionTotal(p, activeVersion.id);
          return `Budget: <strong>${formatCurrency(t.budget)}</strong> &nbsp;|&nbsp; Finishes: <strong>${formatCurrency(t.finishes)}</strong> &nbsp;|&nbsp; Total: <strong>${formatCurrency(t.total)}</strong>`;
        })()}
      </div>
    </section>
  `;

  wireEvents(activeVersion);
}

function renderLinesTable(lines) {
  if (!lines.length) return '<p class="muted">No budget lines yet.</p>';
  return `
    <table class="table">
      <thead><tr><th>Category</th><th>Description</th><th>Unit</th><th>Unit $ (M+L)</th><th>Markup %</th><th>Qty</th><th>Notes</th><th>Total</th><th></th></tr></thead>
      <tbody>
        ${lines
          .map(
            (l) => `
          <tr data-line-id="${l._rowId}">
            <td>${escapeHtml(l.category)}</td>
            <td>${escapeHtml(l.description)}</td>
            <td>${escapeHtml(l.unit)}</td>
            <td>${formatCurrency((Number(l.unitCostMaterial) || 0) + (Number(l.unitCostLabor) || 0))}</td>
            <td><input type="number" class="qty-input" data-field="markupPct" data-line="${l._rowId}" value="${l.markupPct ?? 0}" step="1" style="width:4.5em"></td>
            <td><input type="number" class="qty-input" data-field="qty" data-line="${l._rowId}" value="${l.qty ?? 1}" step="0.01" style="width:5em"></td>
            <td><input type="text" class="notes-input" data-field="notes" data-line="${l._rowId}" value="${escapeHtml(l.notes || '')}"></td>
            <td>${formatCurrency(lineTotal(l))}</td>
            <td><button class="link-btn danger" data-remove-line="${l._rowId}">Remove</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderFinishTable(lines) {
  if (!lines.length) return '<p class="muted">No finishes selected yet.</p>';
  return `
    <table class="table">
      <thead><tr><th>Description</th><th>Unit Price</th><th>Qty</th><th>Notes</th><th>Total</th><th></th></tr></thead>
      <tbody>
        ${lines
          .map(
            (l) => `
          <tr data-line-id="${l._rowId}">
            <td>${escapeHtml(l.description)}</td>
            <td>${formatCurrency(l.unitPrice)}</td>
            <td><input type="number" class="qty-input" data-field="qty" data-fline="${l._rowId}" value="${l.qty ?? 1}" step="0.01" style="width:5em"></td>
            <td><input type="text" class="notes-input" data-field="notes" data-fline="${l._rowId}" value="${escapeHtml(l.notes || '')}"></td>
            <td>${formatCurrency(finishLineTotal(l))}</td>
            <td><button class="link-btn danger" data-remove-fline="${l._rowId}">Remove</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function wireEvents(activeVersion) {
  const p = state.project;

  container.querySelector('#f-name').addEventListener('input', (e) => (p.info.name = e.target.value));
  container.querySelector('#f-client').addEventListener('input', (e) => (p.info.client = e.target.value));
  container.querySelector('#f-date').addEventListener('input', (e) => (p.info.date = e.target.value));
  container.querySelector('#f-projectNumber').addEventListener('input', (e) => (p.info.projectNumber = e.target.value));
  container.querySelector('#f-address').addEventListener('input', (e) => (p.info.address = e.target.value));
  container.querySelector('#f-notes').addEventListener('input', (e) => (p.info.notes = e.target.value));
  container.querySelector('#f-logoUrl').addEventListener('change', (e) => {
    p.info.logoUrl = e.target.value;
    draw();
  });
  container.querySelector('#f-logoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    p.info.logoUrl = await resizeImageFile(file);
    draw();
  });

  container.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeVersionId = btn.dataset.version;
      draw();
    });
  });

  container.querySelector('#add-version').addEventListener('click', () => {
    const name = prompt('Version name:', `Version ${p.info.versions.length + 1}`);
    if (name === null) return;
    addVersion(name);
    draw();
  });
  container.querySelector('#rename-version').addEventListener('click', () => {
    const name = prompt('Rename version:', activeVersion.name);
    if (name === null || !name.trim()) return;
    activeVersion.name = name.trim();
    p.lines.filter((l) => l.versionId === activeVersion.id).forEach((l) => (l.versionName = name.trim()));
    p.finishLines.filter((l) => l.versionId === activeVersion.id).forEach((l) => (l.versionName = name.trim()));
    draw();
  });
  container.querySelector('#dup-version').addEventListener('click', () => {
    duplicateVersion(activeVersion.id);
    draw();
  });
  container.querySelector('#remove-version').addEventListener('click', () => {
    if (!confirm(`Remove "${activeVersion.name}" and all its lines?`)) return;
    removeVersion(activeVersion.id);
    draw();
  });

  container.querySelector('#add-budget-line').addEventListener('click', () => openBudgetPicker(activeVersion));
  container.querySelector('#add-finish-line').addEventListener('click', () => openFinishPicker(activeVersion));

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
    input.addEventListener('input', () => {
      const line = p.lines.find((l) => l._rowId === input.dataset.line);
      if (!line) return;
      line[input.dataset.field] = input.value;
      updateTotalsOnly();
    });
  });
  container.querySelectorAll('[data-fline]').forEach((input) => {
    input.addEventListener('input', () => {
      const line = p.finishLines.find((l) => l._rowId === input.dataset.fline);
      if (!line) return;
      line[input.dataset.field] = input.value;
      updateTotalsOnly();
    });
  });

  container.querySelector('#save-project').addEventListener('click', saveProject);
}

// Re-render just the totals + affected row total cells without losing input focus.
function updateTotalsOnly() {
  const p = state.project;
  const box = container.querySelector('.totals-box');
  const t = versionTotal(p, state.activeVersionId);
  box.innerHTML = `Budget: <strong>${formatCurrency(t.budget)}</strong> &nbsp;|&nbsp; Finishes: <strong>${formatCurrency(t.finishes)}</strong> &nbsp;|&nbsp; Total: <strong>${formatCurrency(t.total)}</strong>`;

  container.querySelectorAll('tr[data-line-id]').forEach((row) => {
    const rowId = row.dataset.lineId;
    const line = p.lines.find((l) => l._rowId === rowId);
    const fline = p.finishLines.find((l) => l._rowId === rowId);
    const totalCell = row.querySelector('td:nth-last-child(2)');
    if (line && totalCell) totalCell.textContent = formatCurrency(lineTotal(line));
    if (fline && totalCell) totalCell.textContent = formatCurrency(finishLineTotal(fline));
  });
}

function openBudgetPicker(activeVersion) {
  const catalog = state.budgetCatalog || [];
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
