import "./styles.css";
import { createI18n } from "./i18n.js";
import metroDataset from "../src/data/metro-areas.json";
import stateDataset from "../src/data/states.json";
import citySource from "./data/bea-us-city-geofips.json";
import bayAreaSource from "./data/bea-us-bay-area-geofips.json";
import { buildAreaCountyRows, buildAreaYearMatrix } from "../src/excel.js";
import {
  aggregateByAreasWithCoverage,
  buildGeographyCountyRows,
  createCustomAreas,
  isAggregatedGeographyLevel,
} from "./geography-tools.js";
import {
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
const i18n = createI18n();
const t = (key, parameters) => i18n.t(key, parameters);
const cityDataset = Object.freeze({
  source: citySource.source,
  areas: createCustomAreas(citySource.cities, "city"),
});
const bayAreaDataset = Object.freeze({
  source: bayAreaSource.geoFipsSource,
  areas: createCustomAreas(bayAreaSource.bayAreas, "bay-area"),
});
const COUNTRY_AREA = Object.freeze({
  id: "country-us",
  type: "country",
  code: "US",
  name: "United States",
  fips: Object.freeze([]),
});

const TABLE_CONFIG = Object.freeze({
  CAGDP1: Object.freeze({
    labelKey: "measure.gdp",
    filename: "BEA_Gross_Domestic_Product",
    firstYear: 2001,
    lastYear: 2024,
    defaultLineCode: "3",
    lineCodes: Object.freeze([
      Object.freeze({ value: "1", labelKey: "measure.realGdp" }),
      Object.freeze({ value: "3", labelKey: "measure.currentGdp" }),
    ]),
  }),
  CAINC1: Object.freeze({
    labelKey: "measure.population",
    filename: "BEA_Population",
    firstYear: 2001,
    lastYear: 2024,
    defaultLineCode: "2",
    lineCodes: Object.freeze([
      Object.freeze({ value: "2", labelKey: "measure.population" }),
    ]),
  }),
  SAGDP1: Object.freeze({
    labelKey: "measure.gdp",
    filename: "BEA_State_GDP",
    firstYear: 1997,
    lastYear: 2025,
    defaultLineCode: "3",
    lineCodes: Object.freeze([
      Object.freeze({ value: "1", labelKey: "measure.realGdp" }),
      Object.freeze({ value: "3", labelKey: "measure.currentGdp" }),
    ]),
  }),
  SAINC1: Object.freeze({
    labelKey: "measure.population",
    filename: "BEA_State_Population",
    firstYear: 1929,
    lastYear: 2025,
    defaultLineCode: "2",
    lineCodes: Object.freeze([
      Object.freeze({ value: "2", labelKey: "measure.population" }),
    ]),
  }),
  NIPA_GDP: Object.freeze({
    labelKey: "measure.gdp",
    filename: "BEA_United_States_GDP",
    firstYear: 1929,
    lastYear: 2025,
    defaultLineCode: "current",
    lineCodes: Object.freeze([
      Object.freeze({ value: "current", labelKey: "measure.currentGdp" }),
      Object.freeze({ value: "real", labelKey: "measure.realGdp" }),
    ]),
  }),
});

const GEOGRAPHY_TABLES = Object.freeze({
  metro: Object.freeze(["CAGDP1", "CAINC1"]),
  city: Object.freeze(["CAGDP1", "CAINC1"]),
  "bay-area": Object.freeze(["CAGDP1", "CAINC1"]),
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
  languageToggle: document.querySelector("#language-toggle"),
  languageToggleLabel: document.querySelector("#language-toggle-label"),
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
  resultLevel: "metro",
  parameters: null,
  queryContext: null,
  meta: {},
  source: "",
  unsupportedFips: [],
  controller: null,
  errorMessage: "",
  loadingCompleted: 0,
  loadingTotal: 0,
};

function formatNumber(value) {
  return new Intl.NumberFormat(i18n.language === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 4,
  }).format(value);
}

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
  if (normalizedTable.endsWith("INC1")) return t("measure.population");
  if (/^T(?:101|801)05$/u.test(normalizedTable)) return t("measure.currentGdp");
  if (/^T(?:101|801)06$/u.test(normalizedTable)) return t("measure.realGdp");
  return String(lineCode) === "1" ? t("measure.realGdp") : t("measure.currentGdp");
}

