const STORAGE_KEY = 'budgetTableSettings';

const DEFAULTS = {
  categoryColor: '#2563eb',
  fontSize: 'normal', // 'small' | 'normal' | 'large'
  columnWidths: {}, // { [tableKey]: { [columnLabel]: px } }
};

const FONT_SIZE_PX = { small: '0.72rem', normal: '0.82rem', large: '0.95rem' };

export function getTableSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, columnWidths: {} };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, columnWidths: { ...(parsed.columnWidths || {}) } };
  } catch {
    return { ...DEFAULTS, columnWidths: {} };
  }
}

export function saveTableSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private browsing, etc.) -- settings just won't persist.
  }
}

export function fontSizePx(size) {
  return FONT_SIZE_PX[size] || FONT_SIZE_PX.normal;
}
