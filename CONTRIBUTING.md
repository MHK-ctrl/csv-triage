# Contributing to CSV Triage

Thanks for wanting to help. This project has a few hard rules — they are what make it trustworthy:

1. **Diagnosis only.** Never add code that edits, repairs, or rewrites the user's data.
2. **No network at runtime.** No uploads, telemetry, analytics, remote fonts, or API calls. The CSV never leaves the browser tab. If a feature needs a server, it does not belong in this project.
3. **UTF-8 only.** Do not claim encoding detection. UTF-8 (+BOM), stated plainly.
4. **`src/analyze.ts` stays pure.** No DOM, no network, no globals — it must remain unit-testable in Node.
5. **Never silently change behavior.** Findings say what is wrong and where; they never "fix" anything.

## Getting set up

```bash
git clone https://github.com/MHK-ctrl/csv-triage.git
cd csv-triage
npm install
npm run dev       # http://localhost:5173
npm test          # vitest
npm run build     # tsc --noEmit && vite build
```

## Making changes

- **Tests first for `analyze.ts`.** Every new diagnostic needs a unit test in `tests/analyze.test.ts` that pins its exact output — record numbers included.
- **Keep the diff small.** One concern per pull request.
- **Conventional commit messages** (`feat:`, `fix:`, `docs:`, …) are appreciated.
- **Bug reports:** include the Markdown report from the tool and, if possible, a minimal CSV that reproduces the issue. Redact real customer data first — a hand-crafted example is just as good.

## Project layout

```
src/analyze.ts   pure diagnostics engine (records, findings, stats)
src/report.ts    Markdown report builder (pure)
src/main.ts      DOM wiring, clipboard/download, size guard
tests/           vitest suites
docs/            architecture notes
```

## License

By contributing, you agree that your contributions are licensed under the [MIT license](LICENSE).
