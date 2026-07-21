// scripts/build-demo-site.mjs — regenerate everything the GitLab Pages site
// generates rather than tracks:
//
//   engine/           unmodified copies of the engine sources the in-page demo runs
//   demo-graph.json   the example code graph (see build-demo-graph.mjs)
//   demo-memory.json  the taught payload behind the ledger (see build-demo-memory.mjs)
//   ledger.html       the memory ledger, with the ask bundle inlined AND a live
//                     teach-and-ask chat dock over its own browser bundle —
//                     `tmct viz`'s own output stays the lighter query-only page
//                     (see ledger-viz.mjs's ledgerBundleAvailable doc)
//   plan.html         the solved hanoi-3 replay plus a live re-solve session
//                     (disk-count/max-depth controls, a chat-assert dock, a
//                     PDDL+OWL/RDF plan panel) over its own browser bundle
//
// It also stamps index.html's version from package.json, so the number the page
// documents follows a version bump on its own.
//
// All of them are .gitignored. src/, examples/mini-webapp/.tmct/graph.json and the
// binary stay the single source of truth, so the published site cannot drift from
// them. Run via `npm run demo:build`, the same script .gitlab-ci.yml's `pages` job
// calls, whenever you want to serve public/ locally and try the site yourself.
//
// The copied engine set is whatever src/domain/ask.mjs's imports actually reach, walked
// from the source at build time. The copies keep src/'s directory layout under
// public/engine/src/, because their own relative imports have to keep resolving.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import { stampVersion } from "../src/domain/version-stamp.mjs";
import { importClosure } from "../src/adapters/import-closure.mjs";
import { readSpriteTemplateFiles } from "../src/adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../src/adapters/corpus/sprite-large-template-files.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SRC = join(ROOT, "src");
// Everything generated lands under SITE. It defaults to the repo's own public/,
// which is what CI and a local `npm run demo:build` want. Set TMCT_DEMO_SITE_OUT
// to build into a directory of your own instead — the browser tests do that so
// their run neither reads nor writes public/ while another build is touching it.
const SITE = process.env.TMCT_DEMO_SITE_OUT ? resolve(process.env.TMCT_DEMO_SITE_OUT) : join(ROOT, "public");
const OUT = join(SITE, "engine", "src");

// The wink lemma/POS tier arrives through a computed specifier, so reading the
// source cannot see it. Everything these two reach is walked like any other file.
const DYNAMICALLY_LOADED = ["adapters/wink-model.mjs", "adapters/ask-nlp.mjs"];

// The sprite template library (data/sprites/*.toml): read once, here, in
// Node, and handed to both the spider-fly and adventure hero renders below
// as embedded page data — the browser bundles stay fs-free, the same reason
// Ashcombe Hall's own world facts are read once at build time rather than
// bundled.
const spriteTemplates = readSpriteTemplateFiles();

// The footer's version number, rewritten from package.json on every build. The
// page is tracked, so the committed copy carries whatever the last build wrote;
// CI stamps it again before it publishes public/, which is what makes a bump
// reach the deployed page without anyone editing HTML. post-deploy-smoke.mjs
// reads the same element back off that page.
function stampPageVersion() {
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const page = join(SITE, "index.html");
  writeFileSync(page, stampVersion(readFileSync(page, "utf8"), version));
  console.log(`stamped ${page} with version ${version}`);
}

// Clear OUT first. Copying into it without clearing leaves every file src/ has
// since renamed sitting there forever, and the browser loads whatever it finds:
// the five-layer src/ move stranded a whole flat copy of the old layout on each
// dev machine that had run this. CI never saw it, because CI checks out clean.
rmSync(OUT, { recursive: true, force: true });

const engineFiles = importClosure("domain/ask.mjs", { root: SRC, seeds: DYNAMICALLY_LOADED });
for (const rel of engineFiles) {
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  cpSync(join(SRC, rel), join(OUT, rel));
}

console.log(`copied ${engineFiles.length} engine source files into ${OUT}`);

stampPageVersion();

// The shared wink vendor asset, built first: every page's lemma/POS tier
// (chat/ledger/plan/index) imports this ONE same-origin file through the
// registerWinkModel seam — no CDN, no per-bundle copy.
{
  const { buildWinkVendor } = await import(join(here, "build-wink-vendor.mjs"));
  const { outPath: winkVendorPath, bytes: winkVendorBytes } = await buildWinkVendor(SITE);
  console.log(`wrote ${winkVendorPath} (${(winkVendorBytes / 1048576).toFixed(2)} MB)`);
}

