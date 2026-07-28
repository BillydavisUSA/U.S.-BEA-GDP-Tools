import "./styles.css";
import metroDataset from "../src/data/metro-areas.json";
import stateDataset from "../src/data/states.json";
import { buildAreaCountyRows, buildAreaYearMatrix } from "../src/excel.js";
import {
  DEFAULT_PARAMETERS,
  aggregateByAreas,
  buildBeaUrl,
  buildNipaRequestParameters,
  buildRequestParameters,
  chunkValues,
  collectAreaFips,
  filterRecordsForTable,
  mapCountryGdpRecords,
  mapStateRecords,
  parseBeaPayload,
  sanitizeFilename,
} from "../src/bea.js";

const API_ENDPOINT = "/api/bea";
const API_BATCH_SIZE = 75;
const API_CONCURRENCY = 3;
const PREVIEW_LIMIT = 5;
const COUNTRY_AREA = Object.freeze({
  id: "country-us",
  type: "country",
  code: "US",
  name: "United States",
  fips: Object.freeze([]),
});

const TABLE_CONFIG = Object.freeze({
  CAGDP1: Object.freeze({
    label: "GDP",
    filename: "BEA_Gross_Domestic_Product",
    firstYear: 2001,
    lastYear: 2024,
    defaultLineCode: "3",
    lineCodes: Object.freeze([
      Object.freeze({ value: "1", label: "Real GDP" }),
      Object.freeze({ value: "3", label: "Current-dollar GDP" }),
    ]),
  }),
  CAINC1: Object.freeze({
    label: "Population",
    filename: "BEA_Population",
    firstYear: 2001,
    lastYear: 2024,
    defaultLineCode: "2",
    lineCodes: Object.freeze([
      Object.freeze({ value: "2", label: "Population" }),
    ]),
  }),
  SAGDP1: Object.freeze({
    label: "GDP",
    filename: "BEA_State_GDP",
    firstYear: 1997,
    lastYear: 2025,
    defaultLineCode: "3",
    lineCodes: Object.freeze([
      Object.freeze({ value: "1", label: "Real GDP" }),
      Object.freeze({ value: "3", label: "Current-dollar GDP" }),
    ]),
  }),
  SAINC1: Object.freeze({
    label: "Population",
    filename: "BEA_State_Population",
    firstYear: 1929,
    lastYear: 2025,
    defaultLineCode: "2",
    lineCodes: Object.freeze([
      Object.freeze({ value: "2", label: "Population" }),
    ]),
  }),
  NIPA_GDP: Object.freeze({
    label: "GDP",
    filename: "BEA_United_States_GDP",
    firstYear: 1929,
    lastYear: 2025,
    defaultLineCode: "current",
    lineCodes: Object.freeze([
      Object.freeze({ value: "current", label: "Current-dollar GDP" }),
      Object.freeze({ value: "real", label: "Real GDP" }),
    ]),
  }),
});

const GEOGRAPHY_TABLES = Object.freeze({
  county: Object.freeze(["CAGDP1", "CAINC1"]),
  state: Object.freeze(["SAGDP1", "SAINC1"]),
  country: Object.freeze(["NIPA_GDP"]),
});

const COUNTRY_TABLES = Object.freeze({
  A: Object.freeze({
    current: Object.freeze({ tableName: "T10105", firstYear: 1929, lastYear: 2025 }),
    real: Object.freeze({ tableName: "T10106", firstYear: 1929, lastYear: 2025 }),
  }),
  Q: Object.freeze({
    current: Object.freeze({ tableName: "T80105", firstYear: 1947, lastYear: 2026 }),
    real: Object.freeze({ tableName: "T80106", firstYear: 2002, lastYear: 2026 }),
  }),
});

