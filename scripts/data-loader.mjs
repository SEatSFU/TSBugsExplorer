export const DATA_FILES = ['bugs', 'projects', 'domains', 'taxonomy', 'dependencies'];
export const LEGACY_CSV_COLUMNS = ['project', 'domain', 'id', 'type', 'link', 'filesChanged', 'filePaths'];

function invalid(where, message) {
  throw new Error(`${where}: ${message}`);
}

function object(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(where, 'expected an object');
}

function string(value, where) {
  if (typeof value !== 'string' || !value.trim()) invalid(where, 'expected a nonempty string');
}

function array(value, where) {
  if (!Array.isArray(value)) invalid(where, 'expected an array');
}

function strings(value, where) {
  array(value, where);
  value.forEach((item, index) => string(item, `${where}[${index}]`));
}

function unique(values, where) {
  if (new Set(values).size !== values.length) invalid(where, 'duplicate entries');
}

function reference(map, id, where) {
  string(id, where);
  if (!map.has(id)) invalid(where, `unknown reference "${id}"`);
  return map.get(id);
}

function registry(rows, where, labelKey) {
  array(rows, where);
  const ids = new Map(), labels = new Set();
  rows.forEach((row, index) => {
    const at = `${where}[${index}] (${row?.id ?? 'missing id'})`;
    object(row, at);
    string(row.id, `${at}.id`);
    string(row[labelKey], `${at}.${labelKey}`);
    if (ids.has(row.id)) invalid(at, `duplicate id "${row.id}"`);
    const label = row[labelKey].trim().toLowerCase();
    if (labels.has(label)) invalid(at, `ambiguous ${labelKey} "${row[labelKey]}"`);
    ids.set(row.id, row);
    labels.add(label);
  });
  return ids;
}

function rejectDerived(row, keys, where) {
  for (const key of keys) {
    if (Object.hasOwn(row, key)) invalid(`${where}.${key}`, 'calculated/resolved field must not be saved; edit its source instead');
  }
}

const numericProjectFields = ['loc', 'files', 'coverage', 'stars', 'forks', 'commits', 'recentCommits', 'issues', 'closedIssues', 'pullRequests'];
const stringProjectFields = ['link', 'startDate', 'testingFramework', 'toolsCountRaw'];

