# Apps Script Backend Setup

This backend is the bridge between the static site (GitHub Pages) and your Google Sheets. It's a single Apps Script project deployed as a Web App.

## 1. Create the General Budget Catalog sheet

Create a new Google Sheet with these column headers in row 1 (order doesn't matter, names must match exactly):

```
Item ID | Category | Subcategory | Description | Unit | Unit Cost (Material) | Unit Cost (Labor) | Default Markup % | Notes
```

Fill in one row per catalog item. This sheet can be edited any time — the app always reads it live.

## 2. Your Interior Finishes catalog sheet

Use your existing sheet as-is. Note its column headers — you'll map them in `js/config.js` (`FINISHES_FIELD_MAP`) after deploying the site. The app only requires headers for: an ID/SKU, a description, a price, and (optionally) unit/category/vendor/spec-link. Any other columns are preserved with each selected item but not otherwise used.

## 3. Create a Drive folder for saved projects

Create a folder in Google Drive (e.g. "Budget App Projects"). Each saved project becomes its own Spreadsheet inside this folder. Copy the folder's ID from its URL: `drive.google.com/drive/folders/<FOLDER_ID>`.

## 4. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) → New Project.
2. Delete the default `Code.gs` contents and paste in the contents of `apps-script/Code.gs` from this repo.
3. In the left sidebar, open **Project Settings** → **Script Properties** → add:
   - `CATALOG_SHEET_ID` — the ID of the budget catalog sheet from step 1 (the long string in its URL between `/d/` and `/edit`)
   - `FINISHES_SHEET_ID` — the ID of your existing finishes sheet
   - `PROJECTS_FOLDER_ID` — the ID of the Drive folder from step 3

## 5. Deploy as a Web App

1. Click **Deploy** → **New deployment**.
2. Select type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone** (this makes the JSON endpoints reachable from your static GitHub Pages site; no Google login is required to use the tool, but only people with the site link can reach it).
5. Click **Deploy**, authorize the requested permissions (Sheets + Drive), and copy the **Web app URL** — it ends in `/exec`.

## 6. Point the site at your deployment

In this repo, edit `js/config.js`:

```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

And adjust `FINISHES_FIELD_MAP` to match your finishes sheet's actual column headers.

## 7. Re-deploy after editing Code.gs

Apps Script Web App URLs stay stable across edits **only if you use "Manage deployments" → edit the existing deployment → New version**, rather than creating a brand-new deployment each time. If you create a new deployment, you'll get a new URL and need to update `js/config.js` again.

## Notes

- Anyone with the Web App URL can call these endpoints (list/load/save/delete projects, read catalogs). There's no per-user auth, matching the "no login" requirement. If you need to restrict access later, switch "Who has access" to your Google Workspace domain, or add a shared-secret check in `doGet`/`doPost`.
- Each project's data lives entirely in its own Google Sheet in the Drive folder, so you can also open and inspect/edit it directly in Sheets if needed — just keep the `ProjectInfo`, `Lines`, and `Finishes` tab names and column headers intact, since the app expects them.
