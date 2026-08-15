/**
 * Construction Budget Builder — Apps Script backend.
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * See apps-script/README.md for setup steps.
 */

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    catalogSheetId: props.getProperty('CATALOG_SHEET_ID'),
    finishesSheetId: props.getProperty('FINISHES_SHEET_ID'),
    projectsFolderId: props.getProperty('PROJECTS_FOLDER_ID'),
  };
}

function doGet(e) {
  const action = e.parameter.action;
  try {
    let result;
    switch (action) {
      case 'getBudgetCatalog':
        result = getBudgetCatalog_();
        break;
      case 'getFinishesCatalog':
        result = getFinishesCatalog_();
        break;
      case 'listProjects':
        result = listProjects_();
        break;
      case 'loadProject':
        result = loadProject_(e.parameter.id);
        break;
      case 'getCatalogFields':
        result = getCatalogFields_(e.parameter.catalog);
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }
    return jsonOutput_({ ok: true, data: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    switch (action) {
      case 'saveProject':
        result = saveProject_(body.project);
        break;
      case 'deleteProject':
        result = deleteProject_(body.id);
        break;
      case 'addCatalogItem':
        result = addCatalogItem_(body.catalog, body.item);
        break;
      case 'updateCatalogItem':
        result = updateCatalogItem_(body.catalog, body.row, body.item);
        break;
      case 'deleteCatalogItem':
        result = deleteCatalogItem_(body.catalog, body.row);
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }
    return jsonOutput_({ ok: true, data: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Reads a sheet's first row as headers and returns an array of objects.
// Each object carries a "_row" field (1-based sheet row number) so the
// frontend can reference it for edit/delete.
// Sheets returns date-formatted cells as JS Date objects, which JSON.stringify
// turns into a full ISO timestamp (e.g. "2026-03-13T07:00:00.000Z") -- very
// confusing when it happens to a cell that was only ever meant to hold a
// plain code/label. Catalog rows are never expected to contain real dates,
// so any Date value here means the cell got auto-parsed by mistake; show the
// short date instead of the raw timestamp so it's at least legible while the
// user retypes it (see textColumnFormats_ for the write-side prevention).
function dateSafeValue_(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'M/d/yyyy') : v;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map((h) => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every((c) => c === '' || c === null)) continue;
    const obj = { _row: i + 1 };
    headers.forEach((h, idx) => (obj[h] = dateSafeValue_(row[idx])));
    rows.push(obj);
  }
  return rows;
}

// Resolves which sheet a catalog name ('budget' or 'finishes') points to.
function catalogSheet_(catalog) {
  const cfg = getConfig_();
  if (catalog === 'finishes') {
    if (!cfg.finishesSheetId) throw new Error('FINISHES_SHEET_ID script property is not set.');
    const ss = SpreadsheetApp.openById(cfg.finishesSheetId);
    return ss.getSheetByName('CATALOG') || ss.getSheets()[0];
  }
  if (catalog === 'budget') {
    if (!cfg.catalogSheetId) throw new Error('CATALOG_SHEET_ID script property is not set.');
    return SpreadsheetApp.openById(cfg.catalogSheetId).getSheets()[0];
  }
  throw new Error('Unknown catalog: ' + catalog);
}

function getBudgetCatalog_() {
  return sheetToObjects_(catalogSheet_('budget'));
}

function getFinishesCatalog_() {
  return finishesSheetToObjects_(catalogSheet_('finishes'));
}

// Returns the sheet's actual header row, trimmed, blanks dropped. Used by
// the Catalog manager UI so its form fields always match the real column
// names in the sheet -- including when the sheet has zero data rows yet.
function getCatalogFields_(catalog) {
  const sheet = catalogSheet_(catalog);
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map((h) => String(h).trim())
    .filter(Boolean);
}

// Columns that hold real numbers (costs, markup, quantities) keep Sheets'
// normal numeric formatting, so any formulas built on top of this sheet
// elsewhere keep working. Every other column (ID/code, category, subcategory,
// description, unit, notes, ...) is forced to plain-text format before the
// value is written -- otherwise Sheets applies its usual locale auto-parsing
// to whatever string comes in, and a code that happens to look like a date
// or number (e.g. "3-13") silently turns into an actual date/number cell.
function textColumnFormats_(headers) {
  return headers.map((h) => (/cost|price|markup|%|qty|amount/i.test(h) ? 'General' : '@'));
}

function addCatalogItem_(catalog, item) {
  const sheet = catalogSheet_(catalog);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const row = headers.map((h) => (item[h] !== undefined ? item[h] : ''));
  const targetRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(targetRow, 1, 1, headers.length);
  range.setNumberFormats([textColumnFormats_(headers)]);
  range.setValues([row]);
  return { row: targetRow };
}

function updateCatalogItem_(catalog, rowNumber, item) {
  if (!rowNumber || rowNumber < 2) throw new Error('Invalid row number');
  const sheet = catalogSheet_(catalog);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const row = headers.map((h) => (item[h] !== undefined ? item[h] : ''));
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  range.setNumberFormats([textColumnFormats_(headers)]);
  range.setValues([row]);
  return { row: rowNumber };
}

function deleteCatalogItem_(catalog, rowNumber) {
  if (!rowNumber || rowNumber < 2) throw new Error('Invalid row number');
  const sheet = catalogSheet_(catalog);
  sheet.deleteRow(rowNumber);
  return { deleted: true };
}

// The interiors CATALOG tab groups items under section-header rows (e.g. a
// row that only has "1 APPLIANCES" in the CATEGORY column, followed by item
// rows with a blank CATEGORY cell). This reads the sheet, skips those header
// rows, and forward-fills the category onto each item below it.
function finishesSheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map((h) => String(h).trim());
  const categoryIdx = headers.indexOf('CATEGORY');
  const idIdx = headers.indexOf('ID');

  const rows = [];
  let currentCategory = '';
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every((c) => c === '' || c === null)) continue;

    const idVal = idIdx >= 0 ? String(row[idIdx]).trim() : '';
    const categoryVal = categoryIdx >= 0 ? String(row[categoryIdx]).trim() : '';

    if (!idVal && categoryVal) {
      // Section header row, e.g. "1 APPLIANCES" — strip a leading number.
      currentCategory = categoryVal.replace(/^\d+(\.\d+)?\s+/, '');
      continue;
    }
    if (!idVal) continue; // stray blank/formatting row

    const obj = {};
    headers.forEach((h, idx) => (obj[h] = dateSafeValue_(row[idx])));
    if (categoryIdx >= 0) obj['CATEGORY'] = categoryVal || currentCategory;
    rows.push(obj);
  }
  return rows;
}

function listProjects_() {
  const cfg = getConfig_();
  if (!cfg.projectsFolderId) throw new Error('PROJECTS_FOLDER_ID script property is not set.');
  const folder = DriveApp.getFolderById(cfg.projectsFolderId);
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    list.push({ id: f.getId(), name: f.getName(), updated: f.getLastUpdated() });
  }
  list.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  return list;
}