execFileSync(process.execPath, [join(here, "build-demo-graph.mjs"), join(SITE, "demo-graph.json")], { stdio: "inherit" });

// The ledger hero: build the memory payload through the real teach paths, then
// render public/ledger.html (memory-ask bundle inlined, exactly as `tmct viz`
// writes it) plus this page's own dedicated browser bundle (the full turn
// engine, same posture as the plan/spider-fly/adventure bundles below —
// generated fresh per build, never committed) so the deployed page's chat
// dock can teach new facts, not just answer them. ledgerBundleAvailable:true
// is what makes renderLedgerHtml link the sibling bundle at all — bin/tmct.mjs's
// own `tmct viz` never passes it, so the CLI's own output stays exactly the
// self-contained, query-only page it always was.
const { main: buildDemoMemory } = await import(join(here, "build-demo-memory.mjs"));
const { outPath: memoryPath } = await buildDemoMemory(join(SITE, "demo-memory.json"));
const { readFile: readF, writeFile: writeF } = await import("node:fs/promises");
const { computeLedgerDataFromPayload, renderLedgerHtml, readMemoryAskBundle } = await import(join(ROOT, "src", "services/ledger-viz.mjs"));
const payload = JSON.parse(await readF(memoryPath, "utf8"));
const ledgerData = computeLedgerDataFromPayload(payload, {});
const memoryAskBundle = await readMemoryAskBundle();
const { main: buildLedgerBundle } = await import(join(here, "build-ledger-bundle.mjs"));
const { outPath: ledgerBundlePath, size: ledgerBundleBytes } = await buildLedgerBundle(SITE);
console.log(`wrote ${ledgerBundlePath} (${(ledgerBundleBytes / 1024).toFixed(0)} KB)`);
const ledgerPath = join(SITE, "ledger.html");
await writeF(ledgerPath, renderLedgerHtml({ ...ledgerData, memoryAskBundle, ledgerBundleAvailable: true }));
console.log(`wrote ${ledgerPath} (${memoryAskBundle ? "chat dock enabled" : "no bundle — dock disabled"})`);

// chat.html's full engine: the browser bundle plus its starter-memory seed,
// both generated (never committed) so the page always serves what src/
// builds today.
const { main: buildChatBundle } = await import(join(here, "build-chat-bundle.mjs"));
const { outPath: chatBundlePath, size: chatBundleBytes } = await buildChatBundle(SITE);
console.log(`wrote ${chatBundlePath} (${(chatBundleBytes / 1024).toFixed(0)} KB)`);
const { main: buildChatSeed } = await import(join(here, "build-chat-seed.mjs"));
const seed = await buildChatSeed(join(SITE, "chat-seed.json"));
console.log(`wrote ${seed.outPath} (${seed.facts} facts, ${(seed.bytes / 1024).toFixed(0)} KB)`);

// The reference pack's browser subset (public/reference-pack/): EVERY term
// the full pack at this machine already resolves, not a curated slice — the
// lazy per-citation fetch path (chat-browser-entry.mjs's fetchPackProvider)
// reaches whatever's already built, and a term genuinely absent from the pack
// reads as the ordinary honest miss, same as it always did. Skipped outright
// when this machine carries no pack at all.
{
  const { referencePackDir } = await import(join(ROOT, "src", "adapters", "corpus", "reference-pack.mjs"));
  const packDir = referencePackDir();
  if (existsSync(join(packDir, "index.json.gz"))) {
    const { buildDemoPack, allPackTerms } = await import(join(here, "build-demo-pack.mjs"));
    const packOut = join(SITE, "reference-pack");
    rmSync(packOut, { recursive: true, force: true });
    const manifest = buildDemoPack({ srcDir: packDir, terms: allPackTerms(packDir), outDir: packOut });
    console.log(`wrote ${packOut} (${Object.keys(manifest.terms).length} terms)`);
  } else {
    console.log(`reference pack not present at ${packDir} — demo pack skipped (run \`npm run gen:reference-pack\` to enable)`);
  }
}

// "Talk to it"'s full-screen destination: the SAME chat bundle/seed/pack
// built just above, reused as-is — chat.html is a second consumer of them,
// never a second engine.
{
  const { renderChatHtml } = await import(join(ROOT, "src", "services", "chat-page-viz.mjs"));
  const chatPagePath = join(SITE, "chat.html");
  await writeF(chatPagePath, renderChatHtml());
  console.log(`wrote ${chatPagePath}`);
}

