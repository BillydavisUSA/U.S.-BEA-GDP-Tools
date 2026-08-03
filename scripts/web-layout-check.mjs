import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
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
  search.value = "纽约";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const cityResultText = searchResults.textContent;
  const citySearchWorks =
    !searchResults.hidden
    && searchResults.querySelectorAll(".search-result").length > 0
    && (cityResultText.includes("New York") || cityResultText.includes("纽约"))
    && document.querySelector("#metro-type-field").hidden
    && document.querySelector("#coverage-badge").textContent.includes("143")
    && document.querySelector("#select-all-label").textContent.toLowerCase().includes(
      document.documentElement.lang === "zh-CN" ? "城市" : "cities"
    );

  geography.value = "country";
  geography.dispatchEvent(new Event("change", { bubbles: true }));
  const frequency = document.querySelector("#frequency");
  frequency.value = "Q";
  frequency.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    stateSearchWorks,
    citySearchWorks,
    searchAvoidsMeasureOverlap,
    countryControlsWork:
      !document.querySelector("#country-summary").hidden
      && !document.querySelector("#frequency-field").hidden
      && !document.querySelector("#quarterly-mode-field").hidden
      && document.querySelector("#search-group").hidden
  };
})()`;

const queryCompletionExpression = `(async () => {
  window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      BEAAPI: {
        Results: {
          Statistic: "Gross domestic product",
          UnitOfMeasure: "Millions of dollars",
          Data: [{
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
  document.querySelector("#query").requestSubmit();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!document.querySelector("#success-state").hidden) break;
    if (!document.querySelector("#error-state").hidden) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return {
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
