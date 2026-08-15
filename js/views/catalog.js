import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatCurrency, toast, wirePointerDrag } from '../util.js';
import { openModal, closeModal } from '../modal.js';

const FALLBACK_FIELDS = [
  'Item ID', 'Category', 'Subcategory', 'Description', 'Unit',
  'Unit Cost (Material)', 'Unit Cost (Labor)', 'Default Markup %', 'Notes',
];

const NEW_CATEGORY_VALUE = '__new__';
const NEW_SUBCATEGORY_VALUE = '__new__';
const COST_FIELDS = ['Unit Cost (Material)', 'Unit Cost (Labor)'];

// Display preferences (grouping color, column order/widths/visibility,
// category display order) aren't project data -- the catalog is a single
// shared sheet, not scoped to a project -- so they're kept as a local
// per-browser preference instead of being saved to the sheet.
const SETTINGS_KEY = 'budgetCatalogTableSettings_v1';
const DEFAULT_SETTINGS = { categoryColor: '#2563eb', columnOrder: [], hiddenColumns: [], columnWidths: {}, categoryOrder: [], zoomPct: 100 };

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    saved = {};
  }
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    columnWidths: { ...(saved.columnWidths || {}) },
    columnOrder: saved.columnOrder || [],
    hiddenColumns: saved.hiddenColumns || [],
    categoryOrder: saved.categoryOrder || [],
  };
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private browsing, quota) -- settings just won't persist.
  }
}

let container;
let fields = [];
let items = [];
let dirtyRows = new Set();
let selectedRows = new Set();
let collapsedCats = new Set();
let allCatKeys = [];
let settings = loadSettings();
// Sorting is scoped within each category -- categories stay the outer
// grouping (Category -> Lines), a column click only reorders the items
// inside each group, never mixes rows across categories.
let sortState = { field: null, direction: 'asc' };

