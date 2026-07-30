// build-code-explorer-bundle.mjs — bundle the live code-explorer dock engine
// for the browser (code-explorer.bundle.js), mirroring build-ledger-bundle.mjs.
//
// One IIFE bundle from src/surfaces/web/code-explorer-browser-entry.mjs: the
// full chat turn engine over a code graph (imports/calls/contains lanes plus
// teach/recall), exposing createCodeExplorerSession and the re-derivation
// helpers on window.tmctCodeExplorer. The output is gitignored and built fresh
// (by scripts/build-electron-app.mjs and `npm run build:code-explorer-bundle`),
// so the shipped bundle can never drift from src/. Stub selection matches the
// ledger dock's: the same runTurn pulls in the same optional adapters that
// bundle strips.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { stubNodeBuiltins, stubNodeZlib, makeOptionalAdapterStubs, buildBundle } from "./lib/browser-bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const OPTIONAL_ADAPTER_STUBS = {
  "strategies/constructions.mjs": "export const constructionsStrategy = undefined;\nexport const setConstructionBanks = () => {};\n",
  "corpus/construction-banks.mjs": "export const CONSTRUCTIONS_DIR = \"\";\nexport const readConstructionFiles = () => ({ relations: [], constructions: [] });\n",
  "answer-variants.mjs": "export const pickPhrase = (poolId, key, base) => base;\n",
  // tmct_sprite is a cold (CLI-only) tool, but dispatchTool's handler registry
  // imports every handler statically, so its fs+TOML loaders are link-time
  // reachable here even though nothing in this bundle ever calls it. Both
  // modules' own headers already declare "never imported by a browser entry"
  // as the intended invariant; this restores it rather than changing it.
  "corpus/sprite-template-files.mjs": "export const SPRITE_TEMPLATES_DIR = \"\";\nexport const readSpriteTemplateFiles = () => [];\n",
  "corpus/sprite-large-template-files.mjs": "export const SPRITE_LARGE_TEMPLATES_DIR = \"\";\nexport const readSpriteLargeTemplateFiles = () => [];\n",
};

/** Build code-explorer.bundle.js into `outDir` (default the repo's own
 *  public/; TMCT_CODE_EXPLORER_BUNDLE_OUT redirects it for the desktop build
 *  and tests). */
export async function main(outDir = process.env.TMCT_CODE_EXPLORER_BUNDLE_OUT ? resolve(process.env.TMCT_CODE_EXPLORER_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/code-explorer-browser-entry.mjs",
    outFile: "code-explorer.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`code-explorer bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
