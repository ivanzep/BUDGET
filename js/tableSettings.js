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