const elements = {
  form: document.querySelector("#query"),
  geographyLevel: document.querySelector("#geography-level"),
  coverageBadge: document.querySelector("#coverage-badge"),
  metroTypeField: document.querySelector("#metro-type-field"),
  metroTypeButtons: [...document.querySelectorAll("#metro-type button")],
  searchGroup: document.querySelector("#search-group"),
  searchLabel: document.querySelector("#search-label"),
  areaSearch: document.querySelector("#area-search"),
  clearSearch: document.querySelector("#clear-search"),
  searchResults: document.querySelector("#search-results"),
  selectionRow: document.querySelector("#selection-row"),
  selectionSummary: document.querySelector("#selection-summary"),
  selectionName: document.querySelector("#selection-name"),
  selectionDetail: document.querySelector("#selection-detail"),
  clearSelection: document.querySelector("#clear-selection"),
  selectAll: document.querySelector("#select-all"),
  selectAllLabel: document.querySelector("#select-all-label"),
  selectAllCount: document.querySelector("#select-all-count"),
  countrySummary: document.querySelector("#country-summary"),
  scopeError: document.querySelector("#scope-error"),
  tableName: document.querySelector("#table-name"),
  lineCode: document.querySelector("#line-code"),
  frequencyField: document.querySelector("#frequency-field"),
  frequency: document.querySelector("#frequency"),
  quarterlyModeField: document.querySelector("#quarterly-mode-field"),
  quarterlyMode: document.querySelector("#quarterly-mode"),
  year: document.querySelector("#year"),
  filename: document.querySelector("#filename"),
  runQuery: document.querySelector("#run-query"),
  exportButton: document.querySelector("#export-button"),
  results: document.querySelector("#results"),
  resultsSubtitle: document.querySelector("#results-subtitle"),
  emptyState: document.querySelector("#empty-state"),
  loadingState: document.querySelector("#loading-state"),
  loadingMessage: document.querySelector("#loading-message"),
  errorState: document.querySelector("#error-state"),
  errorMessage: document.querySelector("#error-message"),
  successState: document.querySelector("#success-state"),
  resultScope: document.querySelector("#result-scope"),
  resultRecords: document.querySelector("#result-records"),
  resultPeriods: document.querySelector("#result-periods"),
  resultMissing: document.querySelector("#result-missing"),
  metricHeading: document.querySelector("#metric-heading"),
  resultBody: document.querySelector("#result-body"),
  previewNote: document.querySelector("#preview-note"),
  githubLink: document.querySelector("#github-link"),
  toast: document.querySelector("#toast"),
};

const state = {
  areaType: "all",
  selectionMode: "",
  selectedAreas: [],
  status: "idle",
  records: [],
  aggregated: [],
  resultAreas: [],
  resultLevel: "county",
  parameters: null,
  queryContext: null,
  meta: {},
  source: "",
  unsupportedFips: [],
  controller: null,
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

function configureGithubLink() {
  const candidate = String(
    import.meta.env.VITE_GITHUB_URL
      ?? "https://github.com/BillydavisUSA/U.S.-BEA-GDP-Tools",
  ).trim();
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" && ["github.com", "www.github.com"].includes(url.hostname)) {
      elements.githubLink.href = url.href;
    }
  } catch {
    // Keep the repository link already present in the document.
  }
}

function getTableConfig(tableName = elements.tableName.value) {
  return TABLE_CONFIG[tableName] ?? TABLE_CONFIG.CAGDP1;
}

function getCountryTableSelection() {
  const frequency = elements.frequency.value === "Q" ? "Q" : "A";
  const measure = elements.lineCode.value === "real" ? "real" : "current";
  return { frequency, measure, ...COUNTRY_TABLES[frequency][measure] };
}

function getMetricLabel(lineCode = elements.lineCode.value, tableName = elements.tableName.value) {
  const normalizedTable = String(tableName).toUpperCase();
  if (normalizedTable.endsWith("INC1")) return "Population";
  if (/^T(?:101|801)05$/u.test(normalizedTable)) return "Current-dollar GDP";
  if (/^T(?:101|801)06$/u.test(normalizedTable)) return "Real GDP";
  return String(lineCode) === "1" ? "Real GDP" : "Current-dollar GDP";
}

