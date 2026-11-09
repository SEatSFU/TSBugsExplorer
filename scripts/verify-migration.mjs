// Historical, opt-in audit: run explicitly after migration, not after routine dataset edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareDataset, toLegacyRecords, toLegacyCsv, LEGACY_CSV_COLUMNS } from './data-loader.mjs';
import { readRaw, digest, counts } from '../tests/helpers.mjs';

const raw = await readRaw();
const data = prepareDataset(raw);
const baseline = JSON.parse(await readFile(new URL('../tests/fixtures/migration-baseline.json', import.meta.url), 'utf8'));

test('exact initial migration totals and permanent record IDs', () => {
  for (const key of ['bugs', 'projects', 'dependencies', 'bugCategories', 'dependencyCategories', 'domains']) assert.equal(data[key].length, baseline.totals[key], key);
  assert.deepEqual(data.bugs.map(b => b.recordId), Array.from({ length: 634 }, (_, i) => `bug-${String(i + 1).padStart(6, '0')}`));
  assert.equal(new Set(data.bugs.map(b => b.commitSha)).size, 634);
  assert.equal(new Set(data.bugs.map(b => b.id)).size, 634);
  assert.equal(data.bugs.filter(b => b.filesChanged >= 1).length, 632);
  assert.deepEqual(data.bugs.filter(b => !b.filesChanged).map(b => b.id), ['32179ba', 'bb3e740']);
});

test('only the exact thirteen approved display IDs change; URLs/files/classifications/order remain identical', () => {
  assert.equal(baseline.corrections.length, 13);
  const originalIds = data.bugs.map(b => b.id);
  for (const correction of baseline.corrections) {
    const bug = data.bugs[correction.position - 1];
    assert.equal(bug.project, correction.project);
    assert.equal(bug.commitSha, correction.commitSha);
    assert.equal(bug.id, correction.id);
    assert.notEqual(bug.id, correction.oldId);
    originalIds[correction.position - 1] = correction.oldId;
  }
  assert.equal(digest(originalIds), baseline.originalBugIdsSha256);
  assert.equal(digest(data.bugs.map(b => b.id)), baseline.correctedBugIdsSha256);
  assert(data.bugs.every(b => /^[a-f0-9]{7}$/.test(b.id) && b.id === b.commitSha.slice(0, 7)));
  assert.equal(digest(data.bugs.map(b => ({ project: b.project, type: b.type, link: b.link, filePaths: b.filePaths, filesChanged: b.filesChanged }))), baseline.bugInvariantsSha256);
  assert.deepEqual(counts(data.bugs, 'type'), baseline.categoryCounts);
});

test('every project metadata value is preserved, and domains resolve to the canonical bug terminology', () => {
  const metadata = data.projects.map(p => ({ project: p.name, ...Object.fromEntries(baseline.projectFields.map(key => [key, p[key]])) }));
  assert.equal(digest(metadata), baseline.projectMetadataSha256);
  assert.deepEqual(counts(data.bugs, 'domain'), baseline.domainCounts);
  for (const bug of data.bugs) assert.equal(bug.domain, data.projectById.get(bug.projectId).domain);
  assert(raw.bugs.every(b => !('domain' in b) && !('filesChanged' in b)));
  assert(raw.projects.every(p => !('domain' in p)));
});

test('taxonomy wording and all 64 representative links and their order are preserved', () => {
  const definitions = Object.fromEntries(data.bugCategories.map(c => [c.label, { definition: c.definition, rules: c.rules, confusions: c.confusions }]));
  assert.equal(digest(definitions), baseline.definitionsSha256);
  assert.equal(data.bugCategories.reduce((sum, c) => sum + c.representatives.length, 0), 64);
  assert.deepEqual(Object.fromEntries(data.bugCategories.map(c => [c.label, c.representativeRecordIds])), baseline.representatives);
  assert.equal(digest(Object.fromEntries(data.bugCategories.map(c => [c.label, c.representatives.map(b => b.link)]))), baseline.representativeLinksSha256);
});

test('all dependency entries and exact associations survive migration, including the tablecn alias', () => {
  const associations = data.dependencies.map(d => ({ dependency: d.name, category: d.category, projects: d.projectIds }));
  assert.equal(digest(associations), baseline.dependencyAssociationsSha256);
  assert.equal(data.dependencies.filter(d => d.projectIds.includes('shadcn-table')).length, 10);
});

test('legacy CSV/JSON preserve their actual original seven-field structure', () => {
  const exported = toLegacyRecords(data.bugs);
  assert.equal(exported.length, 634);
  for (const bug of exported) {
    assert.deepEqual(Object.keys(bug), ['project', 'domain', 'id', 'type', 'link', 'filePaths', 'filesChanged']);
    assert.equal(bug.filesChanged, bug.filePaths.length);
  }
  assert.equal(toLegacyCsv(data.bugs).split('\n')[0], LEGACY_CSV_COLUMNS.join(','));
  assert.equal(LEGACY_CSV_COLUMNS.join(','), 'project,domain,id,type,link,filesChanged,filePaths');
});
