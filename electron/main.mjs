// electron/main.mjs — the desktop shell for the tmct code explorer. It is the
// ONLY desktop-specific piece: it opens a window on the channel-agnostic
// renderer (electron/renderer/index.html, built by
// scripts/build-electron-app.mjs) and answers two file-picker requests over
// IPC — open a graph.json, or open a repo whose .tmct/ holds one. Everything
// the window shows is the same ledger-pattern UI a plain page would serve.
//
// No tmct library code runs here; the renderer's own bundle carries the engine.
// The main process only reads a file the user picked and hands its parsed
// payload back, so a graph can be swapped without leaving the app.
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_INDEX = join(HERE, "renderer", "index.html");

async function readGraphFile(file) {
  const text = await readFile(file, "utf8");
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.individuals)) {
    throw new Error("not a tmct graph (no individuals array)");
  }
  return payload;
}

async function firstExisting(candidates) {
  for (const c of candidates) {
    try { await access(c); return c; } catch { /* keep looking */ }
  }
  return null;
}

function registerIpc() {
  ipcMain.handle("code-explorer:open-graph", async () => {
    const res = await dialog.showOpenDialog({
      title: "Open a tmct graph",
      properties: ["openFile"],
      filters: [{ name: "tmct graph", extensions: ["json"] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    try {
      return { payload: await readGraphFile(file), name: basename(file) };
    } catch (e) {
      dialog.showErrorBox("Could not open graph", String(e?.message || e));
      return null;
    }
  });

  ipcMain.handle("code-explorer:open-repo", async () => {
    const res = await dialog.showOpenDialog({
      title: "Open a repo (its .tmct graph)",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    const graphFile = await firstExisting([
      join(dir, ".tmct", "graph.json"),
      join(dir, "graph.json"),
    ]);
    if (!graphFile) {
      dialog.showErrorBox("No graph found", `No .tmct/graph.json under ${dir}. Run "tmct init" there first.`);
      return null;
    }
    try {
      return { payload: await readGraphFile(graphFile), name: basename(dir) };
    } catch (e) {
      dialog.showErrorBox("Could not open graph", String(e?.message || e));
      return null;
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "tmct code explorer",
    webPreferences: {
      preload: join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(RENDERER_INDEX);
  return win;
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
