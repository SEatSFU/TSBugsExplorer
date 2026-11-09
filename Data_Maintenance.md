# Editing TSBugs Explorer data

Data are store in five JSON files in `data/`

## Routine workflow

1. Edit the appropriate JSON file(s).
2. Run `node scripts/check-data.mjs` and `node --test`
3. Serve the repository with `python3 -m http.server 8000` and reload `http://localhost:8000`.
4. Review all affected tabs/filters/exports, then publish the static files and five JSON files together.

Data is fetched on each reload without browser caching. The app displays a persistent error and Retry control if loading or validation fails; it never falls back to an older dataset. A validation error identifies its file, record/index, and failing field.

## Bugs and permanent record identity

Each `bugs.json` entry has exactly these maintained fields:

```json
{
  "recordId": "bug-000635",
  "id": "0123456",
  "projectId": "existing-project-id",
  "categoryId": "existing-category-id",
  "link": "https://github.com/owner/repository/commit/0123456789abcdef0123456789abcdef01234567",
  "filePaths": ["src/example.ts"]
}
```

The `id` must be the first seven lowercase hexadecimal characters of that URL's 40-character SHA, stored as a string so leading zeros survive.

`recordId` uniquely identifies a sample, not a commit. Give a fresh, never-reused ID for new records. Never renumber existing IDs when inserting, reordering, or deleting. Do not reuse a deleted ID. The validator detects current duplicates; it cannot detect historical ID reuse.

Do not save `filesChanged`, `commitSha`, domain, project display name, or category display label in a bug.

## Projects and domains

Project `id` is permanent; change `name` to rename a project. Each project has one `domainId` referencing `domains.json`. Every associated bug inherits that domain. Changing the project's `domainId` updates all its bugs; renaming a domain's `label` updates all views and exports without editing any bugs/projects.

A new project must include:

```json
{
  "id": "new-project-ID",
  "name": "New project name",
  "domainId": "user-interface",
  "loc": "Num",
  "files": "Num",
  "coverage": "Num",
  "stars": "Num",
  "forks": "Num",
  "commits": "Num",
  "recentCommits": "Num",
  "issues": "Num",
  "closedIssues": "Num",
  "pullRequests": "Num"
}
```

Numeric attributes are `loc`, `files`, `coverage`, `stars`, `forks`, `commits`, `recentCommits`, `issues`, `closedIssues`, and `pullRequests` and missing numeric/string metadata becomes `null`, not zero. Optional string attributes are `link`, `startDate`, `testingFramework`, and `toolsCountRaw`; `tools` is an array of strings (defaults to `[]`).

Domain entries contain `id` and `label`. The canonical names use the original long-form Bug Domain terminology, with exactly two corrections.

## Categories and representative records

`taxonomy.json` has two arrays: `bugCategories` and `dependencyCategories`. A bug category contains:

```json
{
  "id": "new-category",
  "label": "New category",
  "definition": "Describe the category.",
  "rules": ["Explain when to assign this category."],
  "neighbors": [],
  "representativeRecordIds": []
}
```

Neighbor IDs must reference existing bug categories. Representative IDs must reference bugs in that same category and cannot repeat within the list. Change a representative URL in its bug record, not in taxonomy.

Dependency categories contain only `id` and `label`. Renaming either kind of category changes its label without modifying IDs or associations. Registry labels/names must be unique ignoring case and surrounding whitespace.

## Dependencies

Each entry has permanent `id`, editable `name`, `dependencyCategoryId`, and a `projectIds` array. Associations must be exact existing IDs. A dependency may reference multiple projects; it counts once per associated project. Add new dependency categories to `taxonomy.json` before referencing them.
