# TSBugs Explorer (TLDR)

A static web-based visual analytics prototype for the uploaded TypeScript bug benchmark.

## Run locally

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

The app uses D3.js from jsDelivr, so an internet connection is needed for visualization rendering. The benchmark is loaded from the five checked-in JSON files in `data/`. Use the HTTP server above

## Included views

- **Dashboard:** linked distributions, project/category heatmap, domain breakdown, and project-size scatterplot.
- **Bug Explorer:** searchable and filterable bug table, rich detail view, provenance links, file paths, and related bugs.
- **Compare Projects:** normalized fault profiles, project metadata, and dependency/tooling profiles.
- **Benchmark Builder:** multi-select criteria, balance previews, JSON/CSV export, and a reproducible textual summary.
- **Taxonomy:** definitions, decision rules, common confusions, and representative examples.

# TSBugs Explorer (Long Version)

**TSBugs Explorer** is an interactive visual analytics platform for exploring, understanding, and benchmarking software bugs in modern TypeScript projects.

The platform combines a curated benchmark of real-world TypeScript bugs with interactive visualizations, coordinated filtering, repository comparison, and benchmark construction tools, enabling researchers and practitioners to rapidly explore software fault patterns and construct customized datasets for empirical software engineering research.

---

## Features

- 📊 Interactive dashboard for exploring the overall bug ecosystem
- 🔍 Faceted search and filtering across projects and bug metadata
- 📈 Side-by-side repository comparison
- 🐞 Interactive bug explorer with rich metadata
- 🔥 Repository × bug category heatmaps and coordinated visualizations
- 🧪 Benchmark Studio for constructing customized benchmark datasets
- 📚 Taxonomy browser with category definitions and representative examples
- 📤 Export selected benchmark subsets as CSV or JSON

---

## Dataset

The benchmark currently includes:

- Curated TypeScript bug reports
- Repository metadata
- Project characteristics
- Dependency information
- Bug taxonomy labels
- Provenance metadata

The platform is designed to accommodate future benchmark expansions and additional software ecosystems.

---

## Maintain the dataset

| File                     | Maintained contents                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `data/bugs.json`         | Bug samples and permanent `recordId` values; project/category references, visible Bug IDs, commit links, and file paths |
| `data/projects.json`     | Stable project IDs, editable display names, domain references, and repository metadata                                  |
| `data/domains.json`      | Stable domain IDs and canonical Bug Domain labels                                                                       |
| `data/taxonomy.json`     | Bug/dependency categories, descriptions, rules, neighboring category IDs, and ordered representative record IDs         |
| `data/dependencies.json` | Dependency inventory entries with explicit category and project IDs                                                     |

`recordId` is the internal sample key; `id` remains the visible seven-character commit prefix. Multiple independent samples may share a commit and visible ID. Domains are stored once on projects and inherited by bugs. Legacy CSV/JSON downloads retain their seven-field schema, without internal IDs.

For deployment, publish the root application files, the four browser modules in `scripts/`, and **all five JSON files together**. The loader requests fresh JSON (`cache: 'no-store'`) on reload. Publish releases atomically and invalidate any hosting/CDN caches for HTML/modules/JSON so clients do not mix releases. Git commits/tags identify the exact dataset revision for research reproducibility

## Getting Started

Clone the repository and start a local web server.

```bash
python3 -m http.server 8000
```

Then open

```
http://localhost:8000
```

in your browser.

---

## Project Structure

```
/
├── index.html
├── app.js
├── styles.css
├── data/
├── scripts/
│   ├── analysis-charts.mjs       # Dashboard and comparison chart rendering
│   ├── benchmark-facet.mjs       # Builder selection interactions
│   ├── data-loader.mjs           # JSON loading, validation, and export adapters
│   ├── visualization-model.mjs   # Shared chart calculations
│   ├── check-data.mjs           # Data validation command
│   ├── smoke-browser.mjs        # Browser acceptance checks
│   └── verify-migration.mjs     # Optional historical migration audit
├── tests/
├── DATA_MAINTENANCE.md
└── README.md
```

`index.html` loads the root `app.js`, which imports the browser modules from `scripts/`. The data loader reads the sibling `data/` directory

---

## Technology Stack

- HTML5
- CSS3
- JavaScript
- D3.js

---

## Intended Users

TSBugs Explorer is designed for:

- Empirical Software Engineering researchers
- Mining Software Repositories researchers
- Software Testing researchers
- Program Analysis researchers
- AI-assisted Software Engineering researchers
- Educators
- Software practitioners

---

## Vision

TSBugs Explorer transforms a TypeScript bug benchmark into an interactive visual analytics platform that enables researchers to explore software fault patterns, compare software ecosystems, inspect individual bugs, and construct reproducible benchmark datasets through coordinated visualizations and interactive exploration.

---

## License

TSBugs Explorer is released under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Preprint

A preprint of our paper, *TSBugs Explorer: Exploring and Benchmarking TypeScript Bugs*, is available on [arXiv](https://arxiv.org/pdf/2611.14940).
