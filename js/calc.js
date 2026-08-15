// Unit cost, gated by which Cost Type tags are selected on the line: if
// only MATERIAL is selected, labor is excluded (and vice versa). With no
// Cost Type selected at all, falls back to material + labor combined.
export function lineUnitCost(line) {
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

export function feeAmounts(project, versionId) {
  const v = project.info.versions.find((v) => v.id === versionId) || {};
  const hardCost = hardCostSubtotal(project, versionId).total;
  const overhead = (hardCost * (Number(v.overheadPct) || 0)) / 100;
  const gcMargin = (hardCost * (Number(v.gcMarginPct) || 0)) / 100;
  const pm = (Number(v.pmMonthlyRate) || 0) * (Number(v.pmMonths) || 0);
  const insurance = (Number(v.insuranceMonthlyRate) || 0) * (Number(v.insuranceMonths) || 0);
  const contingency = (hardCost * (Number(v.contingencyPct) || 0)) / 100;
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