function getUnitLabel(unit, tableName = elements.tableName.value) {
  const normalizedTable = String(tableName).toUpperCase();
  if (normalizedTable.endsWith("INC1")) return "persons";
  if (/^T(?:101|801)0[56]$/u.test(normalizedTable)) return unit || "millions of dollars";
  return unit === "Thousands of dollars" ? "thousands of dollars" : unit || "thousands of dollars";
}

function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function getAvailableAreas() {
  const level = elements.geographyLevel.value;
  if (level === "state") return stateDataset.areas;
  if (level === "country") return [COUNTRY_AREA];
  return state.areaType === "all"
    ? metroDataset.areas
    : metroDataset.areas.filter((area) => area.type === state.areaType);
}

function closeSearchResults() {
  elements.searchResults.hidden = true;
  elements.areaSearch.setAttribute("aria-expanded", "false");
}

function setStatus(status, message = "") {
  state.status = status;
  elements.emptyState.hidden = status !== "idle";
  elements.loadingState.hidden = status !== "loading";
  elements.errorState.hidden = status !== "error";
  elements.successState.hidden = status !== "success";
  elements.exportButton.disabled = status !== "success";
  elements.runQuery.disabled = status === "loading";
  elements.runQuery.querySelector("span").textContent = status === "loading"
    ? "Running query…"
    : "Run query";
  if (status === "error") elements.errorMessage.textContent = message;
}

function resetResult() {
  if (state.status !== "idle") {
    state.records = [];
    state.aggregated = [];
    state.resultAreas = [];
    setStatus("idle");
    elements.resultsSubtitle.textContent = "Choose a geography and measure, then run the query.";
  }
}

function setSelectedAreas(areas, mode) {
  state.selectedAreas = areas;
  state.selectionMode = mode;
  elements.scopeError.textContent = "";
  renderSelection();
  resetResult();
}

function renderSelection() {
  const level = elements.geographyLevel.value;
  if (level === "country") {
    elements.selectionSummary.hidden = true;
    return;
  }
  if (state.selectedAreas.length === 0) {
    elements.selectionSummary.hidden = true;
    return;
  }

  const allSelected = state.selectionMode === "all";
  const area = state.selectedAreas[0];
  elements.selectionSummary.hidden = false;
  elements.selectionName.textContent = allSelected
    ? level === "state"
      ? "All states"
      : state.areaType === "msa"
        ? "All metropolitan statistical areas"
        : state.areaType === "csa"
          ? "All combined statistical areas"
          : "All metro areas"
    : area.name;
  elements.selectionDetail.textContent = allSelected
    ? `${state.selectedAreas.length} ${level === "state" ? "states" : "areas"} selected`
    : area.type === "state"
      ? `State FIPS ${area.code}`
      : `${area.type.toUpperCase()} ${area.code} · ${area.fips.length} county geographies`;
}

function renderScopeControls(clearSelection = true) {
  const level = elements.geographyLevel.value;
  const isCounty = level === "county";
  const isState = level === "state";
  const isCountry = level === "country";
  elements.metroTypeField.hidden = !isCounty;
  elements.searchGroup.hidden = isCountry;
  elements.selectionRow.hidden = isCountry;
  elements.countrySummary.hidden = !isCountry;
  elements.coverageBadge.textContent = isCountry
    ? "1 country"
    : isState ? `${stateDataset.areas.length} states` : `${metroDataset.areas.length} areas`;
  elements.searchLabel.textContent = isState ? "Search states" : "Search metro areas";
  elements.areaSearch.placeholder = isState
    ? "e.g. New York or 36"
    : "e.g. New York or 35620";
  elements.areaSearch.value = "";
  elements.clearSearch.hidden = true;
  closeSearchResults();

  if (clearSelection) {
    setSelectedAreas(isCountry ? [COUNTRY_AREA] : [], isCountry ? "fixed" : "");
  }
  renderSelectAll();
}

function renderSelectAll() {
  const level = elements.geographyLevel.value;
  const areas = getAvailableAreas();
  elements.selectAllLabel.textContent = level === "state"
    ? "Select all states"
    : state.areaType === "msa"
      ? "Select all metropolitan statistical areas"
      : state.areaType === "csa"
        ? "Select all combined statistical areas"
        : "Select all metro areas";
  elements.selectAllCount.textContent = `${areas.length} ${level === "state" ? "states" : "areas"}`;
}

