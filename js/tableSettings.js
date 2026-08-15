// Budget Lines table display settings now live on the project itself
// (project.info.tableSettings, see state.js) so they travel with the
// project data instead of staying local to one browser. This module just
// holds the shared defaults and a small formatting helper.

export const DEFAULT_TABLE_SETTINGS = {
  categoryColor: '#2563eb',
  fontSize: 'normal', // 'small' | 'normal' | 'large'
  columnWidths: {}, // { [columnKey]: px }
  columnOrder: [], // ordered list of reorderable column keys; empty = default order
  hiddenColumns: [], // column keys hidden from the Budget Lines grid
};

const FONT_SIZE_PX = { small: '0.72rem', normal: '0.82rem', large: '0.95rem' };

export function fontSizePx(size) {
  return FONT_SIZE_PX[size] || FONT_SIZE_PX.normal;
}
