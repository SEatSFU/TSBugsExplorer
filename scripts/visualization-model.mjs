// Pure calculations shared by the UI and numerical acceptance tests.
function grid(bugs) {
  const counts = new Map(), totals = new Map();
  for (const bug of bugs) {
    if (!counts.has(bug.projectId)) counts.set(bug.projectId, new Map());
    const project = counts.get(bug.projectId);
    project.set(bug.categoryId, (project.get(bug.categoryId) || 0) + 1);
    totals.set(bug.projectId, (totals.get(bug.projectId) || 0) + 1);
  }
  return { counts, totals };
}

// The caller supplies the context BEFORE the category filter. All other filters apply.
export function categoryDistribution(contextBugs, categories, selectedCategoryId = '') {
  const { counts, totals } = grid(contextBugs);
  const eligibleProjectCount = totals.size;
  const rows = categories.filter(category => !selectedCategoryId || category.id === selectedCategoryId).map(category => {
    let sampleCount = 0, shareSum = 0, projectsWithCategory = 0;
    for (const [projectId, total] of totals) {
      const count = counts.get(projectId).get(category.id) || 0;
      sampleCount += count;
      shareSum += count / total;
      if (count) projectsWithCategory++;
    }
    return { ...category, sampleCount, weightedShare: eligibleProjectCount ? 100 * shareSum / eligibleProjectCount : null, projectsWithCategory };
  });
  return { eligibleProjectCount, rows };
}

export function maxCellCount(bugs) {
  const { counts } = grid(bugs);
  return Math.max(1, ...[...counts.values()].flatMap(project => [...project.values()]));
}

export function heatmapModel(matchingBugs, contextBugs, projects, categories, { projectId = '', categoryId = '', domainId = '' } = {}) {
  const { counts } = grid(matchingBugs);
  const { totals } = grid(contextBugs);
  // Registry membership and explicit axis filters determine eligibility, never counts.
  const rows = projects.filter(project => (!projectId || project.id === projectId) && (!domainId || project.domainId === domainId))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const columns = categories.filter(category => !categoryId || category.id === categoryId)
    .sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const cells = rows.flatMap(project => columns.map(category => {
    const v = counts.get(project.id)?.get(category.id) || 0;
    const denominator = totals.get(project.id) || 0;
    return { projectId: project.id, categoryId: category.id, r: project.name, c: category.label, v, denominator, share: denominator ? 100 * v / denominator : null };
  }));
  return { rows, columns, cells };
}

export function categoryDifferences(bugs, categories, projectAId, projectBId) {
  const { counts, totals } = grid(bugs);
  const totalA = totals.get(projectAId) || 0, totalB = totals.get(projectBId) || 0;
  const rows = categories.map(category => {
    const countA = counts.get(projectAId)?.get(category.id) || 0;
    const countB = counts.get(projectBId)?.get(category.id) || 0;
    const shareA = totalA ? 100 * countA / totalA : null;
    const shareB = totalB ? 100 * countB / totalB : null;
    return { ...category, countA, countB, shareA, shareB, delta: shareA === null || shareB === null ? null : shareA - shareB };
  }).sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || a.label.localeCompare(b.label));
  return { totalA, totalB, rows };
}

export function shortCategoryLabel(category) {
  return category.shortLabel || category.label
    .replace(/Asynchrony/g, 'Async')
    .replace(/Event Handling/g, 'Event')
    .replace(/Exception Handling/g, 'Exception')
    .replace(/\b(Runtime|Logic) (?:Exception|Error)\b/g, '$1')
    .replace(/Configuration/g, 'Config')
    .replace(/\s+(Bug|Issue)$/, '');
}