export async function renderCatalog(el) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';
  dirtyRows = new Set();
  selectedRows = new Set();
  sortState = { field: null, direction: 'asc' };
  try {
    [fields, items] = await Promise.all([api.getCatalogFields('budget'), api.getBudgetCatalog()]);
    if (!fields.length) fields = FALLBACK_FIELDS;
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load catalog: ${escapeHtml(err.message)}</p>`;
    return;
  }
  draw();
}

function categoryField() {
  return fields.find((f) => f.toLowerCase() === 'category');
}

function subcategoryField() {
  return fields.find((f) => f.toLowerCase() === 'subcategory');
}

// The catalog's unique-identifier column, whatever it's actually named
// (historically "Item ID", or "B.ID" to match Budget Lines' own field).
const ITEM_ID_ALIASES = ['item id', 'b.id', 'bid', 'budget id', 'budget code'];
function identifierField() {
  return fields.find((f) => ITEM_ID_ALIASES.includes(f.toLowerCase().trim()));
}

function existingCategories() {
  const catField = categoryField();
  if (!catField) return [];
  return Array.from(new Set(items.map((it) => it[catField]).filter((v) => v && String(v).trim()))).sort();
}

function existingSubcategories() {
  const subField = subcategoryField();
  if (!subField) return [];
  return Array.from(new Set(items.map((it) => it[subField]).filter((v) => v && String(v).trim()))).sort();
}

function costFieldsPresent() {
  // Match case-insensitively: sheet headers are hand-typed and their
  // capitalization can drift (e.g. "Unit Cost (labor)" vs "(Labor)"),
  // but we still want to keep whatever exact casing the sheet actually has.
  const wanted = COST_FIELDS.map((f) => f.toLowerCase());
  return fields.filter((f) => wanted.includes(f.toLowerCase()));
}

function markupField() {
  return fields.find((f) => /markup/i.test(f));
}

// Sum of the item's cost fields, with its markup % applied on top. Always
// computed live for display; also written into a "Unit Cost Total" sheet
// column on save, if the sheet has one (see unitCostTotalField()).
function unitCostTotal(it, costFields, markupF) {
  const base = costFields.reduce((sum, f) => sum + (Number(it[f]) || 0), 0);
  const markupPct = markupF ? Number(it[markupF]) || 0 : 0;
  return base * (1 + markupPct / 100);
}

// The sheet's own "Unit Cost Total" column, if the user has added one. When
// present, saves (both inline edits and Add Item) write the live-computed
// total into it so it's visible directly in Google Sheets, not just in the
// app. Absent, the total still displays in the app -- it just isn't
// persisted anywhere.
function unitCostTotalField() {
  return fields.find((f) => /unit\s*cost\s*total/i.test(f));
}

// Sort key for the synthetic Unit Cost Total column, used when the sheet
// has no real column of its own (see unitTotalInfo.totalField in draw()).
const UNIT_TOTAL_SORT_KEY = '__unitCostTotal';

function sortValue(it, field, unitTotalInfo) {
  if (field === unitTotalInfo.totalField || field === UNIT_TOTAL_SORT_KEY) {
    return unitCostTotal(it, unitTotalInfo.costFields, unitTotalInfo.markupF);
  }
  return it[field];
}

// Numeric compare when both sides parse as numbers, otherwise a
// case-insensitive string compare -- spreadsheet-style auto-detection so a
// cost column sorts numerically and a text column sorts alphabetically.
function compareValues(a, b) {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  const na = Number(sa);
  const nb = Number(sb);
  if (sa !== '' && sb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
}

function sortRows(rows, unitTotalInfo) {
  if (!sortState.field) return rows;
  const dir = sortState.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => dir * compareValues(sortValue(a, sortState.field, unitTotalInfo), sortValue(b, sortState.field, unitTotalInfo)));
}

function getColumnOrder() {
  const saved = settings.columnOrder.filter((f) => fields.includes(f));
  const missing = fields.filter((f) => !saved.includes(f));
  return [...saved, ...missing];
}

function setColumnOrder(order) {
  settings.columnOrder = order;
  saveSettings();
}

function getHiddenColumns() {
  return settings.hiddenColumns.filter((f) => fields.includes(f));
}

function setColumnHidden(field, hidden) {
  const set = new Set(settings.hiddenColumns);
  if (hidden) set.add(field);
  else set.delete(field);
  settings.hiddenColumns = Array.from(set);
  saveSettings();
}

function orderCategories(names) {
  const saved = settings.categoryOrder.filter((c) => names.includes(c));
  const missing = names.filter((c) => !saved.includes(c));
  return [...saved, ...missing];
}

function moveCategoryInOrder(names, fromCategory, toCategory) {
  const order = orderCategories(names);
  const from = order.indexOf(fromCategory);
  const to = order.indexOf(toCategory);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, fromCategory);
  settings.categoryOrder = order;
  saveSettings();
}

function draw() {
  const catField = categoryField();
  const subField = subcategoryField();
  const categories = existingCategories();
  const subcategories = existingSubcategories();
  const costFields = costFieldsPresent();
  const markupF = markupField();
  const totalField = unitCostTotalField();
  // A synthetic extra column only when the sheet has no real "Unit Cost
  // Total" column of its own -- otherwise that real column (rendered
  // read-only, see fieldCellHtml) already shows the same live value.
  const showUnitTotal = !totalField && costFields.length > 0;
  const unitTotalInfo = { show: showUnitTotal, costFields, markupF, totalField };
  const hidden = getHiddenColumns();
  const columnOrder = getColumnOrder().filter((f) => !hidden.includes(f));

  container.innerHTML = `
    <div class="view-header">
      <h2>Budget Catalog</h2>
      <div class="actions">
        <button class="btn btn-primary" id="add-item">+ Add</button>
        <button class="btn" id="save-all" disabled>Save All Changes</button>
      </div>
    </div>
    <p class="muted">Editing here writes directly to your Budget Catalog Google Sheet. Rows are matched by sheet row, not by Item ID, so renaming an Item ID won't lose track of the line.</p>

    <div class="table-toolbar">
      ${catField ? `
        <button class="btn btn-sm" id="expand-all">Expand All</button>
        <button class="btn btn-sm" id="collapse-all">Collapse All</button>
        <label class="toolbar-setting">Category Color <input type="color" id="cat-color-input" value="${settings.categoryColor}"></label>
      ` : ''}
      <div class="dropdown">
        <button class="btn btn-sm" id="columns-toggle" type="button">Columns ▾</button>
        <div class="dropdown-panel" id="columns-panel" hidden>
          ${fields.map(
            (f) => `<label class="checklist-item"><input type="checkbox" data-hide-col="${escapeHtml(f)}" ${getHiddenColumns().includes(f) ? '' : 'checked'}> ${escapeHtml(f)}</label>`
          ).join('')}
        </div>
      </div>
      <label class="toolbar-setting">Zoom <input type="number" id="zoom-input" min="50" max="150" step="5" value="${settings.zoomPct}">%</label>
      ${totalField ? `<button class="btn btn-sm" id="save-unit-totals" title="Writes the computed Unit Cost Total into every row, not just ones you've edited">Save Unit Cost Total for All Rows</button>` : ''}
      ${catField ? `
        <select id="catalog-select-category"><option value="">Select by category...</option>${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        <button class="btn btn-sm" id="catalog-select-category-btn">Select Category</button>
      ` : ''}
      ${subField ? `
        <select id="catalog-select-subcategory"><option value="">Select by subcategory...</option>${subcategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        <button class="btn btn-sm" id="catalog-select-subcategory-btn">Select Subcategory</button>
      ` : ''}
      <span class="muted toolbar-hint">Drag a column's grip to reorder it, or its right edge to resize.${catField ? ' Drag a category row\'s grip to reorder groups.' : ''}</span>
    </div>

    <div class="batch-bar batch-bar-stack ${selectedRows.size > 0 ? 'show' : ''}" id="catalog-batch-bar">
      <div class="batch-bar-row">
        <span id="catalog-batch-count">${selectedRows.size} selected</span>
        <button class="btn btn-sm" id="catalog-clear-selection">Clear Selection</button>
      </div>
      <div class="batch-bar-row">
        ${catField ? `
          <select id="catalog-batch-set-category"><option value="">Set category to...</option>${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
          <button class="btn btn-sm" id="catalog-set-category">Apply</button>
        ` : ''}
        ${subField ? `
          <select id="catalog-batch-set-subcategory"><option value="">Set subcategory to...</option>${subcategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
          <button class="btn btn-sm" id="catalog-set-subcategory">Apply</button>
        ` : ''}
        ${costFields
          .map(
            (f) => `<label class="toolbar-setting">${escapeHtml(f)} <input type="number" step="0.01" id="catalog-batch-${cssKey(f)}" style="width:7em"></label>`
          )
          .join('')}
        ${costFields.length ? `<button class="btn btn-sm" id="catalog-apply-cost">Apply Cost to Selected</button>` : ''}
        ${costFields.length ? `
          <label class="toolbar-setting">Adjust cost by % <input type="number" step="0.1" id="catalog-adjust-pct" style="width:5em"></label>
          <button class="btn btn-sm" id="catalog-adjust-cost">Apply</button>
        ` : ''}
        <button class="btn btn-sm danger" id="catalog-delete-selected">Delete Selected</button>
      </div>
    </div>

    <section class="card">
      <div class="sheet-wrap">
        <table class="table sheet-table grouped-table" id="catalog-table">
          <thead>
            <tr><th data-col-key="select"><input type="checkbox" id="catalog-select-all"></th>${columnOrder.map((f) => headerCellHtml(f)).join('')}${showUnitTotal ? `<th data-sort-key="${UNIT_TOTAL_SORT_KEY}" class="sortable-col" title="Click to sort">Unit Cost Total${sortIndicator(UNIT_TOTAL_SORT_KEY)}</th>` : ''}<th data-col-key="actions"></th></tr>
          </thead>
          <tbody>
            ${renderTbody(catField, subField, categories, subcategories, columnOrder, unitTotalInfo)}
          </tbody>
        </table>
      </div>
    </section>
  `;
  wireEvents(catField, subField, costFields);
  applyCollapseState();
  applyZoom();
  applyCategoryColor();
}

function cssKey(fieldName) {
  return fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function sortIndicator(field) {
  if (sortState.field !== field) return '';
  return sortState.direction === 'desc' ? ' &#9660;' : ' &#9650;';
}

function headerCellHtml(field) {
  return `<th data-col-key="${escapeHtml(field)}" data-sort-key="${escapeHtml(field)}" class="sortable-col" title="Click to sort"><span class="col-grip" title="Drag to reorder column">&#8942;&#8942;</span>${escapeHtml(field)}${sortIndicator(field)}</th>`;
}

