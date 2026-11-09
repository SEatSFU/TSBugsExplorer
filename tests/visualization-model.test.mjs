import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryDistribution, categoryDifferences, heatmapModel, maxCellCount, shortCategoryLabel } from '../scripts/visualization-model.mjs';

const categories = [{ id: 'api', label: 'API Misuse' }, { id: 'other', label: 'Other' }];
const projects = [{ id: 'A', name: 'A', domainId: 'domain' }, { id: 'B', name: 'B', domainId: 'domain' }, { id: 'empty', name: 'Empty', domainId: 'domain' }];
const samples = (projectId, categoryId, n) => Array.from({ length: n }, () => ({ projectId, categoryId }));
const bugs = [...samples('A', 'api', 60), ...samples('A', 'other', 40), ...samples('B', 'api', 1), ...samples('B', 'other', 9)];

test('Project-Weighted is the equal project mean, not the pooled sample proportion', () => {
  const model = categoryDistribution(bugs, categories);
  const api = model.rows[0];
  assert.equal(api.sampleCount, 61);
  assert.equal(api.weightedShare, 35);
  assert(Math.abs(100 * api.sampleCount / bugs.length - 55.4545454545) < 1e-8);
  assert.equal(model.eligibleProjectCount, 2);
  assert.equal(model.rows.reduce((sum, row) => sum + row.weightedShare, 0), 100);
});

test('projects with zero category occurrences contribute zero; projects without eligible bugs are excluded', () => {
  const model = categoryDistribution([...samples('A', 'api', 10), ...samples('B', 'other', 10)], categories);
  assert.equal(model.eligibleProjectCount, 2);
  assert.equal(model.rows[0].weightedShare, 50);
  assert.equal(model.rows[0].projectsWithCategory, 1);
});

test('category focus retains the non-category-filtered project denominator', () => {
  const model = categoryDistribution(bugs, categories, 'api');
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].weightedShare, 35);
  const onlyA = categoryDistribution(bugs.filter(b => b.projectId === 'A'), categories, 'api');
  assert.equal(onlyA.rows[0].weightedShare, 60);
});

test('no eligible projects yields undefined proportions without division by zero', () => {
  const model = categoryDistribution([], categories);
  assert.equal(model.eligibleProjectCount, 0);
  assert(model.rows.every(row => row.weightedShare === null && row.sampleCount === 0));
});

test('heatmap overview retains every registry axis, including empty projects/categories', () => {
  const model = heatmapModel(bugs, bugs, projects, [...categories, { id: 'zero', label: 'Zero' }]);
  assert.equal(model.rows.length, 3);
  assert.equal(model.columns.length, 3);
  assert.equal(model.cells.length, 9);
  assert.equal(model.cells.find(c => c.projectId === 'empty').share, null);
  assert.equal(maxCellCount(bugs), 60);
});

test('heatmap axis filters retain zero cells and the non-Category-filtered percentage denominator', () => {
  const matching = bugs.filter(b => b.categoryId === 'api');
  const category = heatmapModel(matching, bugs, projects, categories, { categoryId: 'api' });
  assert.equal(category.rows.length, 3); assert.equal(category.columns.length, 1);
  assert.equal(category.cells[0].v, 60); assert.equal(category.cells[0].denominator, 100); assert.equal(category.cells[0].share, 60);
  const project = heatmapModel(bugs.filter(b => b.projectId === 'B'), bugs.filter(b => b.projectId === 'B'), projects, categories, { projectId: 'B' });
  assert.equal(project.rows.length, 1); assert.equal(project.columns.length, 2);
  const both = heatmapModel(matching.filter(b => b.projectId === 'B'), bugs.filter(b => b.projectId === 'B'), projects, categories, { projectId: 'B', categoryId: 'api' });
  assert.equal(both.cells[0].share, 10);
  const empty = heatmapModel([], [], projects, categories, { projectId: 'empty', categoryId: 'api' });
  assert.equal(empty.rows.length, 1); assert.equal(empty.columns.length, 1);
  assert.equal(empty.cells[0].v, 0); assert.equal(empty.cells[0].share, null);
});

test('search filtering retains every eligible axis even when no Bug samples match', () => {
  const context = bugs.filter(b => b.projectId === 'B');
  const model = heatmapModel(context, context, projects, categories);
  assert.equal(model.rows.length, projects.length); assert.equal(model.columns.length, categories.length);
  const empty = heatmapModel([], [], projects, categories);
  assert.equal(empty.cells.length, projects.length * categories.length);
  assert(empty.cells.every(cell => cell.v === 0 && cell.share === null));
});

