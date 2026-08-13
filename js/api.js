import { APPS_SCRIPT_URL } from './config.js';

function checkConfigured() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('PASTE_YOUR')) {
    throw new Error('Apps Script URL is not configured yet. Edit js/config.js.');
  }
}

async function callGet(action, params = {}) {
  checkConfigured();
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

async function callPost(action, payload = {}) {
  checkConfigured();
  // Content-Type text/plain avoids a CORS preflight, which Apps Script
  // Web Apps do not handle.
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

export const api = {
  getBudgetCatalog: () => callGet('getBudgetCatalog'),
  getFinishesCatalog: () => callGet('getFinishesCatalog'),
  listProjects: () => callGet('listProjects'),
  loadProject: (id) => callGet('loadProject', { id }),
  saveProject: (project) => callPost('saveProject', { project }),
  deleteProject: (id) => callPost('deleteProject', { id }),
};
