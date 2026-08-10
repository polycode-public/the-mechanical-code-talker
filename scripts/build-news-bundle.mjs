// build-news-bundle.mjs — bundle news.html's thin client for the browser
// (public/news-browser.bundle.js), mirroring build-research-bundle.mjs's
// shape.
//
// Builds src/surfaces/web/news-browser-entry.mjs -> public/news-browser.bundle.js:
// createNewsSession() as tmct.open() — a session key minted at the first
// press, the row service's poll/enrich/ingest triggers, and the purge
// stop & forget wires to. No engine, no seed: the module esbuild bundles
// here imports nothing beyond the row-backend error classes and the HTTP
// client backend's `deleteAll` (src/surfaces/web/http-row-backend.mjs), so
// there is no chat.mjs-adjacent chain (strategies, sprite templates,
// answer-variants) for this bundle to strip in the first place.
//
// Gitignored and Pages-demo-site-only: scripts/build-demo-site.mjs builds it
// fresh on every deploy, never committed, the same posture every sibling
// *-browser-entry.mjs documents for its own output.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { buildBundle } from "./lib/browser-bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** Build public/news-browser.bundle.js into `outDir` (default the repo's own
 *  public/; TMCT_NEWS_BUNDLE_OUT redirects it for tests and the site build). */
export async function main(outDir = process.env.TMCT_NEWS_BUNDLE_OUT ? resolve(process.env.TMCT_NEWS_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/news-browser-entry.mjs",
    outFile: "news-browser.bundle.js",
    outDir,
  });
  const { size } = await stat(outPath);
  return { outPath, size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size } = await main();
  console.log(`news bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
}
