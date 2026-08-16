// Budget Lines table display settings now live on the project itself
// (project.info.tableSettings, see state.js) so they travel with the
// project data instead of staying local to one browser. This module just
// holds the shared defaults.

export const DEFAULT_TABLE_SETTINGS = {
  categoryColor: '#2563eb',
  zoomPct: 100, // 50-150, scales the whole grid (see applyTableSettings in editor.js)
  columnWidths: {}, // { [columnKey]: px }
  columnOrder: [], // ordered list of reorderable column keys; empty = default order
  hiddenColumns: [], // column keys hidden from the Budget Lines grid
  categoryFontSize: 13, // px, applies to category + subcategory header rows
  categoryRowSize: 6, // px vertical padding, applies to category + subcategory header rows
  subtotalFontSize: 13, // px, applies to user-added subtotal lines
  subtotalRowSize: 8, // px vertical padding, applies to user-added subtotal lines
};

// Column keys the user can reorder/hide in the Budget Lines grid. Shared
// (rather than living only in editor.js) so other views -- the Print/Export
// report in particular -- can build their own Budget Lines table matching
// the same column order and visibility instead of a fixed, independent set.
export const REORDERABLE_COLUMNS = [
  'devCostCode', 'budgetCode', 'description', 'costType', 'unit', 'area', 'unitCost', 'markup', 'qty', 'notes', 'total',
];

export const BUDGET_COLUMN_LABELS = {
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

export function getColumnOrder(project) {
  const saved = project.info.tableSettings?.columnOrder || [];
  const valid = saved.filter((k) => REORDERABLE_COLUMNS.includes(k));
  const missing = REORDERABLE_COLUMNS.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
}

export function getHiddenColumns(project) {
  return project.info.tableSettings?.hiddenColumns || [];
}

// The columns actually shown, in the user's chosen order.
export function visibleColumnOrder(project) {
  const hidden = getHiddenColumns(project);
  return getColumnOrder(project).filter((k) => !hidden.includes(k));
}
