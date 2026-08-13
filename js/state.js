import { uid } from './util.js';

export function newProject() {
  const vId = uid('v');
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
      versions: [{ id: vId, name: 'Version 1' }],
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
  state.project = project;
  state.activeVersionId = project.info.versions?.[0]?.id || null;
}

export function addVersion(name) {
  const v = { id: uid('v'), name: name || `Version ${state.project.info.versions.length + 1}` };
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
  const v = { id: uid('v'), name: `${src.name} (copy)` };
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