// The sprite tier meant to be looked at closely (400px, gradient/highlight
// material shading, data/sprites-large/*.toml): excluded from the npm
// package entirely (package.json's own "!data/sprites-large/"), so only
// this build step's own generated public/sprites-pack/ carries it to the
// deployed site. No page FETCHES this pack client-side yet — this step just
// confirms the pack itself builds; sprites.html below reads the same large
// tier a different way, straight off disk at build time, same as every
// other viz page's build-time data.
// The manifest is the ENTIRE large-sprite pack (one file, the full resolved
// template set inline — see buildDemoSpritesPack), so holding onto it here
// lets the adventure page embed it below instead of lazy-fetching the same
// 560 KB back over the wire at every page load.
let largeSpriteManifest = null;
{
  const { buildDemoSpritesPack } = await import(join(here, "build-demo-sprites-pack.mjs"));
  const spritesPackOut = join(SITE, "sprites-pack");
  rmSync(spritesPackOut, { recursive: true, force: true });
  const { manifest, bytes } = buildDemoSpritesPack({ outDir: spritesPackOut });
  largeSpriteManifest = manifest;
  console.log(`wrote ${spritesPackOut} (${manifest.templates.length} templates, ${(bytes / 1024).toFixed(1)} KB)`);
}

// The sprite library catalog: every class either tier resolves a sprite for,
// grouped for browsing, each swatch resolved through the real
// resolveSpriteAsset/classAncestorChain (never hand-simulated) — see
// sprite-catalog-viz.mjs's own header for the real ontology-fact sources
// (the spider-fly world's SEED_TAXONOMY plus corpus/wordnet/wordnet-xl.jsonl)
// this step loads once, in Node, the same posture the ledger/adventure/
// spider-fly build steps above already take with their own build-time data.
{
  const spriteLargeTemplates = readSpriteLargeTemplateFiles();
  const { loadSpriteOntologyFactRows, renderSpriteCatalogHtml } = await import(join(ROOT, "src", "services/sprite-catalog-viz.mjs"));
  const ontologyFactRows = await loadSpriteOntologyFactRows();
  const { main: buildSpritesBundle } = await import(join(here, "build-sprites-bundle.mjs"));
  const { outPath: spritesBundlePath, size: spritesBundleBytes } = await buildSpritesBundle(SITE);
  console.log(`wrote ${spritesBundlePath} (${(spritesBundleBytes / 1024).toFixed(0)} KB)`);
  const spritesPagePath = join(SITE, "sprites.html");
  const spritesHtml = renderSpriteCatalogHtml({ iconTemplates: spriteTemplates, largeTemplates: spriteLargeTemplates, factRows: ontologyFactRows, spritesBundleAvailable: true });
  await writeF(spritesPagePath, spritesHtml);
  console.log(`wrote ${spritesPagePath}`);
}

// The plan hero: teach + solve the default hanoi-3 puzzle through the SAME
// live session src/surfaces/web/plan-browser-entry.mjs exposes to the
// browser — in-process now, not shelled out to the CLI, so this build step
// and a visitor's own disk-count control run through the identical code
// path (no separate "how the site builds it" vs "how a live re-solve works"
// to keep in sync). Also builds this game's own dedicated browser bundle
// (the full turn engine, same posture as the spider-fly/adventure bundles
// above — generated fresh per build, never committed) so the deployed
// page's live re-solve controls and chat-assert dock actually work.
{
  const { main: buildPlanBundle } = await import(join(here, "build-plan-bundle.mjs"));
  const { outPath: planBundlePath, size: planBundleBytes } = await buildPlanBundle(SITE);
  console.log(`wrote ${planBundlePath} (${(planBundleBytes / 1024).toFixed(0)} KB)`);

  const { createPlanSession } = await import(join(ROOT, "src", "surfaces", "web", "plan-browser-entry.mjs"));
  const { renderPlanHtml, renderInputsFromPlan } = await import(join(ROOT, "src", "services", "plan-viz.mjs"));
  const { plan } = await createPlanSession({ diskCount: 3 });
  if (!plan) throw new Error("the default hanoi-3 puzzle failed to solve — plan.html would have nothing to embed");
  const { rendersAs, sizeOrder } = renderInputsFromPlan(plan);
  const planPath = join(SITE, "plan.html");
  await writeF(planPath, renderPlanHtml({ plan, rendersAs, sizeOrder, title: plan.goal?.text || "tmct plan" }));
  console.log(`wrote ${planPath} (${plan.actions.length} moves, ${plan.states.length} snapshots)`);
}

