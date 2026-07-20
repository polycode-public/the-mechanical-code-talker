// build-chat-bundle.mjs — bundle tmct's FULL chat turn engine for chat.html's
// embedded chat.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/chat-browser-entry.mjs -> public/chat-browser.bundle.js —
//     runTurn behind createChatSession: teach, recall, proof chains, plans,
//     the honest miss — the same dispatch the CLI runs, against an in-memory
//     Backend-B store.
//
// The output is gitignored and Pages-only: scripts/build-demo-site.mjs builds
// it fresh on every deploy (and `npm run build:chat-bundle` locally), so the
// served bundle can never drift from src/. That is the opposite arrangement
// from the COMMITTED memory-ask bundle, which npm publish packs.
//
// Stub selection differs from build-ask-bundle.mjs in two deliberate ways:
//   - ask-nlp/wink-model stay LIVE — the page registers a CDN-loaded wink
//     model through tmctChat.registerWinkModel, so the lemma/POS tier can
//     come up in the browser; without a registration the loader's internal
//     catch degrades it to null, same as a checkout without the optional deps;
//   - the ace strategy stays LIVE — grammar/ace.mjs reads its lexicon as an
//     inlined JSON module, so teach/ambiguity parsing is browser-clean.
// The constructions bank and answer-variants stubs stay: both exist to keep
// browser phrasing deterministic and the bank files unread.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { stubNodeBuiltins, stubNodeZlib, makeOptionalAdapterStubs, buildBundle } from "./lib/browser-bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const OPTIONAL_ADAPTER_STUBS = {
  "strategies/constructions.mjs": "export const constructionsStrategy = undefined;\nexport const setConstructionBanks = () => {};\n",
  // the fs+TOML side of the construction banks — never read in the browser
  // (the strategy above is stubbed out entirely).
  "corpus/construction-banks.mjs": "export const CONSTRUCTIONS_DIR = \"\";\nexport const readConstructionFiles = () => ({ relations: [], constructions: [] });\n",
  // phrasing variety stays OFF in the embedded chat — the browser answer is
  // always the base phrase, exactly as when the variants file can't be read.
  "answer-variants.mjs": "export const pickPhrase = (poolId, key, base) => base;\n",
};

/** Build public/chat-browser.bundle.js into `outDir` (default the repo's own
 *  public/; TMCT_CHAT_BUNDLE_OUT redirects it for tests and the site build). */
export async function main(outDir = process.env.TMCT_CHAT_BUNDLE_OUT ? resolve(process.env.TMCT_CHAT_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/chat-browser-entry.mjs",
    outFile: "chat-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`chat bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