function getUnitLabel(unit, tableName = elements.tableName.value) {
  const normalizedTable = String(tableName).toUpperCase();
  if (normalizedTable.endsWith("INC1")) return t("unit.persons");
  if (/^T(?:101|801)0[56]$/u.test(normalizedTable)) {
    return !unit || /millions of dollars/iu.test(unit) ? t("unit.millions") : unit;
  }
  return !unit || /thousands of dollars/iu.test(unit) ? t("unit.thousands") : unit;
}

function getAreaName(area) {
  if (area?.type === "country") return t("scope.countryName");
  if (i18n.language === "zh" && area?.nameZh) return area.nameZh;
  return area?.name ?? "";
}

function getAreaDetail(area) {
  if (area.type === "state") return t("scope.stateFips", { code: area.code });
  return t("scope.countyGeographies", {
    type: [getAreaTypeLabel(area.type), area.code].filter(Boolean).join(" "),
    count: formatNumber(area.fips.length),
  });
}

function getAreaTypeLabel(type) {
  const key = {
    msa: "type.msa",
    csa: "type.csa",
    city: "type.city",
    "bay-area": "type.bayArea",
    state: "type.state",
    country: "type.country",
  }[type];
  return key ? t(key) : String(type ?? "").toUpperCase();
}

function getDatasetForLevel(level) {
  if (level === "metro") return metroDataset;
  if (level === "city") return cityDataset;
  if (level === "bay-area") return bayAreaDataset;
  if (level === "state") return stateDataset;
  return null;
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
  if (level === "country") return [COUNTRY_AREA];
  const areas = getDatasetForLevel(level)?.areas ?? [];
  if (level !== "metro" || state.areaType === "all") return areas;
  return areas.filter((area) => area.type === state.areaType);
}

function closeSearchResults() {
  elements.searchResults.hidden = true;
  elements.areaSearch.setAttribute("aria-expanded", "false");
}

function setStatus(status, message = "") {
  state.status = status;
  state.errorMessage = status === "error" ? message : "";
  elements.emptyState.hidden = status !== "idle";
  elements.loadingState.hidden = status !== "loading";
  elements.errorState.hidden = status !== "error";
  elements.successState.hidden = status !== "success";
  elements.exportButton.disabled = status !== "success";
  elements.runQuery.disabled = status === "loading";
  elements.runQuery.querySelector("span").textContent = status === "loading"
    ? t("output.running")
    : t("output.run");
  if (status === "error") elements.errorMessage.textContent = message;
}

function resetResult() {
  if (state.status !== "idle") {
    state.records = [];
    state.aggregated = [];
    state.resultAreas = [];
    setStatus("idle");
    elements.resultsSubtitle.textContent = t("results.idleSubtitle");
  }
}

function setSelectedAreas(areas, mode) {
  state.selectedAreas = areas;
  state.selectionMode = mode;
  elements.scopeError.textContent = "";
  renderSelection();
  resetResult();
}

function getAllSelectionLabel(level) {
  if (level === "state") return t("scope.allStates");
  if (level === "city") return t("scope.allCities");
  if (level === "bay-area") return t("scope.allBayAreas");
  if (state.areaType === "msa") return t("scope.allMsas");
  if (state.areaType === "csa") return t("scope.allCsas");
  return t("scope.allMetros");
}

function getSelectAllLabel(level) {
  if (level === "state") return t("scope.selectAllStates");
  if (level === "city") return t("scope.selectAllCities");
  if (level === "bay-area") return t("scope.selectAllBayAreas");
  if (state.areaType === "msa") return t("scope.selectAllMsas");
  if (state.areaType === "csa") return t("scope.selectAllCsas");
  return t("scope.selectAllMetros");
}

function getCountMessage(level, count) {
  const key = level === "state"
    ? "scope.stateCount"
    : level === "city"
      ? "scope.cityCount"
      : level === "bay-area" ? "scope.bayAreaCount" : "scope.areaCount";
  return t(key, { count: formatNumber(count) });
}

