import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DATA_FILES } from '../scripts/data-loader.mjs';

export async function readRaw() {
  return Object.fromEntries(await Promise.all(DATA_FILES.map(async name => [name, JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))])));
}

function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const counts = (rows, key) => rows.reduce((out, row) => { out[row[key]] = (out[row[key]] || 0) + 1; return out; }, {});

// Independent small fixture: routine JSON edits must not require rewriting historical assertions.
export function fixture() {
  return {
    domains: [{ id: 'domain', label: 'Domain' }],
    projects: [{ id: 'project', name: 'Project', domainId: 'domain', loc: 100, stars: 10 }],
    taxonomy: {
      bugCategories: [{ id: 'category', label: 'Category', definition: 'Definition', rules: ['Rule'], neighbors: [], representativeRecordIds: ['bug-000001'] }],
      dependencyCategories: [{ id: 'tooling', label: 'Tooling' }]
    },
    bugs: [{ recordId: 'bug-000001', id: '0123456', projectId: 'project', categoryId: 'category', link: 'https://github.com/owner/project/commit/0123456789abcdef0123456789abcdef01234567', filePaths: ['src/file.ts'] }],
    dependencies: [{ id: 'dependency', name: 'tool', dependencyCategoryId: 'tooling', projectIds: ['project'] }]
  };
}
