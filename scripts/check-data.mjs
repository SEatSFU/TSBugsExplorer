import { readFile } from 'node:fs/promises';
import { loadDataset } from './data-loader.mjs';

try {
  const dataset = await loadDataset({ fetchImpl: async url => ({ ok: true, text: () => readFile(url, 'utf8') }) });
  console.log(`Data valid: ${dataset.bugs.length} bugs, ${dataset.projects.length} projects, ${dataset.dependencies.length} dependencies, ${dataset.bugCategories.length} bug categories, ${dataset.dependencyCategories.length} dependency categories, ${dataset.domains.length} domains.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
