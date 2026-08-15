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
};