function loadProject_(id) {
  if (!id) throw new Error('Missing project id');
  const ss = SpreadsheetApp.openById(id);
  const infoSheet = ss.getSheetByName('ProjectInfo');
  const linesSheet = ss.getSheetByName('Lines');
  const finishesSheet = ss.getSheetByName('Finishes');

  const info = {};
  if (infoSheet) {
    const values = infoSheet.getDataRange().getValues();
    values.forEach((row) => {
      if (row[0]) info[row[0]] = row[1];
    });
    JSON_INFO_KEYS_.forEach((key) => {
      if (info[key]) {
        try {
          info[key] = JSON.parse(info[key]);
        } catch (e) {
          info[key] = [];
        }
      }
    });
  }

  return {
    id: ss.getId(),
    info: info,
    lines: linesSheet ? sheetToObjects_(linesSheet) : [],
    finishLines: finishesSheet ? sheetToObjects_(finishesSheet) : [],
  };
}

const JSON_INFO_KEYS_ = ['versions', 'areas', 'tableSettings'];

const LINE_FIELDS_ = [
  'versionId', 'versionName', 'areaId', 'devCostCode', 'itemId', 'category', 'subcategory', 'description',
  'costType', 'unit', 'unitCostMaterial', 'unitCostLabor', 'useOverride', 'unitPriceOverride', 'markupPct',
  'qty', 'notes',
];

const FINISH_FIELDS_ = [
  'versionId', 'versionName', 'areaId', 'itemId', 'category', 'description', 'unit',
  'unitPrice', 'qty', 'notes', 'fieldsJson',
];

function saveProject_(project) {
  const cfg = getConfig_();
  let ss;
  if (project.id) {
    ss = SpreadsheetApp.openById(project.id);
  } else {
    if (!cfg.projectsFolderId) throw new Error('PROJECTS_FOLDER_ID script property is not set.');
    ss = SpreadsheetApp.create(project.info.name || 'Untitled Project');
    const file = DriveApp.getFileById(ss.getId());
    const folder = DriveApp.getFolderById(cfg.projectsFolderId);
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }

  writeInfoSheet_(ss, project.info);
  writeTableSheet_(ss, 'Lines', project.lines, LINE_FIELDS_);
  writeTableSheet_(ss, 'Finishes', project.finishLines, FINISH_FIELDS_);

  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  return { id: ss.getId(), url: ss.getUrl() };
}

function writeInfoSheet_(ss, info) {
  let sheet = ss.getSheetByName('ProjectInfo');
  if (!sheet) sheet = ss.insertSheet('ProjectInfo');
  sheet.clear();
  const rows = [];
  Object.keys(info || {}).forEach((k) => {
    let v = info[k];
    if (JSON_INFO_KEYS_.indexOf(k) !== -1) v = JSON.stringify(v);
    rows.push([k, v]);
  });
  if (rows.length) sheet.getRange(1, 1, rows.length, 2).setValues(rows);
}

function writeTableSheet_(ss, name, records, fields) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clear();
  sheet.getRange(1, 1, 1, fields.length).setValues([fields]);
  if (records && records.length) {
    const rows = records.map((r) =>
      fields.map((f) => {
        const v = r[f];
        return v === undefined || v === null ? '' : v;
      })
    );
    const range = sheet.getRange(2, 1, rows.length, fields.length);
    // Same protection as the Budget Catalog writes: force non-numeric
    // columns (codes, categories, descriptions, notes, ...) to plain-text
    // format before writing, so a value that happens to look like a date
    // or number (e.g. a catalog code) never gets silently reinterpreted by
    // Sheets' normal auto-parsing.
    range.setNumberFormats(rows.map(() => textColumnFormats_(fields)));
    range.setValues(rows);
  }
}

function deleteProject_(id) {
  if (!id) throw new Error('Missing project id');
  DriveApp.getFileById(id).setTrashed(true);
  return { id: id, deleted: true };
}
