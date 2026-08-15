import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, toast } from '../util.js';

const FALLBACK_FIELDS = [
  'Item ID', 'Category', 'Subcategory', 'Description', 'Unit',
  'Unit Cost (Material)', 'Unit Cost (Labor)', 'Default Markup %', 'Notes',
];

let container;
let fields = [];
let items = [];

export async function renderCatalog(el) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';
  try {
    [fields, items] = await Promise.all([api.getCatalogFields('budget'), api.getBudgetCatalog()]);
    if (!fields.length) fields = FALLBACK_FIELDS;
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load catalog: ${escapeHtml(err.message)}</p>`;
    return;
  }
  draw();
}

function draw() {
  container.innerHTML = `
    <div class="view-header">
      <h2>Budget Catalog</h2>
    </div>
    <p class="muted">Editing here writes directly to your Budget Catalog Google Sheet. Rows are matched by sheet row, not by Item ID, so renaming an Item ID won't lose track of the line.</p>

    <section class="card">
      <div class="sheet-wrap">
        <table class="table sheet-table">
          <thead>
            <tr>${fields.map((f) => `<th>${escapeHtml(f)}</th>`).join('')}<th></th></tr>
          </thead>
          <tbody>
            <tr class="new-row">
              ${fields.map((f) => `<td><input type="text" data-new-field="${escapeHtml(f)}" placeholder="${escapeHtml(f)}"></td>`).join('')}
              <td><button class="link-btn" id="add-item">+ Add</button></td>
            </tr>
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
    return `<tr><td colspan="${fields.length + 1}" class="muted">No catalog items yet — add one in the row above.</td></tr>`;
  }
  return items
    .map(
      (it) => `
    <tr data-row="${it._row}">
      ${fields.map((f) => `<td><input type="text" data-field="${escapeHtml(f)}" value="${escapeHtml(it[f] ?? '')}"></td>`).join('')}
      <td class="row-actions">
        <button class="link-btn" data-save-row="${it._row}">Save</button>
        <button class="link-btn danger" data-delete-row="${it._row}">Delete</button>
      </td>
    </tr>`
    )
    .join('');
}

function readRowFields(rowEl, selector) {
  const item = {};
  rowEl.querySelectorAll(selector).forEach((input) => {
    item[input.dataset.field || input.dataset.newField] = input.value;
  });
  return item;
}

function wireEvents() {
  container.querySelector('#add-item').addEventListener('click', async () => {
    const newRow = container.querySelector('.new-row');
    const item = readRowFields(newRow, '[data-new-field]');
    const hasContent = Object.values(item).some((v) => v.trim());
    if (!hasContent) {
      toast('Fill in at least one field', true);
      return;
    }
    try {
      await api.addCatalogItem('budget', item);
      state.budgetCatalog = null;
      toast('Item added');
      await renderCatalog(container);
    } catch (err) {
      toast(`Add failed: ${err.message}`, true);
    }
  });

  container.querySelectorAll('[data-save-row]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const item = readRowFields(row, '[data-field]');
      try {
        await api.updateCatalogItem('budget', Number(btn.dataset.saveRow), item);
        state.budgetCatalog = null;
        toast('Item saved');
      } catch (err) {
        toast(`Save failed: ${err.message}`, true);
      }
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