// The spider-and-fly hero: the world pack (built already, from
// scripts/gen-spider-fly-world.mjs; confirmed current below, never rebuilt
// here) plus this game's own dedicated browser bundle (the full turn engine,
// same posture as the chat bundle above — generated fresh per build, never
// committed), then the self-contained page itself. Unlike ledger.html, the
// page embeds almost no build-time data — the whole game is live client-side
// state — so there is no payload to load here, only the sibling bundle.
{
  const { worldsPackDir } = await import(join(ROOT, "src", "adapters", "corpus", "worlds-pack.mjs"));
  const shardPath = join(worldsPackDir(), "shards", "spider-fly.jsonl.gz");
  if (!existsSync(shardPath)) {
    console.log(`spider-fly world pack shard not found at ${shardPath} — run \`npm run gen:worlds-pack\` first; the hero's session bootstraps its own board client-side regardless, so this is a heads-up, not a build failure`);
  }
  const { main: buildSpiderFlyBundle } = await import(join(here, "build-spider-fly-bundle.mjs"));
  const { outPath: spiderFlyBundlePath, size: spiderFlyBundleBytes } = await buildSpiderFlyBundle(SITE);
  console.log(`wrote ${spiderFlyBundlePath} (${(spiderFlyBundleBytes / 1024).toFixed(0)} KB)`);
  const { renderSpiderFlyHtml } = await import(join(ROOT, "src", "services", "spider-fly-viz.mjs"));
  const spiderFlyPath = join(SITE, "spider-fly.html");
  // The large tier (data/sprites-large/*.toml), not the small icon tier
  // every other embedder above reads: the icon tier carries no face/eye/
  // mouth geometry at all, so it's the only tier `spider-with-emotion.toml`/
  // `fly-with-emotion.toml` actually exist in — the live mgx:feels wiring
  // above has nothing to resolve against without it. Read directly here
  // (not shared with the sprites.html block's own spriteLargeTemplates)
  // so this step stays self-contained regardless of build-step ordering.
  const spiderFlySpriteTemplates = readSpriteLargeTemplateFiles();
  await writeF(spiderFlyPath, renderSpiderFlyHtml({ spriteTemplates: spiderFlySpriteTemplates }));
  console.log(`wrote ${spiderFlyPath}`);
}

// The adventure hero: the shipped Ashcombe Hall world's real facts+rules,
// read ONCE through the same Node worlds-pack provider the CLI itself uses
// and embedded straight into the page (adventure-viz.mjs's own header
// explains why — the world's canonical definition is a Node-only JSONL
// corpus source, not a pure JS module the browser bundle could call
// directly), plus this game's own dedicated browser bundle.
{
  const { getWorldsPackProvider, clearWorldsPackCache } = await import(join(ROOT, "src", "adapters", "corpus", "worlds-pack.mjs"));
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("ashcombe-hall");
  if (!world) {
    console.log("ashcombe-hall world not found in the worlds pack — run `npm run gen:worlds-pack` first; the adventure hero has no world to embed, so this is a heads-up, not a build failure");
  } else {
    const { main: buildAdventureBundle } = await import(join(here, "build-adventure-bundle.mjs"));
    const { outPath: adventureBundlePath, size: adventureBundleBytes } = await buildAdventureBundle(SITE);
    console.log(`wrote ${adventureBundlePath} (${(adventureBundleBytes / 1024).toFixed(0)} KB)`);
    const { renderAdventureHtml } = await import(join(ROOT, "src", "services", "adventure-viz.mjs"));
    const worldPayload = {
      name: world.name,
      facts: world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
      rules: world.rules.map((r) => ({ name: r.name, ruleKind: r.ruleKind, slots: r.slots })),
      opening: world.meta?.opening || "",
    };
    const adventurePath = join(SITE, "adventure.html");
    await writeF(adventurePath, renderAdventureHtml({
      worldPayload,
      spriteTemplates,
      largeSpriteTemplates: largeSpriteManifest ? largeSpriteManifest.templates : [],
    }));
    console.log(`wrote ${adventurePath}`);
  }
}

