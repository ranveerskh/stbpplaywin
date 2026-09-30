const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stbPlay", {
  platform: process.platform,
  installUpdate: (url) => ipcRenderer.invoke("download-and-install-update", String(url || "")),
});
