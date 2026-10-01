# CSV Triage

**Find out why your CSV won't import — with exact record numbers, in plain language. Runs entirely in your browser.**

[![Test, build and deploy](https://github.com/MHK-ctrl/csv-triage/actions/workflows/deploy.yml/badge.svg)](https://github.com/MHK-ctrl/csv-triage/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![No uploads](https://img.shields.io/badge/data-never%20leaves%20the%20browser-brightgreen.svg)](#privacy)

**Try it:** https://mhk-ctrl.github.io/csv-triage/

---

## The problem

"Invalid CSV" is the worst error message in software. When Excel, Google Sheets, or a data pipeline refuses a file, it almost always has exactly one specific problem — a row with too few fields, a stray quote, a duplicate header — and you're told nothing about where it is or what it is.

CSV Triage answers one question: **what exactly is wrong with this file?**

## What it checks

- **Ragged rows** — every record's field count is compared against the first row, with exact record numbers. Ragged rows are the #1 cause of failed imports.
- **Delimiters** — auto-detects comma, semicolon, tab, and pipe, and warns you when the guess looks wrong (for example, one column detected while `;` appears in the first line). Manual override is always one click away.
- **Headers** — duplicate headers (case-insensitive) and empty headers caused by a trailing delimiter, both reported with column numbers.
- **Encoding and line endings** — detects a UTF-8 BOM and notes mixed CRLF/LF line endings.
- **Parse errors** — unclosed or stray quotes, surfaced with a plain-language hint about the likely cause.
- **A Markdown report** — copy or download a report you can paste straight into an issue.

## Privacy

Everything runs in your browser tab. There is no backend, no analytics, and no network calls at runtime. CSV files often contain customer data — that data should never leave your machine, and with CSV Triage it doesn't. You can verify there is no network activity in your browser's DevTools.

## Quick start

Use the hosted version: **https://mhk-ctrl.github.io/csv-triage/**

Or run it locally:

```bash
npm install
npm run dev
```

## Usage

1. Open the app (hosted, or via `npm run dev`).
2. Add a CSV: drop it on the drop zone, click to browse for a file, or paste its text.
3. Read the findings. If the column count looks wrong, pick a different delimiter from the menu — the analysis re-runs instantly.
4. Export the Markdown report ("Copy report" or "Download .md") and share it.

> **A note on record numbers:** findings refer to *parsed* record numbers, not editor line numbers. If a field contains a newline inside quotes, the numbering shifts from what your text editor shows.

## What it deliberately does NOT do

- **It never modifies or "repairs" your data.** Diagnosis only — no rewritten files, no silently dropped rows, no "cleaned" exports.
- **It does not detect encodings beyond UTF-8 (+BOM).** Files are read as UTF-8. Other encodings are not reliably detectable from content alone, and this tool does not pretend otherwise.
- **It does not upload anything, ever.** No server, no queues, no AI calls, no "anonymous usage stats".
- **It does not validate against a schema** or infer column types — it reports structural problems that break parsers, nothing more.
- **It does not handle files over 5 MB.** The whole file is parsed in your browser tab, and the limit keeps it responsive.

## Development

```bash
npm install      # install dependencies
npm run dev      # start the Vite dev server
npm test         # run the unit tests (vitest)
npm run build    # type-check (tsc --noEmit) + production build
npm run preview  # preview the production build locally
```

## Roadmap

- [x] v1: ragged rows, delimiter detection + manual override, header checks, BOM and line-ending notes, plain-language parse errors, Markdown report export
- [x] CI: test → build → deploy to GitHub Pages
- [ ] Confidence indicator for delimiter auto-detection
- [ ] Bundled example files for trying the tool in one click
- [ ] More line-ending edge cases (lone CR) surfaced in the UI

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable bug report you can send is a CSV that breaks the tool.

## License

[MIT](LICENSE) © 2026 MHK-ctrl
