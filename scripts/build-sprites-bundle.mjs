// build-sprites-bundle.mjs — bundle the chat engine for sprites.html's dock
// (public/sprites-browser.bundle.js), mirroring build-spider-fly-bundle.mjs's
// shape exactly.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/sprites-browser-entry.mjs -> public/sprites-browser.bundle.js —
//     createSpriteCatalogSession: the full chat turn engine over one
//     in-memory store seeded with the embedded sprite-facts rows.
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs builds
// it fresh on every deploy (and `npm run build:sprites-bundle` locally), so
// the served bundle can never drift from src/.
//
// Stub selection matches build-spider-fly-bundle.mjs's own set: the dock is
// dispatched through the exact same runTurn, so it pulls in the identical
// strategies/construction-bank/answer-variants modules that bundle already
// strips.
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
};

/** Build public/sprites-browser.bundle.js into `outDir` (default the repo's
 *  own public/; TMCT_SPRITES_BUNDLE_OUT redirects it for tests and the site
 *  build). */
export async function main(outDir = process.env.TMCT_SPRITES_BUNDLE_OUT ? resolve(process.env.TMCT_SPRITES_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/sprites-browser-entry.mjs",
    outFile: "sprites-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`sprites bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
