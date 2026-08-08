// build-news-bundle.mjs — bundle news.html's engine for the browser
// (public/news-browser.bundle.js), mirroring build-research-bundle.mjs's
// shape, plus one extra step neither sibling needs: emitting
// public/news-fixtures.json, the committed pair the page's two fixture-replay
// demo buttons push through the live ingest pipeline with the network fully
// blocked (PLAN_NEWS_FEED.md section 13.2).
//
// Builds:
//   - src/surfaces/web/news-browser-entry.mjs -> public/news-browser.bundle.js —
//     createNewsSession (poll/enrich/rank/buildFeed/addSource/ingest/replay,
//     every one of them consent-gated except replayFixture) over the news
//     capability (src/services/news.mjs), the same in-memory Backend-B store
//     every other demo page's bundle runs.
//   - test/fixtures/news/{nyt-world.rss.xml,wikimedia-featured.json} ->
//     public/news-fixtures.json — the exact wire-format bodies a live fetch
//     would have returned, keyed by source id, so "replay recorded NYT
//     sample" / "replay recorded Wikipedia sample" run the identical parse ->
//     ingest pipeline a real poll runs, minus the network call.
//
// Both outputs are gitignored and Pages-demo-site-only: scripts/build-demo-
// site.mjs will build them fresh on every deploy once news.html joins
// DEMO_PAGES (a later round), never committed — the same posture every
// sibling *-browser-entry.mjs documents for its own output.
//
// Stub selection matches build-ingest-bundle.mjs's OWN OPTIONAL_ADAPTER_STUBS:
// news-browser-entry.mjs's ingestText/replayFixture paths run through
// extract-facts.mjs, which imports chat.mjs for runTurn — the same
// strategies/construction-bank/answer-variants/sprite-template modules those
// bundles already strip.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stat, readFile, writeFile, mkdir, rename } from "node:fs/promises";
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

const FIXTURES_DIR = join(ROOT, "test", "fixtures", "news");

/** The two named demo buttons' fixtures, read as the wire body a live fetch
 *  would have returned: the NYT RSS body verbatim (a string, the shape
 *  parseFeed itself takes), the Wikimedia featured-feed body parsed once
 *  here (an object, the shape the page's wikimedia-specific mapping reads) —
 *  never re-parsed from a raw string client-side beyond what the fetcher
 *  itself would have done. */
async function readNewsFixtures() {
  const nytBody = await readFile(join(FIXTURES_DIR, "nyt-world.rss.xml"), "utf8");
  const wikimediaBody = JSON.parse(await readFile(join(FIXTURES_DIR, "wikimedia-featured.json"), "utf8"));
  return {
    "nyt-world": { format: "rss", body: nytBody },
    "wikimedia-featured": { format: "wikimedia-feed", body: wikimediaBody },
  };
}

async function writeNewsFixturesJson(outDir) {
  const outPath = join(outDir, "news-fixtures.json");
  const tmpPath = outPath + ".tmp";
  await mkdir(outDir, { recursive: true });
  await writeFile(tmpPath, JSON.stringify(await readNewsFixtures()), "utf8");
  await rename(tmpPath, outPath);
  return outPath;
}

/** Build public/news-browser.bundle.js and public/news-fixtures.json into
 *  `outDir` (default the repo's own public/; TMCT_NEWS_BUNDLE_OUT redirects
 *  it for tests and the site build). */
export async function main(outDir = process.env.TMCT_NEWS_BUNDLE_OUT ? resolve(process.env.TMCT_NEWS_BUNDLE_OUT) : join(ROOT, "public")) {
  const outPath = await buildBundle({
    entryFile: "surfaces/web/news-browser-entry.mjs",
    outFile: "news-browser.bundle.js",
    outDir,
    plugins: [stubNodeZlib, makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
  });
  const { size } = await stat(outPath);
  const fixturesPath = await writeNewsFixturesJson(outDir);
  const { size: fixturesSize } = await stat(fixturesPath);
  return { outPath, size, fixturesPath, fixturesSize };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { outPath, size, fixturesPath, fixturesSize } = await main();
  console.log(`news bundle: ${outPath} (${(size / 1024).toFixed(0)} KB)`);
  console.log(`news fixtures: ${fixturesPath} (${(fixturesSize / 1024).toFixed(0)} KB)`);
}
