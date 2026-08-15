import { api } from '../api.js';
import {
  state, setProject, newProject, addVersion, removeVersion, duplicateVersion, addArea, removeArea,
} from '../state.js';
import {
  lineTotal, lineUnitCost, isOverrideOn, finishLineTotal, linesForVersion, versionTotal, feeAmounts, totalSqft, costPerSf,
} from '../calc.js';
import { escapeHtml, formatCurrency, toast, uid, resizeImageFile, wirePointerDrag, compareValues } from '../util.js';
import { openModal, closeModal } from '../modal.js';
import { FINISHES_FIELD_MAP } from '../config.js';

let container;
// rowId -> { catKey, subKey } for budget lines, populated on each render of the lines table.
let lineGroupKeys = new Map();
// rowId -> catKey for finish lines
let finishGroupKeys = new Map();
// Which top-level editor tab is showing: 'info' | 'areas' | 'budget' | 'fees'
let activeTab = 'info';
// Budget Lines table UI state (collapse, batch-select, drag) -- session-only, not persisted.
let collapsedCats = new Set();
let allCatKeys = [];
let selectedLineIds = new Set();
// Sorting is scoped within each category/subcategory group -- clicking a
// header only reorders the lines inside their existing group, categories
// and subcategories themselves never reorder or mix.
let lineSortState = { field: null, direction: 'asc' };

const COST_TYPE_OPTIONS = ['LABOR', 'MATERIAL', 'EQUIPMENT', 'INSTALLATION', 'FABRICATION', 'SERVICE', 'ALLOWANCE'];

// The Budget Catalog's unique-identifier column links catalog items to
// Budget Lines via the line's Budget Code (itemId) field. It was originally
// called "Item ID"; the catalog sheet may instead be labeled "B.ID" to match
// Budget Lines' own B.ID column. Detected from whatever key actually
// appears on a loaded catalog item/array, so renaming the sheet header
// doesn't silently break the link.
const ITEM_ID_ALIASES = ['item id', 'b.id', 'bid', 'budget id', 'budget code'];
function catalogIdKey(sampleOrArray) {
  const sample = Array.isArray(sampleOrArray) ? sampleOrArray[0] : sampleOrArray;
  if (!sample) return 'Item ID';
  return Object.keys(sample).find((k) => ITEM_ID_ALIASES.includes(k.toLowerCase().trim())) || 'Item ID';
}

// Column keys the user can drag to reorder. "select" and "actions" stay
// pinned to the far left/right.
const REORDERABLE_COLUMNS = [
  'devCostCode', 'budgetCode', 'description', 'costType', 'unit', 'area', 'unitCost', 'markup', 'qty', 'notes', 'total',
];

const BUDGET_COLUMN_LABELS = {
  devCostCode: 'D.ID',
  budgetCode: 'B.ID',
  description: 'Description',
  costType: 'Cost Type',
  unit: 'Unit',
  area: 'Area',
  unitCost: 'Unit $',
  markup: 'Markup %',
  qty: 'Qty',
  notes: 'Notes',
  total: 'Total',
};

function tableSettings() {
  return state.project.info.tableSettings;
}

function getColumnOrder() {
  const saved = tableSettings().columnOrder || [];
  const valid = saved.filter((k) => REORDERABLE_COLUMNS.includes(k));
  const missing = REORDERABLE_COLUMNS.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
}

function setColumnOrder(order) {
  tableSettings().columnOrder = order;
}

function getHiddenColumns() {
  return tableSettings().hiddenColumns || [];
}

function setColumnHidden(key, hidden) {
  const set = new Set(getHiddenColumns());
  if (hidden) set.add(key);
  else set.delete(key);
  tableSettings().hiddenColumns = Array.from(set);
}

