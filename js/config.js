// Fill this in after deploying the Apps Script Web App (see apps-script/README.md).
// Example: 'https://script.google.com/macros/s/AKfycb.../exec'
export const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

// Your finishes catalog sheet can have any columns you want. Map the
// column headers it actually uses to the roles the app needs. Only the
// keys below are read; everything else in a finish row is kept and shown
// in the item picker/detail view as-is.
export const FINISHES_FIELD_MAP = {
  id: 'SKU',
  description: 'Description',
  category: 'Category',
  price: 'Price',
  unit: 'Unit',
  vendor: 'Vendor',
  spec: 'Spec Link',
};