function getSearchCopy(level) {
  if (level === "state") {
    return { label: t("scope.searchStates"), placeholder: t("scope.statePlaceholder") };
  }
  if (level === "city") {
    return { label: t("scope.searchCities"), placeholder: t("scope.cityPlaceholder") };
  }
  if (level === "bay-area") {
    return { label: t("scope.searchBayAreas"), placeholder: t("scope.bayAreaPlaceholder") };
  }
  return { label: t("scope.searchMetro"), placeholder: t("scope.metroPlaceholder") };
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
    ? getAllSelectionLabel(level)
    : getAreaName(area);
  elements.selectionDetail.textContent = allSelected
    ? t(level === "state" ? "scope.stateSelected" : "scope.areaSelected", {
        count: formatNumber(state.selectedAreas.length),
      })
    : getAreaDetail(area);
}

function renderScopeControls(clearSelection = true, resetSearch = true) {
  const level = elements.geographyLevel.value;
  const isMetro = level === "metro";
  const isCountry = level === "country";
  const dataset = getDatasetForLevel(level);
  const searchCopy = getSearchCopy(level);
  elements.metroTypeField.hidden = !isMetro;
  elements.searchGroup.hidden = isCountry;
  elements.selectionRow.hidden = isCountry;
  elements.countrySummary.hidden = !isCountry;
  elements.coverageBadge.textContent = isCountry
    ? t("scope.oneCountry")
    : getCountMessage(level, dataset?.areas.length ?? 0);
  elements.searchLabel.textContent = searchCopy.label;
  elements.areaSearch.placeholder = searchCopy.placeholder;
  if (resetSearch) {
    elements.areaSearch.value = "";
    elements.clearSearch.hidden = true;
    closeSearchResults();
  }

  if (clearSelection) {
    setSelectedAreas(isCountry ? [COUNTRY_AREA] : [], isCountry ? "fixed" : "");
  }
  renderSelectAll();
}

function renderSelectAll() {
  const level = elements.geographyLevel.value;
  const areas = getAvailableAreas();
  elements.selectAllLabel.textContent = getSelectAllLabel(level);
  elements.selectAllCount.textContent = getCountMessage(level, areas.length);
}

