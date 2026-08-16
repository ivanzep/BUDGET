import { escapeHtml } from './util.js';
import { SECTION_DEFS, DEFAULT_SECTION_ORDER, buildHeaderHtml } from './printSections.js';

// Physical page dimensions in inches (portrait). Landscape swaps w/h.
const PAGE_SIZES = {
  letter: { label: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
  legal: { label: 'Legal (8.5 × 14 in)', w: 8.5, h: 14 },
  tabloid: { label: 'Tabloid (11 × 17 in)', w: 11, h: 17 },
  a4: { label: 'A4 (8.27 × 11.69 in)', w: 8.27, h: 11.69 },
  a3: { label: 'A3 (11.69 × 16.54 in)', w: 11.69, h: 16.54 },
};

function defaultSections() {
  return DEFAULT_SECTION_ORDER.map((id) => ({ id, enabled: true, pageBreakBefore: true }));
}

const SETTINGS_KEY = 'printPreviewSettings_v1';
const DEFAULT_SETTINGS = {
  pageSize: 'letter',
  orientation: 'portrait',
  tableScale: 100,
  viewZoom: 60,
  marginTop: 0.5,
  marginRight: 0.5,
  marginBottom: 0.5,
  marginLeft: 0.5,
  showLogo: true,
  showPageNumbers: true,
  sections: defaultSections(),
};

// Merges saved section list with the current set of known sections: keeps
// the saved order/enabled/pageBreak choices, drops any section id that no
// longer exists, and appends any newly-added section id (enabled by
// default) so it isn't silently missing from older saved settings.
function normalizeSections(saved) {
  const list = Array.isArray(saved) ? saved : [];
  const known = list.filter((s) => s && SECTION_DEFS[s.id]);
  const seen = new Set(known.map((s) => s.id));
  DEFAULT_SECTION_ORDER.forEach((id) => {
    if (!seen.has(id)) known.push({ id, enabled: true, pageBreakBefore: true });
  });
  return known;
}

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    saved = {};
  }
  return { ...DEFAULT_SETTINGS, ...saved, sections: normalizeSections(saved.sections) };
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable -- settings just won't persist across sessions.
  }
}

