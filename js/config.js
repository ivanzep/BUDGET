// Fill this in after deploying the Apps Script Web App (see apps-script/README.md).
// Example: 'https://script.google.com/macros/s/AKfycb.../exec'
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzCP7EopENp0YCxrzWg3b6EmnVHevOjP6FHMMMSt39I-dr2zux1_UVaNjDAklpt2tO4Gg/exec';

// Maps the interiors CATALOG tab's actual column headers to the roles the
// app needs. "category" is forward-filled server-side from the sheet's
// section-header rows (see finishesSheetToObjects_ in apps-script/Code.gs).
// Add a "UNIT PRICE" column to the CATALOG tab yourself — the sheet doesn't
// have pricing built in, so this is the column the app will read for cost.
export const FINISHES_FIELD_MAP = {
  id: 'ID',
  description: 'DESCRIPTION',
  category: 'CATEGORY',
  price: 'UNIT PRICE',
  unit: '',
  vendor: 'MFR',
  spec: 'SPECIFICATION',
};
