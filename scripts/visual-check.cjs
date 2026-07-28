const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "artifacts");
const sessionDirectory = path.join(outputDirectory, "electron-session");

fs.mkdirSync(sessionDirectory, { recursive: true });
app.setPath("userData", sessionDirectory);
app.setPath("sessionData", sessionDirectory);
app.commandLine.appendSwitch("disk-cache-dir", path.join(sessionDirectory, "cache"));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let beaResponseMode = "error";
let lastBeaSearch = "";

function createBeaPayload(search) {
  const parameters = new URLSearchParams(String(search || "").replace(/^\?/u, ""));
  const datasetName = String(
    parameters.get("DataSetName") || parameters.get("DATASETNAME") || "REGIONAL",
  ).toUpperCase();
  if (datasetName === "NIPA") {
    const tableName = parameters.get("TableName") || parameters.get("TABLENAME") || "T10105";
    const frequency = parameters.get("Frequency") || parameters.get("FREQUENCY") || "A";
    const requestedYear = parameters.get("Year") || parameters.get("YEAR") || "ALL";
    const years = requestedYear === "ALL"
      ? [2024, 2025]
      : requestedYear.split(",").map(Number).filter(Number.isFinite);
    const records = [];
    years.forEach((year) => {
      const periods = frequency === "Q"
        ? [1, 2, 3, 4].map((quarter) => `${year}Q${quarter}`)
        : [String(year)];
      periods.forEach((timePeriod, index) => {
        records.push({
          TableName: tableName,
          LineNumber: "1",
          LineDescription: "Gross domestic product",
          TimePeriod: timePeriod,
          DataValue: frequency === "Q" ? String((index + 1) * 100) : "30,762,099",
          UNIT_MULT: "6",
          CL_UNIT: "Level",
          Metric_Name: tableName.endsWith("05") ? "Current Dollars" : "Chained Dollars",
          NoteRef: "",
        });
      });
      records.push({
        TableName: tableName,
        LineNumber: "2",
        LineDescription: "Personal consumption expenditures",
        TimePeriod: periods[0],
        DataValue: "999",
        UNIT_MULT: "6",
      });
    });

    return {
      BEAAPI: {
        Request: {
          RequestParam: [
            { ParameterName: "METHOD", ParameterValue: "GETDATA" },
            { ParameterName: "DATASETNAME", ParameterValue: "NIPA" },
            { ParameterName: "TABLENAME", ParameterValue: tableName },
            { ParameterName: "FREQUENCY", ParameterValue: frequency },
            { ParameterName: "YEAR", ParameterValue: requestedYear },
            { ParameterName: "RESULTFORMAT", ParameterValue: "JSON" },
          ],
        },
        Results: {
          Data: records,
        },
      },
    };
  }

  const fips = String(parameters.get("GeoFips") || parameters.get("GEOFIPS") || "36061")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const stateRequest = fips.length === 1 && fips[0].toUpperCase() === "STATE";
  const stateNames = {
    "01000": "Alabama",
    "02000": "Alaska",
    "04000": "Arizona",
  };
  const geographies = stateRequest
    ? [
        { GeoFips: "01000", GeoName: "Alabama" },
        { GeoFips: "02000", GeoName: "Alaska" },
        { GeoFips: "04000", GeoName: "Arizona" },
      ]
    : fips.map((GeoFips) => ({
        GeoFips,
        GeoName: stateNames[GeoFips] || `County ${GeoFips}`,
      }));
  const records = [];
  const tableName = parameters.get("TableName") || parameters.get("TABLENAME") || "CAGDP1";
  const requestedYear = parameters.get("Year") || parameters.get("YEAR") || "ALL";
  const lastYear = tableName.startsWith("SA") ? 2025 : 2024;
  const firstYear = tableName === "SAINC1" ? 1929 : tableName === "SAGDP1" ? 1997 : 2001;
  const years = requestedYear === "LAST5"
    ? Array.from({ length: 5 }, (_, index) => lastYear - 4 + index)
    : requestedYear === "LAST10"
      ? Array.from({ length: 10 }, (_, index) => lastYear - 9 + index)
      : requestedYear === "ALL"
        ? Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
        : requestedYear.split(",").map(Number).filter(Number.isFinite);

  years.forEach((year) => {
    geographies.forEach((geography, index) => {
      records.push({
        ...geography,
        TimePeriod: String(year),
        DataValue: String(32000000 + (year - 2000) * 1750000 + index * 245000),
        NoteRef: "",
      });
    });
  });

  return {
    BEAAPI: {
      Request: {
        RequestParam: [
          { ParameterName: "METHOD", ParameterValue: "GETDATA" },
          { ParameterName: "DATASETNAME", ParameterValue: "REGIONAL" },
          { ParameterName: "GEOFIPS", ParameterValue: fips.join(",") },
          { ParameterName: "LINECODE", ParameterValue: parameters.get("LineCode") || "3" },
          { ParameterName: "TABLENAME", ParameterValue: parameters.get("TableName") || "CAGDP1" },
          { ParameterName: "YEAR", ParameterValue: parameters.get("Year") || "ALL" },
          { ParameterName: "RESULTFORMAT", ParameterValue: "JSON" },
        ],
      },
      Results: {
        Statistic: "Gross domestic product",
        UnitOfMeasure: "Thousands of dollars",
        Data: records,
      },
    },
  };
}

