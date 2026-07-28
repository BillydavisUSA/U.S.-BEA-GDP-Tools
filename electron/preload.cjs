const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", Object.freeze({
  isDesktop: true,
  arch: process.arch,
  fetchBea(search) {
    return ipcRenderer.invoke("bea:fetch", search);
  },
  setTheme(theme) {
    return ipcRenderer.invoke("theme:set", theme);
  },
}));