function pageDims(s) {
  const size = PAGE_SIZES[s.pageSize] || PAGE_SIZES.letter;
  return s.orientation === 'landscape' ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

let root;
let settings;
let project;
let versionId;

// Composes the header (always shown) plus every enabled section in the
// user's chosen order, wrapping each in a div that page-breaks before it
// when that section's own "page break before" toggle is on (the very first
// visible section never breaks -- it already starts the report right after
// the header).
function buildFullContentHtml() {
  const header = buildHeaderHtml(project, settings.showLogo);
  const enabled = settings.sections.filter((s) => s.enabled && SECTION_DEFS[s.id]);
  const sectionsHtml = enabled
    .map((s, idx) => {
      const html = SECTION_DEFS[s.id].build(project, versionId);
      const breakStyle = idx > 0 && s.pageBreakBefore ? 'break-before: page; page-break-before: always;' : '';
      return `<div class="print-section" style="${breakStyle}">${html}</div>`;
    })
    .join('');
  return header + sectionsHtml;
}

// Opens a full-screen preview of the printable project report -- built
// from whichever of the project's tabs (Project Info, Areas, Budget Lines,
// Interior Finishes, GC Fees, Summary/Comparison) are enabled, in the
// user's chosen order, each independently able to start a new page -- with
// page setup controls (size, orientation, table scale, on-screen zoom,
// margins, logo, page numbers) shared by every tab/view that offers
// printing, so the same one feature and settings apply everywhere rather
// than each screen inventing its own.
export function openPrintPreview(proj, activeVersionId) {
  project = proj;
  versionId = activeVersionId || proj.info.versions[0]?.id;
  settings = loadSettings();

  root = document.createElement('div');
  root.id = 'print-preview-root';
  document.body.appendChild(root);
  document.addEventListener('keydown', onKeydown);
  render();
}

function onKeydown(e) {
  if (e.key === 'Escape') closePreview();
}

function closePreview() {
  document.getElementById('print-page-style')?.remove();
  document.removeEventListener('keydown', onKeydown);
  root?.remove();
  root = null;
}

function sectionsListHtml() {
  return settings.sections
    .map((s, idx, arr) => {
      const def = SECTION_DEFS[s.id];
      if (!def) return '';
      return `
        <div class="pp-section-row ${s.enabled ? '' : 'pp-section-disabled'}">
          <span class="col-order-btns">
            <button type="button" class="icon-btn" data-move-section-up="${s.id}" ${idx === 0 ? 'disabled' : ''} title="Move up" aria-label="Move ${escapeHtml(def.label)} up">&#9650;</button>
            <button type="button" class="icon-btn" data-move-section-down="${s.id}" ${idx === arr.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move ${escapeHtml(def.label)} down">&#9660;</button>
          </span>
          <label class="pp-section-name"><input type="checkbox" data-section-enable="${s.id}" ${s.enabled ? 'checked' : ''}> ${escapeHtml(def.label)}</label>
          <label class="pp-section-break" title="Start this section on a new page">
            <input type="checkbox" data-section-break="${s.id}" ${s.pageBreakBefore ? 'checked' : ''} ${idx === 0 ? 'disabled' : ''}> Page break
          </label>
        </div>`;
    })
    .join('');
}

function render() {
  const dims = pageDims(settings);
  root.innerHTML = `
    <div class="print-preview-overlay">
      <div class="print-preview-sidebar">
        <div class="print-preview-sidebar-header">
          <h3>Print / Export</h3>
          <button class="modal-close" id="pp-close" aria-label="Close">&times;</button>
        </div>
        <label>Page Size
          <select id="pp-page-size">
            ${Object.entries(PAGE_SIZES).map(([key, s]) => `<option value="${key}" ${settings.pageSize === key ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </label>
        <label>Orientation
          <select id="pp-orientation">
            <option value="portrait" ${settings.orientation === 'portrait' ? 'selected' : ''}>Portrait</option>
            <option value="landscape" ${settings.orientation === 'landscape' ? 'selected' : ''}>Landscape</option>
          </select>
        </label>
        <label>Table Scale <span class="pp-value">${settings.tableScale}%</span>
          <input type="range" id="pp-table-scale" min="40" max="150" step="5" value="${settings.tableScale}">
        </label>
        <label>View Zoom <span class="pp-value">${settings.viewZoom}%</span>
          <input type="range" id="pp-view-zoom" min="25" max="150" step="5" value="${settings.viewZoom}">
        </label>
        <div class="pp-margins">
          <span class="pp-margins-label">Margins (in)</span>
          <div class="pp-margins-grid">
            <label>Top <input type="number" id="pp-margin-top" min="0" max="3" step="0.1" value="${settings.marginTop}"></label>
            <label>Right <input type="number" id="pp-margin-right" min="0" max="3" step="0.1" value="${settings.marginRight}"></label>
            <label>Bottom <input type="number" id="pp-margin-bottom" min="0" max="3" step="0.1" value="${settings.marginBottom}"></label>
            <label>Left <input type="number" id="pp-margin-left" min="0" max="3" step="0.1" value="${settings.marginLeft}"></label>
          </div>
        </div>
        <label class="pp-checkbox"><input type="checkbox" id="pp-show-logo" ${settings.showLogo ? 'checked' : ''}> Include logo</label>
        <label class="pp-checkbox"><input type="checkbox" id="pp-show-pagenum" ${settings.showPageNumbers ? 'checked' : ''}> Page numbers</label>
        <div class="pp-sections">
          <span class="pp-margins-label">Sections (reorder, include, page-break)</span>
          ${sectionsListHtml()}
        </div>
        <div class="pp-actions">
          <button class="btn btn-primary" id="pp-print">Print...</button>
          <button class="btn" id="pp-export-pdf">Export PDF</button>
          <button class="btn" id="pp-close-btn">Close Preview</button>
        </div>
        <p class="muted pp-hint">"Print..." opens your browser's print dialog (choose "Save as PDF" there for a paginated PDF using these exact settings).</p>
      </div>
      <div class="print-preview-main">
        <div class="print-preview-viewport">
          <div class="print-preview-page-scaler" style="transform: scale(${settings.viewZoom / 100});">
            <div class="print-preview-page" id="pp-page" style="width:${dims.w}in; min-height:${dims.h}in; padding:${settings.marginTop}in ${settings.marginRight}in ${settings.marginBottom}in ${settings.marginLeft}in;">
              <div class="print-preview-content" id="pp-content" style="transform: scale(${settings.tableScale / 100}); transform-origin: top left; width:${10000 / settings.tableScale}%;">
                ${buildFullContentHtml()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  wire();
}

function moveSection(id, dir) {
  const idx = settings.sections.findIndex((s) => s.id === id);
  const target = idx + dir;
  if (idx === -1 || target < 0 || target >= settings.sections.length) return;
  [settings.sections[idx], settings.sections[target]] = [settings.sections[target], settings.sections[idx]];
}

function wire() {
  root.querySelector('#pp-close').addEventListener('click', closePreview);
  root.querySelector('#pp-close-btn').addEventListener('click', closePreview);
  root.querySelector('.print-preview-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('print-preview-overlay')) closePreview();
  });

  const bind = (id, key, parse = (v) => v) => {
    root.querySelector(id).addEventListener('input', (e) => {
      settings[key] = parse(e.target.value);
      saveSettings(settings);
      render();
    });
  };
  bind('#pp-page-size', 'pageSize');
  bind('#pp-orientation', 'orientation');
  bind('#pp-table-scale', 'tableScale', Number);
  bind('#pp-view-zoom', 'viewZoom', Number);
  bind('#pp-margin-top', 'marginTop', Number);
  bind('#pp-margin-right', 'marginRight', Number);
  bind('#pp-margin-bottom', 'marginBottom', Number);
  bind('#pp-margin-left', 'marginLeft', Number);
  root.querySelector('#pp-show-logo').addEventListener('change', (e) => {
    settings.showLogo = e.target.checked;
    saveSettings(settings);
    render();
  });
  root.querySelector('#pp-show-pagenum').addEventListener('change', (e) => {
    settings.showPageNumbers = e.target.checked;
    saveSettings(settings);
    render();
  });

  root.querySelectorAll('[data-move-section-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveSection(btn.dataset.moveSectionUp, -1);
      saveSettings(settings);
      render();
    });
  });
  root.querySelectorAll('[data-move-section-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveSection(btn.dataset.moveSectionDown, 1);
      saveSettings(settings);
      render();
    });
  });
  root.querySelectorAll('[data-section-enable]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const s = settings.sections.find((sec) => sec.id === cb.dataset.sectionEnable);
      if (s) s.enabled = cb.checked;
      saveSettings(settings);
      render();
    });
  });
  root.querySelectorAll('[data-section-break]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const s = settings.sections.find((sec) => sec.id === cb.dataset.sectionBreak);
      if (s) s.pageBreakBefore = cb.checked;
      saveSettings(settings);
      render();
    });
  });

  root.querySelector('#pp-print').addEventListener('click', doPrint);
  root.querySelector('#pp-export-pdf').addEventListener('click', doExportPdf);
}

