// build-mudiii-bundle.mjs — bundle the mudiii engine for the browser
// (public/mudiii-browser.bundle.js), mirroring build-mud-bundle.mjs's
// shape exactly — same stub set, since mudiii-browser-entry.mjs pulls in the
// same chat.mjs -> adventure.mjs dependency chain plus mudiii surface modules,
// which add no new optional adapter of their own.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/mudiii-browser-entry.mjs -> public/mudiii-browser.bundle.js —
//     createMudiiiSession: the shared-world bootstrap with 3D rendering,
//     character motion, camera controls, and one omniscient snapshot(), all over
//     one in-memory store.
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs builds
// it fresh on every deploy (and `npm run build:mudiii-bundle` locally), so the
// served bundle can never drift from src/.
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

/** Build public/mudiii-browser.bundle.js into `outDir` (default the repo's own
 *  public/; TMCT_MUDIII_BUNDLE_OUT redirects it for tests and the site build). */
export async function main(outDir = process.env.TMCT_MUDIII_BUNDLE_OUT ? resolve(process.env.TMCT_MUDIII_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/mudiii-browser-entry.mjs",
    outFile: "mudiii-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`mudiii bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
