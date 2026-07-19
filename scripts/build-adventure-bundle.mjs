// build-adventure-bundle.mjs — bundle the adventure engine for the browser
// (public/adventure-browser.bundle.js), mirroring build-spider-fly-bundle.mjs's
// shape exactly.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/adventure-browser-entry.mjs -> public/adventure-browser.bundle.js —
//     createAdventureSession: the world bootstrap, a raw autoplayTick(), and a
//     read-only snapshot(), all over one in-memory store.
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs builds
// it fresh on every deploy (and `npm run build:adventure-bundle` locally), so
// the served bundle can never drift from src/ — the same arrangement
// build-spider-fly-bundle.mjs already documents for its own output.
//
// Stub selection matches build-spider-fly-bundle.mjs's OWN OPTIONAL_ADAPTER_STUBS:
// adventure.mjs is a dependency of chat.mjs's own runTurn (the exact path
// both the spider-fly and chat bundles already exercise successfully), so an
// adventure-only entry point pulls in a strict subset of what those bundles
// already strip cleanly.
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

/** Build public/adventure-browser.bundle.js into `outDir` (default the
 *  repo's own public/; TMCT_ADVENTURE_BUNDLE_OUT redirects it for tests and
 *  the site build). */
export async function main(outDir = process.env.TMCT_ADVENTURE_BUNDLE_OUT ? resolve(process.env.TMCT_ADVENTURE_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/adventure-browser-entry.mjs",
    outFile: "adventure-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`adventure bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