function createSearchResult(area) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-result";
  button.setAttribute("role", "option");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const detail = document.createElement("small");
  name.textContent = area.name;
  detail.textContent = area.type === "state"
    ? `State FIPS ${area.code}`
    : `${area.type.toUpperCase()} ${area.code} · ${area.fips.length} counties`;
  copy.append(name, detail);
  const badge = document.createElement("span");
  badge.className = "type-badge";
  badge.textContent = area.type.toUpperCase();
  button.append(copy, badge);
  button.addEventListener("click", () => {
    setSelectedAreas([area], "single");
    elements.areaSearch.value = area.name;
    elements.clearSearch.hidden = false;
    closeSearchResults();
  });
  return button;
}

function renderSearchResults() {
  const query = normalizeSearch(elements.areaSearch.value);
  elements.clearSearch.hidden = !query;
  if (!query) {
    closeSearchResults();
    return;
  }
  const matches = getAvailableAreas()
    .filter((area) => normalizeSearch(`${area.name} ${area.code}`).includes(query))
    .slice(0, 20);
  elements.searchResults.replaceChildren(
    ...(matches.length
      ? matches.map(createSearchResult)
      : [Object.assign(document.createElement("p"), {
          className: "search-empty",
          textContent: "No matching geography found.",
        })]),
  );
  elements.searchResults.hidden = false;
  elements.areaSearch.setAttribute("aria-expanded", "true");
}

function setAreaType(type) {
  if (!["all", "msa", "csa"].includes(type)) return;
  state.areaType = type;
  elements.metroTypeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.type === type));
  });
  if (state.selectionMode === "all") setSelectedAreas(getAvailableAreas(), "all");
  else if (
    state.selectedAreas.length
    && type !== "all"
    && state.selectedAreas[0].type !== type
  ) {
    setSelectedAreas([], "");
  }
  renderSelectAll();
  renderSearchResults();
}

function syncMeasureControls(updateFilename = true) {
  const level = elements.geographyLevel.value;
  const previousTable = elements.tableName.value;
  const previousKind = previousTable.endsWith("INC1") ? "population" : "gdp";
  const allowed = GEOGRAPHY_TABLES[level];
  elements.tableName.replaceChildren(...allowed.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = TABLE_CONFIG[value].label;
    return option;
  }));
  elements.tableName.value = level === "country"
    ? "NIPA_GDP"
    : allowed.find((value) => (
        previousKind === "population" ? value.endsWith("INC1") : value.endsWith("GDP1")
      )) ?? allowed[0];
  syncLineCodeControls(updateFilename);
}

