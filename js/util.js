export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatCurrency(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let toastTimer = null;
export function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'toast toast-error show' : 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Numeric compare when both sides parse as numbers, otherwise a
// case-insensitive string compare -- spreadsheet-style auto-detection so a
// cost column sorts numerically and a text column sorts alphabetically.
export function compareValues(a, b) {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  const na = Number(sa);
  const nb = Number(sb);
  if (sa !== '' && sb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
}

// Pointer-based (not native HTML5 drag-and-drop) drag helper: HTML5 DnD is
// unreliable across browsers/touch devices. Pointer events mirror an
// ordinary mousedown/mousemove/mouseup drag and work for touch too.
// `grips` are the drag handles; `getTargets()` returns the current
// draggable-over elements (re-queried, since a re-render can replace them);
// `targetAttr` is the selector each grip/target resolves up to via
// `closest()`; `onDrop(startEl, targetEl)` fires once, on release, only
// when the pointer let go over a valid target other than the start element.
export function wirePointerDrag(grips, getTargets, targetAttr, onDrop) {
  grips.forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startEl = grip.closest(targetAttr);
      if (!startEl) return;
      let currentTarget = null;
      const clearHighlight = () => getTargets().forEach((t) => t.classList.remove('drag-over'));
      const onMove = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(targetAttr);
        clearHighlight();
        if (el && el !== startEl && getTargets().includes(el)) {
          el.classList.add('drag-over');
          currentTarget = el;
        } else {
          currentTarget = null;
        }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        clearHighlight();
        if (currentTarget) onDrop(startEl, currentTarget);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

// Resize/compress an uploaded image file so it's small enough to store as a
// data URL in a Sheets cell (35,000 char practical limit).
export function resizeImageFile(file, maxWidth = 260, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