test('Domain eligibility comes from registry membership and retains empty projects and categories', () => {
  const registryProjects = [...projects, { id: 'zero-2', name: 'Zero 2', domainId: 'domain' }, { id: 'outside', name: 'Outside', domainId: 'other-domain' }];
  const registryCategories = [...categories, { id: 'zero-1', label: 'Zero 1' }, { id: 'zero-2', label: 'Zero 2' }];
  const matching = [...samples('A', 'api', 3), ...samples('B', 'other', 2)];
  const model = heatmapModel(matching, bugs, registryProjects, registryCategories, { domainId: 'domain' });
  assert.deepEqual(model.rows.map(row => row.id), ['A', 'B', 'empty', 'zero-2']);
  assert.deepEqual(model.columns.map(column => column.id), ['api', 'other', 'zero-1', 'zero-2']);
  assert.equal(model.cells.length, 16);
  assert.equal(model.cells.reduce((sum, cell) => sum + cell.v, 0), 5);
  assert.equal(model.cells.find(cell => cell.projectId === 'A' && cell.categoryId === 'api').share, 3);
  assert.equal(model.cells.find(cell => cell.projectId === 'A' && cell.categoryId === 'other').v, 0, 'zero cells between populated axes remain visible');
});

test('combined axis filters restrict eligibility independently of matching counts and denominators', () => {
  const matching = samples('B', 'api', 1);
  const model = heatmapModel(matching, bugs, projects, categories, { domainId: 'domain', projectId: 'B', categoryId: 'api' });
  assert.deepEqual(model.rows.map(row => row.id), ['B']);
  assert.deepEqual(model.columns.map(column => column.id), ['api']);
  assert.equal(model.cells[0].v, 1);
  assert.equal(model.cells[0].denominator, 10);
  assert.equal(model.cells[0].share, 10);
  const noMatch = heatmapModel([], bugs, projects, categories, { domainId: 'domain' });
  assert.equal(noMatch.cells.length, projects.length * categories.length);
  assert(noMatch.cells.every(cell => cell.v === 0));
  assert.equal(noMatch.cells.find(cell => cell.projectId === 'B').denominator, 10);
});

test('clearing axis filters restores eligible registry members including zero-only axes', () => {
  const registryProjects = [...projects, { id: 'outside', name: 'Outside', domainId: 'other-domain' }];
  const registryCategories = [...categories, { id: 'zero', label: 'Zero' }];
  const matching = samples('A', 'api', 1);
  const focused = heatmapModel(matching, bugs, registryProjects, registryCategories, { domainId: 'domain', projectId: 'A' });
  assert.equal(focused.rows.length, 1); assert.equal(focused.columns.length, 3);
  const domain = heatmapModel(bugs, bugs, registryProjects, registryCategories, { domainId: 'domain' });
  assert.equal(domain.rows.length, 3); assert.equal(domain.columns.length, 3);
  const reset = heatmapModel(bugs, bugs, registryProjects, registryCategories);
  assert.equal(reset.rows.length, 4); assert.equal(reset.columns.length, 3);
});

test('an axis-empty result requires an explicit eligibility exclusion rather than zero sample counts', () => {
  for (const filters of [{ projectId: 'unknown' }, { categoryId: 'unknown' }, { projectId: 'A', domainId: 'other-domain' }]) {
    const model = heatmapModel([], [], projects, categories, filters);
    assert(model.rows.length === 0 || model.columns.length === 0);
    assert.equal(model.cells.length, 0);
  }
});

test('category differences are signed pp, ordered by absolute difference, with count details', () => {
  const model = categoryDifferences(bugs, categories, 'A', 'B');
  assert.equal(model.totalA, 100); assert.equal(model.totalB, 10);
  const api = model.rows.find(row => row.id === 'api');
  assert.equal(api.shareA, 60); assert.equal(api.shareB, 10); assert.equal(api.delta, 50);
  assert.equal(api.countA, 60); assert.equal(api.countB, 1);
  assert.equal(model.rows.find(row => row.id === 'other').delta, -50);
  assert.deepEqual(categoryDifferences(bugs, categories, 'B', 'A').rows.map(row => row.delta), model.rows.map(row => -row.delta));
});

test('zero-sample comparisons are N/A rather than zero percent', () => {
  assert(categoryDifferences(bugs, categories, 'A', 'empty').rows.every(row => row.shareB === null && row.delta === null));
});

test('heatmap labels honor optional registry metadata and abbreviate without changing research data', () => {
  assert.equal(shortCategoryLabel({ label: 'Asynchrony / Event Handling Bug' }), 'Async / Event');
  assert.equal(shortCategoryLabel({ label: 'Tooling / Configuration Issue' }), 'Tooling / Config');
  assert.equal(shortCategoryLabel({ label: 'New category', shortLabel: 'New' }), 'New');
  assert.equal(shortCategoryLabel({ label: 'New category' }), 'New category');
});
