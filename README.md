# Construction Budget Builder

A static web app (hosted on GitHub Pages) for assembling construction budgets from a reusable Google Sheets catalog, comparing multiple pricing versions side by side, and exporting to PDF/Excel/CSV.

## How it works

- **Frontend**: plain HTML/CSS/JS in this repo, served by GitHub Pages. No build step.
- **Backend**: a Google Apps Script Web App (see `apps-script/`) that reads two independent Google Sheets catalogs (general budget items, and interior finishes) and stores each saved project as its own Google Sheet in a Drive folder.
- **Storage**: no database — Google Sheets/Drive is the persistence layer.

## Features

- Project info form: name, client, date, address, project #, logo (URL or upload), notes.
- Catalog-driven line items: search/add items from the budget catalog, with editable qty and notes.
- Interior Finishes section pulled from its own separate catalog sheet.
- Multiple pricing **versions** per project (add/rename/duplicate/remove) for side-by-side comparison.
- Summary/Compare view: top-line category totals across all versions, cheapest option highlighted, plus full line detail.
- Export: Print, PDF, Excel (multi-sheet), CSV.
- Read-only shareable link for clients (`#/summary/<id>?readonly=1`), no login required.

## Setup

1. **Backend first** — follow `apps-script/README.md` to create your catalog sheets, Drive folder, and deploy the Apps Script Web App.
2. **Configure the frontend** — edit `js/config.js` with your Web App URL and finishes sheet column mapping.
3. **Enable GitHub Pages** on this repo (Settings → Pages → Deploy from branch → root), then open the published URL.

## Project structure

```
index.html          App shell
css/style.css        Styles (incl. print stylesheet)
js/config.js          Your Apps Script URL + finishes column mapping (edit this)
js/api.js             Fetch wrapper for the Apps Script backend
js/calc.js            Pricing math (line totals, version/category totals)
js/state.js           In-memory app state
js/router.js          Hash-based routing
js/export.js          PDF/Excel/CSV export
js/views/projects.js  Project list
js/views/editor.js    Project editor (info, versions, line items, finishes)
js/views/summary.js   Compare view + exports + share link
apps-script/Code.gs   Backend deployed to script.google.com
apps-script/README.md Backend setup instructions
```
