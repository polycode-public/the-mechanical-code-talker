// electron/preload.cjs — the context-isolated bridge. It exposes a tiny,
// audited surface (window.tmctDesktop) to the renderer: two picker calls that
// return a parsed graph payload, and the platform string. Nothing else from
// Node or Electron crosses the boundary, so the renderer stays a plain web page
// that happens to gain "Open graph…" / "Open repo…" when it runs in the shell.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tmctDesktop", {
  openGraph: () => ipcRenderer.invoke("code-explorer:open-graph"),
  openRepo: () => ipcRenderer.invoke("code-explorer:open-repo"),
  platform: process.platform,
});