async function saveCapture(window, name) {
  await wait(260);
  const image = await window.webContents.capturePage();
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, image.toPNG());
  return { target, size: image.getSize() };
}

ipcMain.handle("bea:fetch", async (_event, search) => {
  await wait(100);
  lastBeaSearch = String(search || "");
  if (beaResponseMode === "success") {
    return {
      ok: true,
      status: 200,
      payload: createBeaPayload(search),
    };
  }
  return {
    ok: false,
    status: 0,
    error: "Network requests are disabled during visual checks.",
  };
});

ipcMain.handle("theme:set", (_event, theme) => {
  nativeTheme.themeSource = ["light", "dark"].includes(theme) ? theme : "light";
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
});

async function auditLayout(window, expectedWidth, expectedHeight) {
  window.webContents.focus();
  return window.webContents.executeJavaScript(`(async () => {
    const activeView = document.querySelector(".app-view.is-active")?.dataset.view;
    const search = document.querySelector("#metro-search");
    const searchField = search.closest(".search-field");
    const queryForm = document.querySelector(".query-form");
    const queryWorkspace = document.querySelector(".query-workspace");
    const floatingAction = document.querySelector(".floating-query-action");
    const previewHeader = document.querySelector(".preview-header-card");
    const previewProgress = document.querySelector(".preview-progress");
    const selectedArea = document.querySelector("#selected-area");
    if (activeView === "home") search.focus({ preventScroll: true });
    if (activeView === "home") await new Promise((resolve) => setTimeout(resolve, 160));
    const focusStyle = activeView === "home"
      ? getComputedStyle(searchField)
      : null;
    const focusShadow = focusStyle
      ? focusStyle.boxShadow
      : "not-applicable";
    const queryRect = queryWorkspace.getBoundingClientRect();
    const floatingRect = floatingAction.getBoundingClientRect();
    const headerRect = previewHeader.getBoundingClientRect();
    const progressRect = previewProgress.getBoundingClientRect();
    const searchRect = searchField.getBoundingClientRect();
    const selectedRect = selectedArea.getBoundingClientRect();
    return {
      expectedWidth: ${expectedWidth},
      expectedHeight: ${expectedHeight},
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalBodyOverflow:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      activeView,
      sidebarWidth: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
      queryWidth: Math.round(document.querySelector(".query-workspace").getBoundingClientRect().width),
      previewWidth: Math.round(document.querySelector(".preview-inspector").getBoundingClientRect().width),
      toolbarHeight: Math.round(document.querySelector(".unified-toolbar").getBoundingClientRect().height),
      floatingActionBottom: Math.round(document.querySelector(".floating-query-action").getBoundingClientRect().bottom),
      viewportBottom: window.innerHeight,
      queryScrollable:
        queryForm.scrollHeight > queryForm.clientHeight,
      queryScrollbarHidden: getComputedStyle(queryForm).scrollbarWidth === "none",
      floatingActionCentered:
        Math.abs((floatingRect.left + floatingRect.width / 2) - (queryRect.left + queryRect.width / 2)) < 2,
      progressInsidePreviewHeader: previewProgress.closest(".preview-header-card") === previewHeader,
      progressStretchRatio: Number((progressRect.width / headerRect.width).toFixed(3)),
      selectedAreaAttached:
        selectedArea.hidden ? null : Math.abs(selectedRect.top - searchRect.bottom) < 2,
      focusWithin: activeView === "home" ? searchField.matches(":focus-within") : false,
      focusRingVisible:
        activeView === "home" &&
        searchField.matches(":focus-within") &&
        focusStyle.borderColor !== "rgba(60, 60, 67, 0.18)",
      focusShadow,
      previewTabs: document.querySelectorAll("[data-preview-tab]").length,
      querySteps: document.querySelectorAll("[data-query-step]").length,
      queryCards: document.querySelectorAll(".query-header, .query-step-section").length,
      cardRadius: getComputedStyle(document.querySelector(".query-step-section")).borderRadius,
      toolbarPathRemoved: !document.querySelector(".toolbar-context"),
      chartRemoved: !document.querySelector('[data-preview-tab="chart"], #chart-panel'),
      jsonImportRemoved: !document.querySelector("#import-button, #json-file"),
      footerExportRemoved: !document.querySelector(".data-view-footer, #inline-export-button"),
      sectionNumbersRemoved: !document.querySelector(".section-number"),
      sidebarStudioRemoved: !document.querySelector(".sidebar-heading"),
      controls: document.querySelectorAll("button, a, input, select, summary, [tabindex='0']").length
    };
  })()`);
}

