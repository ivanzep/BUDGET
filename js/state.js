import { uid } from './util.js';
import { DEFAULT_TABLE_SETTINGS } from './tableSettings.js';

export function defaultVersionFees() {
  return {
    overheadPct: 0,
    gcMarginPct: 0,
    pmMonthlyRate: 0,
    pmMonths: 0,
    insuranceMonthlyRate: 0,
    insuranceMonths: 0,
    contingencyPct: 0,
  };
}

export function newProject() {
  const vId = uid('v');
  const aId = uid('a');
  return {
    id: null,
    info: {
      name: '',
      client: '',
      address: '',
      projectNumber: '',
      date: new Date().toISOString().slice(0, 10),
      logoUrl: '',
      notes: '',
      versions: [{ id: vId, name: 'Version 1', ...defaultVersionFees() }],
      areas: [{ id: aId, name: 'Whole Project', sqft: '' }],
      tableSettings: { ...DEFAULT_TABLE_SETTINGS, columnWidths: {}, columnOrder: [], hiddenColumns: [] },
    },
    lines: [],
    finishLines: [],
  };
}

export const state = {
  project: newProject(),
  activeVersionId: null,
  budgetCatalog: null,
  finishesCatalog: null,
  readonly: false,
};

state.activeVersionId = state.project.info.versions[0].id;

export function setProject(project) {
  project.info.areas = project.info.areas && project.info.areas.length
    ? project.info.areas
    : [{ id: uid('a'), name: 'Whole Project', sqft: '' }];
  project.info.versions.forEach((v) => {
    Object.assign(v, { ...defaultVersionFees(), ...v });
  });
  project.info.tableSettings = {
    ...DEFAULT_TABLE_SETTINGS,
    ...(project.info.tableSettings || {}),
    columnWidths: { ...(project.info.tableSettings?.columnWidths || {}) },
    columnOrder: project.info.tableSettings?.columnOrder || [],
    hiddenColumns: project.info.tableSettings?.hiddenColumns || [],
  };
  state.project = project;
  state.activeVersionId = project.info.versions?.[0]?.id || null;
}

export function addVersion(name) {
  const v = { id: uid('v'), name: name || `Version ${state.project.info.versions.length + 1}`, ...defaultVersionFees() };
  state.project.info.versions.push(v);
  state.activeVersionId = v.id;
  return v;
}

export function removeVersion(versionId) {
  if (state.project.info.versions.length <= 1) return;
  state.project.info.versions = state.project.info.versions.filter((v) => v.id !== versionId);
  state.project.lines = state.project.lines.filter((l) => l.versionId !== versionId);
  state.project.finishLines = state.project.finishLines.filter((l) => l.versionId !== versionId);
  if (state.activeVersionId === versionId) {
    state.activeVersionId = state.project.info.versions[0].id;
  }
}

export function duplicateVersion(versionId) {
  const src = state.project.info.versions.find((v) => v.id === versionId);
  if (!src) return;
  const v = { ...src, id: uid('v'), name: `${src.name} (copy)` };
  state.project.info.versions.push(v);
  state.project.lines
    .filter((l) => l.versionId === versionId)
    .forEach((l) => state.project.lines.push({ ...l, versionId: v.id, versionName: v.name }));
  state.project.finishLines
    .filter((l) => l.versionId === versionId)
    .forEach((l) => state.project.finishLines.push({ ...l, versionId: v.id, versionName: v.name }));
  state.activeVersionId = v.id;
  return v;
}

export function addArea(name, sqft) {
  const a = { id: uid('a'), name: name || `Area ${state.project.info.areas.length + 1}`, sqft: sqft || '' };
  state.project.info.areas.push(a);
  return a;
}

export function removeArea(areaId) {
  if (state.project.info.areas.length <= 1) return;
  state.project.info.areas = state.project.info.areas.filter((a) => a.id !== areaId);
  const fallbackId = state.project.info.areas[0].id;
  state.project.lines.forEach((l) => {
    if (l.areaId === areaId) l.areaId = fallbackId;
  });
  state.project.finishLines.forEach((l) => {
    if (l.areaId === areaId) l.areaId = fallbackId;
  });
}
