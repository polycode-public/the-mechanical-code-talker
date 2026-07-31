// build-ledger-bundle.mjs — bundle the live ledger-dock engine for the
// browser (public/ledger-browser.bundle.js), mirroring
// build-plan-bundle.mjs's shape exactly.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/ledger-browser-entry.mjs -> public/ledger-browser.bundle.js —
//     createLedgerSession: the full chat turn engine (teach, recall, proof
//     chains, the honest miss — the same dispatch the CLI runs) over an
//     in-memory Backend-B store seeded from the ledger page's own embedded
//     PAYLOAD, plus computeLedgerDataFromPayload so a post-teach re-render
//     never duplicates the page's own derivation logic.
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs
// builds it fresh on every deploy (and `npm run build:ledger-bundle`
// locally), so the served bundle can never drift from src/ — the same
// arrangement build-plan-bundle.mjs already documents for its own output.
//
// Stub selection matches build-plan-bundle.mjs's OWN OPTIONAL_ADAPTER_STUBS:
// the ledger dock is dispatched through the exact same runTurn, so it pulls
// in the identical strategies/construction-bank/answer-variants modules that
// bundle already strips.
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

/** Build public/ledger-browser.bundle.js into `outDir` (default the repo's
 *  own public/; TMCT_LEDGER_BUNDLE_OUT redirects it for tests and the site
 *  build). */
export async function main(outDir = process.env.TMCT_LEDGER_BUNDLE_OUT ? resolve(process.env.TMCT_LEDGER_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/ledger-browser-entry.mjs",
    outFile: "ledger-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`ledger bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
