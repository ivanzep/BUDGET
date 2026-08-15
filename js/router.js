import { renderProjects } from './views/projects.js';
import { renderEditor } from './views/editor.js';
import { renderSummary } from './views/summary.js';
import { renderCatalog } from './views/catalog.js';
import { state } from './state.js';

const appEl = () => document.getElementById('app');
const navEl = () => document.getElementById('nav');

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/projects';
  const [path, query] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { parts, params };
}

export async function route() {
  const { parts, params } = parseHash();
  state.readonly = params.get('readonly') === '1';
  navEl().style.display = state.readonly ? 'none' : '';

  if (parts[0] === 'edit') {
    await renderEditor(appEl(), parts[1]);
  } else if (parts[0] === 'summary') {
    await renderSummary(appEl(), parts[1], state.readonly);
  } else if (parts[0] === 'catalog') {
    await renderCatalog(appEl());
  } else {
    await renderProjects(appEl());
  }
}

export function initRouter() {
  window.addEventListener('hashchange', route);
  route();
}
