import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDataset, loadDataset, toLegacyRecords, toLegacyCsv } from '../scripts/data-loader.mjs';
import { fixture, readRaw } from './helpers.mjs';

test('checked-in editable JSON validates without pinning future edits to the historical snapshot', async () => {
  prepareDataset(await readRaw());
});

test('preparation is deterministic, does not mutate input, and derives domains, counts, and representatives', () => {
  const raw = fixture(), before = structuredClone(raw);
  const data = prepareDataset(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(data, prepareDataset(raw));
  assert.equal(data.bugs[0].filesChanged, 1);
  assert.equal(data.bugs[0].domain, data.projects[0].domain);
  assert.equal(data.bugCategories[0].representatives[0], data.bugByRecordId.get('bug-000001'));
  assert.equal(data.projects[0].coverage, null);
});

const failures = [
  ['wrong top-level shape', r => { r.bugs = {}; }, /data\/bugs.json: expected an array/],
  ['missing taxonomy', r => { delete r.taxonomy; }, /data\/taxonomy.json/],
  ['missing record ID', r => { delete r.bugs[0].recordId; }, /data\/bugs.json\[0\].*recordId/],
  ['duplicate record ID', r => { r.bugs.push({ ...r.bugs[0] }); }, /data\/bugs.json\[1\].*duplicate recordId/],
  ['duplicate project ID', r => { r.projects.push({ ...r.projects[0], name: 'Other' }); }, /data\/projects.json\[1\].*duplicate id/],
  ['duplicate domain ID', r => { r.domains.push({ ...r.domains[0], label: 'Other' }); }, /data\/domains.json\[1\].*duplicate id/],
  ['duplicate category ID', r => { r.taxonomy.bugCategories.push({ ...r.taxonomy.bugCategories[0], label: 'Other' }); }, /taxonomy.json.bugCategories\[1\].*duplicate id/],
  ['duplicate tooling category ID', r => { r.taxonomy.dependencyCategories.push({ ...r.taxonomy.dependencyCategories[0], label: 'Other' }); }, /taxonomy.json.dependencyCategories\[1\].*duplicate id/],
  ['ambiguous category label', r => { r.taxonomy.bugCategories.push({ ...r.taxonomy.bugCategories[0], id: 'other', label: ' CATEGORY ' }); }, /ambiguous label/],
  ['ambiguous project name', r => { r.projects.push({ ...r.projects[0], id: 'other', name: 'project' }); }, /ambiguous name/],
  ['ambiguous domain label', r => { r.domains.push({ id: 'other', label: 'domain' }); }, /ambiguous label/],
  ['unknown project', r => { r.bugs[0].projectId = 'missing'; }, /bugs.json\[0\].*bug-000001.*projectId.*missing/],
  ['unknown domain', r => { r.projects[0].domainId = 'missing'; }, /projects.json\[0\].*domainId.*missing/],
  ['unknown category', r => { r.bugs[0].categoryId = 'missing'; }, /bugs.json\[0\].*categoryId.*missing/],
  ['unknown neighbor', r => { r.taxonomy.bugCategories[0].neighbors = ['missing']; }, /taxonomy.json.*neighbors.*missing/],
  ['unknown dependency project', r => { r.dependencies[0].projectIds = ['missing']; }, /dependencies.json\[0\].*projectIds.*missing/],
  ['unknown dependency category', r => { r.dependencies[0].dependencyCategoryId = 'missing'; }, /dependencies.json\[0\].*dependencyCategoryId/],
  ['unknown representative', r => { r.taxonomy.bugCategories[0].representativeRecordIds = ['missing']; }, /taxonomy.json.*representativeRecordIds.*missing/],
  ['duplicate representative', r => { r.taxonomy.bugCategories[0].representativeRecordIds.push('bug-000001'); }, /representativeRecordIds.*duplicate/],
  ['representative in another category', r => { r.taxonomy.bugCategories.push({ id: 'other', label: 'Other', definition: 'Other', rules: [], neighbors: [], representativeRecordIds: ['bug-000001'] }); }, /belongs to another Bug Category/],
  ['invalid URL', r => { r.bugs[0].link = 'https://example.com/commit/123'; }, /bugs.json\[0\].*link.*GitHub Commit URL/],
  ['invalid ID type', r => { r.bugs[0].id = 1234567; }, /bugs.json\[0\].*id.*string/],
  ['mismatched SHA prefix', r => { r.bugs[0].id = 'abcdef0'; }, /bugs.json\[0\].*id.*0123456/],
  ['invalid file paths', r => { r.bugs[0].filePaths = [3]; }, /bugs.json\[0\].*filePaths\[0\]/],
  ['saved count', r => { r.bugs[0].filesChanged = 1; }, /bugs.json\[0\].*filesChanged.*must not be saved/],
  ['duplicated bug domain', r => { r.bugs[0].domain = 'Domain'; }, /bugs.json\[0\].*domain.*must not be saved/],
  ['invalid numeric metadata', r => { r.projects[0].loc = '100'; }, /projects.json\[0\].*loc/],
  ['invalid negative stars', r => { r.projects[0].stars = -1; }, /projects.json\[0\].*stars/],
  ['invalid testing metadata', r => { r.projects[0].testingFramework = 1; }, /projects.json\[0\].*testingFramework/],
  ['invalid tools array', r => { r.projects[0].tools = null; }, /projects.json\[0\].*tools.*array/],
  ['invalid representative array', r => { r.taxonomy.bugCategories[0].representativeRecordIds = null; }, /taxonomy.json.*representativeRecordIds.*array/],
  ['invalid category short label', r => { r.taxonomy.bugCategories[0].shortLabel = 3; }, /taxonomy.json.*shortLabel.*string/],
  ['duplicate dependency ID', r => { r.dependencies.push({ ...r.dependencies[0] }); }, /dependencies.json\[1\].*duplicate id/],
  ['duplicate dependency associations', r => { r.dependencies[0].projectIds.push('project'); }, /dependencies.json.*projectIds.*duplicate/]
];
for (const [name, mutate, expected] of failures) {
  test(`validation rejects ${name} with an actionable location`, () => {
    const raw = fixture(); mutate(raw);
    assert.throws(() => prepareDataset(raw), expected);
  });
}

test('multiple defects may share display ID and commit SHA but remain independently addressable', () => {
  const raw = fixture();
  raw.bugs.push({ ...raw.bugs[0], recordId: 'bug-000002', filePaths: [] });
  raw.taxonomy.bugCategories[0].representativeRecordIds = ['bug-000002', 'bug-000001'];
  const data = prepareDataset(raw);
  assert.equal(data.bugs[0].id, data.bugs[1].id);
  assert.equal(data.bugs[0].commitSha, data.bugs[1].commitSha);
  assert.deepEqual(data.bugCategories[0].representatives.map(b => b.recordId), ['bug-000002', 'bug-000001']);
  assert.equal(data.bugByRecordId.get('bug-000002').filesChanged, 0);
});

test('JSON-only additions, renames, and seven ordered representatives require no code edits', () => {
  const raw = fixture();
  raw.projects.push({ id: 'new-project', name: 'Empty project', domainId: 'domain' });
  raw.taxonomy.bugCategories.push({ id: 'new-category', label: 'Empty category', definition: 'New', rules: [], neighbors: [] });
  let data = prepareDataset(raw);
  assert.equal(data.projectById.get('new-project').loc, null);
  assert.equal(data.categoryById.get('new-category').representatives.length, 0);
  raw.bugs.push({ ...raw.bugs[0], recordId: 'new-bug', projectId: 'new-project', categoryId: 'new-category' });
  raw.projects[0].name = 'Renamed project';
  raw.taxonomy.bugCategories[0].label = 'Renamed category';
  raw.domains[0].label = 'Renamed domain';
  for (let i = 2; i <= 7; i++) raw.bugs.push({ ...raw.bugs[0], recordId: `example-${i}` });
  raw.taxonomy.bugCategories[0].representativeRecordIds = ['bug-000001', ...Array.from({ length: 6 }, (_, i) => `example-${i + 2}`)];
  data = prepareDataset(raw);
  assert.equal(data.bugs.length, 8);
  assert.equal(data.bugs[0].project, 'Renamed project');
  assert.equal(data.bugs[0].type, 'Renamed category');
  assert(data.bugs.every(b => b.domain === 'Renamed domain'));
  assert.equal(data.dependencies[0].projectIds[0], 'project');
  assert.equal(data.bugCategories[0].representatives.length, 7);
  assert.equal(toLegacyRecords(data.bugs)[0].domain, 'Renamed domain');
});

test('reordering and deleting records never renumbers their permanent IDs', () => {
  const raw = fixture();
  raw.bugs.push({ ...raw.bugs[0], recordId: 'bug-000009' });
  raw.bugs.reverse();
  assert.deepEqual(prepareDataset(raw).bugs.map(b => b.recordId), ['bug-000009', 'bug-000001']);
  raw.bugs.pop(); raw.taxonomy.bugCategories[0].representativeRecordIds = [];
  assert.equal(prepareDataset(raw).bugs[0].recordId, 'bug-000009');
});

test('empty dataset is valid', () => {
  const data = prepareDataset({ bugs: [], projects: [], domains: [], dependencies: [], taxonomy: { bugCategories: [], dependencyCategories: [] } });
  assert.equal(data.bugs.length, 0);
  assert.equal(data.categoryById.size, 0);
});

test('legacy export adapter excludes all internal fields and preserves CSV escaping', () => {
  const raw = fixture(); raw.bugs[0].filePaths = ['src/"quoted",file.ts', 'other.ts'];
  const bugs = prepareDataset(raw).bugs;
  assert.deepEqual(Object.keys(toLegacyRecords(bugs)[0]), ['project', 'domain', 'id', 'type', 'link', 'filePaths', 'filesChanged']);
  assert.match(toLegacyCsv(bugs), /src\/""quoted"",file.ts; other.ts/);
  assert(!JSON.stringify(toLegacyRecords(bugs)).includes('recordId'));
});

test('loader reads exactly five JSON files freshly and invokes shared preparation', async () => {
  const raw = fixture(), calls = [];
  const data = await loadDataset({ fetchImpl: async (url, options) => {
    calls.push([url, options]);
    const name = url.pathname.split('/').at(-1).replace('.json', '');
    return { ok: true, text: async () => JSON.stringify(raw[name]) };
  } });
  assert.equal(calls.length, 5);
  assert(calls.every(([, options]) => options.cache === 'no-store'));
  assert.equal(data.bugs[0].filesChanged, 1);
});

for (const [name, response, expected] of [
  ['HTTP missing file', async () => ({ ok: false, status: 404 }), /data\/.*.json.*HTTP 404/],
  ['network failure', async () => { throw new Error('offline'); }, /data\/.*.json.*offline/],
  ['invalid JSON', async () => ({ ok: true, text: async () => '{' }), /data\/.*.json.*invalid JSON/],
  ['interrupted response', async () => ({ ok: true, text: async () => { throw new Error('interrupted'); } }), /data\/.*.json.*interrupted/]
]) test(`loader reports ${name}`, async () => assert.rejects(loadDataset({ fetchImpl: response }), expected));
