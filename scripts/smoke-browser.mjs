// Optional real-browser acceptance checks. Start the local HTTP server first.
// Requires Playwright plus installed Chrome; neither is an application dependency.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { prepareDataset, toLegacyRecords, toLegacyCsv } from './data-loader.mjs';
import { readRaw } from '../tests/helpers.mjs';
import { categoryDistribution, categoryDifferences, maxCellCount } from './visualization-model.mjs';

const raw = await readRaw();
const initial = prepareDataset(raw);
const url = process.env.SMOKE_URL || 'http://127.0.0.1:8000/';
const cachedD3 = process.env.D3_SMOKE_FILE ? await readFile(process.env.D3_SMOKE_FILE, 'utf8') : null;
if (cachedD3) assert.match(cachedD3.slice(0, 150), /https:\/\/d3js\.org v7\.9\.0/, 'cached browser test dependency must be the existing D3 version');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, hasTouch: true });
if (cachedD3) {
  await context.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', route => route.fulfill({ contentType: 'application/javascript', body: cachedD3 }));
}
after(() => browser.close());

async function open(overrides, { failFirst = false } = {}) {
  if (overrides) prepareDataset(overrides);
  const page = await context.newPage();
  const errors = [];
  let bugRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.route('**/data/*.json', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1).replace('.json', '');
    if (name === 'bugs') {
      bugRequests++;
      if (failFirst && bugRequests === 1) return route.fulfill({ status: 503, body: 'Unavailable' });
    }
    if (overrides) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(overrides[name]) });
    return route.continue();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!failFirst) await ready(page);
  return { page, errors, bugRequests: () => bugRequests };
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#dataStatus').hidden || !document.querySelector('#retryLoad').hidden);
  assert.equal(await page.locator('#dataStatus').isHidden(), true, await page.locator('#dataMessage').textContent());
}

const tab = (page, id) => page.locator(`.tab[data-view="${id}"]`).click();
async function value(page, selector = '#metricCards') {
  return Number((await page.locator(`${selector} .value`).first().textContent()).replaceAll(',', ''));
}
const selectedFacetValues=(page,id)=>page.locator(`#${id} .criterion-option[aria-selected="true"]`).evaluateAll(nodes=>nodes.map(n=>n.dataset.value));
async function setFacetValues(page,id,values){
  const list=page.locator(`#${id}`),facet=page.locator('fieldset').filter({has:list});
  await facet.locator('input[type="search"]').fill('');
  await facet.locator('[data-clear]').click();
  for(const value of values){
    const index=await list.locator('.criterion-option').evaluateAll((nodes,value)=>nodes.findIndex(n=>n.dataset.value===value),value);
    assert(index>=0,`criterion value ${value} exists`);
    await list.locator('.criterion-option').nth(index).click();
  }
}
async function dragOptions(page,id,from,to,steps=6){
  const list=page.locator(`#${id}`);await list.evaluate(n=>{n.scrollTop=0});
  const first=list.locator('.criterion-option').nth(from),last=list.locator('.criterion-option').nth(to);
  await first.scrollIntoViewIfNeeded();
  let box=await first.boundingBox();
  const navBottom=await page.locator('nav').evaluate(n=>n.getBoundingClientRect().bottom);
  if(box.y<navBottom+10)await page.evaluate(delta=>window.scrollBy(0,delta),box.y-navBottom-20);
  box=await first.boundingBox();const end=await last.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps});await page.mouse.up();
}
async function download(page, selector) {
  const promise = page.waitForEvent('download');
  await page.locator(selector).click();
  const result = await promise;
  return readFile(await result.path(), 'utf8');
}
async function healthy(page, errors) {
  assert.deepEqual(errors, []);
  const invalid = await page.locator('svg [width],svg [cx],svg [cy],svg [r]').evaluateAll(elements => elements.filter(el => [...el.attributes].some(a => /NaN|Infinity/.test(a.value))).length);
  assert.equal(invalid, 0, 'no invalid SVG coordinates');
}

