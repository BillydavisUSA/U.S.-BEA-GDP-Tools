# Contributing

Contributions to U.S. BEA GDP Tools are welcome: bug fixes, accessible web UI,
English and Chinese translations, geography corrections, tests, and
documentation. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Discuss and reproduce

For a bug, open a
[GitHub issue](https://github.com/BillydavisUSA/U.S.-BEA-GDP-Tools/issues)
with the expected result, actual result, and steps to reproduce. Data reports
should identify the geographic level, area, measure, year, and official source.
Include a small redacted sample if it helps; never include an API key or personal
information. Discuss substantial scope changes before starting a large patch.

For a possible security issue, do not post an exploit, credential, or sensitive
data in a public issue. No private security-reporting address is published yet;
ask the maintainer for a private reporting channel without disclosing the
vulnerability details.

## Set up and check

Install Node.js 22 or later, then run from the repository root:

```bash
npm ci
npm run dev
```

For live data queries, copy `.env.example` to `.env` and set `BEA_USER_ID` as described in the [README](README.md). Keep this file local.

Before opening a pull request, run the checks relevant to your change:

```bash
npm test
npm run build
npm run test:web-layout
```

The current layout check uses Microsoft Edge on Windows at
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
If a check cannot run, say which check and why in the pull request. Use
`npm.cmd` in Windows PowerShell if your execution policy blocks `npm.ps1`.

## Make a focused change

1. Fork the repository and create a branch for your change.
2. Keep implementation and documentation aligned with the website's behavior.
3. Preserve official GeoFIPS, MSA, and CSA identifiers when changing display
   names. Chinese translations must not change geographic boundaries or values.
4. For aggregation changes, add a small deterministic fixture that verifies
   the affected rule. Tests should not depend on a live BEA release.
5. Include source links and explain any geography or statistical assumptions.
6. Open a pull request against `main`, describing the change and validation.

Keep generated builds, dependencies, local environment files, API keys, and
large temporary downloads out of commits. Update the lockfile when changing
dependencies. Do not add a new dependency if an existing one solves the problem
clearly.

## Geographic data

- `src/data/metro-areas.json` is generated from `data/list1_2023.xlsx` by
  `npm run build:data`.
- `src/data/states.json` contains the state definitions.
- `src/data/metro-names.zh.json` holds Chinese display names keyed by official
  metropolitan identifiers; the data generator applies these names.
- `web/data/` contains city and bay-area definitions and their display names.
- `src/bea.js`, `src/excel.js`, and `web/geography-tools.js` implement request,
  aggregation, and workbook rules.

When updating a source definition, verify the resulting county membership and
its applicable years, rather than relying on a translated name. Keep raw BEA
county names and notes available in workbook detail so results can be audited.

## License

Contributions are made under the project's [Apache License 2.0](LICENSE).
Submit only material that you have permission to contribute and retain any
required attribution.