// A single <select> that always shows the row's current value as its
// selected option (the value itself is folded into the option list even if
// it's not one of the sheet's existing distinct values), plus an "Add New"
// option that prompts for a brand new value. Used for Category/Subcategory
// cells instead of a picker+text-input pair, so there's only ever one
// control and it never looks "stuck" on a placeholder.
function pickSelectHtml(currentValue, options, extraAttrs) {
  const all = Array.from(new Set([...(currentValue ? [currentValue] : []), ...options])).sort();
  return `
    <select ${extraAttrs}>
      <option value="" ${!currentValue ? 'selected' : ''}>-- none --</option>
      ${all.map((o) => `<option value="${escapeHtml(o)}" ${o === currentValue ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      <option value="${NEW_CATEGORY_VALUE}">+ Add New...</option>
    </select>`;
}

function fieldCellHtml(it, f, catField, subField, categories, subcategories, unitTotalInfo) {
  if (f === catField) {
    return `<td>${pickSelectHtml(it[f], categories, `class="cat-select-single" data-field="${escapeHtml(f)}"`)}</td>`;
  }
  if (f === subField) {
    return `<td>${pickSelectHtml(it[f], subcategories, `class="sub-select-single" data-field="${escapeHtml(f)}"`)}</td>`;
  }
  if (f === unitTotalInfo.totalField) {
    // A real "Unit Cost Total" sheet column exists -- show the live-computed
    // value read-only (it's always kept in sync on save) rather than a
    // plain editable text box that would just get overwritten anyway.
    return `<td class="text-cell num-cell unit-total-cell">${formatCurrency(unitCostTotal(it, unitTotalInfo.costFields, unitTotalInfo.markupF))}</td>`;
  }
  return `<td><input type="text" data-field="${escapeHtml(f)}" value="${escapeHtml(it[f] ?? '')}"></td>`;
}

function renderRow(it, catField, subField, categories, subcategories, columnOrder, catKey, unitTotalInfo) {
  return `
    <tr data-row="${it._row}" ${catKey ? `data-cat-group="${catKey}"` : ''}>
      <td><input type="checkbox" class="row-select" data-select-row="${it._row}" ${selectedRows.has(it._row) ? 'checked' : ''}></td>
      ${columnOrder.map((f) => fieldCellHtml(it, f, catField, subField, categories, subcategories, unitTotalInfo)).join('')}
      ${unitTotalInfo.show ? `<td class="text-cell num-cell unit-total-cell">${formatCurrency(unitCostTotal(it, unitTotalInfo.costFields, unitTotalInfo.markupF))}</td>` : ''}
      <td class="row-actions">
        <button class="link-btn danger" data-delete-row="${it._row}">Delete</button>
      </td>
    </tr>`;
}

function renderTbody(catField, subField, categories, subcategories, columnOrder, unitTotalInfo) {
  const extraCols = (unitTotalInfo.show ? 1 : 0) + 2;
  if (!items.length) {
    return `<tr><td colspan="${columnOrder.length + extraCols}" class="muted">No catalog items yet — click "+ Add" above.</td></tr>`;
  }
  if (!catField) {
    allCatKeys = [];
    return sortRows(items, unitTotalInfo).map((it) => renderRow(it, catField, subField, categories, subcategories, columnOrder, null, unitTotalInfo)).join('');
  }

  const groups = new Map();
  items.forEach((it) => {
    const cat = String(it[catField] || '').trim() || 'Uncategorized';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  });
  const orderedCats = orderCategories(Array.from(groups.keys()));
  allCatKeys = orderedCats.map((_, idx) => `c${idx}`);

  return orderedCats
    .map((cat, idx) => {
      const catKey = `c${idx}`;
      const rows = sortRows(groups.get(cat), unitTotalInfo);
      return `
        <tr class="group-row cat-row" data-cat-key="${catKey}" data-cat-name="${escapeHtml(cat)}">
          <td></td>
          <td class="group-label-cell" colspan="${columnOrder.length}">
            <span class="row-grip" data-cat-name="${escapeHtml(cat)}" title="Drag to reorder this category">&#8942;&#8942;</span>
            <button class="cat-toggle" type="button" data-toggle-cat="${catKey}">${collapsedCats.has(catKey) ? '▸' : '▾'}</button>
            ${escapeHtml(cat)} <span class="pill">${rows.length}</span>
          </td>
          ${unitTotalInfo.show ? '<td></td>' : ''}
          <td></td>
        </tr>
        ${rows.map((it) => renderRow(it, catField, subField, categories, subcategories, columnOrder, catKey, unitTotalInfo)).join('')}
      `;
    })
    .join('');
}

function readRowFields(rowEl) {
  const item = {};
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    item[input.dataset.field] = input.value;
  });
  const totalField = unitCostTotalField();
  if (totalField) {
    item[totalField] = unitCostTotal(item, costFieldsPresent(), markupField()).toFixed(2);
  }
  return item;
}

function updateSaveAllButton() {
  const btn = container.querySelector('#save-all');
  if (!btn) return;
  btn.disabled = dirtyRows.size === 0;
  btn.textContent = dirtyRows.size ? `Save All Changes (${dirtyRows.size})` : 'Save All Changes';
}

function markDirty(row) {
  const rowNum = Number(row.dataset.row);
  dirtyRows.add(rowNum);
  row.classList.add('row-dirty');
  updateSaveAllButton();
}

function updateCatalogBatchBar() {
  const el = container.querySelector('#catalog-batch-count');
  if (el) el.textContent = `${selectedRows.size} selected`;
  container.querySelector('#catalog-batch-bar')?.classList.toggle('show', selectedRows.size > 0);
}

function applyZoom() {
  const wrap = container.querySelector('#catalog-table')?.closest('.sheet-wrap');
  if (wrap) wrap.style.zoom = (settings.zoomPct || 100) / 100;
}

function applyCollapseState() {
  container.querySelectorAll('[data-cat-group]').forEach((row) => {
    row.style.display = collapsedCats.has(row.dataset.catGroup) ? 'none' : '';
  });
  container.querySelectorAll('[data-toggle-cat]').forEach((btn) => {
    btn.textContent = collapsedCats.has(btn.dataset.toggleCat) ? '▸' : '▾';
  });
}

function applyCategoryColor() {
  const wrap = container.querySelector('#catalog-table')?.closest('.sheet-wrap');
  if (wrap) wrap.style.setProperty('--cat-color', settings.categoryColor);
}

// Warns (without blocking) when an identifier field is left holding a value
// that matches another row currently on screen -- checked against the live
// inputs, not the last-saved data, so it also catches two rows both being
// edited to the same value in the same session before either is saved.
function wireIdentifierDuplicateCheck() {
  const idField = identifierField();
  if (!idField) return;
  const inputs = Array.from(container.querySelectorAll(`tbody tr[data-row] input[data-field="${cssEscapeAttr(idField)}"]`));
  inputs.forEach((input) => {
    input.addEventListener('blur', () => {
      const value = input.value.trim();
      if (!value) return;
      const dupe = inputs.some((other) => other !== input && other.value.trim().toLowerCase() === value.toLowerCase());
      if (dupe) toast(`"${value}" is already used by another catalog item`, true);
    });
  });
}

function wireEvents(catField, subField, costFields) {
  container.querySelector('#add-item').addEventListener('click', openAddModal);
  container.querySelector('#save-all').addEventListener('click', saveAllChanges);
  container.querySelector('#save-unit-totals')?.addEventListener('click', () => {
    // Marks every row dirty (not just ones already edited) so the normal
    // save path writes each row's current values -- including the freshly
    // computed Unit Cost Total -- back to the sheet, backfilling any row
    // that's never been touched since the column was added.
    container.querySelectorAll('tbody tr[data-row]').forEach((row) => markDirty(row));
    saveAllChanges();
  });

  // "Add New..." selects need their handler wired before the generic
  // dirty-tracker below so the sentinel value is replaced with the typed
  // name first -- listeners on the same element+event run in the order
  // they were attached, so the generic handler then sees the real value.
  container.querySelectorAll('.cat-select-single, .sub-select-single').forEach((select) => {
    select.addEventListener('change', () => {
      if (select.value !== NEW_CATEGORY_VALUE) return;
      const name = prompt('New value:');
      const trimmed = (name || '').trim();
      const addedOption = select.querySelector(`option[value="${cssEscapeAttr(NEW_CATEGORY_VALUE)}"]`);
      if (trimmed) {
        const opt = document.createElement('option');
        opt.value = trimmed;
        opt.textContent = trimmed;
        opt.selected = true;
        select.insertBefore(opt, addedOption);
      } else {
        select.value = '';
      }
    });
  });

  container.querySelectorAll('tbody tr[data-row] [data-field]').forEach((input) => {
    const evt = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(evt, () => markDirty(input.closest('tr')));
  });

  wireIdentifierDuplicateCheck();

  container.querySelectorAll('[data-delete-row]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this catalog item?')) return;
      try {
        await api.deleteCatalogItem('budget', Number(btn.dataset.deleteRow));
        state.budgetCatalog = null;
        toast('Item deleted');
        await renderCatalog(container);
      } catch (err) {
        toast(`Delete failed: ${err.message}`, true);
      }
    });
  });

  container.querySelectorAll('[data-select-row]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const rowNum = Number(cb.dataset.selectRow);
      if (cb.checked) selectedRows.add(rowNum);
      else selectedRows.delete(rowNum);
      updateCatalogBatchBar();
    });
  });
  container.querySelector('#catalog-select-all')?.addEventListener('change', (e) => {
    if (e.target.checked) items.forEach((it) => selectedRows.add(it._row));
    else selectedRows.clear();
    draw();
  });
  container.querySelector('#catalog-select-category-btn')?.addEventListener('click', () => {
    const cat = container.querySelector('#catalog-select-category').value;
    if (!cat || !catField) return;
    items.filter((it) => it[catField] === cat).forEach((it) => selectedRows.add(it._row));
    draw();
  });
  container.querySelector('#catalog-select-subcategory-btn')?.addEventListener('click', () => {
    const sub = container.querySelector('#catalog-select-subcategory').value;
    if (!sub || !subField) return;
    items.filter((it) => it[subField] === sub).forEach((it) => selectedRows.add(it._row));
    draw();
  });
  container.querySelector('#catalog-clear-selection')?.addEventListener('click', () => {
    selectedRows.clear();
    draw();
  });

  container.querySelector('#catalog-set-category')?.addEventListener('click', () => {
    const value = container.querySelector('#catalog-batch-set-category').value;
    if (!selectedRows.size) {
      toast('Select at least one item first', true);
      return;
    }
    if (!value) {
      toast('Choose a category first', true);
      return;
    }
    let applied = 0;
    selectedRows.forEach((rowNum) => {
      const rowEl = container.querySelector(`tr[data-row="${rowNum}"]`);
      const cell = rowEl?.querySelector(`[data-field="${cssEscapeAttr(catField)}"]`);
      if (cell) {
        cell.value = value;
        markDirty(rowEl);
        applied += 1;
      }
    });
    if (applied) toast(`Set category on ${applied} item(s) — click Save All Changes to persist`);
  });
  container.querySelector('#catalog-set-subcategory')?.addEventListener('click', () => {
    const value = container.querySelector('#catalog-batch-set-subcategory').value;
    if (!selectedRows.size) {
      toast('Select at least one item first', true);
      return;
    }
    if (!value) {
      toast('Choose a subcategory first', true);
      return;
    }
    let applied = 0;
    selectedRows.forEach((rowNum) => {
      const rowEl = container.querySelector(`tr[data-row="${rowNum}"]`);
      const cell = rowEl?.querySelector(`[data-field="${cssEscapeAttr(subField)}"]`);
      if (cell) {
        cell.value = value;
        markDirty(rowEl);
        applied += 1;
      }
    });
    if (applied) toast(`Set subcategory on ${applied} item(s) — click Save All Changes to persist`);
  });

  container.querySelector('#catalog-apply-cost')?.addEventListener('click', () => {
    if (!selectedRows.size) {
      toast('Select at least one item first', true);
      return;
    }
    let applied = 0;
    costFields.forEach((f) => {
      const input = container.querySelector(`#catalog-batch-${cssKey(f)}`);
      if (!input || input.value === '') return;
      selectedRows.forEach((rowNum) => {
        const rowEl = container.querySelector(`tr[data-row="${rowNum}"]`);
        if (!rowEl) return;
        const cell = rowEl.querySelector(`[data-field="${cssEscapeAttr(f)}"]`);
        if (cell) {
          cell.value = input.value;
          markDirty(rowEl);
          applied += 1;
        }
      });
    });
    if (applied) toast(`Updated cost fields on ${selectedRows.size} item(s) — click Save All Changes to persist`);
    else toast('Enter a cost value first', true);
  });

  container.querySelector('#catalog-adjust-cost')?.addEventListener('click', () => {
    const pctInput = container.querySelector('#catalog-adjust-pct');
    const pct = Number(pctInput?.value);
    if (!selectedRows.size) {
      toast('Select at least one item first', true);
      return;
    }
    if (!pctInput?.value || Number.isNaN(pct)) {
      toast('Enter a percentage first', true);
      return;
    }
    let applied = 0;
    selectedRows.forEach((rowNum) => {
      const rowEl = container.querySelector(`tr[data-row="${rowNum}"]`);
      if (!rowEl) return;
      costFields.forEach((f) => {
        const cell = rowEl.querySelector(`[data-field="${cssEscapeAttr(f)}"]`);
        if (!cell || cell.value === '') return;
        const current = Number(cell.value) || 0;
        cell.value = Math.round(current * (1 + pct / 100) * 100) / 100;
        markDirty(rowEl);
      });
      applied += 1;
    });
    toast(`Adjusted cost by ${pct}% on ${applied} item(s) — click Save All Changes to persist`);
  });

  container.querySelector('#catalog-delete-selected')?.addEventListener('click', async () => {
    if (!selectedRows.size) {
      toast('Select at least one item first', true);
      return;
    }
    if (!confirm(`Delete ${selectedRows.size} selected item(s)? This cannot be undone.`)) return;
    // Delete highest row number first -- deleting a sheet row shifts every
    // row below it up by one, so working top-down would invalidate the
    // remaining selected row numbers mid-batch.
    const rows = Array.from(selectedRows).sort((a, b) => b - a);
    let succeeded = 0;
    const failed = [];
    for (const rowNum of rows) {
      try {
        await api.deleteCatalogItem('budget', rowNum);
        succeeded += 1;
      } catch (err) {
        failed.push(`row ${rowNum}: ${err.message}`);
      }
    }
    state.budgetCatalog = null;
    selectedRows.clear();
    if (failed.length) toast(`Deleted ${succeeded}, failed ${failed.length} (${failed[0]})`, true);
    else toast(`Deleted ${succeeded} item${succeeded === 1 ? '' : 's'}`);
    await renderCatalog(container);
  });

  container.querySelector('#expand-all')?.addEventListener('click', () => {
    collapsedCats.clear();
    applyCollapseState();
  });
  container.querySelector('#collapse-all')?.addEventListener('click', () => {
    collapsedCats = new Set(allCatKeys);
    applyCollapseState();
  });
  container.querySelectorAll('[data-toggle-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggleCat;
      if (collapsedCats.has(key)) collapsedCats.delete(key);
      else collapsedCats.add(key);
      applyCollapseState();
    });
  });

  container.querySelector('#cat-color-input')?.addEventListener('input', (e) => {
    settings.categoryColor = e.target.value;
    saveSettings();
    applyCategoryColor();
  });

  container.querySelector('#zoom-input')?.addEventListener('input', (e) => {
    const v = Math.max(50, Math.min(150, Number(e.target.value) || 100));
    settings.zoomPct = v;
    saveSettings();
    applyZoom();
  });

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
  if (catField) makeCategoriesDraggable();
  wireColumnSort();
}

