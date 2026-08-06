// build-claims-bundle.mjs — bundle the claims page's "run it on this
// device" button (public/claims-browser.bundle.js), mirroring
// build-plan-bundle.mjs's shape exactly.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/claims-browser-entry.mjs -> public/claims-browser.bundle.js —
//     exposes solvePlannerInstance(domain, size), the same function
//     scripts/claims/claim-planner.mjs drives to produce
//     results/claims/planner.json.
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs
// builds it fresh on every deploy (and `npm run build:claims-bundle`
// locally), so the served bundle can never drift from src/.
//
// Stub selection matches build-plan-bundle.mjs's OWN OPTIONAL_ADAPTER_STUBS:
// solvePlannerInstance teaches and solves through the exact same runTurn the
// plan lane dispatches through, so it pulls in the identical strategies/
// construction-bank/answer-variants/sprite-template modules that bundle
// already strips.
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
  "corpus/sprite-template-files.mjs": "export const SPRITE_TEMPLATES_DIR = \"\";\nexport const readSpriteTemplateFiles = () => [];\n",
  "corpus/sprite-large-template-files.mjs": "export const SPRITE_LARGE_TEMPLATES_DIR = \"\";\nexport const readSpriteLargeTemplateFiles = () => [];\n",
};

/** Build public/claims-browser.bundle.js into `outDir` (default the repo's
 *  own public/; TMCT_CLAIMS_BUNDLE_OUT redirects it for tests and the site
 *  build). */
export async function main(outDir = process.env.TMCT_CLAIMS_BUNDLE_OUT ? resolve(process.env.TMCT_CLAIMS_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/claims-browser-entry.mjs",
    outFile: "claims-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`claims bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
