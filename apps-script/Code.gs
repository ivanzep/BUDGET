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
function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map((h) => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every((c) => c === '' || c === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = row[idx]));
    rows.push(obj);
  }
  return rows;
}

function getBudgetCatalog_() {
  const cfg = getConfig_();
  if (!cfg.catalogSheetId) throw new Error('CATALOG_SHEET_ID script property is not set.');
  const ss = SpreadsheetApp.openById(cfg.catalogSheetId);
  return sheetToObjects_(ss.getSheets()[0]);
}

function getFinishesCatalog_() {
  const cfg = getConfig_();
  if (!cfg.finishesSheetId) throw new Error('FINISHES_SHEET_ID script property is not set.');
  const ss = SpreadsheetApp.openById(cfg.finishesSheetId);
  const sheet = ss.getSheetByName('CATALOG') || ss.getSheets()[0];
  return finishesSheetToObjects_(sheet);
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
    headers.forEach((h, idx) => (obj[h] = row[idx]));
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
    if (info.versions) {
      try {
        info.versions = JSON.parse(info.versions);
      } catch (e) {
        info.versions = [];
      }
    }
  }

  return {
    id: ss.getId(),
    info: info,
    lines: linesSheet ? sheetToObjects_(linesSheet) : [],
    finishLines: finishesSheet ? sheetToObjects_(finishesSheet) : [],
  };
}

const LINE_FIELDS_ = [
  'versionId', 'versionName', 'itemId', 'category', 'subcategory', 'description',
  'unit', 'unitCostMaterial', 'unitCostLabor', 'markupPct', 'qty', 'notes',
];

const FINISH_FIELDS_ = [
  'versionId', 'versionName', 'itemId', 'category', 'description', 'unit',
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
    if (k === 'versions') v = JSON.stringify(v);
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
    sheet.getRange(2, 1, rows.length, fields.length).setValues(rows);
  }
}

function deleteProject_(id) {
  if (!id) throw new Error('Missing project id');
  DriveApp.getFileById(id).setTrashed(true);
  return { id: id, deleted: true };
}
