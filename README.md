# DataLens AI - Data Quality Copilot

A privacy-first data-quality dashboard that runs entirely in the browser. Upload a CSV and receive an explainable quality score, column-by-column diagnostics, possible sensitive-data warnings, duplicate checks, numeric outlier counts, category imbalance checks, and a downloadable JSON report.

## Run locally

Open `dist/index.html` in a browser, or serve the folder:

```bash
cd dist
python3 -m http.server 8080
```

## Deploy to GitHub Pages

The workflow at `.github/workflows/pages.yml` deploys `dist/` when the repository's GitHub Pages source is set to **GitHub Actions**.

## Privacy and limitations

Files never leave the browser. The tool uses deterministic heuristics, not a trained model, and a warning is not proof of an error or of personal data. Review results in their business context before changing a dataset.
