// electron/smoke.test.mjs — the desktop shell smoke, driven by Playwright's
// _electron. It launches the real Electron app on the built renderer and
// checks the IDE shell comes up: the explorer ledger has rows, the hint rail
// carries suggested queries, the demo focus symbol is named, the status bar
// reports the graph's counts, and the general-knowledge seed settles into a
// definite state (loaded, or the clean graph-only note).
//
// Kept OUT of `npm test` on purpose — it needs the Electron binary and a real
// windowing launch, neither of which belongs in the hermetic suite. Run it with
// `npm run test:electron`. Because .npmrc sets ignore-scripts=true, installing
// electron as a devDependency does NOT fetch its binary; fetch it once with
//   node node_modules/electron/install.js
// This test SKIPS cleanly (exit 0) when the binary or Playwright is absent, so
// a checkout without the desktop extras never fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function resolveElectronBinary() {
  let electronPath;
  try {
    electronPath = require("electron"); // the package's default export is the binary path
  } catch {
    return { reason: "the electron devDependency is not installed (npm i -D electron)" };
  }
  if (typeof electronPath !== "string" || !existsSync(electronPath)) {
    return { reason: "the Electron binary is not downloaded (run: node node_modules/electron/install.js)" };
  }
  return { electronPath };
}

async function resolvePlaywrightElectron() {
  try {
    const { _electron } = await import("playwright");
    return _electron;
  } catch {
    return null;
  }
}

test("the desktop shell renders the IDE shell: ledger, hints, focus, stats, and a settled seed state", async (t) => {
  const _electron = await resolvePlaywrightElectron();
  if (!_electron) { t.skip("playwright is not installed"); return; }
  const { electronPath, reason } = await resolveElectronBinary();
  if (!electronPath) { t.skip(reason); return; }

  // Build the renderer fresh so the launch always has assets to load.
  const { buildElectronApp } = await import("../scripts/build-electron-app.mjs");
  await buildElectronApp();

  const app = await _electron.launch({
    executablePath: electronPath,
    args: [join(HERE, "main.mjs")],
  });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector("#ledger .row", { timeout: 15000 });

    const rowCount = await win.locator("#ledger .row").count();
    assert.ok(rowCount > 0, "the ledger shows at least one fact row");

    const hintCount = await win.locator("#hints .hint").count();
    assert.ok(hintCount > 0, "the hint rail offers at least one suggested query");

    const focusText = (await win.locator("#focus-name").textContent())?.trim();
    assert.ok(focusText && focusText !== "—", `a focus symbol is named (got "${focusText}")`);

    const firstHint = (await win.locator("#hints .hint").first().textContent())?.trim();
    assert.ok(firstHint && firstHint.length > 0, "a hint has text");

    const stats = (await win.locator("#stats").textContent())?.trim();
    assert.match(stats ?? "", /\d+ individuals/, "the status bar reports the graph's individual count");

    // The seed either loads (the packaged chat-seed.json over the preload
    // bridge) or the page says plainly it is running graph-only — never a
    // hung "loading" state and never a blank.
    await win.waitForFunction(
      () => /general knowledge: \d+ facts|graph-only/.test(document.getElementById("seed-status")?.textContent || ""),
      null,
      { timeout: 30000 },
    );
  } finally {
    await app.close();
  }
});