// Clicking a sortable header sorts the items inside each category group by
// that column (category grouping itself never changes -- Category -> Lines
// stays a strict hierarchy). Clicking the same column again flips direction;
// clicking a different one starts fresh, ascending. Ignores clicks on the
// drag grip so dragging a column doesn't also trigger a sort.
function wireColumnSort() {
  container.querySelectorAll('#catalog-table thead th[data-sort-key]').forEach((th) => {
    th.addEventListener('click', (e) => {
      if (e.target.closest('.col-grip')) return;
      const key = th.dataset.sortKey;
      if (sortState.field === key) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortState = { field: key, direction: 'asc' };
      }
      draw();
    });
  });
}

// Minimal attribute-value escaping for building a CSS attribute selector
// from a field name that may contain spaces/parentheses.
function cssEscapeAttr(value) {
  return String(value ?? '').replace(/(["\\])/g, '\\$1');
}

function makeColumnsResizable() {
  const table = container.querySelector('#catalog-table');
  if (!table) return;
  const widths = settings.columnWidths || {};
  table.querySelectorAll('thead th[data-col-key]').forEach((th) => {
    const key = th.dataset.colKey;
    if (key === 'select' || key === 'actions') return;
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
        settings.columnWidths[key] = th.offsetWidth;
        saveSettings();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function makeColumnsDraggable() {
  const table = container.querySelector('#catalog-table');
  if (!table) return;
  const grips = Array.from(table.querySelectorAll('thead .col-grip'));
  const getTargets = () => Array.from(table.querySelectorAll('thead th[data-col-key]')).filter((th) => th.dataset.colKey !== 'select' && th.dataset.colKey !== 'actions');
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

// Drags a whole category group to a new position. This only changes display
// order (kept as a local preference, see settings.categoryOrder) -- it does
// not physically move rows in the Google Sheet.
function makeCategoriesDraggable() {
  const table = container.querySelector('#catalog-table');
  if (!table) return;
  const grips = Array.from(table.querySelectorAll('.row-grip'));
  const getTargets = () => Array.from(table.querySelectorAll('tr.cat-row[data-cat-name]'));
  wirePointerDrag(grips, getTargets, 'tr.cat-row[data-cat-name]', (startRow, targetRow) => {
    const draggedName = startRow.dataset.catName;
    const targetName = targetRow.dataset.catName;
    if (!draggedName || draggedName === targetName) return;
    const names = getTargets().map((row) => row.dataset.catName);
    moveCategoryInOrder(names, draggedName, targetName);
    draw();
  });
}

async function saveAllChanges() {
  if (!dirtyRows.size) return;
  const btn = container.querySelector('#save-all');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  let succeeded = 0;
  const failed = [];
  for (const rowNum of dirtyRows) {
    const rowEl = container.querySelector(`tr[data-row="${rowNum}"]`);
    if (!rowEl) continue;
    const item = readRowFields(rowEl);
    try {
      await api.updateCatalogItem('budget', rowNum, item);
      succeeded += 1;
    } catch (err) {
      failed.push(`row ${rowNum}: ${err.message}`);
    }
  }

  state.budgetCatalog = null;
  if (failed.length) {
    toast(`Saved ${succeeded}, failed ${failed.length} (${failed[0]})`, true);
  } else {
    toast(`Saved ${succeeded} item${succeeded === 1 ? '' : 's'}`);
  }
  await renderCatalog(container);
}

function openAddModal() {
  const catField = categoryField();
  const subField = subcategoryField();
  const categories = existingCategories();
  const subcategories = existingSubcategories();
  const totalField = unitCostTotalField();

  const body = openModal(`
    <h3>Add Budget Catalog Item</h3>
    <div class="form-grid">
      ${fields
        .map((f) => {
          if (f === totalField) return '';
          if (f === catField) {
            return `
              <label>${escapeHtml(f)}
                <select id="modal-category-select">
                  <option value="">-- Select --</option>
                  ${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                  <option value="${NEW_CATEGORY_VALUE}">+ Add New Category</option>
                </select>
              </label>
              <label id="modal-category-new-wrap" style="display:none">New Category Name
                <input type="text" id="modal-category-new" placeholder="New category name">
              </label>`;
          }
          if (f === subField) {
            return `
              <label>${escapeHtml(f)}
                <select id="modal-subcategory-select">
                  <option value="">-- Select --</option>
                  ${subcategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                  <option value="${NEW_SUBCATEGORY_VALUE}">+ Add New Subcategory</option>
                </select>
              </label>
              <label id="modal-subcategory-new-wrap" style="display:none">New Subcategory Name
                <input type="text" id="modal-subcategory-new" placeholder="New subcategory name">
              </label>`;
          }
          return `<label>${escapeHtml(f)} <input type="text" data-modal-field="${escapeHtml(f)}"></label>`;
        })
        .join('')}
    </div>
    <button class="btn btn-primary" id="modal-add-submit" style="margin-top:1rem">Add Item</button>
  `);

  if (catField) {
    const select = body.querySelector('#modal-category-select');
    const newWrap = body.querySelector('#modal-category-new-wrap');
    select.addEventListener('change', () => {
      const isNew = select.value === NEW_CATEGORY_VALUE;
      newWrap.style.display = isNew ? '' : 'none';
      if (isNew) body.querySelector('#modal-category-new').focus();
    });
  }
  if (subField) {
    const select = body.querySelector('#modal-subcategory-select');
    const newWrap = body.querySelector('#modal-subcategory-new-wrap');
    select.addEventListener('change', () => {
      const isNew = select.value === NEW_SUBCATEGORY_VALUE;
      newWrap.style.display = isNew ? '' : 'none';
      if (isNew) body.querySelector('#modal-subcategory-new').focus();
    });
  }

  body.querySelector('#modal-add-submit').addEventListener('click', async () => {
    const item = {};
    body.querySelectorAll('[data-modal-field]').forEach((input) => {
      item[input.dataset.modalField] = input.value;
    });
    if (catField) {
      const select = body.querySelector('#modal-category-select');
      item[catField] = select.value === NEW_CATEGORY_VALUE ? body.querySelector('#modal-category-new').value : select.value;
    }
    if (subField) {
      const select = body.querySelector('#modal-subcategory-select');
      item[subField] = select.value === NEW_SUBCATEGORY_VALUE ? body.querySelector('#modal-subcategory-new').value : select.value;
    }
    if (totalField) {
      item[totalField] = unitCostTotal(item, costFieldsPresent(), markupField()).toFixed(2);
    }
    const hasContent = Object.values(item).some((v) => v && v.trim());
    if (!hasContent) {
      toast('Fill in at least one field', true);
      return;
    }
    const idField = identifierField();
    const idValue = idField ? String(item[idField] || '').trim() : '';
    if (idValue) {
      const dupe = items.some((it) => String(it[idField] || '').trim().toLowerCase() === idValue.toLowerCase());
      if (dupe) {
        const proceed = confirm(`"${idValue}" is already used by another catalog item. Add it anyway?`);
        if (!proceed) return;
      }
    }
    try {
      await api.addCatalogItem('budget', item);
      state.budgetCatalog = null;
      closeModal();
      toast('Item added');
      await renderCatalog(container);
    } catch (err) {
      toast(`Add failed: ${err.message}`, true);
    }
  });
}