function costTypesOf(line) {
  return (line.costType || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function costTypePillsHtml(line) {
  const types = costTypesOf(line);
  if (!types.length) return '<span class="muted">Select...</span>';
  return types.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join('');
}

export async function renderEditor(el, id) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';

  selectedLineIds = new Set();
  collapsedCats = new Set();
  lineSortState = { field: null, direction: 'asc' };

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
  const settings = tableSettings();
  return `
    ${renderVersionBar(p, activeVersion)}

    <h3>Budget Lines <button class="btn btn-sm btn-primary" id="add-budget-line">+ Add Item</button></h3>
    <div class="table-toolbar">
      <button class="btn btn-sm" id="expand-all">Expand All</button>
      <button class="btn btn-sm" id="collapse-all">Collapse All</button>
      <div class="dropdown">
        <button class="btn btn-sm" id="columns-toggle" type="button">Columns ▾</button>
        <div class="dropdown-panel" id="columns-panel" hidden>
          ${REORDERABLE_COLUMNS.map(
            (k) => `<label class="checklist-item"><input type="checkbox" data-hide-col="${k}" ${getHiddenColumns().includes(k) ? '' : 'checked'}> ${escapeHtml(BUDGET_COLUMN_LABELS[k])}</label>`
          ).join('')}
        </div>
      </div>
      <label class="toolbar-setting">Category Color <input type="color" id="cat-color-input" value="${settings.categoryColor}"></label>
      <label class="toolbar-setting">Zoom <input type="number" id="zoom-input" min="50" max="150" step="5" value="${settings.zoomPct}">%</label>
      <span class="muted toolbar-hint">Drag a column's grip to reorder it, or its right edge to resize. Click a header to sort. Saved with the project.</span>
    </div>
    <div class="batch-bar" id="batch-bar">
      <span id="batch-count">0 selected</span>
      <select id="batch-area"><option value="">Set Area...</option>${areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select>
      <button class="btn btn-sm" id="batch-apply-area">Apply Area</button>
      <button class="btn btn-sm" id="batch-costtype">Set Cost Type</button>
      <button class="btn btn-sm" id="batch-adjust-pct">Adjust %</button>
      <button class="btn btn-sm danger" id="batch-delete">Delete Selected</button>
      <button class="btn btn-sm" id="batch-clear">Clear Selection</button>
    </div>
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

// Cells with text (not an input) that fill the column need their own
// left padding, since inputs supply their own. "num" cells are also
// right-aligned so $ figures line up with the category/subtotal totals.
const TEXT_COLS = new Set(['devCostCode', 'description', 'unit', 'unitCost', 'total']);
const NUM_COLS = new Set(['unitCost', 'total']);

function cellClassFor(colKey) {
  const classes = [];
  if (TEXT_COLS.has(colKey)) classes.push('text-cell');
  if (NUM_COLS.has(colKey)) classes.push('num-cell');
  if (colKey === 'actions') classes.push('row-actions');
  return classes.join(' ');
}

function lineSortValue(l, field, areas) {
  switch (field) {
    case 'devCostCode': return l.devCostCode;
    case 'budgetCode': return l.itemId;
    case 'description': return l.description;
    case 'costType': return l.costType;
    case 'unit': return l.unit;
    case 'area': return areas.find((a) => a.id === l.areaId)?.name || '';
    case 'unitCost': return lineUnitCost(l);
    case 'markup': return l.markupPct;
    case 'qty': return l.qty;
    case 'notes': return l.notes;
    case 'total': return lineTotal(l);
    default: return '';
  }
}

function sortLineItems(items, areas) {
  if (!lineSortState.field) return items;
  const dir = lineSortState.direction === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => dir * compareValues(lineSortValue(a, lineSortState.field, areas), lineSortValue(b, lineSortState.field, areas)));
}

function sortIndicator(field) {
  if (lineSortState.field !== field) return '';
  return lineSortState.direction === 'desc' ? ' &#9660;' : ' &#9650;';
}

function renderLinesTable(lines, areas) {
  lineGroupKeys = new Map();
  allCatKeys = [];
  if (!lines.length) return '<p class="muted">No budget lines yet.</p>';
  const hidden = getHiddenColumns();
  const columnOrder = ['select', ...getColumnOrder().filter((k) => !hidden.includes(k)), 'actions'];
  const groups = groupLines(lines);
  let catIdx = 0;
  const groupHtml = [];
  groups.forEach((subMap, category) => {
    const catKey = `c${catIdx++}`;
    const catNum = catIdx; // 1-based: categories are whole numbers.
    allCatKeys.push(catKey);
    let catTotal = 0;
    let subIdx = 0;
    let itemIdx = 0; // sequential across every line in this category, regardless of subcategory -- never repeats.
    const subHtml = [];
    subMap.forEach((rawItems, subcategory) => {
      const subKey = `${catKey}-s${subIdx++}`;
      const items = sortLineItems(rawItems, areas);
      let subTotal = 0;
      const itemRows = items
        .map((l) => {
          subTotal += lineTotal(l);
          itemIdx += 1;
          l.devCostCode = `${catNum}.${String(itemIdx).padStart(2, '0')}`;
          lineGroupKeys.set(l._rowId, { catKey, subKey });
          return itemRowHtml(l, areas, catKey, columnOrder);
        })
        .join('');
      catTotal += subTotal;
      subHtml.push(`
        ${subcategory ? groupRowHtml('sub-row', columnOrder, catKey, subcategory, subTotal, { subKey }) : ''}
        ${itemRows}
      `);
    });
    groupHtml.push(`
      ${groupRowHtml('cat-row', columnOrder, catKey, category, catTotal, { toggle: true, devCode: String(catNum), catName: category })}
      ${subHtml.join('')}
    `);
  });
  return `
    <div class="sheet-wrap">
      <table class="table sheet-table grouped-table" id="budget-lines-table">
        <thead><tr>
          ${columnOrder.map((key) => headerCellHtml(key)).join('')}
        </tr></thead>
        <tbody>${groupHtml.join('')}</tbody>
      </table>
    </div>
  `;
}

function headerCellHtml(key) {
  if (key === 'select') return `<th data-col-key="select"><input type="checkbox" id="select-all-lines"></th>`;
  if (key === 'actions') return `<th data-col-key="actions"></th>`;
  const draggable = REORDERABLE_COLUMNS.includes(key);
  const grip = draggable ? `<span class="col-grip" title="Drag to reorder column">&#8942;&#8942;</span>` : '';
  return `<th data-col-key="${key}" data-sort-key="${key}" class="sortable-col" title="Click to sort">${grip}${escapeHtml(BUDGET_COLUMN_LABELS[key] || '')}${sortIndicator(key)}</th>`;
}

// Renders a category or subcategory header row. Rather than colspan (which
// breaks once columns can be freely reordered), every column gets its own
// cell: the label+toggle always lands in the first content column (so it
// stays at the start of the row no matter how the user reorders the other
// columns), the subtotal lands in "total", everything else is blank.
function groupRowHtml(rowClass, columnOrder, catKey, label, subtotal, opts = {}) {
  const firstColKey = columnOrder.find((k) => k !== 'select' && k !== 'actions' && k !== 'total');
  const cells = columnOrder
    .map((key) => {
      if (key === 'select' || key === 'actions') return '<td></td>';
      if (key === 'total') {
        const attr = opts.subKey ? `data-subcat-total="${opts.subKey}"` : `data-cat-total="${catKey}"`;
        return `<td class="subtotal-cell" ${attr}>${formatCurrency(subtotal)}</td>`;
      }
      if (key === firstColKey) {
        const grip = opts.toggle ? `<span class="row-grip" data-cat-name="${escapeHtml(opts.catName || label)}" title="Drag to reorder this category">&#8942;&#8942;</span>` : '';
        const toggle = opts.toggle ? `<button class="cat-toggle" type="button" data-toggle-cat="${catKey}">${collapsedCats.has(catKey) ? '▸' : '▾'}</button>` : '';
        const code = opts.devCode && key === 'devCostCode' ? `<span class="group-code-prefix">${escapeHtml(opts.devCode)}</span>` : '';
        return `<td class="group-label-cell">${grip}${toggle}${code}${escapeHtml(label)}</td>`;
      }
      if (key === 'devCostCode') {
        return `<td class="text-cell group-code-cell">${escapeHtml(opts.devCode || '')}</td>`;
      }
      return '<td></td>';
    })
    .join('');
  const groupAttr = opts.subKey ? `data-cat-group="${catKey}"` : `data-cat-key="${catKey}" data-cat-name="${escapeHtml(opts.catName || label)}"`;
  return `<tr class="group-row ${rowClass}" ${groupAttr}>${cells}</tr>`;
}

function unitCostCellHtml(l) {
  if (isOverrideOn(l)) {
    return `
      <div class="unit-cost-wrap">
        <label class="override-toggle" title="Manual override enabled"><input type="checkbox" data-field="useOverride" data-line="${l._rowId}" checked></label>
        <input type="number" class="qty-input override-input" data-field="unitPriceOverride" data-line="${l._rowId}" value="${l.unitPriceOverride ?? lineUnitCost(l)}" step="0.01">
      </div>`;
  }
  return `
    <div class="unit-cost-wrap">
      <label class="override-toggle" title="Enable manual unit price override"><input type="checkbox" data-field="useOverride" data-line="${l._rowId}"></label>
      <span>${formatCurrency(lineUnitCost(l))}</span>
    </div>`;
}

const BUDGET_CELL_RENDERERS = {
  select: (l) => `<input type="checkbox" class="row-select" data-select-line="${l._rowId}" ${selectedLineIds.has(l._rowId) ? 'checked' : ''}>`,
  devCostCode: (l) => escapeHtml(l.devCostCode || ''),
  budgetCode: (l) => `<input type="text" class="code-input" data-field="itemId" data-line="${l._rowId}" value="${escapeHtml(l.itemId || '')}">`,
  description: (l) => escapeHtml(l.description),
  costType: (l) => `<button class="costtype-btn" data-open-costtype="${l._rowId}">${costTypePillsHtml(l)}</button>`,
  unit: (l) => escapeHtml(l.unit),
  area: (l, areas) => `
    <select data-field="areaId" data-line="${l._rowId}">
      ${areas.map((a) => `<option value="${a.id}" ${l.areaId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
    </select>`,
  unitCost: (l) => unitCostCellHtml(l),
  markup: (l) => `<input type="number" class="qty-input" data-field="markupPct" data-line="${l._rowId}" value="${l.markupPct ?? 0}" step="1" style="width:4.5em">`,
  qty: (l) => `<input type="number" class="qty-input" data-field="qty" data-line="${l._rowId}" value="${l.qty ?? 1}" step="0.01" style="width:5em">`,
  notes: (l) => `<input type="text" class="notes-input" data-field="notes" data-line="${l._rowId}" value="${escapeHtml(l.notes || '')}">`,
  total: (l) => formatCurrency(lineTotal(l)),
  actions: (l) => `
    <button class="icon-btn" data-refresh-line="${l._rowId}" title="${l.itemId ? 'Pull latest price/description from the catalog' : 'Link this line to a catalog item'}" aria-label="${l.itemId ? 'Refresh from catalog' : 'Link to catalog'}">${l.itemId ? '&#8635;' : '&#128279;'}</button>
    <button class="remove-x-btn" data-remove-line="${l._rowId}" title="Remove line" aria-label="Remove line">&times;</button>`,
};

function itemRowHtml(l, areas, catKey, columnOrder) {
  const cells = columnOrder
    .map((key) => {
      const totalAttr = key === 'total' ? `data-total-cell="${l._rowId}"` : '';
      return `<td class="${cellClassFor(key)}" ${totalAttr}>${BUDGET_CELL_RENDERERS[key](l, areas)}</td>`;
    })
    .join('');
  return `<tr data-line-id="${l._rowId}" data-cat-group="${catKey}">${cells}</tr>`;
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
      <td><button class="remove-x-btn" data-remove-fline="${l._rowId}" title="Remove line" aria-label="Remove line">&times;</button></td>
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
      selectedLineIds.clear();
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

  container.querySelectorAll('[data-open-costtype]').forEach((btn) => {
    btn.addEventListener('click', () => openCostTypeModal(btn.dataset.openCosttype));
  });

  container.querySelectorAll('[data-refresh-line]').forEach((btn) => {
    btn.addEventListener('click', () => refreshLineFromCatalog(btn.dataset.refreshLine));
  });

  container.querySelectorAll('[data-remove-line]').forEach((btn) => {
    btn.addEventListener('click', () => {
      p.lines = p.lines.filter((l) => l._rowId !== btn.dataset.removeLine);
      selectedLineIds.delete(btn.dataset.removeLine);
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
    const isCheckbox = input.type === 'checkbox';
    const field = input.dataset.field;
    // Budget Code (itemId) matches on blur, not every keystroke, so partial
    // typing doesn't trigger lookups/re-renders mid-edit.
    const evt = input.tagName === 'SELECT' || isCheckbox || field === 'itemId' ? 'change' : 'input';
    input.addEventListener(evt, () => {
      const line = p.lines.find((l) => l._rowId === input.dataset.line);
      if (!line) return;
      if (field === 'useOverride') {
        // Seed the override with the current computed value before flipping
        // the flag, so turning it on doesn't silently zero the line out.
        if (input.checked && !isOverrideOn(line)) line.unitPriceOverride = lineUnitCost(line);
        line.useOverride = input.checked;
        draw();
        return;
      }
      if (field === 'itemId') {
        line.itemId = input.value;
        const trimmed = String(input.value || '').trim();
        const idKey = catalogIdKey(state.budgetCatalog);
        const match = trimmed ? (state.budgetCatalog || []).find((c) => String(c[idKey] || '').trim() === trimmed) : null;
        if (match) {
          applyCatalogItemToLine(line, match);
          toast('Line matched to catalog item');
          draw();
        } else {
          patchLineRow(line, false);
        }
        return;
      }
      line[field] = isCheckbox ? input.checked : input.value;
      patchLineRow(line, field === 'areaId');
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

  wireBudgetTableExtras(p, activeVersion.id);
}

// Collapse/expand, batch-select, and table settings (color/font/column
// widths) for the Budget Lines grid. Only finds elements when the Budget
// tab is showing; every lookup is null-safe so this is a no-op otherwise.
function wireBudgetTableExtras(p, activeVersionId) {
  container.querySelectorAll('[data-toggle-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggleCat;
      if (collapsedCats.has(key)) collapsedCats.delete(key);
      else collapsedCats.add(key);
      applyCollapseState();
    });
  });
  container.querySelector('#expand-all')?.addEventListener('click', () => {
    collapsedCats.clear();
    applyCollapseState();
  });
  container.querySelector('#collapse-all')?.addEventListener('click', () => {
    collapsedCats = new Set(allCatKeys);
    applyCollapseState();
  });
  applyCollapseState();

  container.querySelectorAll('[data-select-line]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedLineIds.add(cb.dataset.selectLine);
      else selectedLineIds.delete(cb.dataset.selectLine);
      updateBatchBar();
    });
  });
  container.querySelector('#select-all-lines')?.addEventListener('change', (e) => {
    const ids = linesForVersion(p.lines, state.activeVersionId).map((l) => l._rowId);
    if (e.target.checked) ids.forEach((id) => selectedLineIds.add(id));
    else ids.forEach((id) => selectedLineIds.delete(id));
    draw();
  });
  container.querySelector('#batch-apply-area')?.addEventListener('click', () => {
    const areaId = container.querySelector('#batch-area').value;
    if (!areaId) {
      toast('Choose an area first', true);
      return;
    }
    p.lines.forEach((l) => {
      if (selectedLineIds.has(l._rowId)) l.areaId = areaId;
    });
    draw();
  });
  container.querySelector('#batch-costtype')?.addEventListener('click', () => {
    if (selectedLineIds.size) openBatchCostTypeModal();
  });
  container.querySelector('#batch-adjust-pct')?.addEventListener('click', () => {
    if (selectedLineIds.size) openBatchAdjustPctModal();
  });
  container.querySelector('#batch-delete')?.addEventListener('click', () => {
    if (!selectedLineIds.size) return;
    if (!confirm(`Delete ${selectedLineIds.size} selected line(s)?`)) return;
    p.lines = p.lines.filter((l) => !selectedLineIds.has(l._rowId));
    selectedLineIds.clear();
    draw();
  });
  container.querySelector('#batch-clear')?.addEventListener('click', () => {
    selectedLineIds.clear();
    draw();
  });
  updateBatchBar();

  container.querySelector('#cat-color-input')?.addEventListener('input', (e) => {
    tableSettings().categoryColor = e.target.value;
    applyTableSettings();
  });
  container.querySelector('#zoom-input')?.addEventListener('input', (e) => {
    const v = Math.max(50, Math.min(150, Number(e.target.value) || 100));
    tableSettings().zoomPct = v;
    applyTableSettings();
  });
  applyTableSettings();

  container.querySelector('#columns-toggle')?.addEventListener('click', () => {
    const panel = container.querySelector('#columns-panel');
    if (panel) panel.hidden = !panel.hidden;
  });
  container.querySelectorAll('[data-hide-col]').forEach((cb) => {
    cb.addEventListener('change', () => {
      setColumnHidden(cb.dataset.hideCol, !cb.checked);
      draw();
    });
  });

  makeColumnsResizable();
  makeColumnsDraggable();
  makeCategoriesDraggable(p, activeVersionId);
  wireLineColumnSort();
}

// Clicking a sortable header sorts the lines inside each category/
// subcategory group by that column -- grouping itself never changes.
// Clicking the same column again flips direction; a different column
// starts fresh, ascending. Ignores clicks on the drag grip so dragging a
// column doesn't also trigger a sort.
function wireLineColumnSort() {
  container.querySelectorAll('#budget-lines-table thead th[data-sort-key]').forEach((th) => {
    th.addEventListener('click', (e) => {
      if (e.target.closest('.col-grip')) return;
      const key = th.dataset.sortKey;
      if (lineSortState.field === key) {
        lineSortState.direction = lineSortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        lineSortState = { field: key, direction: 'asc' };
      }
      draw();
    });
  });
}

function applyCollapseState() {
  container.querySelectorAll('[data-cat-group]').forEach((row) => {
    row.style.display = collapsedCats.has(row.dataset.catGroup) ? 'none' : '';
  });
  container.querySelectorAll('[data-toggle-cat]').forEach((btn) => {
    btn.textContent = collapsedCats.has(btn.dataset.toggleCat) ? '▸' : '▾';
  });
}

function updateBatchBar() {
  const bar = container.querySelector('#batch-bar');
  if (!bar) return;
  const count = selectedLineIds.size;
  bar.classList.toggle('show', count > 0);
  const countEl = container.querySelector('#batch-count');
  if (countEl) countEl.textContent = `${count} selected`;
}

function applyTableSettings() {
  const wrap = container.querySelector('#budget-lines-table')?.closest('.sheet-wrap');
  if (!wrap) return;
  const settings = tableSettings();
  wrap.style.setProperty('--cat-color', settings.categoryColor);
  wrap.style.zoom = (settings.zoomPct || 100) / 100;
}

function makeColumnsResizable() {
  const table = container.querySelector('#budget-lines-table');
  if (!table) return;
  const widths = tableSettings().columnWidths || {};
  table.querySelectorAll('thead th[data-col-key]').forEach((th) => {
    const key = th.dataset.colKey;
    if (widths[key]) th.style.width = widths[key] + 'px';
    th.style.position = 'relative';
    const handle = document.createElement('span');
    handle.className = 'col-resizer';
    th.appendChild(handle);
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = th.offsetWidth;
      const onMove = (ev) => {
        th.style.width = `${Math.max(30, startWidth + (ev.clientX - startX))}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        tableSettings().columnWidths[key] = th.offsetWidth;
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function makeColumnsDraggable() {
  const table = container.querySelector('#budget-lines-table');
  if (!table) return;
  const grips = Array.from(table.querySelectorAll('thead .col-grip'));
  const getTargets = () => Array.from(table.querySelectorAll('thead th[data-col-key]'));
  wirePointerDrag(grips, getTargets, 'th[data-col-key]', (startTh, targetTh) => {
    const draggedKey = startTh.dataset.colKey;
    const targetKey = targetTh.dataset.colKey;
    if (!draggedKey || draggedKey === targetKey) return;
    const order = getColumnOrder();
    const from = order.indexOf(draggedKey);
    const to = order.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, draggedKey);
    setColumnOrder(order);
    draw();
  });
}

// Drags a whole category group (and everything under it) to a new position
// by physically reordering that version's lines, so Dev Cost Code numbers
// (which are derived from render order) recompute automatically.
function makeCategoriesDraggable(p, activeVersionId) {
  const table = container.querySelector('#budget-lines-table');
  if (!table) return;
  const grips = Array.from(table.querySelectorAll('.row-grip'));
  const getTargets = () => Array.from(table.querySelectorAll('tr.cat-row[data-cat-name]'));
  wirePointerDrag(grips, getTargets, 'tr.cat-row[data-cat-name]', (startRow, targetRow) => {
    const draggedName = startRow.dataset.catName;
    const targetName = targetRow.dataset.catName;
    if (!draggedName || draggedName === targetName) return;
    state.project.lines = moveCategoryGroup(p.lines, activeVersionId, draggedName, targetName);
    draw();
  });
}

// Reorders lines so every line in fromCategory moves to sit where
// toCategory's lines are, without disturbing item order within each
// category or lines belonging to other versions.
function moveCategoryGroup(allLines, versionId, fromCategory, toCategory) {
  const versionLines = allLines.filter((l) => l.versionId === versionId);
  const otherLines = allLines.filter((l) => l.versionId !== versionId);
  const catOrder = [];
  const catBuckets = new Map();
  versionLines.forEach((l) => {
    const cat = l.category || 'Uncategorized';
    if (!catBuckets.has(cat)) {
      catBuckets.set(cat, []);
      catOrder.push(cat);
    }
    catBuckets.get(cat).push(l);
  });
  const from = catOrder.indexOf(fromCategory);
  const to = catOrder.indexOf(toCategory);
  if (from === -1 || to === -1) return allLines;
  catOrder.splice(from, 1);
  catOrder.splice(to, 0, fromCategory);
  const reordered = [];
  catOrder.forEach((cat) => reordered.push(...catBuckets.get(cat)));
  return [...otherLines, ...reordered];
}

function openBatchCostTypeModal() {
  const count = selectedLineIds.size;
  const body = openModal(`
    <h3>Set Cost Type for ${count} Line${count === 1 ? '' : 's'}</h3>
    <p class="muted">This replaces the Cost Type on all selected lines.</p>
    <div class="checklist">
      ${COST_TYPE_OPTIONS.map((opt) => `<label class="checklist-item"><input type="checkbox" value="${opt}"> ${opt}</label>`).join('')}
    </div>
    <button class="btn btn-primary" id="batch-costtype-apply" style="margin-top:1rem">Apply</button>
  `);
  body.querySelector('#batch-costtype-apply').addEventListener('click', () => {
    const chosen = Array.from(body.querySelectorAll('input[type=checkbox]:checked')).map((cb) => cb.value);
    state.project.lines.forEach((l) => {
      if (selectedLineIds.has(l._rowId)) l.costType = chosen.join(',');
    });
    closeModal();
    draw();
  });
}

// Scales each selected line's unit cost by a percentage -- e.g. an
// across-the-board escalation or a targeted discount on a subset of lines.
// The result is applied as a manual price override (and the line flags as
// overridden), since the adjusted price no longer matches what the catalog
// or cost-type math alone would compute.
function openBatchAdjustPctModal() {
  const count = selectedLineIds.size;
  const body = openModal(`
    <h3>Adjust ${count} Line${count === 1 ? '' : 's'} by Percentage</h3>
    <p class="muted">Scales each line's current unit price by this percent and marks it as a manual override. Use a negative number to decrease.</p>
    <label>Percent Change <input type="number" id="adjust-pct-input" step="0.1" placeholder="e.g. 10 or -5"></label>
    <button class="btn btn-primary" id="adjust-pct-apply" style="margin-top:1rem">Apply</button>
  `);
  body.querySelector('#adjust-pct-apply').addEventListener('click', () => {
    const pct = Number(body.querySelector('#adjust-pct-input').value);
    if (!pct) {
      toast('Enter a non-zero percent', true);
      return;
    }
    const factor = 1 + pct / 100;
    const round2 = (n) => Math.round(n * 100) / 100;
    state.project.lines.forEach((l) => {
      if (!selectedLineIds.has(l._rowId)) return;
      const newUnitCost = round2(lineUnitCost(l) * factor);
      l.useOverride = true;
      l.unitPriceOverride = newUnitCost;
    });
    closeModal();
    toast(`Adjusted ${count} line(s) by ${pct}% and marked as overridden`);
    draw();
  });
}

// Patch a single budget line's total, its subcategory/category subtotals, and
// the overall totals — without a full re-render (keeps input focus intact).
// Area changes move a line between groups only after the next full redraw,
// so those trigger a full draw() instead.
function patchLineRow(line, movedGroup) {
  if (movedGroup) { draw(); return; }
  const totalCell = container.querySelector(`[data-total-cell="${line._rowId}"]`);
  if (totalCell) totalCell.textContent = formatCurrency(lineTotal(line));
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
    if (catCell) catCell.textContent = formatCurrency(catTotal);
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

function applyCatalogItemToLine(line, c) {
  line.itemId = c[catalogIdKey(c)] || '';
  line.category = c.Category || '';
  line.subcategory = c.Subcategory || '';
  line.description = c.Description || '';
  line.unit = c.Unit || '';
  line.unitCostMaterial = Number(c['Unit Cost (Material)']) || 0;
  line.unitCostLabor = Number(c['Unit Cost (Labor)']) || 0;
  line.markupPct = Number(c['Default Markup %']) || 0;
}

// If the line has an Item ID (added after that field existed), pulls the
// current Category/Subcategory/Description/Unit/Costs/Markup for that ID
// straight from the live catalog. If it doesn't (an older line added before
// Item ID was saving correctly), opens the catalog picker so the user can
// link it to the right item instead. Qty, notes, area, and cost type are
// left as-is either way.
async function refreshLineFromCatalog(rowId) {
  const line = state.project.lines.find((l) => l._rowId === rowId);
  if (!line) return;

  if (!line.itemId) {
    openCatalogPicker('Link Line to Catalog Item', (c) => {
      applyCatalogItemToLine(line, c);
      toast('Line linked and refreshed from catalog');
      draw();
    });
    return;
  }

  try {
    const catalog = await api.getBudgetCatalog();
    state.budgetCatalog = catalog;
    const idKey = catalogIdKey(catalog);
    const match = catalog.find((c) => String(c[idKey] || '').trim() === String(line.itemId).trim());
    if (!match) {
      toast(`No catalog item found with ${idKey} "${line.itemId}"`, true);
      return;
    }
    applyCatalogItemToLine(line, match);
    toast('Line refreshed from catalog');
    draw();
  } catch (err) {
    toast(`Refresh failed: ${err.message}`, true);
  }
}

function openCostTypeModal(rowId) {
  const line = state.project.lines.find((l) => l._rowId === rowId);
  if (!line) return;
  const selected = new Set(costTypesOf(line));
  const body = openModal(`
    <h3>Cost Type</h3>
    <p class="muted">Select any combination that applies to this line.</p>
    <div class="checklist">
      ${COST_TYPE_OPTIONS.map(
        (opt) => `
        <label class="checklist-item">
          <input type="checkbox" value="${opt}" ${selected.has(opt) ? 'checked' : ''}>
          ${opt}
        </label>`
      ).join('')}
    </div>
    <button class="btn btn-primary" id="costtype-apply" style="margin-top:1rem">Apply</button>
  `);
  body.querySelector('#costtype-apply').addEventListener('click', () => {
    const chosen = Array.from(body.querySelectorAll('input[type=checkbox]:checked')).map((cb) => cb.value);
    line.costType = chosen.join(',');
    closeModal();
    draw();
  });
}

// Opens the budget catalog search/pick modal, grouped by Category then
// Subcategory. In single mode (default), clicking a row immediately selects
// it and closes the modal — onSelect(catalogItem). In multi mode, rows
// toggle a checkbox instead, and onSelect(catalogItemsArray) fires once
// when "Add Selected" is clicked.
function openCatalogPicker(title, onSelect, { multi = false } = {}) {
  const catalog = state.budgetCatalog || [];
  const idKey = catalogIdKey(catalog);
  const selected = new Set();
  const body = openModal(
    `
    <h3>${escapeHtml(title)}</h3>
    <input type="text" id="picker-search" placeholder="Search category, description, or code..." class="full">
    <div id="picker-results" class="picker-results picker-results-grouped"></div>
    ${multi ? '<div class="picker-footer"><button class="btn btn-primary" id="picker-add-selected" disabled>Add Selected (0)</button></div>' : ''}
  `,
    { wide: true }
  );

  const updateFooter = () => {
    if (!multi) return;
    const btn = body.querySelector('#picker-add-selected');
    btn.disabled = selected.size === 0;
    btn.textContent = `Add Selected (${selected.size})`;
  };

  const renderResults = (filter = '') => {
    const f = filter.toLowerCase();
    const matches = catalog.filter(
      (c) => !f || `${c.Category} ${c.Subcategory} ${c.Description} ${c[idKey]}`.toLowerCase().includes(f)
    );
    const groups = new Map();
    matches.forEach((c) => {
      const cat = c.Category || 'Uncategorized';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(c);
    });
    const sortedCats = Array.from(groups.keys()).sort();

    body.querySelector('#picker-results').innerHTML =
      sortedCats
        .map((cat) => {
          const items = groups.get(cat).slice().sort((a, b) => (a.Description || '').localeCompare(b.Description || ''));
          return `
          <div class="picker-group">
            <div class="picker-group-header">${escapeHtml(cat)} <span class="muted">(${items.length})</span></div>
            ${items
              .map((c) => {
                const idx = catalog.indexOf(c);
                return `
              <div class="picker-row ${multi && selected.has(idx) ? 'selected' : ''}" data-idx="${idx}">
                ${multi ? `<input type="checkbox" class="picker-checkbox" ${selected.has(idx) ? 'checked' : ''}>` : ''}
                <div class="picker-row-main">
                  <strong>${escapeHtml(c.Description)}</strong>
                  ${c.Subcategory ? `<span class="muted"> · ${escapeHtml(c.Subcategory)}</span>` : ''}
                  ${c[idKey] ? `<span class="picker-code">${escapeHtml(c[idKey])}</span>` : ''}
                </div>
                <div>${formatCurrency((Number(c['Unit Cost (Material)']) || 0) + (Number(c['Unit Cost (Labor)']) || 0))} / ${escapeHtml(c.Unit || '')}</div>
              </div>`;
              })
              .join('')}
          </div>`;
        })
        .join('') || '<p class="muted">No matches.</p>';

    body.querySelectorAll('.picker-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.idx);
        if (multi) {
          if (selected.has(idx)) selected.delete(idx);
          else selected.add(idx);
          row.classList.toggle('selected');
          const cb = row.querySelector('.picker-checkbox');
          if (cb) cb.checked = selected.has(idx);
          updateFooter();
        } else {
          closeModal();
          onSelect(catalog[idx]);
        }
      });
    });
  };
  renderResults();
  body.querySelector('#picker-search').addEventListener('input', (e) => renderResults(e.target.value));
  if (multi) {
    body.querySelector('#picker-add-selected').addEventListener('click', () => {
      const items = Array.from(selected).map((idx) => catalog[idx]);
      closeModal();
      onSelect(items);
    });
  }
}

function openBudgetPicker(activeVersion) {
  const defaultAreaId = state.project.info.areas[0]?.id;
  openCatalogPicker(
    'Add Budget Items',
    (items) => {
      items.forEach((c) => {
        const line = {
          _rowId: uid('l'),
          versionId: activeVersion.id,
          versionName: activeVersion.name,
          areaId: defaultAreaId,
          qty: 1,
          notes: '',
        };
        applyCatalogItemToLine(line, c);
        state.project.lines.push(line);
      });
      draw();
    },
    { multi: true }
  );
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
