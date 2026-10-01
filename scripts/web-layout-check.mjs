import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = join(root, "artifacts");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const pageUrl = pathToFileURL(join(root, "dist-web", "index.html")).href;

function findOpenPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForBrowser(port) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw lastError ?? new Error("Edge DevTools endpoint did not start.");
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveCall, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveCall(message.result);
      return;
    }
    listeners.forEach((listener) => listener(message));
  });
  const ready = new Promise((resolveReady, reject) => {
    socket.addEventListener("open", resolveReady, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolveCall, reject) => {
        pending.set(id, { resolve: resolveCall, reject });
      });
    },
    waitFor(method, sessionId) {
      return new Promise((resolveEvent) => {
        const listener = (message) => {
          if (message.method !== method || (sessionId && message.sessionId !== sessionId)) return;
          listeners.delete(listener);
          resolveEvent(message.params);
        };
        listeners.add(listener);
      });
    },
  };
}

const layoutExpression = `(() => {
  const scope = document.querySelector(".scope-panel").getBoundingClientRect();
  const measure = document.querySelector(".measure-panel").getBoundingClientRect();
  const output = document.querySelector(".output-panel").getBoundingClientRect();
  const results = document.querySelector(".results-section").getBoundingClientRect();
  const bodyText = document.body.innerText;
  return {
    viewport: document.documentElement.clientWidth,
    noHorizontalOverflow:
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    controlsContained: [...document.querySelectorAll("input, select, button")]
      .filter((element) => !element.closest(".search-results"))
      .every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -0.5 && rect.right <= document.documentElement.clientWidth + 0.5;
      }),
    sameDocumentStructure:
      Boolean(document.querySelector("#query"))
      && Boolean(document.querySelector("#results"))
      && Boolean(document.querySelector("#sources")),
    resultTargetAvailable:
      document.querySelector("#results") instanceof HTMLElement
      && typeof document.querySelector("#results").scrollIntoView === "function",
    appChromeAbsent:
      !document.querySelector(".sidebar")
      && !document.querySelector("#mobile-settings-button")
      && !bodyText.includes("License")
      && !bodyText.includes("Version")
      && !bodyText.includes("Privacy"),
    footerHasSourcesAndGithub:
        document.querySelectorAll("#sources nav a").length >= 4
      && document.querySelector("#github-link").href.startsWith("https://github.com/"),
    footerHasConduct:
      Boolean(document.querySelector('#sources a[href$="/CODE_OF_CONDUCT.md"]')),
    footerCreditsNetlify:
      [...document.querySelectorAll("#sources a")].some((link) =>
        link.href === "https://www.netlify.com/"
        && link.textContent.trim() === "This site is powered by Netlify"),
    geometry: {
      scope: { left: scope.left, right: scope.right, top: scope.top, bottom: scope.bottom },
      measure: { left: measure.left, right: measure.right, top: measure.top, bottom: measure.bottom },
      output: { left: output.left, right: output.right, top: output.top, bottom: output.bottom },
      results: { left: results.left, right: results.right, top: results.top }
    }
  };
})()`;