function syncLineCodeControls(updateFilename = true) {
  const config = getTableConfig();
  const previous = elements.lineCode.value;
  elements.lineCode.replaceChildren(...config.lineCodes.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.lineCode.value = config.lineCodes.some(({ value }) => value === previous)
    ? previous
    : config.defaultLineCode;
  syncFrequencyControls();
  syncYearControls();
  if (updateFilename) elements.filename.value = config.filename;
  resetResult();
}

function syncFrequencyControls() {
  const isCountry = elements.geographyLevel.value === "country";
  elements.frequencyField.hidden = !isCountry;
  elements.quarterlyModeField.hidden = !isCountry || elements.frequency.value !== "Q";
}

function syncYearControls() {
  const config = elements.geographyLevel.value === "country"
    ? getCountryTableSelection()
    : getTableConfig();
  const previous = elements.year.value || "ALL";
  const choices = [
    ["ALL", `All years (${config.firstYear}–${config.lastYear})`],
    ["LAST5", "Latest 5 years"],
    ["LAST10", "Latest 10 years"],
  ];
  for (let year = config.lastYear; year >= config.firstYear; year -= 1) {
    choices.push([String(year), String(year)]);
  }
  elements.year.replaceChildren(...choices.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.year.value = choices.some(([value]) => value === previous) ? previous : "ALL";
}

function validateQuery() {
  elements.scopeError.textContent = "";
  if (elements.geographyLevel.value !== "country" && state.selectedAreas.length === 0) {
    elements.scopeError.textContent = elements.geographyLevel.value === "state"
      ? "Select a state or choose all states."
      : "Select a metro area or choose all metro areas.";
    elements.searchGroup.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.areaSearch.focus();
    return false;
  }
  return true;
}

function buildQueryParameters(fips) {
  if (elements.geographyLevel.value === "country") {
    const table = getCountryTableSelection();
    return buildNipaRequestParameters({
      tableName: table.tableName,
      frequency: table.frequency,
      year: elements.year.value,
      firstYear: table.firstYear,
      lastYear: table.lastYear,
    });
  }
  return buildRequestParameters({
    datasetName: "REGIONAL",
    geoFips: fips.join(","),
    lineCode: elements.lineCode.value,
    tableName: elements.tableName.value,
    year: elements.year.value,
  });
}

async function fetchBatch(parameters, codes, signal) {
  const requestParameters = codes ? { ...parameters, GEOFIPS: codes.join(",") } : parameters;
  const response = await fetch(buildBeaUrl(requestParameters, API_ENDPOINT), {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`BEA API request failed (HTTP ${response.status}).`);
  return parseBeaPayload(await response.json());
}

function buildResultAreas(aggregated, areas, level) {
  if (level === "country") return [COUNTRY_AREA];
  if (level !== "state") return areas;
  return [...new Map(aggregated.map((row) => [
    row.areaId,
    {
      id: row.areaId,
      type: "state",
      code: row.areaCode,
      name: row.areaName,
      fips: [`${row.areaCode}000`],
    },
  ])).values()];
}

function showResults(parsedBatches, parameters, areas, queryContext) {
  const records = filterRecordsForTable(
    parsedBatches.flatMap((batch) => batch.records),
    parameters.TABLENAME,
  );
  const level = elements.geographyLevel.value;
  const periods = [...new Set(records.map((record) => String(record.TimePeriod ?? "").trim()))];
  const aggregated = level === "country"
    ? mapCountryGdpRecords(records, {
        cumulativeQuarterly: Boolean(queryContext?.cumulativeQuarterly),
      })
    : level === "state"
      ? mapStateRecords(records, collectAreaFips(areas))
      : aggregateByAreas(records, areas, periods);
  if (!aggregated.length) {
    throw new Error("No records matched the selected geography, measure, and year.");
  }

  state.records = records;
  state.aggregated = aggregated;
  state.resultAreas = buildResultAreas(aggregated, areas, level);
  state.resultLevel = level;
  state.parameters = parameters;
  state.queryContext = queryContext;
  state.meta = parsedBatches[0]?.meta ?? {};
  state.source = "BEA API";

  const missing = aggregated.filter((row) => row.status === "missing").length;
  const periodCount = new Set(aggregated.map((row) => row.year)).size;
  const scope = level === "country"
    ? "United States"
    : state.resultAreas.length === 1
      ? state.resultAreas[0].name
      : level === "state"
        ? "All states"
        : state.areaType === "msa"
          ? "All MSAs"
          : state.areaType === "csa" ? "All CSAs" : "All metro areas";
  elements.resultScope.textContent = scope;
  elements.resultRecords.textContent = numberFormatter.format(records.length);
  elements.resultPeriods.textContent = numberFormatter.format(periodCount);
  elements.resultMissing.textContent = numberFormatter.format(missing);
  elements.metricHeading.textContent = `${getMetricLabel(parameters.LINECODE, parameters.TABLENAME)} (${getUnitLabel(state.meta.unit, parameters.TABLENAME)})`;
  elements.resultsSubtitle.textContent = `${scope} · ${getMetricLabel(parameters.LINECODE, parameters.TABLENAME)}`;
  renderPreview();
  setStatus("success");
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPreview() {
  elements.resultBody.replaceChildren(...state.aggregated.slice(0, PREVIEW_LIMIT).map((row) => {
    const tr = document.createElement("tr");
    const values = [
      row.areaName,
      row.areaType.toUpperCase(),
      row.year,
      row.status === "ok" ? numberFormatter.format(row.total) : "No data",
    ];
    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `row-status ${row.status === "ok" ? "ok" : "missing"}`;
    status.textContent = row.status === "ok"
      ? state.resultLevel === "country"
        ? row.calculated ? "Calculated" : "Reported"
        : state.resultLevel === "state" ? "Reported" : "Aggregated"
      : "No data";
    statusCell.append(status);
    tr.append(statusCell);
    return tr;
  }));
  elements.previewNote.textContent = state.aggregated.length > PREVIEW_LIMIT
    ? `Showing 5 of ${numberFormatter.format(state.aggregated.length)} rows. Export the workbook to view the complete dataset.`
    : `Showing all ${numberFormatter.format(state.aggregated.length)} rows.`;
}

async function runQuery() {
  if (!validateQuery()) return;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  setStatus("loading");
  elements.resultsSubtitle.textContent = "Loading official BEA data…";

  const level = elements.geographyLevel.value;
  const allFips = collectAreaFips(state.selectedAreas);
  const fips = level === "country"
    ? []
    : level === "state" && state.selectionMode === "all"
      ? ["STATE"]
      : allFips.filter((code) => !code.startsWith("72"));
  state.unsupportedFips = level === "county"
    ? allFips.filter((code) => code.startsWith("72"))
    : [];
  const parameters = buildQueryParameters(fips);
  const batches = level === "country"
    ? [null]
    : level === "state" ? [fips] : chunkValues(fips, API_BATCH_SIZE);
  const queryContext = level === "country"
    ? {
        cumulativeQuarterly:
          elements.frequency.value === "Q"
          && elements.quarterlyMode.value === "cumulative",
      }
    : null;
  elements.loadingMessage.textContent = level === "country"
    ? "Loading United States NIPA records."
    : `Loading ${batches.length} request ${batches.length === 1 ? "batch" : "batches"}.`;

  try {
    const parsedBatches = new Array(batches.length);
    let nextBatch = 0;
    let completed = 0;
    async function worker() {
      while (nextBatch < batches.length) {
        const index = nextBatch;
        nextBatch += 1;
        parsedBatches[index] = await fetchBatch(parameters, batches[index], controller.signal);
        completed += 1;
        elements.loadingMessage.textContent = `Completed ${completed} of ${batches.length} request batches.`;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(API_CONCURRENCY, batches.length) }, () => worker()),
    );
    showResults(parsedBatches, parameters, state.selectedAreas, queryContext);
  } catch (error) {
    if (error.name === "AbortError") return;
    const message = `${error.message || "Unable to load data."} Check the selection and try again.`;
    setStatus("error", message);
    elements.resultsSubtitle.textContent = "The query did not complete.";
  } finally {
    if (state.controller === controller) state.controller = null;
  }
}

function buildParameterRows() {
  const parameters = state.parameters ?? {};
  return [
    ["Parameter", "Description", "Value"],
    ["METHOD", "Request method", parameters.METHOD || "GETDATA"],
    ["DATASETNAME", "Dataset", parameters.DATASETNAME || "REGIONAL"],
    ["AREA_SCOPE", "Selected geographic scope", elements.resultScope.textContent],
    ["TABLENAME", "BEA table", parameters.TABLENAME || ""],
    ["LINECODE", "Measure line", parameters.LINECODE || "LineNumber 1"],
    ["FREQUENCY", "Frequency", parameters.FREQUENCY || "Annual"],
    ["YEAR", "Years", parameters.YEAR || "ALL"],
    ["UNIT", "DataValue unit", getUnitLabel(state.meta.unit, parameters.TABLENAME)],
    ["SOURCE", "Data source", state.source],
    ["BOUNDARIES", "Metro-area definitions", state.resultLevel === "county" ? metroDataset.source : "Not applicable"],
  ];
}

async function exportExcel() {
  if (state.status !== "success") return;
  elements.exportButton.disabled = true;
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const groups = state.resultLevel === "country"
      ? [{ type: "country", label: "Country" }]
      : state.resultLevel === "state"
        ? [{ type: "state", label: "State" }]
        : [
            { type: "msa", label: "Metropolitan Statistical Area" },
            { type: "csa", label: "Combined Statistical Area" },
          ];
    groups.forEach(({ type, label }) => {
      const rows = state.aggregated.filter((row) => row.areaType === type);
      if (!rows.length) return;
      const matrix = buildAreaYearMatrix(
        rows,
        label,
        `${getMetricLabel(state.parameters.LINECODE, state.parameters.TABLENAME)} (${getUnitLabel(state.meta.unit, state.parameters.TABLENAME)})`,
        state.resultLevel === "county" ? "Metro area type" : "Geographic level",
      );
      const sheet = XLSX.utils.aoa_to_sheet(matrix.rows);
      sheet["!cols"] = [{ wch: 48 }, ...matrix.years.map(() => ({ wch: 15 }))];
      sheet["!autofilter"] = {
        ref: `A3:${XLSX.utils.encode_col(matrix.years.length)}${matrix.rows.length}`,
      };
      XLSX.utils.book_append_sheet(workbook, sheet, label);
    });

    if (state.resultLevel === "county") {
      const countyRows = buildAreaCountyRows(
        state.records,
        state.resultAreas,
        state.aggregated.map((row) => row.year),
      );
      if (countyRows.length) {
        const sheet = XLSX.utils.aoa_to_sheet(countyRows);
        sheet["!cols"] = [
          { wch: 12 }, { wch: 46 }, { wch: 12 }, { wch: 15 }, { wch: 32 },
          { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
        ];
        sheet["!autofilter"] = { ref: `A1:I${countyRows.length}` };
        XLSX.utils.book_append_sheet(workbook, sheet, "Metro Area County Data");
      }
    }
    const parameterSheet = XLSX.utils.aoa_to_sheet(buildParameterRows());
    parameterSheet["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, parameterSheet, "Request Parameters");
    XLSX.writeFile(workbook, `${sanitizeFilename(elements.filename.value)}.xlsx`, {
      compression: true,
    });
    showToast("Excel workbook created.");
  } catch (error) {
    setStatus("error", `Unable to create the Excel workbook: ${error.message}`);
  } finally {
    elements.exportButton.disabled = state.status !== "success";
  }
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runQuery();
});
elements.geographyLevel.addEventListener("change", () => {
  renderScopeControls(true);
  syncMeasureControls(true);
});
elements.metroTypeButtons.forEach((button) => {
  button.addEventListener("click", () => setAreaType(button.dataset.type));
});
elements.areaSearch.addEventListener("input", renderSearchResults);
elements.areaSearch.addEventListener("focus", renderSearchResults);
elements.areaSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSearchResults();
});
elements.clearSearch.addEventListener("click", () => {
  elements.areaSearch.value = "";
  elements.clearSearch.hidden = true;
  closeSearchResults();
  elements.areaSearch.focus();
});
elements.clearSelection.addEventListener("click", () => {
  setSelectedAreas([], "");
  elements.areaSearch.value = "";
  elements.clearSearch.hidden = true;
});
elements.selectAll.addEventListener("click", () => {
  setSelectedAreas(getAvailableAreas(), "all");
  closeSearchResults();
});
elements.tableName.addEventListener("change", () => syncLineCodeControls(true));
elements.lineCode.addEventListener("change", () => {
  if (elements.geographyLevel.value === "country") syncYearControls();
  resetResult();
});
elements.frequency.addEventListener("change", () => {
  syncFrequencyControls();
  syncYearControls();
  resetResult();
});
elements.quarterlyMode.addEventListener("change", resetResult);
elements.year.addEventListener("change", resetResult);
elements.exportButton.addEventListener("click", exportExcel);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-group")) closeSearchResults();
});

configureGithubLink();
renderScopeControls(false);
setSelectedAreas([], "");
syncMeasureControls(true);
setStatus("idle");
