# Architecture

## Goals

- Answer one question: **what exactly is wrong with this CSV?**
- Be private by construction: the file never leaves the browser tab.
- Keep diagnostics deterministic and unit-testable.

## Non-goals

- Repairing, rewriting, or "cleaning" data (diagnosis only).
- Encoding detection beyond UTF-8 + BOM.
- Schema validation or type inference.
- Any server-side component.

## Data flow

```
file (drop / picker) ──► ArrayBuffer ──► UTF-8 decode (BOM preserved) ─┐
paste event ──────────► text ──────────────────────────────────────────┤
                                                                       ▼
                                              analyzeCsv(text, {delimiter?})   ← pure
                                                                       │
                     ┌─────────────────────────────────────────────────┤
                     ▼                                                 ▼
        render stats + findings (DOM)                    buildMarkdownReport(result, meta)
        (textContent only — no innerHTML)                          │
                                                          copy to clipboard / .md download
```

## Modules

| File | Responsibility |
| --- | --- |
| `src/analyze.ts` | Pure engine. Parses with Papa Parse, then derives findings: ragged rows, delimiter guess warnings, duplicate/empty headers, BOM, line endings, parse-error hints, blank lines. No DOM, no network. |
| `src/report.ts` | Pure Markdown export. Takes an `AnalysisResult` plus metadata (file name, timestamp, repo URL). |
| `src/main.ts` | DOM wiring only: file/paste intake, 5 MB guard, delimiter override, rendering, clipboard/download. |

## Key decisions

- **Record numbers are parsed record numbers.** A newline inside a quoted field means record number ≠ editor line number. This is stated in the UI and in the report, because a wrong row number is worse than no row number.
- **Delimiter detection is always called a guess.** Papa Parse's auto-detection is good but not infallible, so the UI always exposes a manual override and labels auto results as guesses. Detection runs on a blank-skipping pass, because Papa Parse scores candidates by averaging field counts — a trailing newline (which parses as one extra empty record) would otherwise skew the score and break detection for ordinary two-column files. If only one column is detected while the first line contains another candidate delimiter, a warning is raised.
- **BOM handling is read-only.** The file is decoded with `TextDecoder("utf-8", { ignoreBOM: true })` so a leading U+FEFF stays visible to the analyzer; it is then ignored for parsing. Nothing is ever written back to disk.
- **Blank lines are counted, never treated as ragged rows.** A blank record (`[""]`) is excluded from field-count comparison — otherwise every blank line would look like a ragged row.
- **Data is never trusted as HTML.** CSV-derived strings (headers, error messages) are inserted with `textContent` only.
- **5 MB cap.** The entire file is parsed synchronously in the tab; the cap keeps the UI responsive. The check happens before decoding.
- **`base: "./"` in `vite.config.ts`.** GitHub Pages serves the app from a repository subpath (`/csv-triage/`), so all asset URLs must be relative.
- **No runtime network access.** There is no `fetch`, `XMLHttpRequest`, analytics snippet, or remote asset anywhere in `src/`. This is a testable property of the source tree and a hard rule for contributors.

## Testing

- `tests/analyze.test.ts` runs in Node via vitest against the pure engine and the report builder: clean files, quoted delimiters, ragged rows with exact record numbers, semicolon/tab/pipe detection, manual override, BOM, duplicate headers, empty headers, single-column warnings, blank lines, mixed line endings, unclosed quotes, size limit, and empty input.
- Manual smoke test: `npm run dev`, load a broken CSV, confirm findings render and the report downloads.

## Deployment

- `.github/workflows/deploy.yml` runs on every push to `main`: `npm ci` → `npm test` → `npm run build` (which type-checks with `tsc --noEmit`) → `configure-pages` → `upload-pages-artifact` → `deploy-pages`.
- Pages uses the **GitHub Actions** build type (not branch-based), so the deployed site is exactly the tested artifact.
- The workflow needs `pages: write` and `id-token: write`; `configure-pages` is invoked with `enablement: true` so a fresh fork/repo can enable Pages on its first run.

## Failure modes

- **False-positive ragged rows** would occur if blank records were counted — they are excluded.
- **Wrong delimiter guess**: mitigated by the "guess" label, the manual override, and the single-column warning.
- **Quoted newlines shift record numbers**: documented in UI and report.
- **Non-UTF-8 input**: decoded with replacement characters; a note is shown if any U+FFFD appears. The tool does not attempt to guess the original encoding.
