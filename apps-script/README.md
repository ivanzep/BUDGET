# Apps Script Backend Setup

This backend is the bridge between the static site (GitHub Pages) and your Google Sheets. It's a single Apps Script project deployed as a Web App.

## 1. Create the General Budget Catalog sheet

Create a new Google Sheet with these column headers in row 1 (order doesn't matter, names must match exactly):

```
Item ID | Category | Subcategory | Description | Unit | Unit Cost (Material) | Unit Cost (Labor) | Default Markup % | Notes
```

The identifier column (the one Budget Lines matches against via its B.ID/Budget Code field) can also be named `B.ID` instead of `Item ID` — the app detects either name automatically, so renaming it in the sheet doesn't break the link.

Fill in one row per catalog item. This sheet can be edited any time — the app always reads it live.

## 2. Your Interior Finishes catalog sheet

This is wired up to your existing spreadsheet's **CATALOG** tab (headers: `CATEGORY, ID, TYPE, LOCATION, DESCRIPTION, MFR, SPECIFICATION, DIRECTION / PAT, COLOR, SIZE, THICKNESS`). Two things to know:

- **Add a `UNIT PRICE` column.** The sheet has no pricing column today — add one titled exactly `UNIT PRICE` and fill in a unit cost for each item. Without it, finish line totals will compute as $0.
- **Category is a section header, not a per-row value** (e.g. a row that just says "1 APPLIANCES", followed by item rows with a blank Category cell). The backend (`finishesSheetToObjects_` in `Code.gs`) already handles this — it forward-fills the category from the last header row onto each item beneath it, and strips the leading number. You don't need to change the sheet's layout.

`js/config.js`'s `FINISHES_FIELD_MAP` is already set to match this sheet's headers (`ID`, `DESCRIPTION`, `CATEGORY`, `UNIT PRICE`, `MFR`, `SPECIFICATION`). If you rename columns or add a new finishes sheet later, update that map to match.

## 3. Create a Drive folder for saved projects

Create a folder in Google Drive (e.g. "Budget App Projects"). Each saved project becomes its own Spreadsheet inside this folder. Copy the folder's ID from its URL: `drive.google.com/drive/folders/<FOLDER_ID>`.

## 4. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) → New Project.
2. Delete the default `Code.gs` contents and paste in the contents of `apps-script/Code.gs` from this repo.
3. In the left sidebar, open **Project Settings** → **Script Properties** → add:
   - `CATALOG_SHEET_ID` — the ID of the budget catalog sheet from step 1 (the long string in its URL between `/d/` and `/edit`)
   - `FINISHES_SHEET_ID` — `1sZCvIgqQGRuuFEXwSMchL8lY0tZe8QIRgClV3szNNiU` (the interiors catalog spreadsheet)
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
