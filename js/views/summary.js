import { api } from '../api.js';
import { state, setProject } from '../state.js';
import { escapeHtml, toast } from '../util.js';
import { exportCSV, exportExcel } from '../export.js';
import { openPrintPreview } from '../print.js';
import { buildHeaderHtml, SECTION_DEFS } from '../printSections.js';

export async function renderSummary(container, id, readonly) {
  container.innerHTML = '<p>Loading...</p>';
  if (!state.project.id || state.project.id !== id) {
    try {
      const raw = await api.loadProject(id);
      setProject(fromWire(raw));
    } catch (err) {
      container.innerHTML = `<p class="error">Could not load project: ${escapeHtml(err.message)}</p>`;
      return;
    }
  }
  draw(container, readonly);
}

function fromWire(raw) {
  const info = raw.info || {};
  info.versions = info.versions || [];
  return { id: raw.id, info, lines: raw.lines || [], finishLines: raw.finishLines || [] };
}

function draw(container, readonly) {
  const p = state.project;
  const shareUrl = `${location.origin}${location.pathname}#/summary/${p.id}?readonly=1`;
  const activeVersionId = state.activeVersionId || p.info.versions[0]?.id;

  container.innerHTML = `
    <div class="view-header no-print">
      <h2>Summary &amp; Comparison</h2>
      <div class="actions">
        ${readonly ? '' : `<a class="btn" href="#/edit/${p.id}">Back to Editor</a>`}
        <button class="btn" id="btn-print">Print / Export</button>
        <button class="btn" id="btn-xlsx">Export Excel</button>
        <button class="btn" id="btn-csv">Export CSV</button>
        <button class="btn" id="btn-share">Copy Share Link</button>
      </div>
    </div>

    <section class="card">
      <div id="print-area">${buildHeaderHtml(p, true)}${SECTION_DEFS.summary.build(p)}</div>
    </section>
  `;

  container.querySelector('#btn-print').addEventListener('click', () => openPrintPreview(p, activeVersionId));
  container.querySelector('#btn-xlsx').addEventListener('click', () => exportExcel(p));
  container.querySelector('#btn-csv').addEventListener('click', () => exportCSV(p));
  container.querySelector('#btn-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('Read-only share link copied to clipboard');
    } catch {
      prompt('Copy this link:', shareUrl);
    }
  });
}
