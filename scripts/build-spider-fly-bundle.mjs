// build-spider-fly-bundle.mjs — bundle the spider-and-fly engine for the
// browser (public/spider-fly-browser.bundle.js), mirroring
// build-chat-bundle.mjs's shape exactly.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/spider-fly-browser-entry.mjs -> public/spider-fly-browser.bundle.js —
//     createSpiderFlySession: the headless engine's tick(), the full chat
//     turn engine's turn(), and a read-only snapshot(), all over one
//     in-memory store (see the entry file's own header for why both a raw
//     tick and a full chat turn are exposed side by side).
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs builds
// it fresh on every deploy (and `npm run build:spider-fly-bundle` locally),
// so the served bundle can never drift from src/ — the same arrangement
// build-chat-bundle.mjs already documents for its own output.
//
// Stub selection matches build-chat-bundle.mjs's OWN OPTIONAL_ADAPTER_STUBS:
// the spider-fly lane is dispatched through the exact same runTurn, so it
// pulls in the identical strategies/construction-bank/answer-variants modules
// that bundle already strips.
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

/** Build public/spider-fly-browser.bundle.js into `outDir` (default the
 *  repo's own public/; TMCT_SPIDER_FLY_BUNDLE_OUT redirects it for tests and
 *  the site build). */
export async function main(outDir = process.env.TMCT_SPIDER_FLY_BUNDLE_OUT ? resolve(process.env.TMCT_SPIDER_FLY_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/spider-fly-browser-entry.mjs",
    outFile: "spider-fly-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`spider-fly bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
