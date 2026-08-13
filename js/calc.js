export function lineTotal(line) {
  const mat = Number(line.unitCostMaterial) || 0;
  const lab = Number(line.unitCostLabor) || 0;
  const qty = Number(line.qty) || 0;
  const markup = Number(line.markupPct) || 0;
  return qty * (mat + lab) * (1 + markup / 100);
}

export function finishLineTotal(fl) {
  const price = Number(fl.unitPrice) || 0;
  const qty = Number(fl.qty) || 0;
  return price * qty;
}

export function linesForVersion(lines, versionId) {
  return lines.filter((l) => l.versionId === versionId);
}

export function versionTotal(project, versionId) {
  const budget = linesForVersion(project.lines, versionId).reduce((s, l) => s + lineTotal(l), 0);
  const finishes = linesForVersion(project.finishLines, versionId).reduce((s, l) => s + finishLineTotal(l), 0);
  return { budget, finishes, total: budget + finishes };
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
