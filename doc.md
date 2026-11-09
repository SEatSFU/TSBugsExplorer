# TSBugs Explorer

**TSBugs Explorer** is an interactive visual analytics platform for exploring, understanding, and benchmarking software bugs in modern TypeScript projects. It provides researchers and practitioners with a web-based interface for searching, filtering, comparing, and visualizing a curated dataset of real-world bugs collected from popular open-source TypeScript repositories.

Unlike traditional dataset repositories, TSBugs Explorer combines a reusable benchmark with coordinated visual analytics, enabling users to rapidly explore fault distributions, inspect individual bugs, compare software ecosystems, and construct customized benchmark datasets for downstream empirical studies.

---

# Features

## 📊 Interactive Dashboard

Provides a high-level overview of the benchmark, including:

- Number of projects
- Number of bugs
- Taxonomy distribution
- Project characteristics
- Technology ecosystem
- Repository statistics

The dashboard uses coordinated visualizations that update dynamically as users interact with the dataset.

---

## 🔍 Faceted Search and Filtering

Users can interactively filter the benchmark using combinations of project and bug attributes, including:

- Repository
- Bug category
- Project domain
- Framework
- Testing framework
- Package manager
- Dependencies
- Project size
- Project maturity
- Popularity
- Additional metadata

All visualizations and statistics update immediately as filters are applied.

---

## 📈 Repository Comparison

Compare multiple TypeScript projects side-by-side.

The comparison view presents:

- Fault distributions
- Project characteristics
- Technology stacks
- Testing infrastructure
- Dependency information
- Repository metadata

This enables users to identify similarities and differences in software quality across projects.

---

## 🐞 Bug Explorer

Browse and inspect individual bug reports.

Each bug includes available metadata such as:

- Repository
- Issue information
- Taxonomy label
- Project metadata
- Changed files
- Commit information
- GitHub links
- Additional annotations

The explorer supports searching, sorting, filtering, and drill-down navigation.

---

## 📉 Interactive Visual Analytics

TSBugs Explorer provides multiple coordinated visualizations, including:

- Bug category distributions
- Repository distributions
- Repository × category heatmaps
- Technology ecosystem summaries
- Comparative visualizations
- Project statistics

Selections made in one visualization automatically update all other views, enabling efficient exploratory analysis.

---

## 🧪 Benchmark Studio

Researchers can construct customized benchmark datasets by selecting subsets of projects and bugs using arbitrary combinations of filters.

Selected benchmarks can be exported for downstream research and experimentation.

Supported export formats include:

- CSV
- JSON

---

## 📚 Taxonomy Browser

The taxonomy browser documents each bug category, including:

- Category definitions
- Classification guidelines
- Representative examples
- Common ambiguities
- Related categories

This facilitates consistent interpretation and reuse of the benchmark.

---

# Dataset

The maintained dataset is stored in five editable JSON files under `data/` and validated by the shared loader. See [DATA_MAINTENANCE.md](DATA_MAINTENANCE.md).

The benchmark currently contains:

- Curated TypeScript bug reports
- Repository metadata
- Project characteristics
- Dependency information
- Bug taxonomy labels
- Provenance metadata

The platform is designed to support future extensions as additional repositories, bug reports, and metadata become available.

---

# Typical Workflow

1. Explore the overall ecosystem using the interactive dashboard.
2. Filter projects and bugs using repository or taxonomy attributes.
3. Compare repositories to investigate differences in fault profiles.
4. Inspect individual bugs and their associated metadata.
5. Construct customized benchmark datasets.
6. Export selected data for downstream empirical studies.

---

# Intended Users

TSBugs Explorer is intended for:

- Empirical Software Engineering researchers
- Mining Software Repositories (MSR) researchers
- Software testing researchers
- Program analysis researchers
- AI-assisted Software Engineering researchers
- Educators
- Software practitioners

---

# Technology Stack

TSBugs Explorer is implemented as a modern web application using:

- HTML5
- CSS3
- JavaScript
- D3.js

The architecture is modular and designed to accommodate larger datasets, additional visualizations, and future software engineering benchmarks.

---

# Vision

TSBugs Explorer transforms a curated TypeScript bug benchmark into an interactive visual analytics platform that enables researchers to explore software fault patterns, compare ecosystems, inspect bug provenance, and construct reproducible benchmark datasets through coordinated visualizations and interactive exploration.