// Injects an @page rule (size + margins, and a page-number margin box when
// enabled) plus @media print rules that show only this preview's content
// full-page, then triggers the browser's native print dialog -- which is
// also how the user gets a paginated, settings-accurate PDF via its
// "Save as PDF" destination.
function doPrint() {
  const dims = pageDims(settings);
  document.getElementById('print-page-style')?.remove();
  const style = document.createElement('style');
  style.id = 'print-page-style';
  style.textContent = `
    @page {
      size: ${dims.w}in ${dims.h}in;
      margin: ${settings.marginTop}in ${settings.marginRight}in ${settings.marginBottom}in ${settings.marginLeft}in;
      ${settings.showPageNumbers ? '@bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #666; }' : ''}
    }
    @media print {
      body > *:not(#print-preview-root) { display: none !important; }
      #print-preview-root { position: static !important; }
      .print-preview-sidebar { display: none !important; }
      .print-preview-overlay, .print-preview-main, .print-preview-viewport { all: unset; display: block !important; }
      .print-preview-page-scaler { transform: none !important; }
      .print-preview-page { width: auto !important; min-height: 0 !important; padding: 0 !important; box-shadow: none !important; }
      .print-preview-content { transform: scale(${settings.tableScale / 100}) !important; transform-origin: top left !important; width: ${10000 / settings.tableScale}% !important; }
    }
  `;
  document.head.appendChild(style);
  window.print();
}

// Renders the same content into an offscreen node at print scale and hands
// it to html2pdf, matching page size/orientation/margins to the chosen
// settings, then stamps page numbers onto the finished PDF afterward
// (html2pdf/jsPDF don't do this on their own).
async function doExportPdf() {
  if (typeof html2pdf === 'undefined') {
    alert('PDF export library did not load. Check your internet connection and try again.');
    return;
  }
  const dims = pageDims(settings);
  const safeName = (project.info.name || 'project').replace(/[^a-z0-9\-_]+/gi, '_');

  const offscreen = document.createElement('div');
  offscreen.style.cssText = `width:${dims.w - settings.marginLeft - settings.marginRight}in;`;
  offscreen.innerHTML = `<div style="transform: scale(${settings.tableScale / 100}); transform-origin: top left; width:${10000 / settings.tableScale}%;">${buildFullContentHtml()}</div>`;
  document.body.appendChild(offscreen);

  const btn = root.querySelector('#pp-export-pdf');
  btn.disabled = true;
  btn.textContent = 'Exporting...';
  try {
    const worker = html2pdf()
      .set({
        margin: [settings.marginTop, settings.marginRight, settings.marginBottom, settings.marginLeft],
        filename: `${safeName}_budget.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        // `format` is already the final, orientation-applied [width, height]
        // (see pageDims()) -- also passing `orientation` here made jsPDF
        // re-interpret/re-swap those same dimensions against it, producing
        // a squashed or wrong-shaped page. Passing only the explicit array
        // is what actually makes the exported sheet size correct.
        jsPDF: { unit: 'in', format: [dims.w, dims.h] },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(offscreen);
    if (settings.showPageNumbers) {
      await worker
        .toPdf()
        .get('pdf')
        .then((pdf) => {
          const pageCount = pdf.internal.getNumberOfPages();
          for (let i = 1; i <= pageCount; i += 1) {
            pdf.setPage(i);
            pdf.setFontSize(9);
            pdf.setTextColor(120);
            pdf.text(`Page ${i} of ${pageCount}`, dims.w / 2, dims.h - settings.marginBottom / 2, { align: 'center' });
          }
        })
        .save();
    } else {
      await worker.save();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export PDF';
    offscreen.remove();
  }
}
