const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require("electron");
const path = require("node:path");

const BEA_ENDPOINT = "https://apps.bea.gov/api/data/";
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const ALLOWED_BEA_PARAMETERS = new Set([
  "METHOD",
  "DATASETNAME",
  "FREQUENCY",
  "GEOFIPS",
  "LINECODE",
  "TABLENAME",
  "YEAR",
  "RESULTFORMAT",
  "USERID",
]);

let mainWindow;

function getTitleBarOverlay() {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#1c1c1e", symbolColor: "#f5f5f7", height: 52 }
    : { color: "#f7f7f9", symbolColor: "#1d1d1f", height: 52 };
}

function openExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (EXTERNAL_PROTOCOLS.has(url.protocol)) shell.openExternal(url.href);
  } catch {
    // Ignore malformed links instead of handing them to the operating system.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ededf0",
    title: "Metro Studio",
    titleBarStyle: "hidden",
    titleBarOverlay: getTitleBarOverlay(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url === currentUrl) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    mainWindow.loadURL(developmentUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

ipcMain.handle("bea:fetch", async (_event, rawSearch) => {
  try {
    if (typeof rawSearch !== "string" || rawSearch.length > 50_000) {
      throw new Error("Invalid BEA request.");
    }

    const params = new URLSearchParams(rawSearch.startsWith("?") ? rawSearch.slice(1) : rawSearch);
    for (const key of params.keys()) {
      if (!ALLOWED_BEA_PARAMETERS.has(key.toUpperCase())) {
        throw new Error(`Unsupported BEA parameter: ${key}`);
      }
    }

    const target = new URL(BEA_ENDPOINT);
    target.search = params.toString();
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Metro-Studio/1.0.0",
      },
      signal: AbortSignal.timeout(60_000),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("BEA returned a response that was not valid JSON.");
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.message || "Unable to reach the BEA API.",
    };
  }
});

ipcMain.handle("theme:set", (_event, theme) => {
  const allowedThemes = new Set(["light", "dark"]);
  nativeTheme.themeSource = allowedThemes.has(theme) ? theme : "light";
  return {
    themeSource: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  };
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId("org.metrogdp.studio");
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    nativeTheme.on("updated", () => {
      mainWindow?.setTitleBarOverlay(getTitleBarOverlay());
      mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ededf0");
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
