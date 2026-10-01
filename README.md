# U.S. BEA GDP Tools

U.S. BEA GDP Tools (Metro Studio) is a free, open-source website for querying
GDP and population data from the U.S. Bureau of Economic Analysis (BEA). It runs
in a browser on phones, tablets, and computers.

[Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
[Privacy](PRIVACY.md) · [Apache License 2.0](LICENSE)

## Features

- Five geographic levels: metropolitan areas (MSA/CSA), U.S. cities, bay areas,
  states, and the United States.
- English and Chinese interfaces, with geographic display names used in search,
  result previews, and Excel exports.
- Current-dollar GDP, real GDP in chained dollars, and population where supported
  by the selected BEA table. National GDP supports annual and quarterly periods,
  including an optional cumulative quarterly calculation.
- Batched county queries and independent aggregation for every selected metro,
  city, or bay-area definition.
- Excel (`.xlsx`) exports with area-by-year results, county detail for aggregate
  geographies, and request parameters.

## Data sources and interpretation

BEA has discontinued publishing statistics for county-aggregate geographies,
including metropolitan areas. This project helps users retrieve county records
and combine them into their own estimates. See
[BEA's explanation](https://www.bea.gov/help/faq/1481).

**Metro, city, and bay-area totals produced by this tool are project-generated
estimates, not official aggregate estimates published by BEA.** The included
city and bay-area definitions specify sets of county geographies and should
not be assumed to match municipal administrative boundaries.

MSA and CSA membership is generated from the July 2023 delineation workbook
associated with
[OMB Bulletin 23-01](https://www.whitehouse.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf).
Geographic display-name translations do not change those definitions, official
identifiers, or the underlying statistics. Raw county names and notes remain
available in the workbook detail for checking against the BEA source.

This project is not endorsed by BEA, OMB, the U.S. Census Bureau, or the United
States Government. See [NOTICE](NOTICE).

## Before you start / 使用前说明

This tool retrieves official data through the BEA API. Before running it locally
or deploying your own instance, register at the
[BEA API signup page](https://apps.bea.gov/API/signup/) and obtain an API key
issued by BEA. Configure that key on your server as described below so the tool
can authenticate its requests for official data.

Alternatively, use our hosted website. We have already configured a BEA API key
on the website's server. Simply select your query options and click the query
button to retrieve data; you do not need to apply for or enter your own key.

本工具通过 BEA 官方 API 获取数据。如果您需要在本地运行或自行部署，请先前往
[BEA API 注册页面](https://apps.bea.gov/API/signup/)注册，并获取由 BEA 颁发的 API 密钥，
再按下方说明配置到服务器，以便工具通过凭证调取官方数据。

您也可以直接使用我们的网站。网站已在服务器端配置好 BEA API 密钥，您只需选择查询条件，
点击查询即可获取数据，无需自行申请或填写密钥。

## Run from source

Install [Node.js 22 or later](https://nodejs.org/), then run:

```bash
git clone https://github.com/BillydavisUSA/U.S.-BEA-GDP-Tools.git
cd U.S.-BEA-GDP-Tools
npm ci
```

Copy `.env.example` to `.env` and set `BEA_USER_ID` to your BEA API key. This
unprefixed variable is read by the local server; it must not be renamed with a
`VITE_` prefix or committed to Git. The browser does not need to receive or
include the key in exported workbooks.

```bash
npm run dev
```

Open the local URL printed by Vite. The `/api/bea` route proxies requests to BEA.
An internet connection and a valid server API key are needed for data queries.

Build and preview the website:

```bash
npm run build
npm run preview
```

The output is written to `dist-web/`. Preview also uses the local server's
`BEA_USER_ID`. Opening the built HTML directly as a file is not a substitute
for running the server, because live queries require the API route.

If Windows PowerShell blocks `npm.ps1`, use `npm.cmd` instead.

## Deploy on Netlify

The checked-in `netlify.toml` uses these settings:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `dist-web` |
| Functions directory | `netlify/functions` |
| Node version | `22` |

Set `BEA_USER_ID` in the Netlify project's environment variables with Functions
scope for the intended deployment environment, then deploy. The function reads
the key on the server and forwards supported queries to `apps.bea.gov`.

`VITE_GITHUB_URL` optionally changes the public repository link for a fork.
This variable is public build configuration and must never contain a secret.

The home page links to Netlify. Maintainers preparing an Open Source plan
application can use [the application notes](docs/NETLIFY_OPEN_SOURCE.md).

## Development and checks

```bash
npm test
npm run build
npm run test:web-layout
```

The test suite covers request parameters, parsing, geographic aggregation, and
workbook behavior. The layout check inspects the built website at multiple
viewport widths. Its current browser runner uses Microsoft Edge on Windows.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

The main source areas are:

- `web/`: responsive UI, language strings, geographic display names, and custom
  city/bay-area definitions.
- `src/bea.js` and `src/excel.js`: data parsing, aggregation, and workbook helpers.
- `src/data/`: state definitions, metropolitan Chinese-name mappings, and
  generated metropolitan-area definitions.
- `server/bea.js`: the shared BEA proxy used by Vite and Netlify; it injects the
  server key and removes the upstream request-parameter echo.
- `netlify/functions/`: the Netlify endpoint for that proxy.
- `scripts/` and `test/`: data preparation and validation.

`node_modules/`, `dist-web/`, local `.env` files, and test artifacts are generated
or local files. They are excluded from Git. Use Git to publish changes so that
`.gitignore` is respected.

## Data rules

- Requests use BEA's JSON API. Regional tables include `CAGDP1`/`CAINC1` for
  counties and `SAGDP1`/`SAINC1` for states; national GDP uses NIPA tables.
- Search distinguishes MSA and CSA definitions. Micropolitan areas are not
  included as MSAs.
- Five-digit county GeoFIPS combine zero-padded state and county identifiers.
  Virginia's BEA combination-area identifiers are normalized where required.
- Selecting multiple aggregate geographies deduplicates the requested county
  identifiers, then computes each geography independently.
- Year-specific Connecticut city/bay-area coverage uses legacy counties through
  2023 and planning regions from 2024 onward where the definition specifies it.
- County population aggregation starts in 2001. Zero values are excluded from
  sums; nonzero parseable values remain included even when they have a `NoteRef`.
  All-zero or invalid-value totals are shown as missing data.
- Current Regional requests exclude Puerto Rico county identifiers. Affected
  aggregate definitions remain visible with missing results where applicable.
- Workbooks preserve county `DataValue`, `NoteRef`, and aggregation status for
  aggregate geographies. Request parameters are included without credentials.

## Updating metropolitan definitions

Replace `data/list1_2023.xlsx` with the intended source workbook, then run:

```bash
npm run build:data
```

This regenerates `src/data/metro-areas.json`, including names from
`src/data/metro-names.zh.json`. If a replacement workbook contains
Virginia counties and independent cities as separate rows, normalize it against
a BEA Virginia county CSV first:

```bash
npm run update:data:virginia -- "C:\path\to\Table.csv"
npm run build:data
```

Review county membership, geographic-name mappings, and applicable years before
publishing a data update.

## Community and license

Bug reports, translations, data corrections, and pull requests are welcome.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) and
[contribution guide](CONTRIBUTING.md).

The source code is licensed under [Apache License 2.0](LICENSE). Upstream data
and dependency notices remain applicable; see [NOTICE](NOTICE). The website
has no account, advertising, or analytics feature in its source code; its
hosting and request handling are described in [PRIVACY.md](PRIVACY.md).
