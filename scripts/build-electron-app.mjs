// build-electron-app.mjs — assemble the code-explorer's renderer assets for the
// Electron shell into electron/renderer/ (gitignored, built fresh, never
// published). Four steps, all reusing the same seams the site build reuses:
//   1. build the demo code graph (public/demo-graph.json) if it is missing;
//   2. build the live dock bundle (code-explorer.bundle.js) into the renderer;
//   3. build the shared wink vendor asset into the renderer, so the lemma/POS
//      tier works fully offline (the desktop shell has no network);
//   4. render index.html from the demo graph via renderCodeExplorerHtml,
//      linking the sibling bundle.
//
// The Electron main process (electron/main.mjs) loads electron/renderer/
// index.html; the graph pickers swap the payload client-side afterwards. This
// is a packaging step, not a bundler plugin — run by `npm run build:electron`
// and by the smoke script before it launches.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { computeCodeExplorerData, renderCodeExplorerHtml, VENDOR_WINK_LOADER_JS } from "../src/services/code-explorer-viz.mjs";
import { main as buildCodeExplorerBundle } from "./build-code-explorer-bundle.mjs";
import { buildWinkVendor } from "./build-wink-vendor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RENDERER_DIR = join(ROOT, "electron", "renderer");
const DEMO_GRAPH = join(ROOT, "public", "demo-graph.json");

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

export async function buildElectronApp() {
  await mkdir(RENDERER_DIR, { recursive: true });

  // build-demo-graph.mjs writes public/demo-graph.json as an import side
  // effect (its default output path); only trigger it when the file is absent.
  if (!(await exists(DEMO_GRAPH))) await import("./build-demo-graph.mjs");

  await buildCodeExplorerBundle(RENDERER_DIR);
  await buildWinkVendor(RENDERER_DIR);

  const payload = JSON.parse(await readFile(DEMO_GRAPH, "utf8"));
  const data = computeCodeExplorerData(payload, { title: "demo code graph" });
  const html = renderCodeExplorerHtml(data, {
    bundleAvailable: true,
    winkLoaderInline: VENDOR_WINK_LOADER_JS,
    sourceName: "demo code graph",
  });
  const indexPath = join(RENDERER_DIR, "index.html");
  await writeFile(indexPath, html);
  return { indexPath, rendererDir: RENDERER_DIR, focus: data.focus, hintCount: data.hints.length };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { indexPath, focus, hintCount } = await buildElectronApp();
  console.log(`electron renderer: ${indexPath} (focus "${focus}", ${hintCount} hints)`);
}