const interactionExpression = `(() => {
  const geography = document.querySelector("#geography-level");
  geography.value = "state";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  const search = document.querySelector("#area-search");
  search.value = "new";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const searchResults = document.querySelector("#search-results");
  const searchRect = searchResults.getBoundingClientRect();
  const measureRect = document.querySelector(".measure-panel").getBoundingClientRect();
  const searchAvoidsMeasureOverlap =
    searchRect.bottom <= measureRect.top
    || searchRect.top >= measureRect.bottom
    || searchRect.right <= measureRect.left
    || searchRect.left >= measureRect.right;
  const stateSearchWorks =
    !searchResults.hidden
    && searchResults.querySelectorAll(".search-result").length > 0
    && searchResults.textContent.includes("New York")
    && searchRect.left >= 0
    && searchRect.right <= document.documentElement.clientWidth;

  geography.value = "city";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  search.value = "Cambridge";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const cityLevelWorks =
    document.querySelector("#metro-type-field").hidden
    && document.querySelector("#coverage-badge").textContent.includes("267")
    && !searchResults.hidden
    && searchResults.textContent.includes("Cambridge");

  geography.value = "bay-area";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  search.value = "San Francisco Bay Area";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const bayAreaLevelWorks =
    document.querySelector("#metro-type-field").hidden
    && document.querySelector("#coverage-badge").textContent.includes("8")
    && !searchResults.hidden
    && searchResults.textContent.includes("San Francisco Bay Area");

  geography.value = "country";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  const frequency = document.querySelector("#frequency");
  frequency.value = "Q";
  frequency.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    stateSearchWorks,
    cityLevelWorks,
    bayAreaLevelWorks,
    searchAvoidsMeasureOverlap,
    countryControlsWork:
      !document.querySelector("#country-summary").hidden
      && !document.querySelector("#frequency-field").hidden
      && !document.querySelector("#quarterly-mode-field").hidden
      && document.querySelector("#search-group").hidden
  };
})()`;

const queryCompletionExpression = `(async () => {
  window.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({
      BEAAPI: {
        Results: {
          Statistic: "Gross domestic product",
          UnitOfMeasure: String(url).includes("DATASETNAME=REGIONAL")
            ? "Thousands of dollars"
            : "Millions of dollars",
          Data: String(url).includes("DATASETNAME=REGIONAL")
            ? [{
                GeoFips: "06075",
                GeoName: "San Francisco County, CA",
                TimePeriod: "2024",
                DataValue: "321.5",
                UNIT_MULT: "3"
              }]
            : [{
                LineNumber: "1",
                LineDescription: "Gross domestic product",
                TimePeriod: "2025Q1",
                DataValue: "321.5",
                UNIT_MULT: "6"
              }]
        }
      }
    })
  });

  const geography = document.querySelector("#geography-level");
  const search = document.querySelector("#area-search");
  geography.value = "bay-area";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  search.value = "San Francisco Bay Area";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#search-results .search-result").click();
  document.querySelector("#query").requestSubmit();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!document.querySelector("#success-state").hidden) break;
    if (!document.querySelector("#error-state").hidden) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const bayAreaQueryCompletes =
    !document.querySelector("#success-state").hidden
    && document.querySelectorAll("#result-body tr").length === 1
    && ["San Francisco Bay Area", "旧金山大湾区"]
      .includes(document.querySelector("#result-scope").textContent)
    && document.querySelector("#result-body").textContent.includes("321.5");

  geography.value = "country";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#query").requestSubmit();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!document.querySelector("#success-state").hidden) break;
    if (!document.querySelector("#error-state").hidden) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return {
    bayAreaQueryCompletes,
    queryCompletesIntoResults:
      !document.querySelector("#success-state").hidden
      && document.querySelectorAll("#result-body tr").length === 1
      && ["United States", "美国"].includes(document.querySelector("#result-scope").textContent),
    noResultRenderError: document.querySelector("#error-state").hidden
  };
})()`;

const languageToggleExpression = `(() => {
  const toggle = document.querySelector("#language-toggle");
  if (document.documentElement.lang === "zh-CN") toggle.click();
  const before = {
    level: document.querySelector("#geography-level").value,
    statusVisible: !document.querySelector("#success-state").hidden
  };
  toggle.click();
  const rect = toggle.getBoundingClientRect();
  const chineseWorks =
    document.documentElement.lang === "zh-CN"
    && document.querySelector("#scope-title").textContent === "选择地理区域"
    && document.querySelector("#results-title").textContent === "查询结果"
    && document.querySelector("#result-scope").textContent === "美国"
    && toggle.textContent.trim() === "EN";
  const statePreserved =
    document.querySelector("#geography-level").value === before.level
    && !document.querySelector("#success-state").hidden === before.statusVisible;
  toggle.click();
  return {
    languageToggleAccessible:
      rect.width >= 44
      && rect.height >= 44
      && Boolean(toggle.getAttribute("aria-label")),
    bilingualToggleWorks:
      chineseWorks
      && document.documentElement.lang === "en"
      && document.querySelector("#scope-title").textContent === "Choose geography",
    languageSwitchPreservesQuery: statePreserved
  };
})()`;

const loadJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const geographyFixtures = (() => {
  const states = loadJson("src/data/states.json").areas;
  const metros = loadJson("src/data/metro-areas.json").areas;
  const cities = loadJson("web/data/bea-us-city-geofips.json").cities;
  const bays = loadJson("web/data/bea-us-bay-area-geofips.json").bayAreas;
  return [
    { ...states.find((area) => area.code === "36"), level: "state" },
    { ...cities.find((area) => area.id === "cambridge-us"), level: "city" },
    { ...bays.find((area) => area.id === "san-francisco-bay-area"), level: "bay-area" },
    { ...metros.find((area) => area.code === "35620"), level: "metro" },
    { ...metros.find((area) => area.code === "408"), level: "metro" },
    { id: "country-us", level: "country", name: "United States", nameZh: "美国" },
  ].map((area) => {
    assert.ok(area.id && area.nameZh, `Audit geography is missing a Chinese mapping: ${area.id}`);
    return { ...area, name: area.nameEn || area.name };
  });
})();

async function auditLocalizedGeographies(fixtures) {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const element = (selector) => document.querySelector(selector);
  const waitFor = async (predicate, message) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(message + ": " + element("#error-message").textContent);
  };
  const setLanguage = (language) => {
    if (document.documentElement.lang !== language) element("#language-toggle").click();
  };
  const requests = [];
  window.fetch = async (request) => {
    const url = new URL(request, "https://audit.invalid");
    check(url.pathname === "/api/bea", "Unexpected request destination");
    check(!url.searchParams.has("USERID"), "Browser request contains a private key");
    requests.push(url.pathname + url.search);
    const codes = (url.searchParams.get("GEOFIPS") || "").split(",").filter(Boolean);
    const isCountry = url.searchParams.get("DATASETNAME") === "NIPA";
    const records = ["2023", "2024"].flatMap((year) => isCountry
      ? [{ LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: year, DataValue: year === "2023" ? "123.5" : "246.5", UNIT_MULT: "6" }]
      : codes.map((code) => ({
          GeoFips: code,
          GeoName: code === "36000" ? "New York" : "Official county " + code,
          TimePeriod: year,
          DataValue: year === "2023" ? "123.5" : "246.5",
          UNIT_MULT: "6",
        })));
    return new Response(JSON.stringify({ BEAAPI: { Results: {
      UnitOfMeasure: "Millions of dollars", Data: records,
    } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const exportedBlobs = [];
  const objectUrls = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = createObjectURL(blob);
    objectUrls.set(url, blob);
    return url;
  };
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && objectUrls.has(this.href)) {
      exportedBlobs.push({ filename: this.download, blob: objectUrls.get(this.href) });
      return;
    }
    anchorClick.call(this);
  };
  const results = [];
  for (const fixture of fixtures) {
    setLanguage("zh-CN");
    const geography = element("#geography-level");
    geography.value = fixture.level;
    geography.dispatchEvent(new Event("change", { bubbles: true }));
    if (fixture.level === "metro") element('#metro-type button[data-type="' + fixture.type + '"]').click();
    if (fixture.level !== "country") {
      const search = element("#area-search");
      for (const query of [fixture.nameZh, fixture.name]) {
        search.value = query;
        search.dispatchEvent(new Event("input", { bubbles: true }));
        const matches = [...document.querySelectorAll("#search-results .search-result")];
        check(matches.some((button) => button.querySelector("strong").textContent === fixture.nameZh), fixture.id + " bilingual search: " + query);
      }
      [...document.querySelectorAll("#search-results .search-result")]
        .find((button) => button.querySelector("strong").textContent === fixture.nameZh).click();
      check(element("#selection-name").textContent === fixture.nameZh, fixture.id + " Chinese selection");
      check(!element("#selection-detail").textContent.includes("undefined"), fixture.id + " missing code leaked into detail");
    }
    const year = element("#year");
    year.value = "ALL";
    year.dispatchEvent(new Event("change", { bubbles: true }));
    if (fixture.level === "country") {
      element("#frequency").value = "A";
      element("#frequency").dispatchEvent(new Event("change", { bubbles: true }));
    }
    element("#query").requestSubmit();
    await waitFor(() => !element("#success-state").hidden || !element("#error-state").hidden, fixture.id + " query did not finish");
    check(element("#error-state").hidden, fixture.id + " query error: " + element("#error-message").textContent);
    check(element("#result-scope").textContent === fixture.nameZh, fixture.id + " Chinese result scope");
    const initialValues = [...document.querySelectorAll("#result-body tr")].map((row) => row.children[3].textContent);
    check(initialValues.length === 2, fixture.id + " result periods changed");
    const item = { id: fixture.id, level: fixture.level, type: fixture.type, name: fixture.name, nameZh: fixture.nameZh, exports: [] };
    for (const language of ["zh-CN", "en"]) {
      setLanguage(language);
      const displayName = language === "zh-CN" ? fixture.nameZh : fixture.name;
      check(!element("#success-state").hidden, fixture.id + " language switch cleared result");
      check(element("#result-scope").textContent === displayName, fixture.id + " language switch scope mismatch");
      check([...document.querySelectorAll("#result-body tr")].every((row) => row.children[0].textContent === displayName), fixture.id + " language switch row mismatch");
      check([...document.querySelectorAll("#result-body tr")].every((row, index) => row.children[3].textContent === initialValues[index]), fixture.id + " language switch changed numeric values");
      const count = exportedBlobs.length;
      element("#export-button").click();
      await waitFor(() => exportedBlobs.length > count || !element("#error-state").hidden, fixture.id + " export did not finish");
      check(element("#error-state").hidden, fixture.id + " export failed: " + element("#error-message").textContent);
      const exported = exportedBlobs.at(-1);
      const bytes = new Uint8Array(await exported.blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      item.exports.push({ language, filename: exported.filename, base64: btoa(binary) });
    }
    results.push(item);
  }
  HTMLAnchorElement.prototype.click = anchorClick;
  URL.createObjectURL = createObjectURL;
  return { results, requests };
}

const geographyAuditExpression = `(${auditLocalizedGeographies.toString()})(${JSON.stringify(geographyFixtures)})`;

function verifyLocalizedWorkbooks(audit) {
  for (const result of audit.results) {
    const books = result.exports.map((item) => ({
      ...item, book: XLSX.read(Buffer.from(item.base64, "base64"), { type: "buffer" }),
    }));
    const [chinese, english] = books;
    const zhRows = XLSX.utils.sheet_to_json(chinese.book.Sheets[chinese.book.SheetNames[0]], { header: 1 });
    const enRows = XLSX.utils.sheet_to_json(english.book.Sheets[english.book.SheetNames[0]], { header: 1 });
    assert.equal(zhRows[3][0], result.nameZh, `${result.id} Chinese workbook name`);
    assert.equal(enRows[3][0], result.name, `${result.id} English workbook name`);
    assert.deepEqual(zhRows[3].slice(1), enRows[3].slice(1), `${result.id} workbook values changed across languages`);
    assert.ok(zhRows[3].slice(1).every((value) => typeof value === "number" && value > 0), `${result.id} workbook numbers missing`);
    assert.equal(zhRows[2][0], "年份");
    assert.equal(enRows[2][0], "Year");
    if (["metro", "city", "bay-area"].includes(result.level)) {
      for (const item of books) {
        const sheet = item.book.Sheets[item.book.SheetNames[1]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const count = result.level === "metro" ? 9 : 8;
        assert.equal(rows[0].length, count, `${result.id} county column count`);
        assert.ok(rows.slice(1).every((row) => row.length === count && row[1] === (item.language === "zh-CN" ? result.nameZh : result.name)));
        assert.ok(rows.slice(1).every((row) => row.includes("Official county " + row[result.level === "metro" ? 3 : 2])));
        assert.equal(sheet["!autofilter"].ref, `A1:${count === 9 ? "I" : "H"}${rows.length}`);
      }
    }
    assert.ok(chinese.book.SheetNames.includes("查询参数"));
    assert.ok(english.book.SheetNames.includes("Request Parameters"));
  }
}


async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function inspectViewport(cdp, width, height, name) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send(
    "Target.attachToTarget",
    { targetId, flatten: true },
  );
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: 'localStorage.setItem("metro-studio-web-language", "en"); window.fetch = async () => { throw new Error("Unmocked network request blocked by browser audit"); };',
  }, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
      screenWidth: width,
      screenHeight: height,
    },
    sessionId,
  );
  const loaded = cdp.waitFor("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url: `${pageUrl}?audit=${name}` }, sessionId);
  await loaded;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));

  const report = await evaluate(cdp, sessionId, layoutExpression);
  const responsive = width > 980
    ? Math.abs(report.geometry.scope.top - report.geometry.measure.top) < 2
      && report.geometry.measure.left > report.geometry.scope.left
      && Math.abs(report.geometry.output.left - report.geometry.measure.left) < 2
      && report.geometry.output.top > report.geometry.measure.bottom
    : Math.abs(report.geometry.scope.left - report.geometry.measure.left) < 2
      && Math.abs(report.geometry.measure.left - report.geometry.output.left) < 2
      && report.geometry.measure.top > report.geometry.scope.bottom
      && report.geometry.output.top > report.geometry.measure.bottom;
  report.responsivePlacement = responsive;
  report.resultsFollowQuery = report.geometry.results.top > report.geometry.output.bottom;
  const initialScreenshot = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true, captureBeyondViewport: false },
    sessionId,
  );
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    join(artifacts, `web-layout-${name}-top.png`),
    initialScreenshot.data,
    "base64",
  );
  Object.assign(report, await evaluate(cdp, sessionId, interactionExpression));
  Object.assign(report, await evaluate(cdp, sessionId, queryCompletionExpression));
  Object.assign(report, await evaluate(cdp, sessionId, languageToggleExpression));
  const localizedResults = await evaluate(cdp, sessionId, geographyAuditExpression);
  verifyLocalizedWorkbooks(localizedResults);
  report.bilingualGeographyQueries = localizedResults.results.length === 6;
  report.bilingualWorkbooks = localizedResults.results.every((item) => item.exports.length === 2);
  report.requestsExcludePrivateKey = localizedResults.requests.every((url) => !/USERID=/iu.test(url));

  const screenshot = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true, captureBeyondViewport: false },
    sessionId,
  );
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, `web-layout-${name}.png`), screenshot.data, "base64");
  await cdp.send("Target.closeTarget", { targetId });
  return report;
}

const port = await findOpenPort();
const profile = mkdtempSync(join(tmpdir(), "metro-studio-web-audit-"));
const browser = spawn(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--allow-file-access-from-files",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

try {
  const version = await waitForBrowser(port);
  const cdp = connectCdp(version.webSocketDebuggerUrl);
  await cdp.ready;
  const report = {
    mobile: await inspectViewport(cdp, 375, 812, "mobile"),
    tablet: await inspectViewport(cdp, 820, 1000, "tablet"),
    desktop: await inspectViewport(cdp, 1440, 1000, "desktop"),
  };
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    join(artifacts, "web-layout-audit.json"),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    Object.values(report).some((viewport) =>
      Object.entries(viewport)
        .filter(([key]) => key !== "geometry" && key !== "viewport")
        .some(([, value]) => value === false)
    )
  ) {
    process.exitCode = 1;
  }
  await cdp.send("Browser.close");
} finally {
  browser.kill();
}