async function openAndAuditInfoPage(window, view) {
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-view-target="${view}"]').click()`,
  );
  await wait(120);
  return window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.app-view.is-active.info-page');
    const headerCopy = page.querySelector('.info-page-header > div');
    const content = page.querySelector('.info-page-content');
    const headerRect = headerCopy.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const contentStyle = getComputedStyle(content);
    const headerLeft = headerRect.left;
    const contentLeft = contentRect.left + parseFloat(contentStyle.paddingLeft);
    return {
      view: page.dataset.view,
      headerLeft: Number(headerLeft.toFixed(2)),
      contentLeft: Number(contentLeft.toFixed(2)),
      difference: Number(Math.abs(headerLeft - contentLeft).toFixed(2)),
      leftAligned: Math.abs(headerLeft - contentLeft) < 1
    };
  })()`);
}

async function auditAreaFilterSelection(window) {
  return window.webContents.executeJavaScript(`(() => {
    const buttons = [...document.querySelectorAll('.area-filter-button')];
    const snapshots = ['all', 'msa', 'csa'].map((type) => {
      buttons.find((button) => button.dataset.areaType === type).click();
      const selected = buttons.filter((button) => button.classList.contains('is-selected'));
      const pressed = buttons.filter((button) => button.getAttribute('aria-pressed') === 'true');
      const legacyActive = buttons.filter((button) => button.classList.contains('is-active'));
      return {
        requested: type,
        selected: selected.map((button) => button.dataset.areaType),
        pressed: pressed.map((button) => button.dataset.areaType),
        legacyActive: legacyActive.map((button) => button.dataset.areaType),
        exclusive:
          selected.length === 1 &&
          pressed.length === 1 &&
          selected[0] === pressed[0] &&
          selected[0].dataset.areaType === type &&
          legacyActive.length === 0
      };
    });
    buttons.find((button) => button.dataset.areaType === 'all').click();
    return {
      snapshots,
      exclusive: snapshots.every((snapshot) => snapshot.exclusive)
    };
  })()`);
}

async function auditToolbarSimplification(window) {
  return window.webContents.executeJavaScript(`(() => {
    const buttons = [...document.querySelectorAll('[data-theme-option]')];
    const snapshots = ['light', 'dark'].map((theme) => {
      buttons.find((button) => button.dataset.themeOption === theme).click();
      const selected = buttons.filter((button) => button.classList.contains('is-selected'));
      const pressed = buttons.filter((button) => button.getAttribute('aria-pressed') === 'true');
      return {
        requested: theme,
        selected: selected.map((button) => button.dataset.themeOption),
        pressed: pressed.map((button) => button.dataset.themeOption),
        exclusive:
          selected.length === 1 &&
          pressed.length === 1 &&
          selected[0] === pressed[0] &&
          selected[0].dataset.themeOption === theme
      };
    });
    buttons.find((button) => button.dataset.themeOption === 'light').click();
    const hasApiOptionsLabel = [...document.querySelectorAll('summary')]
      .some((summary) => summary.textContent.includes('API options'));
    return {
      options: buttons.map((button) => button.dataset.themeOption),
      onlyLightAndDark:
        buttons.length === 2 &&
        buttons[0].dataset.themeOption === 'light' &&
        buttons[1].dataset.themeOption === 'dark',
      exclusive: snapshots.every((snapshot) => snapshot.exclusive),
      snapshots,
      apiBadgeRemoved: !document.querySelector('.api-badge'),
      apiSettingsRemoved: !document.querySelector('#user-id') && !hasApiOptionsLabel
    };
  })()`);
}

async function auditStateLevel(window) {
  const controls = await window.webContents.executeJavaScript(`(() => {
    const level = document.querySelector("#geography-level");
    level.value = "state";
    level.dispatchEvent(new Event("change", { bubbles: true }));
    const countyControls = [...document.querySelectorAll(".county-scope-control")];
    const initial = {
      countyControlsHidden: countyControls.every((control) => control.hidden),
      noDefaultSelection: document.querySelector("#selected-area").hidden,
      stateSearchVisible:
        !document.querySelector(".metro-search-block").hidden
        && document.querySelector("#geography-search-label").textContent.trim() === "Search states",
      selectAllAvailable:
        document.querySelector("#select-all-label").textContent.trim() === "Select all states",
      tableOptions: [...document.querySelector("#table-name").options]
        .map((option) => [option.value, option.textContent.trim()]),
      lineCodes: [...document.querySelector("#line-code").options]
        .map((option) => [option.value, option.textContent.trim()]),
      yearOptionsAvailable:
        !document.querySelector("#year").disabled
        && ["ALL", "LAST5", "LAST10", "2025", "1997"].every((value) => (
          [...document.querySelector("#year").options].some((option) => option.value === value)
        )),
    };
    document.querySelector("#year").value = "LAST5";
    document.querySelector("#year").dispatchEvent(new Event("change", { bubbles: true }));
    const search = document.querySelector("#metro-search");
    search.value = "Alabama";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".metro-option")?.click();
    return {
      ...initial,
      selectedAfterSearch:
        !document.querySelector("#selected-area").hidden
        && document.querySelector("#selected-area-name").textContent.trim() === "Alabama",
    };
  })()`);
  await window.webContents.executeJavaScript(
    `document.querySelector("#fetch-button").click()`,
  );
  await wait(700);
  const results = await window.webContents.executeJavaScript(`(() => ({
    status: document.body.dataset.status,
    tableTitle: document.querySelector("#table-title").textContent.trim(),
    areaHeading: document.querySelector("#area-column-heading").textContent.trim(),
    typeHeading: document.querySelector("#type-column-heading").textContent.trim(),
    firstArea: document.querySelector("#result-body tr th")?.textContent.trim(),
    firstType: document.querySelector("#result-body tr td .table-type")?.textContent.trim(),
    note: document.querySelector("#result-note-text").textContent.trim(),
  }))()`);
  const requestedParameters = new URLSearchParams(lastBeaSearch.replace(/^\?/u, ""));
  results.parameters = {
    geoFips: requestedParameters.get("GEOFIPS"),
    tableName: requestedParameters.get("TABLENAME"),
    year: requestedParameters.get("YEAR"),
  };
  return { controls, results };
}

async function auditCountryLevel(window) {
  const controls = await window.webContents.executeJavaScript(`(() => {
    const level = document.querySelector("#geography-level");
    level.value = "country";
    level.dispatchEvent(new Event("change", { bubbles: true }));
    const frequency = document.querySelector("#frequency");
    frequency.value = "Q";
    frequency.dispatchEvent(new Event("change", { bubbles: true }));
    const mode = document.querySelector("#quarterly-mode");
    mode.value = "cumulative";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    const year = document.querySelector("#year");
    year.value = "2025";
    year.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      searchHidden: document.querySelector(".metro-search-block").hidden,
      countyControlsHidden: [...document.querySelectorAll(".county-scope-control")]
        .every((control) => control.hidden),
      countrySummaryVisible: !document.querySelector("#country-scope-summary").hidden,
      countrySummaryText: document.querySelector("#country-scope-summary").textContent.trim(),
      tableOptions: [...document.querySelector("#table-name").options]
        .map((option) => [option.value, option.textContent.trim()]),
      frequencyVisible: !frequency.closest(".field").hidden,
      quarterlyModeVisible: !document.querySelector("#quarterly-mode-field").hidden,
      yearRange:
        document.querySelector("#year").options[0]?.textContent.trim(),
    };
  })()`);
  await window.webContents.executeJavaScript(
    `document.querySelector("#fetch-button").click()`,
  );
  await wait(700);
  const results = await window.webContents.executeJavaScript(`(() => ({
    status: document.body.dataset.status,
    title: document.querySelector("#table-title").textContent.trim(),
    areaHeading: document.querySelector("#area-column-heading").textContent.trim(),
    firstType: document.querySelector("#result-body tr td .table-type")?.textContent.trim(),
    periods: [...document.querySelectorAll("#result-body tr")]
      .filter((row) => !row.classList.contains("preview-limit-row"))
      .map((row) => row.children[2]?.textContent.trim()),
    values: [...document.querySelectorAll("#result-body tr")]
      .filter((row) => !row.classList.contains("preview-limit-row"))
      .map((row) => row.children[3]?.textContent.trim()),
    statuses: [...document.querySelectorAll("#result-body tr")]
      .filter((row) => !row.classList.contains("preview-limit-row"))
      .map((row) => row.children[4]?.textContent.trim()),
    note: document.querySelector("#result-note-text").textContent.trim(),
  }))()`);
  const requestedParameters = new URLSearchParams(lastBeaSearch.replace(/^\?/u, ""));
  results.parameters = {
    datasetName: requestedParameters.get("DATASETNAME"),
    tableName: requestedParameters.get("TABLENAME"),
    frequency: requestedParameters.get("FREQUENCY"),
    year: requestedParameters.get("YEAR"),
    showMillions: requestedParameters.get("SHOWMILLIONS"),
    geoFips: requestedParameters.get("GEOFIPS"),
  };
  return { controls, results };
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = "light";

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    frame: false,
    backgroundColor: "#ececef",
    webPreferences: {
      preload: path.join(root, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  const consoleErrors = [];
  window.webContents.on("console-message", (event) => {
    if (event.level === "error" || event.level === 3) consoleErrors.push(event.message);
  });

  await window.loadFile(path.join(root, "dist", "index.html"));
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-theme-option="light"]').click()`,
  );

  const toolbarSimplification = await auditToolbarSimplification(window);
  const areaFilterAuditLight = await auditAreaFilterSelection(window);
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-area-type="msa"]').click()`,
  );
  const areaFilterMsaLight = await saveCapture(window, "metro-area-filter-msa-1440x900-light.png");
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-area-type="all"]').click()`,
  );
  const home1440 = await saveCapture(window, "metro-home-1440x900-light.png");
  const audit1440 = await auditLayout(window, 1440, 900);

  await window.webContents.executeJavaScript(`(() => {
    const search = document.querySelector("#metro-search");
    search.value = "New York";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".metro-option")?.click();
    document.querySelector("#fetch-button").click();
  })()`);
  const loading1440 = await saveCapture(window, "metro-loading-1440x900-light.png");
  await wait(2700);
  const error1440 = await saveCapture(window, "metro-error-1440x900-light.png");

  beaResponseMode = "success";
  await window.webContents.executeJavaScript(`document.querySelector("#retry-button").click()`);
  await wait(700);
  const table1440 = await saveCapture(window, "metro-table-1440x900-light.png");
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-preview-tab="metadata"]').click()`,
  );
  const metadata1440 = await saveCapture(window, "metro-metadata-1440x900-light.png");
  const stateLevel = await auditStateLevel(window);
  const state1440 = await saveCapture(window, "state-level-1440x900-light.png");
  const countryLevel = await auditCountryLevel(window);
  const country1440 = await saveCapture(window, "country-level-1440x900-light.png");
  await window.webContents.executeJavaScript(`(() => {
    const level = document.querySelector("#geography-level");
    level.value = "county";
    level.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector('[data-preview-tab="table"]').click();
  })()`);

  window.setSize(1280, 720);
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-view-target="home"]').click();
    document.querySelector('[data-preview-tab="table"]').click();
  })()`);
  const home1280 = await saveCapture(window, "metro-home-1280x720-light.png");
  const audit1280 = await auditLayout(window, 1280, 720);

  window.setSize(1728, 1117);
  await window.webContents.executeJavaScript(`document.querySelector('[data-theme-option="dark"]').click()`);
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-view-target="home"]').click()`,
  );
  const areaFilterAuditDark = await auditAreaFilterSelection(window);
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-area-type="msa"]').click()`,
  );
  const areaFilterMsaDark = await saveCapture(window, "metro-area-filter-msa-1728x1117-dark.png");
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-area-type="all"]').click()`,
  );
  const privacyAlignmentDark = await openAndAuditInfoPage(window, "privacy");
  const privacy1728 = await saveCapture(window, "metro-privacy-1728x1117-dark.png");
  const audit1728 = await auditLayout(window, 1728, 1117);

  const sourcesAlignmentDark = await openAndAuditInfoPage(window, "data-sources");
  const sources1728 = await saveCapture(window, "metro-sources-1728x1117-dark.png");
  const licenseAlignmentDark = await openAndAuditInfoPage(window, "license");
  const license1728 = await saveCapture(window, "metro-license-1728x1117-dark.png");
  const versionAlignmentDark = await openAndAuditInfoPage(window, "version");
  const version1728 = await saveCapture(window, "metro-version-1728x1117-dark.png");

  window.setSize(1440, 900);
  await window.webContents.executeJavaScript(`document.querySelector('[data-theme-option="light"]').click()`);
  const sourcesAlignmentLight = await openAndAuditInfoPage(window, "data-sources");
  const sources1440 = await saveCapture(window, "metro-sources-1440x900-light.png");
  const licenseAlignmentLight = await openAndAuditInfoPage(window, "license");
  const license1440 = await saveCapture(window, "metro-license-1440x900-light.png");
  const versionAlignmentLight = await openAndAuditInfoPage(window, "version");
  const version1440 = await saveCapture(window, "metro-version-1440x900-light.png");
  const privacyAlignmentLight = await openAndAuditInfoPage(window, "privacy");
  const privacy1440 = await saveCapture(window, "metro-privacy-1440x900-light.png");

  const report = {
    captures: {
      areaFilterMsaLight,
      home1440,
      loading1440,
      error1440,
      table1440,
      metadata1440,
      state1440,
      country1440,
      home1280,
      areaFilterMsaDark,
      privacy1728,
      sources1728,
      license1728,
      version1728,
      sources1440,
      license1440,
      version1440,
      privacy1440,
    },
    audits: {
      "1440x900": audit1440,
      "1280x720": audit1280,
      "1728x1117": audit1728,
    },
    infoPageAlignments: {
      dark: {
        "data-sources": sourcesAlignmentDark,
        license: licenseAlignmentDark,
        version: versionAlignmentDark,
        privacy: privacyAlignmentDark,
      },
      light: {
        "data-sources": sourcesAlignmentLight,
        license: licenseAlignmentLight,
        version: versionAlignmentLight,
        privacy: privacyAlignmentLight,
      },
    },
    areaFilterSelection: {
      light: areaFilterAuditLight,
      dark: areaFilterAuditDark,
    },
    toolbarSimplification,
    stateLevel,
    countryLevel,
    consoleErrors,
  };
  fs.writeFileSync(
    path.join(outputDirectory, "visual-audit.json"),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    !areaFilterAuditLight.exclusive ||
    !areaFilterAuditDark.exclusive ||
    !toolbarSimplification.onlyLightAndDark ||
    !toolbarSimplification.exclusive ||
    !toolbarSimplification.apiBadgeRemoved ||
    !toolbarSimplification.apiSettingsRemoved ||
    !stateLevel.controls.countyControlsHidden ||
    !stateLevel.controls.noDefaultSelection ||
    !stateLevel.controls.stateSearchVisible ||
    !stateLevel.controls.selectAllAvailable ||
    !stateLevel.controls.selectedAfterSearch ||
    JSON.stringify(stateLevel.controls.tableOptions) !== JSON.stringify([
      ["SAGDP1", "GDP"],
      ["SAINC1", "Population"],
    ]) ||
    !stateLevel.controls.yearOptionsAvailable ||
    stateLevel.results.status !== "success" ||
    stateLevel.results.tableTitle !== "Alabama" ||
    stateLevel.results.areaHeading !== "State name" ||
    stateLevel.results.firstType !== "State" ||
    stateLevel.results.parameters.geoFips !== "01000" ||
    stateLevel.results.parameters.tableName !== "SAGDP1" ||
    stateLevel.results.parameters.year !== "LAST5" ||
    !countryLevel.controls.searchHidden ||
    !countryLevel.controls.countyControlsHidden ||
    !countryLevel.controls.countrySummaryVisible ||
    !countryLevel.controls.countrySummaryText.includes("United States") ||
    JSON.stringify(countryLevel.controls.tableOptions) !== JSON.stringify([["NIPA_GDP", "GDP"]]) ||
    !countryLevel.controls.frequencyVisible ||
    !countryLevel.controls.quarterlyModeVisible ||
    countryLevel.controls.yearRange !== "All years (1947–2026)" ||
    countryLevel.results.status !== "success" ||
    countryLevel.results.title !== "United States" ||
    countryLevel.results.areaHeading !== "Country name" ||
    countryLevel.results.firstType !== "Country" ||
    JSON.stringify(countryLevel.results.periods) !== JSON.stringify(["2025Q1", "2025Q2", "2025Q3"]) ||
    JSON.stringify(countryLevel.results.values) !== JSON.stringify(["100", "300", "600"]) ||
    !countryLevel.results.statuses.every((status) => status === "Calculated") ||
    countryLevel.results.parameters.datasetName !== "NIPA" ||
    countryLevel.results.parameters.tableName !== "T80105" ||
    countryLevel.results.parameters.frequency !== "Q" ||
    countryLevel.results.parameters.year !== "2025" ||
    countryLevel.results.parameters.showMillions !== null ||
    countryLevel.results.parameters.geoFips !== null
  ) {
    process.exitCode = 1;
  }
  window.destroy();
  app.quit();
});