/** Validate and resolve raw JSON without accessing the DOM, network, or globals. */
export function prepareDataset(rawFiles) {
  object(rawFiles, 'dataset');
  const { bugs, projects, domains, taxonomy, dependencies } = rawFiles;
  object(taxonomy, 'data/taxonomy.json');
  const domainById = registry(domains, 'data/domains.json', 'label');
  const rawProjectById = registry(projects, 'data/projects.json', 'name');
  const rawCategoryById = registry(taxonomy.bugCategories, 'data/taxonomy.json.bugCategories', 'label');
  const dependencyCategoryById = registry(taxonomy.dependencyCategories, 'data/taxonomy.json.dependencyCategories', 'label');
  array(bugs, 'data/bugs.json');
  array(dependencies, 'data/dependencies.json');

  domains.forEach((domain, index) => {
    if (domain.shortLabel !== undefined) string(domain.shortLabel, `data/domains.json[${index}].shortLabel`);
  });
  const preparedProjects = projects.map((project, index) => {
    const at = `data/projects.json[${index}] (${project.id})`;
    rejectDerived(project, ['domain', 'bugCount'], at);
    const domain = reference(domainById, project.domainId, `${at}.domainId`);
    const attributes = {};
    for (const key of numericProjectFields) {
      const value = project[key] ?? null;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key !== 'coverage' && !Number.isInteger(value)))) invalid(`${at}.${key}`, 'expected a nonnegative number or null');
      if (key === 'coverage' && value !== null && value > 100) invalid(`${at}.${key}`, 'expected a percentage between 0 and 100');
      attributes[key] = value;
    }
    for (const key of stringProjectFields) {
      const value = project[key] ?? null;
      if (value !== null && typeof value !== 'string') invalid(`${at}.${key}`, 'expected a string or null');
      attributes[key] = value;
    }
    const tools = project.tools === undefined ? [] : project.tools;
    strings(tools, `${at}.tools`);
    return { ...project, ...attributes, tools: [...tools], project: project.name, domain: domain.label };
  });
  const projectById = new Map(preparedProjects.map(project => [project.id, project]));

  taxonomy.bugCategories.forEach((category, index) => {
    const at = `data/taxonomy.json.bugCategories[${index}] (${category.id})`;
    string(category.definition, `${at}.definition`);
    if (category.shortLabel !== undefined) string(category.shortLabel, `${at}.shortLabel`);
    strings(category.rules, `${at}.rules`);
    strings(category.neighbors, `${at}.neighbors`);
    unique(category.neighbors, `${at}.neighbors`);
    category.neighbors.forEach(id => reference(rawCategoryById, id, `${at}.neighbors`));
    const ids = category.representativeRecordIds === undefined ? [] : category.representativeRecordIds;
    strings(ids, `${at}.representativeRecordIds`);
    unique(ids, `${at}.representativeRecordIds`);
  });

  const bugByRecordId = new Map();
  const preparedBugs = bugs.map((bug, index) => {
    const at = `data/bugs.json[${index}] (${bug?.recordId ?? 'missing recordId'})`;
    object(bug, at);
    string(bug.recordId, `${at}.recordId`);
    if (bugByRecordId.has(bug.recordId)) invalid(at, `duplicate recordId "${bug.recordId}"`);
    rejectDerived(bug, ['filesChanged', 'commitSha', 'domain', 'domainId', 'project', 'type'], at);
    const project = reference(projectById, bug.projectId, `${at}.projectId`);
    const category = reference(rawCategoryById, bug.categoryId, `${at}.categoryId`);
    string(bug.link, `${at}.link`);
    const match = /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+\/commit\/([a-f0-9]{40})$/.exec(bug.link);
    if (!match) invalid(`${at}.link`, 'expected a GitHub Commit URL with a full 40-character lowercase hexadecimal SHA');
    if (typeof bug.id !== 'string' || !/^[a-f0-9]{7}$/.test(bug.id)) invalid(`${at}.id`, 'expected seven lowercase hexadecimal characters as a string');
    if (bug.id !== match[1].slice(0, 7)) invalid(`${at}.id`, `expected "${match[1].slice(0, 7)}" from its Commit URL`);
    strings(bug.filePaths, `${at}.filePaths`);
    const prepared = { ...bug, filePaths: [...bug.filePaths], commitSha: match[1], filesChanged: bug.filePaths.length, project: project.name, type: category.label, domainId: project.domainId, domain: project.domain };
    bugByRecordId.set(bug.recordId, prepared);
    return prepared;
  });

  const bugCategories = taxonomy.bugCategories.map((category, index) => {
    const at = `data/taxonomy.json.bugCategories[${index}] (${category.id}).representativeRecordIds`;
    const representativeRecordIds = [...(category.representativeRecordIds ?? [])];
    const representatives = representativeRecordIds.map((id, representativeIndex) => {
      const bug = reference(bugByRecordId, id, `${at}[${representativeIndex}]`);
      if (bug.categoryId !== category.id) invalid(`${at}[${representativeIndex}]`, `${id} belongs to another Bug Category (${bug.categoryId})`);
      return bug;
    });
    return { ...category, rules: [...category.rules], neighbors: [...category.neighbors], confusions: category.neighbors.map(id => rawCategoryById.get(id).label), representativeRecordIds, representatives };
  });
  const categoryById = new Map(bugCategories.map(category => [category.id, category]));

  const dependencyIds = new Set();
  const preparedDependencies = dependencies.map((dependency, index) => {
    const at = `data/dependencies.json[${index}] (${dependency?.id ?? 'missing id'})`;
    object(dependency, at);
    string(dependency.id, `${at}.id`);
    if (dependencyIds.has(dependency.id)) invalid(at, `duplicate id "${dependency.id}"`);
    dependencyIds.add(dependency.id);
    string(dependency.name, `${at}.name`);
    const category = reference(dependencyCategoryById, dependency.dependencyCategoryId, `${at}.dependencyCategoryId`);
    strings(dependency.projectIds, `${at}.projectIds`);
    unique(dependency.projectIds, `${at}.projectIds`);
    dependency.projectIds.forEach(id => reference(rawProjectById, id, `${at}.projectIds`));
    return { ...dependency, projectIds: [...dependency.projectIds], dependency: dependency.name, category: category.label };
  });

  return {
    bugs: preparedBugs, projects: preparedProjects, domains: domains.map(domain => ({ ...domain })),
    bugCategories, dependencyCategories: taxonomy.dependencyCategories.map(category => ({ ...category })), dependencies: preparedDependencies,
    projectById, domainById, categoryById, dependencyCategoryById, bugByRecordId
  };
}

/** Load a fresh static snapshot. Injection also permits filesystem/HTTP failure tests. */
export async function loadDataset({ baseUrl = new URL('../data/', import.meta.url), fetchImpl = globalThis.fetch } = {}) {
  const files = await Promise.all(DATA_FILES.map(async name => {
    const file = `data/${name}.json`;
    let response;
    try {
      response = await fetchImpl(new URL(`${name}.json`, baseUrl), { cache: 'no-store' });
    } catch (error) {
      invalid(file, `could not load file: ${error.message}`);
    }
    if (!response.ok) invalid(file, `could not load file (HTTP ${response.status})`);
    let text;
    try {
      text = await response.text();
    } catch (error) {
      invalid(file, `could not read file: ${error.message}`);
    }
    try {
      return [name, JSON.parse(text)];
    } catch (error) {
      invalid(file, `invalid JSON: ${error.message}`);
    }
  }));
  return prepareDataset(Object.fromEntries(files));
}

/** Explicit compatibility projection: internal keys never leak into legacy exports. */
export function toLegacyRecords(bugs) {
  return bugs.map(bug => ({ project: bug.project, domain: bug.domain, id: bug.id, type: bug.type, link: bug.link, filePaths: [...bug.filePaths], filesChanged: bug.filesChanged }));
}

export function toLegacyCsv(bugs) {
  return [LEGACY_CSV_COLUMNS.join(','), ...toLegacyRecords(bugs).map(bug => LEGACY_CSV_COLUMNS.map(key => `"${String(key === 'filePaths' ? bug.filePaths.join('; ') : bug[key]).replaceAll('"', '""')}"`).join(','))].join('\n');
}
