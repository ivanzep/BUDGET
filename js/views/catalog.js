import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, toast } from '../util.js';
import { openModal, closeModal } from '../modal.js';

const FALLBACK_FIELDS = [
  'Item ID', 'Category', 'Subcategory', 'Description', 'Unit',
  'Unit Cost (Material)', 'Unit Cost (Labor)', 'Default Markup %', 'Notes',
];

const NEW_CATEGORY_VALUE = '__new__';

let container;
let fields = [];
let items = [];
let dirtyRows = new Set();

export async function renderCatalog(el) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';
  dirtyRows = new Set();
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

function existingCategories() {
  const catField = categoryField();
  if (!catField) return [];
  return Array.from(new Set(items.map((it) => it[catField]).filter((v) => v && String(v).trim()))).sort();
}

function draw() {
  container.innerHTML = `
    <div class="view-header">
      <h2>Budget Catalog</h2>
      <div class="actions">
        <button class="btn btn-primary" id="add-item">+ Add</button>
        <button class="btn" id="save-all" disabled>Save All Changes</button>
      </div>
    </div>
    <p class="muted">Editing here writes directly to your Budget Catalog Google Sheet. Rows are matched by sheet row, not by Item ID, so renaming an Item ID won't lose track of the line.</p>

    <section class="card">
      <div class="sheet-wrap">
        <table class="table sheet-table">
          <thead>
            <tr>${fields.map((f) => `<th>${escapeHtml(f)}</th>`).join('')}<th></th></tr>
          </thead>
          <tbody>
            ${renderRows()}
          </tbody>
        </table>
      </div>
    </section>
  `;
  wireEvents();
}

function renderRows() {
  if (!items.length) {
    return `<tr><td colspan="${fields.length + 1}" class="muted">No catalog items yet — click "+ Add" above.</td></tr>`;
  }
  return items
    .map(
      (it) => `
    <tr data-row="${it._row}">
      ${fields.map((f) => `<td><input type="text" data-field="${escapeHtml(f)}" value="${escapeHtml(it[f] ?? '')}"></td>`).join('')}
      <td class="row-actions">
        <button class="link-btn danger" data-delete-row="${it._row}">Delete</button>
      </td>
    </tr>`
    )
    .join('');
}

function readRowFields(rowEl) {
  const item = {};
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    item[input.dataset.field] = input.value;
  });
  return item;
}

function updateSaveAllButton() {
  const btn = container.querySelector('#save-all');
  if (!btn) return;
  btn.disabled = dirtyRows.size === 0;
  btn.textContent = dirtyRows.size ? `Save All Changes (${dirtyRows.size})` : 'Save All Changes';
}

function wireEvents() {
  container.querySelector('#add-item').addEventListener('click', openAddModal);
  container.querySelector('#save-all').addEventListener('click', saveAllChanges);

  container.querySelectorAll('tbody tr[data-row] [data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const row = input.closest('tr');
      const rowNum = Number(row.dataset.row);
      dirtyRows.add(rowNum);
      row.classList.add('row-dirty');
      updateSaveAllButton();
    });
  });

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
  const categories = existingCategories();

  const body = openModal(`
    <h3>Add Budget Catalog Item</h3>
    <div class="form-grid">
      ${fields
        .map((f) => {
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

  body.querySelector('#modal-add-submit').addEventListener('click', async () => {
    const item = {};
    body.querySelectorAll('[data-modal-field]').forEach((input) => {
      item[input.dataset.modalField] = input.value;
    });
    if (catField) {
      const select = body.querySelector('#modal-category-select');
      item[catField] = select.value === NEW_CATEGORY_VALUE ? body.querySelector('#modal-category-new').value : select.value;
    }
    const hasContent = Object.values(item).some((v) => v && v.trim());
    if (!hasContent) {
      toast('Fill in at least one field', true);
      return;
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