test('all five tabs retain initial counts, chart values, taxonomy wording, links, and tooltips', async () => {
  const { page, errors } = await open();
  try {
    assert.equal(await value(page), initial.bugs.length);
    assert.equal(await page.locator('#heatmap .heatmap-cell').count(), initial.projects.length * initial.bugCategories.length);
    assert.equal(await page.locator('#scatterChart circle').count(), initial.projects.filter(p => p.loc > 0 && p.stars > 0).length);
    if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
    await page.locator('#categoryChart rect').first().hover();
    assert.match(await page.locator('.tooltip').textContent(), /Bug samples/);
    await tab(page, 'explorer');
    assert.equal(await page.locator('#bugTableSummary').textContent(), `${initial.bugs.filter(b => b.filesChanged >= 1).length} matching bugs`);
    await page.locator('#nextPage').click();
    assert.match(await page.locator('#pageInfo').textContent(), /Page 2 /);
    await page.locator('#prevPage').click();
    await page.locator('#bugTable tbody tr').first().click();
    assert.equal(await page.locator('#bugDetail .panel-header a').getAttribute('href'), initial.bugs.find(b => b.filesChanged >= 1).link);
    assert((await page.locator('#bugDetail .example-card').count()) <= 6);
    await tab(page, 'compare');
    await page.locator('#projectA').selectOption(initial.projectById.get('shadcn-table')?.name || initial.projects[0]?.name);
    const selected = await page.locator('#projectA').inputValue();
    const project = initial.projects.find(p => p.name === selected);
    assert.match(await page.locator('#comparisonCards .project-card').first().textContent(), new RegExp(project.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const plotted = await page.locator('#dependencyCompare rect.a').evaluateAll(nodes => nodes.map(n => n.__data__.a));
    assert.equal(plotted.reduce((a, b) => a + b, 0), initial.dependencies.filter(d => d.projectIds.includes(project.id)).length);
    await tab(page, 'benchmark');
    assert.equal(await value(page, '#benchmarkMetrics'), initial.bugs.filter(b => b.filesChanged >= 1).length);
    await tab(page, 'taxonomy');
    let representatives = 0;
    for (const category of [...initial.bugCategories].sort((a, b) => a.label.localeCompare(b.label))) {
      await page.locator(`.taxonomy-item[data-category-id="${category.id}"]`).click();
      assert.equal(await page.locator('#taxonomyDetail .definition').textContent(), category.definition);
      assert.deepEqual(await page.locator('#taxonomyDetail .example-card a').evaluateAll(links => links.map(a => a.href)), category.representatives.map(b => b.link));
      representatives += await page.locator('#taxonomyDetail .example-card').count();
    }
    assert.equal(representatives, initial.bugCategories.reduce((sum, c) => sum + c.representatives.length, 0));
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('shared filters, corrected display IDs, full-snapshot scatter, and heatmap navigation preserve scopes', async () => {
  const { page, errors } = await open();
  try {
    const bug = initial.bugs.find(b => b.recordId === 'bug-000032') || initial.bugs[0];
    await page.locator('#globalSearch').fill(bug.id);
    assert.equal(await value(page), initial.bugs.filter(b => [b.id, b.project, b.type, b.domain, ...b.filePaths].join(' ').toLowerCase().includes(bug.id)).length);
    assert.equal(await page.locator('#scatterChart circle').count(), initial.projects.filter(p => p.loc > 0 && p.stars > 0).length);
    await tab(page, 'explorer');
    await page.locator(`#bugTable tr[data-record-id="${bug.recordId}"]`).click();
    assert.match(await page.locator('#bugDetail h2').textContent(), new RegExp(bug.id));
    await page.locator('#clearExplorer').click();
    await tab(page, 'dashboard');
    const selected = await page.locator('#heatmap .heatmap-cell').first().evaluate(el => el.__data__);
    await page.locator('#heatmap .heatmap-cell').first().click();
    assert.equal(await page.locator('#explorer').isVisible(), true);
    assert.equal(await page.locator('#explorerProject').inputValue(), selected.r);
    assert.equal(await page.locator('#explorerType').inputValue(), selected.c);
    await tab(page, 'benchmark');
    assert.equal(await value(page, '#benchmarkMetrics'), initial.bugs.filter(b => b.filesChanged >= 1).length);
    await page.locator('#benchClear').click();
    assert.equal(await value(page, '#benchmarkMetrics'), 0);
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('Explorer CSV and Builder CSV/JSON downloads match the seven-field compatibility adapter', async () => {
  const { page, errors } = await open();
  try {
    const expected = initial.bugs.filter(b => b.filesChanged >= 1);
    await tab(page, 'explorer');
    assert.equal(await download(page, '#downloadCurrentCsv'), toLegacyCsv(expected));
    await tab(page, 'benchmark');
    assert.equal(await download(page, '#exportCsv'), toLegacyCsv(expected));
    assert.deepEqual(JSON.parse(await download(page, '#exportJson')), toLegacyRecords(expected));
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('JSON-only empty registries, seventh representative, and multiple defects with one visible ID work in the UI', async () => {
  const edited = structuredClone(raw);
  edited.domains.push({ id: 'smoke-new-domain', label: 'Smoke new domain' });
  edited.projects.push({ id: 'smoke-empty', name: 'Smoke empty project', domainId: 'smoke-new-domain', loc: 0, stars: null });
  edited.taxonomy.bugCategories.push({ id: 'smoke-empty', label: 'Smoke empty category', shortLabel: 'Empty', definition: 'Empty definition', rules: [], neighbors: [], representativeRecordIds: [] });
  const category = edited.taxonomy.bugCategories.find(c => edited.bugs.filter(b => b.categoryId === c.id).length >= 7);
  category.representativeRecordIds = edited.bugs.filter(b => b.categoryId === category.id).slice(0, 7).map(b => b.recordId);
  const first = edited.bugs[0];
  edited.bugs.push({ ...first, recordId: 'smoke-second-defect', filePaths: ['smoke/second-defect.ts'] });
  const { page, errors } = await open(edited);
  try {
    assert.equal(await value(page), edited.bugs.length);
    assert.equal(await page.locator('#heatmap .heatmap-cell').count(), edited.projects.length * edited.taxonomy.bugCategories.length);
    assert.equal(await page.locator('#heatmap th[title="Smoke empty category"]').textContent(), 'Empty');
    for(const [id,total] of [['benchProjects',edited.projects.length],['benchTypes',edited.taxonomy.bugCategories.length],['benchDomains',edited.domains.length]]){
      assert.equal(await page.locator(`#${id} .criterion-option`).count(),total);
      assert.equal((await selectedFacetValues(page,id)).length,total,'new registry options start explicitly selected');
    }
    assert.equal(await page.locator('#benchDomains .criterion-option[data-value="smoke-new-domain"]').count(),1);
    await page.locator('#globalDomain').selectOption('smoke-new-domain');
    await assertHeatmapAxes(page,[],prepareDataset(edited));
    assert.deepEqual(await page.locator('#heatmap tbody th').allTextContents(),['Smoke empty project']);
    assert.equal(await page.locator('#heatmap thead th[title]').count(),edited.taxonomy.bugCategories.length);
    await axisScreenshot(page,'registry-zero-domain');
    await page.locator('#globalType').selectOption('Smoke empty category');
    await assertHeatmapAxes(page,[],prepareDataset(edited));
    assert.equal(await page.locator('.heatmap-cell').count(),1);
    await page.locator('#resetAll').click();
    await tab(page, 'taxonomy');
    await page.locator(`.taxonomy-item[data-category-id="${category.id}"]`).click();
    assert.equal(await page.locator('#taxonomyDetail .example-card').count(), 7);
    await page.locator('.taxonomy-item[data-category-id="smoke-empty"]').click();
    assert.match(await page.locator('#taxonomyDetail').textContent(), /No representative records configured/);
    await tab(page, 'compare');
    await page.locator('#projectA').selectOption('Smoke empty project');
    assert.match(await page.locator('#compareBars').textContent(), /N\/A.*no bug samples/);
    assert.equal(await page.locator('#compareBars rect.a').count(), 0);
    assert.match(await page.locator('#categoryDifference').textContent(), /Insufficient samples/);
    await tab(page, 'explorer');
    await page.locator('#explorerSearch').fill(first.id);
    assert.equal(await page.locator('#bugTable tbody tr').count(), 2);
    await page.locator('tr[data-record-id="smoke-second-defect"]').click();
    assert.match(await page.locator('#bugDetail .files').textContent(), /smoke\/second-defect.ts/);
    assert.equal(await page.locator(`#bugDetail .example-card[data-record-id="${first.recordId}"]`).count(), 1);
    assert.equal(await page.locator('#bugDetail .example-card[data-record-id="smoke-second-defect"]').count(), 0);
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('a JSON-only bug added to a new project/category updates heatmap, bars, comparisons, Explorer, and Builder', async () => {
  const edited = structuredClone(raw);
  edited.projects.push({ id: 'smoke-new', name: 'Smoke new project', domainId: edited.domains[0].id });
  edited.taxonomy.bugCategories.push({ id: 'smoke-new', label: 'Smoke new category', definition: 'New definition', rules: [], neighbors: [], representativeRecordIds: ['smoke-new-bug'] });
  edited.bugs.push({ ...edited.bugs[0], recordId: 'smoke-new-bug', projectId: 'smoke-new', categoryId: 'smoke-new', filePaths: ['smoke/new.ts'] });
  const { page, errors } = await open(edited);
  try {
    const cell = await page.locator('#heatmap .heatmap-cell').evaluateAll(nodes => nodes.find(n => n.__data__.r === 'Smoke new project' && n.__data__.c === 'Smoke new category').__data__);
    assert.equal(cell.v, 1);
    await page.locator('#globalProject').selectOption('Smoke new project');
    assert.equal(await value(page), 1);
    assert.match(await page.locator('#categoryChart').textContent(), /Smoke new category/);
    assert.match(await page.locator('#projectChart').textContent(), /Smoke new project/);
    await tab(page, 'explorer');
    assert.equal(await page.locator('#bugTableSummary').textContent(), '1 matching bugs');
    await page.locator('tr[data-record-id="smoke-new-bug"]').click();
    assert.match(await page.locator('#bugDetail .files').textContent(), /smoke\/new.ts/);
    await tab(page, 'compare');
    await page.locator('#projectA').selectOption('Smoke new project');
    assert.equal(await page.locator('#compareBars rect.a').evaluateAll(nodes => nodes.find(n => n.__data__.label === 'Smoke new category').__data__.a), 100);
    await tab(page, 'benchmark');
    await setFacetValues(page,'benchProjects',['Smoke new project']);
    assert.equal(await value(page, '#benchmarkMetrics'), 1);
    assert.match(await page.locator('#benchmarkCategory').textContent(), /Smoke new category/);
    assert.equal(JSON.parse(await download(page, '#exportJson')).length, 1);
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('JSON-only project/category/domain renames flow through filters, cards, representatives, and exports', async () => {
  const edited = structuredClone(raw);
  const project = edited.projects[0], domain = edited.domains.find(d => d.id === project.domainId);
  project.name = 'Renamed project <edit>';
  domain.label = 'Renamed canonical domain';
  const category = edited.taxonomy.bugCategories[0]; category.label = 'Renamed category';
  const prepared = prepareDataset(edited);
  const { page, errors } = await open(edited);
  try {
    await page.locator('#globalDomain').selectOption(domain.id);
    assert.equal(await value(page), prepared.bugs.filter(b => b.domainId === domain.id).length);
    assert.match(await page.locator('#domainChart').textContent(), /Renamed canonical domain/);
    await tab(page, 'explorer');
    await page.locator('#explorerProject').selectOption(project.name);
    await page.locator('#bugTable tbody tr').first().click();
    assert.match(await page.locator('#bugDetail').textContent(), /Renamed canonical domain/);
    assert.match(await page.locator('#bugDetail h2').textContent(), /Renamed project <edit>/);
    await tab(page, 'compare');
    await page.locator('#projectA').selectOption(project.name);
    assert.match(await page.locator('#comparisonCards .project-card').first().textContent(), /Renamed canonical domain/);
    await tab(page, 'taxonomy');
    await page.locator(`.taxonomy-item[data-category-id="${category.id}"]`).click();
    assert.equal(await page.locator('#taxonomyDetail h2').textContent(), 'Renamed category');
    assert.deepEqual(await page.locator('#taxonomyDetail .example-card a').evaluateAll(links => links.map(a => a.href)), prepared.categoryById.get(category.id).representatives.map(b => b.link));
    await tab(page, 'benchmark');
    await setFacetValues(page,'benchDomains',[domain.id]);
    const selected = prepared.bugs.filter(b => b.domainId === domain.id && b.filesChanged >= 1);
    assert.equal(await value(page, '#benchmarkMetrics'), selected.length);
    assert.deepEqual(JSON.parse(await download(page, '#exportJson')), toLegacyRecords(selected));
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('empty data and absent/nonpositive log values render safe empty states', async () => {
  const empty = { bugs: [], projects: [], domains: [], dependencies: [], taxonomy: { bugCategories: [], dependencyCategories: [] } };
  const { page, errors } = await open(empty);
  try {
    assert.equal(await value(page), 0);
    assert.match(await page.locator('#scatterChart').textContent(), /No projects with positive LOC and stars/);
    await tab(page, 'explorer');
    assert.equal(await page.locator('#bugTableSummary').textContent(), '0 matching bugs');
    await tab(page, 'compare');
    assert.match(await page.locator('#comparisonCards').textContent(), /No projects available/);
    await tab(page, 'benchmark');
    assert.equal(await value(page, '#benchmarkMetrics'), 0);
    await tab(page, 'taxonomy');
    assert.match(await page.locator('#taxonomyDetail').textContent(), /No bug categories available/);
    await healthy(page, errors);
  } finally { await page.close(); }
  const edited = structuredClone(raw);
  edited.projects.forEach(p => { p.loc = null; p.stars = 0; });
  const second = await open(edited);
  try {
    assert.equal(await second.page.locator('#scatterChart circle').count(), 0);
    await healthy(second.page, second.errors);
  } finally { await second.page.close(); }
});

test('failed HTTP load and rapid Retry initialize once without duplicated options, charts, or handlers', async () => {
  const { page, errors, bugRequests } = await open(undefined, { failFirst: true });
  try {
    await page.locator('#retryLoad').waitFor({ state: 'visible' });
    assert.match(await page.locator('#dataMessage').textContent(), /data\/bugs.json.*503/);
    assert.equal(await page.locator('main').isHidden(), true);
    await page.locator('#retryLoad').evaluate(button => { button.click(); button.click(); });
    await ready(page);
    assert.equal(bugRequests(), 2);
    assert.equal(await page.locator('#globalProject option').count(), initial.projects.length + 1);
    assert.equal(await page.locator('#categoryChart svg').count(), 1);
    await tab(page, 'explorer');
    await page.locator('#nextPage').click();
    assert.match(await page.locator('#pageInfo').textContent(), /Page 2 /);
    await healthy(page, errors);
  } finally { await page.close(); }
});

const mode = (page, name) => page.locator(`[data-category-mode="${name}"]`).click();
const categoryBar = (page, id) => page.locator(`#categoryChart .category-bar[data-category-id="${id}"]`);
const cellState = page => page.locator('#heatmap .heatmap-cell').evaluateAll(nodes => nodes.map(n => ({ project: n.dataset.projectId, category: n.dataset.categoryId, count: n.dataset.count, color: n.style.backgroundColor, denominator: n.dataset.denominator })));
async function clickChartBar(page, selector, label) {
  const bars=page.locator(`${selector} rect`);
  const index=await bars.evaluateAll((nodes,label)=>nodes.findIndex(n=>n.__data__[0]===label),label);
  assert(index>=0,`${selector} contains ${label}`);
  await bars.nth(index).click();
}
async function assertHeatmapAxes(page, matching, dataset=initial) {
  const [project,category,domain]=await Promise.all(['#globalProject','#globalType','#globalDomain'].map(selector=>page.locator(selector).inputValue()));
  const projects=dataset.projects.filter(p=>(!project||p.name===project)&&(!domain||p.domainId===domain)).map(p=>p.name).sort();
  const categories=dataset.bugCategories.filter(c=>!category||c.label===category).map(c=>c.label).sort();
  if(!projects.length||!categories.length){
    assert.equal(await page.locator('#heatmap table').count(),0);
    assert.match(await page.locator('#heatmap').textContent(),/No eligible Projects or Bug Categories/);
    return;
  }
  assert.deepEqual(await page.locator('#heatmap tbody th').allTextContents(),projects);
  assert.deepEqual(await page.locator('#heatmap thead th[title]').evaluateAll(nodes=>nodes.map(n=>n.title)),categories);
  const cells=await cellState(page);
  assert.equal(cells.length,projects.length*categories.length);
  for(const cell of cells)assert.equal(Number(cell.count),matching.filter(b=>b.projectId===cell.project&&b.categoryId===cell.category).length);
}
async function axisScreenshot(page,name){
  if(process.env.SMOKE_AXIS_SCREENSHOT_PREFIX)await page.locator('article').filter({has:page.locator('#heatmap')}).screenshot({path:`${process.env.SMOKE_AXIS_SCREENSHOT_PREFIX}-${name}.png`,style:'nav, .tooltip { visibility: hidden !important; }'});
}
const otherChartSelectors = ['#metricCards', '#projectChart', '#heatmap', '#heatmapLegend', '#domainChart', '#scatterChart', '#comparisonCards', '#benchmarkSummary'];
async function otherChartState(page) {
  return page.evaluate(selectors => selectors.map(selector => document.querySelector(selector).innerHTML), otherChartSelectors);
}

test('Project-Weighted control is panel-local, correctly placed, numerically correct, and redraws no other chart', async () => {
  const { page, errors } = await open();
  try {
    assert.equal(await page.locator('#categoryTitle').evaluate(title => title.nextElementSibling.id), 'categoryMode');
    assert.equal(await page.locator('#categoryMode').evaluate(el => el.closest('article').id), 'categoryPanel');
    const titleBox = await page.locator('#categoryTitle').boundingBox(), controlBox = await page.locator('#categoryMode').boundingBox();
    assert(controlBox.y >= titleBox.y + titleBox.height);
    const before = await otherChartState(page);
    await page.evaluate(() => { window.untouchedHeatmap = document.querySelector('.heatmap-cell'); });
    await mode(page, 'weighted');
    assert.deepEqual(await otherChartState(page), before);
    assert.equal(await page.locator('#categoryDescription').textContent(),'Project-Weighted of matching Bug samples');
    assert.equal(await page.locator('#categoryHelp').textContent(),"Calculate each category's share within each eligible project, then average those shares equally across projects.");
    assert.equal(await page.locator('#categoryPanel #allCategories').count(),0);
    assert.equal(await page.evaluate(() => window.untouchedHeatmap === document.querySelector('.heatmap-cell')), true);
    assert.equal(await page.locator('#globalType').inputValue(), '');
    assert.match(await page.locator('#categoryChart .axis-unit').textContent(), /Average share \(%\)/);
    const expected = categoryDistribution(initial.bugs, initial.bugCategories);
    const actual = await page.locator('#categoryChart .category-bar').evaluateAll(nodes => nodes.map(n => ({ id: n.__data__.id, value: n.__data__.weightedShare })));
    for (const row of actual) assert(Math.abs(row.value - expected.rows.find(r => r.id === row.id).weightedShare) < 1e-10);
    assert(Math.abs(actual.reduce((sum, row) => sum + row.value, 0) - 100) < 1e-8);
    await page.locator('#categoryChart .category-bar').first().hover();
    assert.match(await page.locator('.tooltip').textContent(), new RegExp(`${expected.eligibleProjectCount} eligible projects`));
    assert.match(await page.locator('.tooltip').textContent(), /Bug samples/);
    await mode(page, 'count');
    assert.deepEqual(await otherChartState(page), before);
    assert.equal(await page.locator('#categoryChart .axis-unit').textContent(), 'Bug samples (n)');
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('category/domain chips and selected-bar toggle clear only their own filters', async () => {
  const { page, errors } = await open();
  try {
    const category = initial.bugCategories.find(c => c.id === 'api-misuse') || initial.bugCategories[0];
    await mode(page, 'weighted');
    const weightedBefore = await categoryBar(page, category.id).evaluate(n => n.__data__.weightedShare);
    await categoryBar(page, category.id).click();
    assert.equal(await page.locator('#globalType').inputValue(), category.label);
    assert.equal(await page.locator('#categoryChip').isVisible(), true);
    assert.equal(await value(page), initial.bugs.filter(b => b.categoryId === category.id).length);
    assert.equal(await page.locator('#categoryChart .category-bar').count(), 1);
    assert.equal(await categoryBar(page, category.id).evaluate(n => n.__data__.weightedShare), weightedBefore);
    assert.equal(await page.locator('#heatmap thead th').count(), 2);
    assert.equal(await page.locator('#heatmap tbody tr').count(), initial.projects.length);
    const domainLabel = await page.locator('#domainChart rect').first().evaluate(n => n.__data__[0]);
    const domain = initial.domains.find(d => d.label === domainLabel);
    await page.locator('#domainChart rect').first().click();
    assert.equal(await page.locator('#globalDomain').inputValue(), domain.id);
    assert.equal(await page.locator('#domainChip').textContent(),`Selected: ${domain.label} ×`);
    assert.equal(await page.locator('#domainChart .selected-bar').count(),1);
    assert.equal(await page.locator('#globalType').inputValue(), category.label);
    await page.locator('#categoryChip').click();
    assert.equal(await page.locator('#categoryChip').isHidden(), true);
    assert.equal(await page.locator('#domainChip').isVisible(),true);
    assert.equal(await page.locator('#globalDomain').inputValue(), domain.id);
    assert.equal(await value(page), initial.bugs.filter(b => b.domainId === domain.id).length);
    assert.equal(await page.locator('#heatmap tbody tr').count(), initial.projects.filter(p=>p.domainId===domain.id).length);
    await categoryBar(page, category.id).click();
    await page.locator('#domainChip').click();
    assert.equal(await page.locator('#globalDomain').inputValue(), '');
    assert.equal(await page.locator('#domainChip').isHidden(),true);
    assert.equal(await page.locator('#categoryChip').isVisible(),true);
    assert.equal(await page.locator('#globalType').inputValue(), category.label);
    await page.locator('#categoryChip').click();
    assert.equal(await value(page), initial.bugs.length);
    await categoryBar(page, category.id).click(); await categoryBar(page, category.id).click();
    assert.equal(await page.locator('#globalType').inputValue(), '');
    const project = initial.projects.find(p => initial.bugs.some(b => b.projectId === p.id && b.filePaths.some(f => f.includes('src'))));
    await page.locator('#globalProject').selectOption(project.name);
    await page.locator('#globalSearch').fill('src');
    await page.locator('#categoryChart .category-bar').first().click();
    await page.locator('#categoryChip').click();
    assert.equal(await page.locator('#globalProject').inputValue(), project.name);
    assert.equal(await page.locator('#globalSearch').inputValue(), 'src');
    assert.equal(await page.locator('[data-category-mode="weighted"]').getAttribute('aria-pressed'), 'true');
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('heatmap labels/fixed linear colors remain independent, focus follows chart actions, and reset preserves modes', async () => {
  const { page, errors } = await open();
  try {
    const maximum = await page.locator('#heatmapLegend').getAttribute('data-count-maximum');
    assert.equal(Number(maximum), maxCellCount(initial.bugs));
    assert.equal(await page.locator('#heatmap .cell-label').evaluateAll(nodes => nodes.every(n => n.textContent === '')), true);
    const originalCells = await cellState(page);
    await mode(page, 'weighted');
    const categoryBefore = await page.locator('#categoryChart').innerHTML();
    await page.locator('[data-heatmap-labels="project"]').click();
    assert.deepEqual(await cellState(page), originalCells);
    assert.equal(await page.locator('#categoryChart').innerHTML(), categoryBefore);
    const correctPercentages = await page.locator('.heatmap-cell').evaluateAll(nodes => nodes.every(n => n.querySelector('.cell-label').textContent === (n.__data__.share === null ? 'N/A' : `${n.__data__.share.toFixed(0)}%`)));
    assert.equal(correctPercentages, true);
    const project = [...initial.projects].sort((a,b)=>(b.loc||0)-(a.loc||0)).find(p => p.loc > 0 && p.stars > 0 && initial.bugCategories.some(c => initial.bugs.some(b => b.categoryId === c.id) && !initial.bugs.some(b => b.projectId === p.id && b.categoryId === c.id)));
    const category = initial.bugCategories.find(c => initial.bugs.some(b => b.categoryId === c.id) && !initial.bugs.some(b => b.projectId === project.id && b.categoryId === c.id));
    await categoryBar(page, category.id).click();
    const scatter = page.locator('#scatterChart circle');
    const index = await scatter.evaluateAll((nodes, id) => nodes.findIndex(n => n.__data__.id === id), project.id);
    await scatter.nth(index).click();
    assert.equal(await page.locator('.heatmap-cell').count(),1);
    assert.equal(await page.locator('.heatmap-cell').getAttribute('data-count'),'0');
    await page.locator('#categoryChip').click();
    assert.equal(await page.locator('#heatmap tbody tr').count(), 1);
    const projectBugs = initial.bugs.filter(b => b.projectId === project.id);
    assert.equal(await page.locator('.heatmap-cell').count(), initial.bugCategories.length);
    const firstCategory = await page.locator('#categoryChart .category-bar').first().evaluate(n => n.__data__.id);
    await categoryBar(page, firstCategory).click();
    assert.equal(await page.locator('#heatmap .heatmap-cell').count(), 1);
    const cell = await page.locator('.heatmap-cell').evaluate(n => n.__data__);
    assert.equal(cell.denominator, projectBugs.length);
    assert.equal(cell.share, 100 * cell.v / projectBugs.length);
    assert.equal(await page.locator('#heatmapLegend').getAttribute('data-count-maximum'), maximum);
    const properColor = await page.locator('.heatmap-cell').evaluate((node, maximum) => node.style.backgroundColor === d3.color(d3.scaleLinear().domain([0, Number(maximum)]).range(['#D9EAF5', '#07548D'])(node.__data__.v)).formatRgb(), maximum);
    assert.equal(properColor, true);
    await page.locator('.heatmap-cell').hover();
    assert.match(await page.locator('.tooltip').textContent(), /Project denominator/);
    await page.locator('#resetAll').click();
    assert.equal(await value(page), initial.bugs.length);
    assert.equal(await page.locator('#heatmap tbody tr').count(), initial.projects.length);
    assert.equal(await page.locator('#heatmap .heatmap-cell').count(), initial.projects.length * initial.bugCategories.length);
    assert.equal(await page.locator('[data-category-mode="weighted"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-heatmap-labels="project"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await cellState(page), originalCells);
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('heatmap headings are compact and sticky; horizontal scrolling works on narrow screens', async () => {
  const { page, errors } = await open();
  try {
    assert.equal(await page.locator('#heatmap thead th[title="Asynchrony / Event Handling Bug"]').textContent(), 'Async / Event');
    assert.equal(await page.locator('#heatmap thead th[title="Tooling / Configuration Issue"]').textContent(), 'Tooling / Config');
    assert.equal(await page.locator('#heatmap thead th').first().evaluate(n => getComputedStyle(n).position), 'sticky');
    await page.setViewportSize({ width: 600, height: 900 });
    await page.locator('#heatmap').scrollIntoViewIfNeeded();
    const before = await page.locator('#heatmap thead th').first().boundingBox();
    assert.equal(await page.locator('#heatmap').evaluate(n => n.scrollWidth > n.clientWidth), true);
    await page.locator('#heatmap').evaluate(n => { n.scrollLeft = 240; n.scrollTop = 100; });
    const after = await page.locator('#heatmap thead th').first().boundingBox();
    assert(Math.abs(before.x - after.x) < 4); assert(Math.abs(before.y - after.y) < 4);
    assert.equal(await page.locator('#heatmap thead th').nth(1).evaluate(n => getComputedStyle(n).transform), 'none');
    await healthy(page, errors);
  } finally { await page.close(); }
});

test('n8n Project Coverage retains every Category, zero-cell navigation, and all-zero search grids',async()=>{
  const {page,errors}=await open();
  try{
    const project=initial.projectById.get('n8n');
    assert(project,'n8n is registered');
    const projectBugs=initial.bugs.filter(b=>b.projectId===project.id);
    await clickChartBar(page,'#projectChart',project.name);
    await assertHeatmapAxes(page,projectBugs);
    assert.equal(await page.locator('#heatmap tbody tr').count(),1);
    assert.equal(await page.locator('#heatmap thead th[title]').count(),initial.bugCategories.length);
    const zero=page.locator('.heatmap-cell[data-count="0"]').first();
    assert(await zero.count(),'unobserved Categories remain visible');
    assert.equal(await zero.evaluate(n=>n.style.backgroundColor),'rgb(238, 241, 244)');
    await axisScreenshot(page,'n8n');
    await page.locator('[data-heatmap-labels="project"]').click();
    assert.equal(await zero.locator('.cell-label').textContent(),'0%');
    const selected=await zero.evaluate(n=>n.__data__);
    await zero.click();
    assert.equal(await page.locator('#explorerProject').inputValue(),project.name);
    assert.equal(await page.locator('#explorerType').inputValue(),selected.c);
    assert.equal(await page.locator('#bugTableSummary').textContent(),'0 matching bugs');
    await tab(page,'dashboard');
    await assertHeatmapAxes(page,[]);
    assert.equal(await page.locator('.heatmap-cell').count(),1);
    assert.equal(await page.locator('.heatmap-cell').getAttribute('data-count'),'0');
    await page.locator('#globalType').selectOption(projectBugs[0].type);
    await assertHeatmapAxes(page,projectBugs.filter(b=>b.type===projectBugs[0].type));
    assert.equal(await page.locator('.heatmap-cell').count(),1,'Category dropdown explicitly restricts the axis');
    await page.locator('#categoryChip').click();
    await assertHeatmapAxes(page,projectBugs);
    const outsideDomain=initial.domains.find(d=>d.id!==project.domainId);
    await page.locator('#globalDomain').selectOption(outsideDomain.id);
    await assertHeatmapAxes(page,[]);
    await page.locator('#domainChip').click();
    await assertHeatmapAxes(page,projectBugs);
    await page.locator('#globalSearch').fill('-no-match-axis-correction-');
    await assertHeatmapAxes(page,[]);
    assert.equal(await page.locator('.heatmap-cell').evaluateAll(nodes=>nodes.every(n=>n.dataset.count==='0'&&n.style.backgroundColor==='rgb(238, 241, 244)')),true);
    assert.equal(await page.locator('.cell-label').evaluateAll(nodes=>nodes.every(n=>n.textContent==='N/A')),true);
    const before=await cellState(page);
    await mode(page,'weighted');
    assert.deepEqual(await cellState(page),before);
    await axisScreenshot(page,'n8n-zero-search');
    await page.locator('#projectChip').click();
    assert.equal(await page.locator('#globalSearch').inputValue(),'-no-match-axis-correction-');
    await assertHeatmapAxes(page,[]);
    assert.equal(await page.locator('.heatmap-cell').count(),initial.projects.length*initial.bugCategories.length);
    await page.locator('#resetAll').click();
    await assertHeatmapAxes(page,initial.bugs);
    await healthy(page,errors);
  }finally{await page.close();}
});

test('Domain and Project Coverage bars restrict eligible axes while combined sample filters retain zero cells',async()=>{
  const {page,errors}=await open();
  try{
    const domain=[...initial.domains].sort((a,b)=>initial.projects.filter(p=>p.domainId===b.id).length-initial.projects.filter(p=>p.domainId===a.id).length)[0];
    const domainBugs=initial.bugs.filter(b=>b.domainId===domain.id);
    assert(new Set(domainBugs.map(b=>b.projectId)).size>1);
    assert(new Set(domainBugs.map(b=>b.categoryId)).size>1);
    await clickChartBar(page,'#domainChart',domain.label);
    assert.equal(await page.locator('#globalDomain').inputValue(),domain.id);
    await assertHeatmapAxes(page,domainBugs);
    await axisScreenshot(page,'domain');
    const before=await page.locator('#heatmap').innerHTML();
    await mode(page,'weighted');
    assert.equal(await page.locator('#heatmap').innerHTML(),before,'category measure does not change filtered axes');
    await page.locator('[data-heatmap-labels="project"]').click();
    await assertHeatmapAxes(page,domainBugs);
    const project=domainBugs[0].project;
    await clickChartBar(page,'#projectChart',project);
    const projectBugs=domainBugs.filter(b=>b.project===project);
    await assertHeatmapAxes(page,projectBugs);
    assert.equal(await page.locator('#projectChip').textContent(),`Selected: ${project} ×`);
    assert.equal(await page.locator('#projectPanel h2').textContent(),'Project Coverage');
    assert.equal(await page.locator('#projectChip').evaluate(n=>Boolean(n.closest('article').querySelector('#projectChart'))),true);
    assert.equal(await page.locator('#projectPanel button').filter({hasText:'All Projects'}).count(),0);
    const bug=projectBugs[0];
    await categoryBar(page,bug.categoryId).click();
    await assertHeatmapAxes(page,projectBugs.filter(b=>b.categoryId===bug.categoryId));
    await page.locator('#globalSearch').fill(bug.id);
    const matchesSearch=b=>[b.id,b.project,b.type,b.domain,...b.filePaths].join(' ').toLowerCase().includes(bug.id.toLowerCase());
    await assertHeatmapAxes(page,projectBugs.filter(b=>b.categoryId===bug.categoryId&&matchesSearch(b)));
    await page.locator('#globalSearch').fill('-no-match-tsbugs-followup-');
    await assertHeatmapAxes(page,[]);
    await page.locator('#projectChip').click();
    assert.equal(await page.locator('#globalProject').inputValue(),'');
    assert.equal(await page.locator('#projectChip').isHidden(),true);
    assert.equal(await page.locator('#globalDomain').inputValue(),domain.id);
    assert.equal(await page.locator('#globalType').inputValue(),bug.type);
    assert.equal(await page.locator('#globalSearch').inputValue(),'-no-match-tsbugs-followup-');
    assert.equal(await page.locator('#categoryChip').isVisible(),true);
    assert.equal(await page.locator('#domainChip').isVisible(),true);
    await assertHeatmapAxes(page,[]);
    await page.locator('#globalSearch').fill('');
    await assertHeatmapAxes(page,domainBugs.filter(b=>b.categoryId===bug.categoryId));
    await page.locator('#categoryChip').click();
    await assertHeatmapAxes(page,domainBugs);
    await page.locator('#domainChip').click();
    assert.equal(await page.locator('#heatmap .heatmap-cell').count(),initial.projects.length*initial.bugCategories.length);
    await clickChartBar(page,'#projectChart',project);
    await assertHeatmapAxes(page,initial.bugs.filter(b=>b.project===project));
    await clickChartBar(page,'#projectChart',project);
    assert.equal(await page.locator('#projectChip').isHidden(),true);
    assert.equal(await page.locator('#heatmap .heatmap-cell').count(),initial.projects.length*initial.bugCategories.length);
    await healthy(page,errors);
  }finally{await page.close();}
});

test('Project chip follows dropdown, Explorer, and cell selections and clears only its shared Project filter',async()=>{
  const {page,errors}=await open();
  try{
    const bug=initial.bugs.find(b=>b.filePaths.some(path=>path.includes('src'))),project=initial.projectById.get(bug.projectId);
    await page.locator('#globalProject').selectOption(project.name);
    assert.equal(await page.locator('#projectChip').textContent(),`Selected: ${project.name} ×`);
    await assertHeatmapAxes(page,initial.bugs.filter(b=>b.projectId===project.id));
    await page.locator('#globalDomain').selectOption(project.domainId);
    await page.locator('#globalType').selectOption(bug.type);
    await page.locator('#globalSearch').fill('src');
    await page.locator('#projectChip').click();
    assert.equal(await page.locator('#globalDomain').inputValue(),project.domainId);
    assert.equal(await page.locator('#globalType').inputValue(),bug.type);
    assert.equal(await page.locator('#globalSearch').inputValue(),'src');
    await assertHeatmapAxes(page,initial.bugs.filter(b=>b.domainId===project.domainId&&b.type===bug.type&&[b.id,b.project,b.type,b.domain,...b.filePaths].join(' ').toLowerCase().includes('src')));
    await page.locator('#resetAll').click();
    await tab(page,'explorer');
    const other=initial.projects.find(p=>p.id!==project.id);
    await page.locator('#explorerProject').selectOption(other.name);
    await tab(page,'dashboard');
    assert.equal(await page.locator('#projectChip').textContent(),`Selected: ${other.name} ×`);
    await page.locator('#resetAll').click();
    const cell=page.locator('.heatmap-cell').first();
    const selected=await cell.evaluate(n=>n.__data__);
    await cell.click();
    await tab(page,'dashboard');
    assert.equal(await page.locator('#projectChip').textContent(),`Selected: ${selected.r} ×`);
    await page.locator('#projectChip').click();
    assert.equal(await page.locator('#globalType').inputValue(),selected.c);
    await page.locator('#resetAll').click();
    assert.equal(await page.locator('#projectChip').isHidden(),true);
    await healthy(page,errors);
  }finally{await page.close();}
});

test('unified Builder tiles default to all, toggle cumulatively, drag additively, and Clear means none', async () => {
  const { page, errors } = await open();
  try {
    await tab(page, 'benchmark');
    assert.equal(await page.locator('[data-selection-view]').count(),0);
    const defaultTotal = initial.bugs.filter(b => b.filesChanged >= 1).length;
    assert.equal(await value(page,'#benchmarkMetrics'),defaultTotal);
    assert.doesNotMatch(await page.locator('#benchmark').textContent(),/All \(No Restriction\)/);
    for (const id of ['benchProjects', 'benchTypes', 'benchDomains']) {
      const list=page.locator('#'+id), facet=page.locator('fieldset').filter({has:list});
      const options=list.locator('.criterion-option');
      const values=await options.evaluateAll(nodes=>nodes.map(n=>n.dataset.value));
      assert.deepEqual(await selectedFacetValues(page,id),values);
      assert.equal(await options.first().evaluate(n=>getComputedStyle(n,'::before').content),'none','no adjacent checkbox pseudo-element');
      assert.equal(await facet.locator('input[type="checkbox"]').count(),0);
      await options.nth(0).click();assert.deepEqual(await selectedFacetValues(page,id),values.slice(1));
      await options.nth(0).click();assert.deepEqual(await selectedFacetValues(page,id),values);
      await facet.locator('[data-clear]').click();
      assert.equal(await value(page,'#benchmarkMetrics'),0);
      assert.equal(await facet.locator('.selection-summary').textContent(),'No options selected');
      await options.nth(0).click();assert.deepEqual(await selectedFacetValues(page,id),[values[0]]);
      const matches=initial.bugs.filter(b=>(id==='benchProjects'?b.project===values[0]:id==='benchTypes'?b.type===values[0]:b.domainId===values[0])&&b.filesChanged>=1);
      assert.equal(await value(page,'#benchmarkMetrics'),matches.length,'one selected option restores only its matches');
      await options.nth(1).click();assert.deepEqual(await selectedFacetValues(page,id),values.slice(0,2));
      await options.nth(0).click();assert.deepEqual(await selectedFacetValues(page,id),[values[1]]);
      await options.nth(3).click();
      await dragOptions(page,id,0,2);
      assert.deepEqual(await selectedFacetValues(page,id),values.slice(0,4));
      assert.equal(await options.nth(2).getAttribute('aria-selected'),'true','drag end must not toggle the last item');
      if(id==='benchProjects'){
        const selected=await selectedFacetValues(page,id),preview=await value(page,'#benchmarkMetrics');
        await tab(page,'compare');await tab(page,'benchmark');
        assert.deepEqual(await selectedFacetValues(page,id),selected);
        assert.equal(await value(page,'#benchmarkMetrics'),preview);
      }
      const preview=await value(page,'#benchmarkMetrics');
      await facet.locator('input[type="search"]').fill('nothing-will-match-xyz');
      assert.equal(await value(page,'#benchmarkMetrics'),preview);
      assert.equal(await facet.locator('.criterion-empty').isVisible(),true);
      assert.deepEqual(await selectedFacetValues(page,id),values.slice(0,4));
      await facet.locator('[data-select-all]').click();
      assert.equal((await selectedFacetValues(page,id)).length,values.length);
      assert.match(await facet.locator('.selection-summary').textContent(),/all current items selected/);
      await facet.locator('[data-clear]').click();
      assert.equal(await value(page,'#benchmarkMetrics'),0);
      assert.equal(await facet.locator('.selection-summary').textContent(),'No options selected');
      assert.match(await page.locator('#benchmarkCategory').textContent(),/No matching Bug samples/);
      assert.match(await page.locator('#benchmarkSummary').textContent(),/Bugs: 0/);
      assert.deepEqual(JSON.parse(await download(page,'#exportJson')),[]);
      assert.equal(await download(page,'#exportCsv'),toLegacyCsv([]));
      await facet.locator('input[type="search"]').fill('');
      await facet.locator('[data-select-all]').click();
      assert.equal(await value(page,'#benchmarkMetrics'),defaultTotal);
    }
    const projects=initial.projects.slice(0,2).map(p=>p.name);
    await setFacetValues(page,'benchProjects',projects);
    const expected=initial.bugs.filter(b=>projects.includes(b.project)&&b.filesChanged>=1);
    assert.deepEqual(JSON.parse(await download(page,'#exportJson')),toLegacyRecords(expected));
    assert.equal(await download(page,'#exportCsv'),toLegacyCsv(expected));
    await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.copiedBenchmarkSummary=text}});
    await page.locator('#copySummary').click();
    assert.equal(await page.evaluate(()=>window.copiedBenchmarkSummary),await page.locator('#benchmarkSummary').textContent());
    await page.locator('#benchClear').click();assert.equal(await value(page,'#benchmarkMetrics'),0);
    for(const id of ['benchProjects','benchTypes','benchDomains'])assert.equal((await selectedFacetValues(page,id)).length,0);
    await page.locator('#benchSelectAll').click();assert.equal(await value(page,'#benchmarkMetrics'),defaultTotal);
    await healthy(page,errors);
  } finally { await page.close(); }
});

test('category and domain chips preserve every other filter in both category measures',async()=>{
  const {page,errors}=await open();
  try{
    const bug=initial.bugs.find(b=>b.filePaths.some(path=>path.includes('src'))),project=initial.projectById.get(bug.projectId);
    for(const measure of ['count','weighted']){
      await page.locator('#globalProject').selectOption(project.name);
      await page.locator('#globalDomain').selectOption(project.domainId);
      await page.locator('#globalSearch').fill('src');await mode(page,measure);
      await categoryBar(page,bug.categoryId).click();
      assert.equal(await page.locator('#categoryChip').textContent(),'Selected: '+bug.type+' ×');
      assert.equal(await page.locator('#categoryPanel button').filter({hasText:'All Categories'}).count(),0);
      await page.locator('#categoryChip').click();
      assert.equal(await page.locator('#globalType').inputValue(),'');
      assert.equal(await page.locator('#globalDomain').inputValue(),project.domainId);
      assert.equal(await page.locator('#globalProject').inputValue(),project.name);
      assert.equal(await page.locator('#globalSearch').inputValue(),'src');
      await categoryBar(page,bug.categoryId).click();await page.locator('#domainChip').click();
      assert.equal(await page.locator('#globalDomain').inputValue(),'');
      assert.equal(await page.locator('#globalType').inputValue(),bug.type);
      assert.equal(await page.locator('#globalProject').inputValue(),project.name);
      assert.equal(await page.locator('#globalSearch').inputValue(),'src');
      await page.locator('#resetAll').click();
      assert.equal(await page.locator('#categoryChip').isHidden(),true);
      assert.equal(await page.locator('#domainChip').isHidden(),true);
      assert.equal(await page.locator('[data-category-mode="'+measure+'"]').getAttribute('aria-pressed'),'true');
    }
    await healthy(page,errors);
  }finally{await page.close();}
});

test('unified criteria support keyboard toggling and native touch scrolling without accidental selection',async()=>{
  const {page,errors}=await open();
  try{
    await tab(page,'benchmark');
    const list=page.locator('#benchProjects'),items=list.locator('.criterion-option');
    await page.locator('fieldset').filter({has:list}).locator('[data-clear]').click();
    await items.first().focus();await items.first().press('Space');
    assert.equal(await items.first().getAttribute('aria-selected'),'true');
    const selectedColor=await items.first().evaluate(n=>getComputedStyle(n).backgroundColor);
    assert.notEqual(selectedColor,await items.nth(1).evaluate(n=>getComputedStyle(n).backgroundColor));
    await items.first().press('Space');assert.equal((await selectedFacetValues(page,'benchProjects')).length,0);
    await items.first().press('Enter');await items.first().press('ArrowDown');
    assert.equal(await items.nth(1).evaluate(n=>n===document.activeElement),true);
    await items.nth(1).press('Enter');
    const before=await selectedFacetValues(page,'benchProjects'),preview=await value(page,'#benchmarkMetrics');
    await list.scrollIntoViewIfNeeded();
    const box=await list.boundingBox(),session=await context.newCDPSession(page);
    const x=box.x+box.width/2,y=box.y+box.height-30;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*25}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.deepEqual(await selectedFacetValues(page,'benchProjects'),before);
    assert.equal(await value(page,'#benchmarkMetrics'),preview);
    assert(await list.evaluate(n=>n.scrollTop>0),'touch gesture scrolls the list');
    await session.detach();
    await list.evaluate(n=>{n.scrollTop=0});await items.first().scrollIntoViewIfNeeded();
    const target=await items.first().boundingBox();
    await page.touchscreen.tap(target.x+target.width/2,target.y+target.height/2);
    assert.equal(await items.first().getAttribute('aria-selected'),'false','tap toggles once');
    await healthy(page,errors);
  }finally{await page.close();}
});

test('fast and repeated drags are additive, tiny movement remains a click, and long drags auto-scroll',async()=>{
  const {page,errors}=await open();
  try{
    await tab(page,'benchmark');
    const list=page.locator('#benchProjects'),items=list.locator('.criterion-option');
    await page.locator('fieldset').filter({has:list}).locator('[data-clear]').click();
    await items.first().click();assert.equal((await selectedFacetValues(page,'benchProjects')).length,1);
    await items.first().scrollIntoViewIfNeeded();let point=await items.first().boundingBox();
    await page.mouse.move(point.x+20,point.y+point.height/2);await page.mouse.down();
    await page.mouse.move(point.x+22,point.y+point.height/2);await page.mouse.up();
    assert.equal((await selectedFacetValues(page,'benchProjects')).length,0,'2px movement toggles exactly once');
    await dragOptions(page,'benchProjects',0,2,1);
    assert.equal((await selectedFacetValues(page,'benchProjects')).length,3,'fast drag includes intervening item');
    await dragOptions(page,'benchProjects',0,2,1);
    assert.equal((await selectedFacetValues(page,'benchProjects')).length,3,'drag does not toggle existing items off');
    await page.locator('fieldset').filter({has:list}).locator('[data-clear]').click();
    await list.evaluate(n=>{n.scrollTop=0});await items.first().scrollIntoViewIfNeeded();point=await items.first().boundingBox();
    const viewport=await list.boundingBox();
    await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await page.mouse.down();
    await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height-4,{steps:6});
    await page.waitForFunction(()=>{const n=document.querySelector('#benchProjects');return n.scrollTop>=n.scrollHeight-n.clientHeight-2});
    await page.mouse.up();
    assert.equal((await selectedFacetValues(page,'benchProjects')).length,await items.count());
    await healthy(page,errors);
  }finally{await page.close();}
});

test('Category Difference View is below dependency tooling, uses signed pp with correct direction, and stays independent', async () => {
  const { page, errors } = await open();
  try {
    await tab(page, 'compare');
    assert.equal(await page.locator('#differencePanel').evaluate(n => n.previousElementSibling.querySelector('#dependencyCompare') !== null), true);
    const aName = await page.locator('#projectA').inputValue(), bName = await page.locator('#projectB').inputValue();
    const a = initial.projects.find(p => p.name === aName), b = initial.projects.find(p => p.name === bName);
    const expected = categoryDifferences(initial.bugs, initial.bugCategories, a.id, b.id);
    let actual = await page.locator('.difference-bar').evaluateAll(nodes => nodes.map(n => ({ id: n.__data__.id, delta: n.__data__.delta })));
    assert.deepEqual(actual, expected.rows.map(row => ({ id: row.id, delta: row.delta })));
    const zero = Number(await page.locator('.zero-reference').getAttribute('x1'));
    const bars = await page.locator('.difference-bar').evaluateAll(nodes => nodes.map(n => ({ delta: n.__data__.delta, x: Number(n.getAttribute('x')), width: Number(n.getAttribute('width')), color: n.getAttribute('fill') })));
    for (const bar of bars) {
      if (bar.delta > 0) { assert(bar.x + bar.width <= zero + 1e-8); assert.equal(bar.color, '#4f46e5'); }
      if (bar.delta < 0) { assert(bar.x >= zero - 1e-8); assert.equal(bar.color, '#0891b2'); }
    }
    await page.locator('.difference-row').first().hover();
    assert.match(await page.locator('.tooltip').textContent(), /Difference A − B: .* pp/);
    assert.match(await page.locator('.tooltip').textContent(), new RegExp(`/${expected.totalA} bugs`));
    await tab(page, 'dashboard'); await page.locator('#globalType').selectOption(initial.bugCategories[0].label);
    await mode(page, 'weighted'); await tab(page, 'compare');
    assert.deepEqual(await page.locator('.difference-bar').evaluateAll(nodes => nodes.map(n => ({ id: n.__data__.id, delta: n.__data__.delta }))), actual);
    await page.locator('#projectA').selectOption(bName); await page.locator('#projectB').selectOption(aName);
    actual = await page.locator('.difference-bar').evaluateAll(nodes => nodes.map(n => ({ id: n.__data__.id, delta: n.__data__.delta })));
    for (const row of actual) assert(Math.abs(row.delta + expected.rows.find(r => r.id === row.id).delta) < 1e-8);
    await page.locator('#projectA').selectOption(aName);
    assert.equal(await page.locator('.difference-bar').evaluateAll(nodes => nodes.every(n => n.__data__.delta === 0)), true);
    await healthy(page, errors);
  } finally { await page.close(); }
});
