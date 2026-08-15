// Unit cost. If the line has a manual override enabled, that value wins
// outright. Otherwise it's gated by which Cost Type tags are selected: if
// only MATERIAL is selected, labor is excluded (and vice versa). With no
// Cost Type selected at all, falls back to material + labor combined.
// Sheets round-trips booleans reliably in practice, but coerce defensively
// in case a cell ever comes back as the string "TRUE"/"FALSE" instead.
export function isOverrideOn(line) {
  const v = line.useOverride;
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

export function lineUnitCost(line) {
  if (isOverrideOn(line)) return Number(line.unitPriceOverride) || 0;
  const mat = Number(line.unitCostMaterial) || 0;
  const lab = Number(line.unitCostLabor) || 0;
  const types = (line.costType || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!types.length) return mat + lab;
  let total = 0;
  if (types.includes('MATERIAL')) total += mat;
  if (types.includes('LABOR')) total += lab;
  return total;
}

export function lineTotal(line) {
  const qty = Number(line.qty) || 0;
  const markup = Number(line.markupPct) || 0;
  return qty * lineUnitCost(line) * (1 + markup / 100);
}

export function finishLineTotal(fl) {
  const price = Number(fl.unitPrice) || 0;
  const qty = Number(fl.qty) || 0;
  return price * qty;
}

export function linesForVersion(lines, versionId) {
  return lines.filter((l) => l.versionId === versionId);
}

// Budget lines + finish lines, before GC fees/overhead/contingency.
export function hardCostSubtotal(project, versionId) {
  const budget = linesForVersion(project.lines, versionId).reduce((s, l) => s + lineTotal(l), 0);
  const finishes = linesForVersion(project.finishLines, versionId).reduce((s, l) => s + finishLineTotal(l), 0);
  return { budget, finishes, total: budget + finishes };
}

// Kept as an alias for readability at call sites that just want the combined number.
export function versionTotal(project, versionId) {
  return hardCostSubtotal(project, versionId);
}

// Each fee can be manually overridden (v.<key>OverrideOn/OverrideValue,
// mirroring a budget line's useOverride/unitPriceOverride) -- this is the
// single place that resolves rate-computed vs. overridden, so every
// consumer (the Fees tab, the Budget Lines table's GC Fees category,
// summary/compare, exports) stays consistent automatically.
export function feeAmounts(project, versionId) {
  const v = project.info.versions.find((v) => v.id === versionId) || {};
  const hardCost = hardCostSubtotal(project, versionId).total;
  const raw = {
    overhead: (hardCost * (Number(v.overheadPct) || 0)) / 100,
    gcMargin: (hardCost * (Number(v.gcMarginPct) || 0)) / 100,
    pm: (Number(v.pmMonthlyRate) || 0) * (Number(v.pmMonths) || 0),
    insurance: (Number(v.insuranceMonthlyRate) || 0) * (Number(v.insuranceMonths) || 0),
    contingency: (hardCost * (Number(v.contingencyPct) || 0)) / 100,
  };
  const resolve = (key) => (v[`${key}OverrideOn`] ? Number(v[`${key}OverrideValue`]) || 0 : raw[key]);
  const overhead = resolve('overhead');
  const gcMargin = resolve('gcMargin');
  const pm = resolve('pm');
  const insurance = resolve('insurance');
  const contingency = resolve('contingency');
  const feesTotal = overhead + gcMargin + pm + insurance + contingency;
  return { hardCost, overhead, gcMargin, pm, insurance, contingency, feesTotal, grandTotal: hardCost + feesTotal };
}

// category -> total, for a single version, budget lines only
export function categoryTotals(project, versionId) {
  const map = {};
  linesForVersion(project.lines, versionId).forEach((l) => {
    const cat = l.category || 'Uncategorized';
    map[cat] = (map[cat] || 0) + lineTotal(l);
  });
  return map;
}

export function allCategories(project) {
  const set = new Set();
  project.lines.forEach((l) => set.add(l.category || 'Uncategorized'));
  return Array.from(set);
}

// [{ category, subcategories: [subcategory, ...] }] in first-seen order
export function categoryGroups(project) {
  const map = new Map();
  project.lines.forEach((l) => {
    const cat = l.category || 'Uncategorized';
    const sub = l.subcategory || '';
    if (!map.has(cat)) map.set(cat, new Set());
    if (sub) map.get(cat).add(sub);
  });
  return Array.from(map.entries()).map(([category, subs]) => ({ category, subcategories: Array.from(subs) }));
}

export function categoryTotal(project, versionId, category) {
  return linesForVersion(project.lines, versionId)
    .filter((l) => (l.category || 'Uncategorized') === category)
    .reduce((s, l) => s + lineTotal(l), 0);
}

export function subcategoryTotal(project, versionId, category, subcategory) {
  return linesForVersion(project.lines, versionId)
    .filter((l) => (l.category || 'Uncategorized') === category && (l.subcategory || '') === subcategory)
    .reduce((s, l) => s + lineTotal(l), 0);
}

export function totalSqft(project) {
  return (project.info.areas || []).reduce((s, a) => s + (Number(a.sqft) || 0), 0);
}

export function areaTotal(project, versionId, areaId) {
  const budget = linesForVersion(project.lines, versionId)
    .filter((l) => (l.areaId || '') === areaId)
    .reduce((s, l) => s + lineTotal(l), 0);
  const finishes = linesForVersion(project.finishLines, versionId)
    .filter((l) => (l.areaId || '') === areaId)
    .reduce((s, l) => s + finishLineTotal(l), 0);
  return budget + finishes;
}

export function costPerSf(total, sqft) {
  const sf = Number(sqft) || 0;
  return sf > 0 ? total / sf : 0;
}
