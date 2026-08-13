// Fill this in after deploying the Apps Script Web App (see apps-script/README.md).
// Example: 'https://script.google.com/macros/s/AKfycb.../exec'
export const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

// Maps the interiors CATALOG tab's actual column headers to the roles the
// app needs. "category" is forward-filled server-side from the sheet's
// section-header rows (see finishesSheetToObjects_ in apps-script/Code.gs).
// Add a "Price" column to the CATALOG tab yourself — the sheet doesn't
// have pricing built in, so this is the column the app will read for cost.
export const FINISHES_FIELD_MAP = {
  id: 'ID',
  description: 'DESCRIPTION',
  category: 'CATEGORY',
  price: 'Price',
  unit: '',
  vendor: 'MFR',
  spec: 'SPECIFICATION',
};