function createSearchResult(area) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-result";
  button.setAttribute("role", "option");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const detail = document.createElement("small");
  name.textContent = getAreaName(area);
  detail.textContent = getAreaDetail(area);
  copy.append(name, detail);
  const badge = document.createElement("span");
  badge.className = "type-badge";
  badge.textContent = getAreaTypeLabel(area.type);
  button.append(copy, badge);
  button.addEventListener("click", () => {
    setSelectedAreas([area], "single");
    elements.areaSearch.value = getAreaName(area);
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
    .filter((area) => normalizeSearch(
      `${area.name} ${area.nameZh ?? ""} ${area.code ?? ""} ${(area.fips ?? []).join(" ")}`,
    ).includes(query))
    .slice(0, 20);
  elements.searchResults.replaceChildren(
    ...(matches.length
      ? matches.map(createSearchResult)
      : [Object.assign(document.createElement("p"), {
          className: "search-empty",
          textContent: t("scope.noMatch"),
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
    option.textContent = t(TABLE_CONFIG[value].labelKey);
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
  elements.lineCode.replaceChildren(...config.lineCodes.map(({ value, labelKey }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(labelKey);
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
    ["ALL", t("measure.allYears", { first: config.firstYear, last: config.lastYear })],
    ["LAST5", t("measure.latest5")],
    ["LAST10", t("measure.latest10")],
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
    const key = {
      state: "scope.validationState",
      city: "scope.validationCity",
      "bay-area": "scope.validationBayArea",
      metro: "scope.validationMetro",
    }[elements.geographyLevel.value];
    elements.scopeError.textContent = t(key ?? "scope.validationMetro");
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
  if (!response.ok) throw new Error(t("error.http", { status: response.status }));
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
      nameZh: areas.find((area) => area.code === row.areaCode)?.nameZh,
      fips: [`${row.areaCode}000`],
    },
  ])).values()];
}

function getResultScopeLabel() {
  if (state.resultLevel === "country") return t("scope.countryName");
  if (state.resultAreas.length === 1) return getAreaName(state.resultAreas[0]);
  if (state.resultLevel === "state") return t("results.allStates");
  if (state.resultLevel === "city") return t("results.allCities");
  if (state.resultLevel === "bay-area") return t("results.allBayAreas");
  if (state.areaType === "msa") return t("results.allMsas");
  if (state.areaType === "csa") return t("results.allCsas");
  return t("results.allMetros");
}

function renderResultSummary() {
  const scope = getResultScopeLabel();
  const missing = state.aggregated.filter((row) => row.status === "missing").length;
  const periodCount = new Set(state.aggregated.map((row) => row.year)).size;
  elements.resultScope.textContent = scope;
  elements.resultRecords.textContent = formatNumber(state.records.length);
  elements.resultPeriods.textContent = formatNumber(periodCount);
  elements.resultMissing.textContent = formatNumber(missing);
  elements.metricHeading.textContent =
    `${getMetricLabel(state.parameters?.LINECODE, state.parameters?.TABLENAME)} `
    + `(${getUnitLabel(state.meta.unit, state.parameters?.TABLENAME)})`;
  elements.resultsSubtitle.textContent =
    `${scope} · ${getMetricLabel(state.parameters?.LINECODE, state.parameters?.TABLENAME)}`;
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
      : aggregateByAreasWithCoverage(records, areas, periods);
  if (!aggregated.length) {
    throw new Error(t("error.noRecords"));
  }

  state.records = records;
  state.aggregated = aggregated;
  state.resultAreas = buildResultAreas(aggregated, areas, level);
  state.resultLevel = level;
  state.parameters = parameters;
  state.queryContext = queryContext;
  state.meta = parsedBatches[0]?.meta ?? {};
  state.source = "BEA API";

  renderResultSummary();
  renderPreview();
  setStatus("success");
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPreview() {
  elements.resultBody.replaceChildren(...state.aggregated.slice(0, PREVIEW_LIMIT).map((row) => {
    const tr = document.createElement("tr");
    const values = [
      getAreaName(state.resultAreas.find((area) => area.id === row.areaId)) || row.areaName,
      getAreaTypeLabel(row.areaType),
      row.year,
      row.status === "ok" ? formatNumber(row.total) : t("results.noData"),
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
        ? row.calculated ? t("results.calculated") : t("results.reported")
        : state.resultLevel === "state" ? t("results.reported") : t("results.aggregated")
      : t("results.noData");
    statusCell.append(status);
    tr.append(statusCell);
    return tr;
  }));
  elements.previewNote.textContent = state.aggregated.length > PREVIEW_LIMIT
    ? t("results.showingPartial", { count: formatNumber(state.aggregated.length) })
    : t("results.showingAll", { count: formatNumber(state.aggregated.length) });
}

async function runQuery() {
  if (!validateQuery()) return;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  setStatus("loading");
  elements.resultsSubtitle.textContent = t("results.loadingSubtitle");

  const level = elements.geographyLevel.value;
  const allFips = collectAreaFips(state.selectedAreas);
  const fips = level === "country"
    ? []
    : level === "state" && state.selectionMode === "all"
      ? ["STATE"]
      : allFips.filter((code) => !code.startsWith("72"));
  state.unsupportedFips = isAggregatedGeographyLevel(level)
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
  state.loadingCompleted = 0;
  state.loadingTotal = batches.length;
  elements.loadingMessage.textContent = level === "country"
    ? t("loading.country")
    : t("loading.batches", {
        count: formatNumber(batches.length),
        noun: t(batches.length === 1 ? "loading.batch" : "loading.batchPlural"),
      });

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
        state.loadingCompleted = completed;
        elements.loadingMessage.textContent = t("loading.completed", {
          completed: formatNumber(completed),
          total: formatNumber(batches.length),
        });
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(API_CONCURRENCY, batches.length) }, () => worker()),
    );
    showResults(parsedBatches, parameters, state.selectedAreas, queryContext);
  } catch (error) {
    if (error.name === "AbortError") return;
    const message = t("error.checkSelection", {
      message: error.message || t("error.loadFallback"),
    });
    setStatus("error", message);
    elements.resultsSubtitle.textContent = t("results.failedSubtitle");
  } finally {
    if (state.controller === controller) state.controller = null;
  }
}

function getGeographyDefinitionSource(level) {
  if (level === "metro") return metroDataset.source;
  if (level === "city") return cityDataset.source;
  if (level === "bay-area") return bayAreaDataset.source;
  return "Not applicable";
}

function getExportGroups(level) {
  const types = level === "metro" ? ["msa", "csa"] : [level];
  return types.map((type) => ({
    type,
    label: t(`export.group.${type}`),
    sheetName: t(`export.sheet.${type}`),
  }));
}

function buildParameterRows() {
  const parameters = state.parameters ?? {};
  return [
    [t("export.parameter"), t("export.description"), t("results.value")],
    ["METHOD", t("export.requestMethod"), parameters.METHOD || "GETDATA"],
    ["DATASETNAME", t("export.dataset"), parameters.DATASETNAME || "REGIONAL"],
    ["AREA_SCOPE", t("export.selectedScope"), getResultScopeLabel()],
    ["TABLENAME", t("export.beaTable"), parameters.TABLENAME || ""],
    ["LINECODE", t("export.measureLine"), parameters.LINECODE || "LineNumber 1"],
    ["FREQUENCY", t("measure.frequency"), parameters.FREQUENCY || "A"],
    ["YEAR", t("measure.years"), parameters.YEAR || "ALL"],
    ["UNIT", t("export.valueUnit"), getUnitLabel(state.meta.unit, parameters.TABLENAME)],
    ["SOURCE", t("footer.sources"), state.source],
    ["BOUNDARIES", t("export.definitions"), getGeographyDefinitionSource(state.resultLevel)],
  ];
}

function localizeCountyRows(rows) {
  if (!rows.length) return rows;
  const statusKeys = {
    "Included": "export.included",
    "Excluded": "export.excluded",
    "Invalid data": "export.invalid",
    "No BEA data": "results.noData",
  };
  const officialCodeColumn = state.resultLevel === "metro";
  return [
    [
      t("scope.level"), t("results.geography"),
      ...(officialCodeColumn ? [t("export.geographyCode")] : []),
      "County GeoFips", t("export.countyName"), t("export.year"),
      "DataValue", "NoteRef", t("export.aggregationStatus"),
    ],
    ...rows.slice(1).map(([type, ...cells]) => [
      getAreaTypeLabel(type.toLowerCase()),
      ...cells.slice(0, -1),
      t(statusKeys[cells.at(-1)]),
    ]),
  ];
}

async function exportExcel() {
  if (state.status !== "success") return;
  elements.exportButton.disabled = true;
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const displayNames = new Map(state.resultAreas.map((area) => [area.id, getAreaName(area)]));
    const groups = getExportGroups(state.resultLevel);
    groups.forEach(({ type, label, sheetName = label }) => {
      const rows = state.aggregated
        .filter((row) => row.areaType === type)
        .map((row) => ({ ...row, areaName: displayNames.get(row.areaId) || row.areaName }));
      if (!rows.length) return;
      const matrix = buildAreaYearMatrix(
        rows,
        label,
        `${getMetricLabel(state.parameters.LINECODE, state.parameters.TABLENAME)} (${getUnitLabel(state.meta.unit, state.parameters.TABLENAME)})`,
        t(state.resultLevel === "metro" ? "scope.metroType" : "scope.level"),
        { yearHeading: t("export.year"), noDataLabel: t("results.noData"), locale: i18n.language },
      );
      const sheet = XLSX.utils.aoa_to_sheet(matrix.rows);
      sheet["!cols"] = [{ wch: 48 }, ...matrix.years.map(() => ({ wch: 15 }))];
      sheet["!autofilter"] = {
        ref: `A3:${XLSX.utils.encode_col(matrix.years.length)}${matrix.rows.length}`,
      };
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    });

    if (isAggregatedGeographyLevel(state.resultLevel)) {
      const detailAreas = state.resultAreas.map((area) => ({
        ...area,
        name: displayNames.get(area.id) || area.name,
      }));
      const countyRows = state.resultLevel === "metro"
        ? buildAreaCountyRows(
            state.records,
            detailAreas,
            state.aggregated.map((row) => row.year),
          )
        : buildGeographyCountyRows(
            state.records,
            detailAreas,
            state.aggregated.map((row) => row.year),
          );
      if (countyRows.length) {
        const sheet = XLSX.utils.aoa_to_sheet(localizeCountyRows(countyRows));
        sheet["!cols"] = [
          { wch: 12 }, { wch: 46 },
          ...(state.resultLevel === "metro" ? [{ wch: 12 }] : []),
          { wch: 15 }, { wch: 32 },
          { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
        ];
        sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(countyRows[0].length - 1)}${countyRows.length}` };
        const detailSheetName = t(`export.countySheet.${state.resultLevel}`);
        XLSX.utils.book_append_sheet(workbook, sheet, detailSheetName);
      }
    }
    const parameterSheet = XLSX.utils.aoa_to_sheet(buildParameterRows());
    parameterSheet["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, parameterSheet, t("export.parametersSheet"));
    XLSX.writeFile(workbook, `${sanitizeFilename(elements.filename.value)}.xlsx`, {
      compression: true,
    });
    showToast(t("toast.exported"));
  } catch (error) {
    setStatus("error", t("error.export", { message: error.message }));
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

function refreshMeasureOptionLabels() {
  [...elements.tableName.options].forEach((option) => {
    const config = TABLE_CONFIG[option.value];
    if (config) option.textContent = t(config.labelKey);
  });
  const config = getTableConfig();
  [...elements.lineCode.options].forEach((option) => {
    const lineCode = config.lineCodes.find(({ value }) => value === option.value);
    if (lineCode) option.textContent = t(lineCode.labelKey);
  });
  syncYearControls();
}

function refreshStatusCopy() {
  elements.runQuery.querySelector("span").textContent = state.status === "loading"
    ? t("output.running")
    : t("output.run");
  if (state.status === "idle") {
    elements.resultsSubtitle.textContent = t("results.idleSubtitle");
    return;
  }
  if (state.status === "loading") {
    elements.resultsSubtitle.textContent = t("results.loadingSubtitle");
    if (state.loadingCompleted > 0) {
      elements.loadingMessage.textContent = t("loading.completed", {
        completed: formatNumber(state.loadingCompleted),
        total: formatNumber(state.loadingTotal),
      });
    } else if (elements.geographyLevel.value === "country") {
      elements.loadingMessage.textContent = t("loading.country");
    } else {
      elements.loadingMessage.textContent = t("loading.batches", {
        count: formatNumber(state.loadingTotal),
        noun: t(state.loadingTotal === 1 ? "loading.batch" : "loading.batchPlural"),
      });
    }
    return;
  }
  if (state.status === "error") {
    elements.resultsSubtitle.textContent = t("results.failedSubtitle");
    elements.errorMessage.textContent = state.errorMessage;
    return;
  }
  renderResultSummary();
  renderPreview();
}

function applyLanguage(language, options) {
  const selectedArea = state.selectionMode === "single" ? state.selectedAreas[0] : null;
  const searchWasSelection = selectedArea && elements.areaSearch.value === getAreaName(selectedArea);
  const searchWasOpen = !elements.searchResults.hidden;
  i18n.setLanguage(language, options);
  if (searchWasSelection) elements.areaSearch.value = getAreaName(selectedArea);
  const switchingToChinese = i18n.language === "en";
  elements.languageToggleLabel.textContent = switchingToChinese ? "中文" : "EN";
  elements.languageToggle.setAttribute(
    "aria-label",
    t(switchingToChinese ? "language.switchToChinese" : "language.switchToEnglish"),
  );
  elements.languageToggle.setAttribute("lang", switchingToChinese ? "zh-CN" : "en");
  renderScopeControls(false, false);
  renderSelection();
  renderSelectAll();
  refreshMeasureOptionLabels();
  if (searchWasOpen && elements.areaSearch.value.trim()) renderSearchResults();
  refreshStatusCopy();
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
elements.languageToggle.addEventListener("click", () => {
  applyLanguage(i18n.language === "en" ? "zh" : "en");
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-group")) closeSearchResults();
});

configureGithubLink();
i18n.translateDocument();
renderScopeControls(false);
setSelectedAreas([], "");
syncMeasureControls(true);
setStatus("idle");
applyLanguage(i18n.language, { persist: false });
