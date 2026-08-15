import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, toast } from '../util.js';

const BUDGET_FIELDS = [
  'Item ID', 'Category', 'Subcategory', 'Description', 'Unit',
  'Unit Cost (Material)', 'Unit Cost (Labor)', 'Default Markup %', 'Notes',
];

let container;
let items = [];

export async function renderCatalog(el) {
  container = el;
  container.innerHTML = '<p>Loading...</p>';
  try {
    items = await api.getBudgetCatalog();
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
    <p class="muted">Items added, edited, or removed here are saved directly to your Budget Catalog Google Sheet, and will show up next time you add a line item to a project.</p>

    <section class="card">
      <h3>Add Item</h3>
      <div class="form-grid" id="add-form">
        ${BUDGET_FIELDS.map((f) => `<label>${escapeHtml(f)} <input type="text" data-new-field="${escapeHtml(f)}"></label>`).join('')}
      </div>
      <button class="btn btn-primary" id="add-item" style="margin-top:0.75rem">+ Add Item</button>
    </section>

    <section class="card">
      <h3>Catalog Items (${items.length})</h3>
      ${renderTable()}
    </section>
  `;
  wireEvents();
}

function renderTable() {
  if (!items.length) return '<p class="muted">No catalog items yet — add one above.</p>';
  return `
    <table class="table">
      <thead><tr>${BUDGET_FIELDS.map((f) => `<th>${escapeHtml(f)}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${items
          .map(
            (it) => `
          <tr data-row="${it._row}">
            ${BUDGET_FIELDS.map((f) => `<td><input type="text" data-field="${escapeHtml(f)}" value="${escapeHtml(it[f] ?? '')}"></td>`).join('')}
            <td class="row-actions">
              <button class="link-btn" data-save-row="${it._row}">Save</button>
              <button class="link-btn danger" data-delete-row="${it._row}">Delete</button>
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function readRowFields(rowEl) {
  const item = {};
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    item[input.dataset.field] = input.value;
  });
  return item;
}

function wireEvents() {
  container.querySelector('#add-item').addEventListener('click', async () => {
    const item = {};
    container.querySelectorAll('#add-form [data-new-field]').forEach((input) => {
      item[input.dataset.newField] = input.value;
    });
    if (!item['Description'] && !item['Item ID']) {
      toast('Add at least a Description or Item ID', true);
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
      const item = readRowFields(row);
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