// The site's service worker, version-stamped so a version bump rolls the
// cache name and the activate step drops the previous release's entries.
// What it caches is best-effort and volatile — browser storage can be
// evicted or cleared; every page works identically without it, this only
// stops a RETURN visitor re-paying for the big boot assets.
function renderServiceWorker(version) {
  return `"use strict";
const CACHE = ${JSON.stringify("tmct-precache-v" + version)};
// The page shell and its big boot assets. Cached one-by-one, tolerating any
// individual 404 (a build without the reference pack, say) — cache.addAll
// would refuse the whole install over one missing optional file.
const PRECACHE = [
  "./index.html",
  "./chat.html",
  "./chat-browser.bundle.js",
  "./sprites-browser.bundle.js",
  "./vendor/wink.js",
  "./chat-seed.json",
  "./reference-pack/index.json",
];
const precacheUrl = (p) => new URL(p, self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (path) => {
      try {
        const res = await fetch(path, { cache: "no-cache" });
        if (res.ok) await cache.put(precacheUrl(path), res);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("tmct-precache-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const href = url.origin + url.pathname;
  const precached = PRECACHE.some((p) => precacheUrl(p) === href);
  const packArticle = url.pathname.includes("/reference-pack/articles/");
  const pageOrBundle = url.pathname.endsWith(".html") || url.pathname.endsWith("/") || url.pathname.endsWith(".bundle.js");
  if (precached || packArticle) {
    // Cache-first: immutable-per-release boot assets and the per-article
    // pack tier (cached the first time a citation fetches it).
    event.respondWith((async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, res.clone());
      }
      return res;
    })());
  } else if (pageOrBundle) {
    // Network-first: pages and bundles track the deploy; the cache is only
    // the offline fallback.
    event.respondWith((async () => {
      try {
        const res = await fetch(event.request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
`;
}

{
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const swPath = join(SITE, "tmct-sw.js");
  writeFileSync(swPath, renderServiceWorker(version));
  console.log(`wrote ${swPath} (cache tmct-precache-v${version})`);
}

// Precompressed siblings (.gz/.br) for every sizable text asset, last, over
// the finished site: GitLab Pages documents serving these variants when they
// sit next to the file. The per-article reference-pack tier is skipped on
// purpose — thousands of small files whose individual wins are tiny, tripling
// the pack's file count for near-zero wire savings; scripts/post-deploy-smoke
// probes whether the deployment actually honours the siblings.
// TMCT_DEMO_PRECOMPRESS=0 skips the pass (the e2e snapshot builds set it —
// their static server never serves the siblings, and brotli at quality 11
// costs real seconds per build).
if (process.env.TMCT_DEMO_PRECOMPRESS !== "0") {
  const COMPRESS_EXTS = new Set([".js", ".mjs", ".json", ".html"]);
  const MIN_BYTES = 50 * 1024;
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === join(SITE, "reference-pack", "articles")) continue;
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  walk(SITE);
  // Clear every existing sibling first, so a source that shrank below the
  // threshold (or vanished) can never leave a stale compressed twin behind
  // for the host to serve in its place.
  for (const f of files) {
    if (f.endsWith(".gz") || f.endsWith(".br")) unlinkSync(f);
  }
  let preBytes = 0;
  let gzBytes = 0;
  let brBytes = 0;
  let count = 0;
  for (const f of files) {
    if (f.endsWith(".gz") || f.endsWith(".br")) continue;
    const ext = extname(f);
    if (!COMPRESS_EXTS.has(ext)) continue;
    const size = statSync(f).size;
    // Every page document compresses regardless of size — the html files are
    // few, and they're the first transfer of every visit; the byte floor only
    // prunes the long tail of small js/json.
    if (ext !== ".html" && size < MIN_BYTES) continue;
    const body = readFileSync(f);
    const gz = gzipSync(body, { level: 9 });
    const br = brotliCompressSync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    });
    writeFileSync(`${f}.gz`, gz);
    writeFileSync(`${f}.br`, br);
    preBytes += size;
    gzBytes += gz.length;
    brBytes += br.length;
    count += 1;
  }
  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(`precompressed ${count} files: ${mb(preBytes)} MB raw -> ${mb(gzBytes)} MB gz / ${mb(brBytes)} MB br`);
} else {
  console.log("precompression skipped (TMCT_DEMO_PRECOMPRESS=0)");
}
