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
//   code.html         the code explorer over the demo code graph, the same
//                     page the Electron desktop shell renders for itself
//                     (see build-electron-app.mjs), over its own browser bundle
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
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import { shortCommit, stampCommit, stampVersion } from "../src/domain/version-stamp.mjs";
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
//
// The commit stamp is written only when CI_COMMIT_SHA is in the environment,
// so the committed page keeps its placeholder and a local build never churns
// it. A page cannot name the commit that adds it, so the tracked value is a
// placeholder by construction — wait-for-site.mjs treats anything that is not
// a short object name as "no commit stamped".
function stampPageBuild() {
  const version = siteVersion();
  const page = join(SITE, "index.html");
  let html = stampVersion(readFileSync(page, "utf8"), version);
  console.log(`stamped ${page} with version ${version}`);
  const sha = process.env.CI_COMMIT_SHA;
  if (sha) {
    html = stampCommit(html, sha);
    console.log(`stamped ${page} with commit ${shortCommit(sha)}`);
  }
  writeFileSync(page, html);
}

/** A short content hash of one built file, or "" when it isn't there. Short
 *  on purpose: this rides in a URL and a cache name, and 12 hex characters of
 *  SHA-256 already make an accidental collision between two builds of the same
 *  file implausible. */
function contentHash(path) {
  if (!existsSync(path)) return "";
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
}

/** package.json's version, or TMCT_DEMO_VERSION_OVERRIDE when set. The
 *  override lets a test drive two builds that differ only in the version
 *  the site stamps and the service worker's cache name embeds, without
 *  touching the repo's own package.json — test-e2e/pages-service-worker-
 *  cache-bust.test.mjs is the one caller. */
function siteVersion() {
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return process.env.TMCT_DEMO_VERSION_OVERRIDE || version;
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

stampPageBuild();

// The shared wink vendor asset, built first: every page's lemma/POS tier
// (chat/ledger/plan/index) imports this ONE same-origin file through the
// registerWinkModel seam — no CDN, no per-bundle copy.
{
  const { buildWinkVendor } = await import(join(here, "build-wink-vendor.mjs"));
  const { outPath: winkVendorPath, bytes: winkVendorBytes } = await buildWinkVendor(SITE);
  console.log(`wrote ${winkVendorPath} (${(winkVendorBytes / 1048576).toFixed(2)} MB)`);
}

// The shared P2P asset, built the same way and for the same reason: every page
// that can join a shared world imports THIS one same-origin module at runtime,
// so the networking layer is never copied into a per-page engine bundle. The
// pages import it lazily, so a visitor who never shares never fetches it.
{
  const { buildP2pVendor } = await import(join(here, "build-p2p-vendor.mjs"));
  const { outPath: p2pVendorPath, bytes: p2pVendorBytes } = await buildP2pVendor(SITE);
  console.log(`wrote ${p2pVendorPath} (${(p2pVendorBytes / 1024).toFixed(0)} KB)`);
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
// The focus term's digest paragraph, computed here — node-side, where the
// sentence-structure bank is readable — and embedded for the ledger's focus
// card; a client refocus to another term shows the fact groups without it.
const { readFactRows: readLedgerFactRows } = await import(join(ROOT, "src", "adapters/memory/core.mjs"));
const { digestTermFromRows, readDigestStructures: readLedgerDigestStructures } = await import(join(ROOT, "src", "adapters/corpus/digest-bank.mjs"));
// The digest structure table, embedded so the page recomputes a term's digest
// client-side on refocus (over the store the dock grows in the browser) rather
// than losing the focus card. The server digest below stays as the initial
// focus's fallback for a page whose engine bundle never loads.
const ledgerDigestStructures = readLedgerDigestStructures();
let focusDigest = null;
if (ledgerData.focus) {
  const allFactRows = readLedgerFactRows(payload);
  const focusRows = allFactRows.filter((r) => r.subject === ledgerData.focus);
  const article = focusRows.length ? digestTermFromRows(ledgerData.focus, focusRows, allFactRows, { budget: 8 }) : null;
  if (article && article.paragraphs.length) {
    focusDigest = {
      term: ledgerData.focus,
      paragraphs: article.paragraphs,
      sources: [...new Set(article.sources.map((s) => s.provenance).filter(Boolean))],
      facts: (article.detail.facts || []).map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
      factCount: article.detail.factCount,
    };
  }
}
const memoryAskBundle = await readMemoryAskBundle();
const { main: buildLedgerBundle } = await import(join(here, "build-ledger-bundle.mjs"));
const { outPath: ledgerBundlePath, size: ledgerBundleBytes } = await buildLedgerBundle(SITE);
console.log(`wrote ${ledgerBundlePath} (${(ledgerBundleBytes / 1024).toFixed(0)} KB)`);
const ledgerPath = join(SITE, "ledger.html");
await writeF(ledgerPath, renderLedgerHtml({ ...ledgerData, memoryAskBundle, ledgerBundleAvailable: true, focusDigest, digestStructures: ledgerDigestStructures }));
console.log(`wrote ${ledgerPath} (${memoryAskBundle ? "chat dock enabled" : "no bundle — dock disabled"})`);

// The code explorer: the exact page the Electron shell renders for itself
// (renderCodeExplorerHtml, src/services/code-explorer-viz.mjs), seeded here
// with the demo code graph built above, plus its own dedicated browser
// bundle — generated fresh per build, never committed, same posture as the
// ledger bundle above. showDesktopLink:true is the one option that differs
// from the Electron build (scripts/build-electron-app.mjs), which renders
// the identical page for the desktop shell and has nothing to point at.
// chat.html's starter-memory seed, generated (never committed) so every page
// that fetches it serves what src/ builds today. Built here, ahead of the four
// pages that fetch it, because each of them embeds the seed's own content hash
// in the URL it requests: a cache-first read in the service worker can then
// only ever return the copy the page asked for, so a content-only deploy (a
// rebuilt seed under an unchanged package version) can never be served from a
// browser's cache of the previous one.
const { main: buildChatSeed } = await import(join(here, "build-chat-seed.mjs"));
const seed = await buildChatSeed(join(SITE, "chat-seed.json"));
const seedStamp = contentHash(seed.outPath);
console.log(`wrote ${seed.outPath} (${seed.facts} facts, ${(seed.bytes / 1024).toFixed(0)} KB, content ${seedStamp})`);

// The page also fetches ./chat-seed.json at runtime for its chat's
// general-knowledge bands — nothing to embed here, and a build without the
// seed leaves the page graph-only.
{
  const { computeCodeExplorerData, renderCodeExplorerHtml, VENDOR_WINK_LOADER_JS } = await import(join(ROOT, "src", "services/code-explorer-viz.mjs"));
  const { main: buildCodeExplorerBundle } = await import(join(here, "build-code-explorer-bundle.mjs"));
  const { outPath: codeExplorerBundlePath, size: codeExplorerBundleBytes } = await buildCodeExplorerBundle(SITE);
  console.log(`wrote ${codeExplorerBundlePath} (${(codeExplorerBundleBytes / 1024).toFixed(0)} KB)`);
  const codeGraphPayload = JSON.parse(await readF(join(SITE, "demo-graph.json"), "utf8"));
  const codeExplorerData = computeCodeExplorerData(codeGraphPayload, { title: "demo code graph" });
  const codePath = join(SITE, "code.html");
  await writeF(codePath, renderCodeExplorerHtml(codeExplorerData, {
    bundleAvailable: true,
    winkLoaderInline: VENDOR_WINK_LOADER_JS,
    sourceName: "demo code graph",
    showDesktopLink: true,
    seedStamp,
  }));
  console.log(`wrote ${codePath} (focus "${codeExplorerData.focus}", ${codeExplorerData.hints.length} hints)`);
}

// chat.html's full engine: the browser bundle, generated (never committed) so
// the page always serves what src/ builds today. Its starter-memory seed is
// built further up, ahead of the pages that stamp its content hash into the
// URL they fetch it by.
const { main: buildChatBundle } = await import(join(here, "build-chat-bundle.mjs"));
const { outPath: chatBundlePath, size: chatBundleBytes } = await buildChatBundle(SITE);
console.log(`wrote ${chatBundlePath} (${(chatBundleBytes / 1024).toFixed(0)} KB)`);

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
  // The digest sentence-structure bank, read once here (node-side, where the
  // TOML is) and embedded in the page, same as research.html's own call just
  // below — chat.html's answer flow feeds these rows to the chat bundle's
  // live digest-bank twin (chat-browser-entry.mjs) so a long answer leads
  // with a composed digest instead of always falling back to the flat list.
  const { readDigestStructures } = await import(join(ROOT, "src", "adapters/corpus/digest-bank.mjs"));
  const chatPagePath = join(SITE, "chat.html");
  await writeF(chatPagePath, renderChatHtml({ digestStructures: readDigestStructures(), seedStamp }));
  console.log(`wrote ${chatPagePath}`);
}

// The ingest page: paste or drop text, keep only the facts the deterministic
// recognizer can ground. Its own dedicated browser bundle (the full turn
// engine's teach recognizer, same posture as the chat/ledger bundles above —
// generated fresh per build, never committed), then the self-contained page.
{
  const { main: buildIngestBundle } = await import(join(here, "build-ingest-bundle.mjs"));
  const { outPath: ingestBundlePath, size: ingestBundleBytes } = await buildIngestBundle(SITE);
  console.log(`wrote ${ingestBundlePath} (${(ingestBundleBytes / 1024).toFixed(0)} KB)`);
  const { renderIngestHtml } = await import(join(ROOT, "src", "services", "ingest-viz.mjs"));
  const ingestPagePath = join(SITE, "ingest.html");
  await writeF(ingestPagePath, renderIngestHtml({ seedStamp }));
  console.log(`wrote ${ingestPagePath}`);
}

// The research page: grow one in-memory graph three ways (research a term over
// Simple English Wikipedia, teach by telling, ingest documents) and ask it a
// question scoped by source. Its own dedicated browser bundle (the full turn
// engine plus the ingest recognizer, same posture as the chat/ingest bundles
// above — generated fresh per build, never committed), then the self-contained
// page. It reuses ./chat-seed.json (built above) for its seed corpus bands and
// ./reference-pack/ (built above) at runtime, so nothing new to embed here.
{
  const { main: buildResearchBundle } = await import(join(here, "build-research-bundle.mjs"));
  const { outPath: researchBundlePath, size: researchBundleBytes } = await buildResearchBundle(SITE);
  console.log(`wrote ${researchBundlePath} (${(researchBundleBytes / 1024).toFixed(0)} KB)`);
  const { renderResearchHtml } = await import(join(ROOT, "src", "services", "research-viz.mjs"));
  // The digest sentence-structure bank, read once here (node-side, where the
  // TOML is), embedded in the page so the research digest composes client-side
  // over the store it grows in the browser — no TOML parser ever ships.
  const { readDigestStructures } = await import(join(ROOT, "src", "adapters/corpus/digest-bank.mjs"));
  const researchPagePath = join(SITE, "research.html");
  await writeF(researchPagePath, renderResearchHtml({ digestStructures: readDigestStructures(), seedStamp }));
  console.log(`wrote ${researchPagePath}`);
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
//
// One page per CATALOG_GROUPS entry carries that group's own full gallery
// (sprites-adventure-props.html/sprites-person-roles.html/sprites-objects.html/
// sprites-emotions.html — each group's own `page` field), and sprites.html
// itself is the lighter landing page: one example card per section, linking
// out to its own class's card on the group page that actually holds it. Every
// page shares the one sprites-browser.bundle.js bundle built once below —
// the composer/dock both read the WHOLE catalog regardless of which page
// they're embedded in, so there's nothing page-specific to bundle per page.
{
  const spriteLargeTemplates = readSpriteLargeTemplateFiles();
  const { loadSpriteOntologyFactRows, renderSpriteCatalogHtml, renderSpriteCatalogLandingHtml, CATALOG_GROUPS } = await import(join(ROOT, "src", "services/sprite-catalog-viz.mjs"));
  const ontologyFactRows = await loadSpriteOntologyFactRows();
  const { main: buildSpritesBundle } = await import(join(here, "build-sprites-bundle.mjs"));
  const { outPath: spritesBundlePath, size: spritesBundleBytes } = await buildSpritesBundle(SITE);
  console.log(`wrote ${spritesBundlePath} (${(spritesBundleBytes / 1024).toFixed(0)} KB)`);

  const spritesPagePath = join(SITE, "sprites.html");
  const spritesHtml = renderSpriteCatalogLandingHtml({ iconTemplates: spriteTemplates, largeTemplates: spriteLargeTemplates, factRows: ontologyFactRows, spritesBundleAvailable: true });
  await writeF(spritesPagePath, spritesHtml);
  console.log(`wrote ${spritesPagePath}`);

  for (const group of CATALOG_GROUPS) {
    const groupPagePath = join(SITE, group.page);
    const groupHtml = renderSpriteCatalogHtml({
      title: `tmct — ${group.label} — the sprite library`,
      iconTemplates: spriteTemplates,
      largeTemplates: spriteLargeTemplates,
      factRows: ontologyFactRows,
      spritesBundleAvailable: true,
      groupId: group.id,
    });
    await writeF(groupPagePath, groupHtml);
    console.log(`wrote ${groupPagePath}`);
  }
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

// What each scenario's dropdown entry says. The label names the difference
// that made the world worth shipping — how big it is, and what it is that
// makes it harder or easier — so picking one is a choice rather than a guess
// at what a hyphenated world id means.
const ADVENTURE_SCENARIO_LABELS = {
  "ashcombe-hall": "ashcombe hall (6 rooms, 1 lock)",
  "lantern-cottage": "lantern cottage (3 rooms, no locks)",
  "greyvale-museum": "greyvale museum (9 rooms, 3 locks)",
};
const MUD_SCENARIO_LABELS = {
  "mud-garden": "mud garden (4 rooms, 1 fox)",
  "mud-hollow": "mud hollow (3 rooms, nothing hunting)",
  "mud-warren": "mud warren (8 rooms, fox and owl)",
};

// The world payload every game page embeds: one shipped world's real
// facts+rules, read through the same Node worlds-pack provider the CLI itself
// uses (the viz headers explain why — a world's canonical definition is a
// Node-only gzipped JSONL shard, not a pure JS module the browser bundle
// could call directly).
function worldPayloadOf(world) {
  return {
    name: world.name,
    facts: world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
    rules: world.rules.map((r) => ({ name: r.name, ruleKind: r.ruleKind, slots: r.slots })),
    opening: world.meta?.opening || "",
  };
}

/** The worlds a page's scenario dropdown offers, in the order named, skipping
 *  any the pack does not carry. A page whose alternates are all missing still
 *  builds — it just ships the one world it found. */
async function loadScenarioWorlds(names) {
  const { getWorldsPackProvider, clearWorldsPackCache } = await import(join(ROOT, "src", "adapters", "corpus", "worlds-pack.mjs"));
  clearWorldsPackCache();
  const provider = getWorldsPackProvider({});
  const found = [];
  for (const name of names) {
    const world = await provider.load(name);
    if (world) found.push(worldPayloadOf(world));
    else console.log(`${name} world not found in the worlds pack — run \`npm run gen:worlds-pack\`; skipping that scenario`);
  }
  return found;
}

// The adventure hero: Ashcombe Hall plus the two alternates its scenario
// dropdown offers, a shorter cottage and a bigger museum with a deeper lock
// chain. Ashcombe stays first, so the page opens on the world it always has.
{
  const worlds = await loadScenarioWorlds(["ashcombe-hall", "lantern-cottage", "greyvale-museum"]);
  if (!worlds.length) {
    console.log("no adventure worlds found in the worlds pack — the adventure hero has no world to embed, so this is a heads-up, not a build failure");
  } else {
    const { main: buildAdventureBundle } = await import(join(here, "build-adventure-bundle.mjs"));
    const { outPath: adventureBundlePath, size: adventureBundleBytes } = await buildAdventureBundle(SITE);
    console.log(`wrote ${adventureBundlePath} (${(adventureBundleBytes / 1024).toFixed(0)} KB)`);
    const { renderAdventureHtml } = await import(join(ROOT, "src", "services", "adventure-viz.mjs"));
    const scenarios = worlds.map((worldPayload) => ({
      label: ADVENTURE_SCENARIO_LABELS[worldPayload.name] || worldPayload.name,
      worldPayload,
    }));
    const adventurePath = join(SITE, "adventure.html");
    await writeF(adventurePath, renderAdventureHtml({
      worldPayload: scenarios[0].worldPayload,
      scenarios,
      spriteTemplates,
      largeSpriteTemplates: largeSpriteManifest ? largeSpriteManifest.templates : [],
    }));
    console.log(`wrote ${adventurePath}`);
  }
}

// The mud demo: mud-garden plus the two alternates its scenario dropdown
// offers, a three-room hollow with nothing hunting in it and an eight-room
// warren with two predators and thin food. mud-garden stays first, so the
// page opens on the burrow it always has. The large-tier sprite set is read
// again here (not shared with spider-fly's own spriteLargeTemplates above) so
// this block stays self-contained regardless of build-step ordering, matching
// the spider-fly block's own posture.
{
  const worlds = await loadScenarioWorlds(["mud-garden", "mud-hollow", "mud-warren"]);
  if (!worlds.length) {
    console.log("no mud worlds found in the worlds pack — the mud demo has no world to embed, so this is a heads-up, not a build failure");
  } else {
    const { main: buildMudBundle } = await import(join(here, "build-mud-bundle.mjs"));
    const { outPath: mudBundlePath, size: mudBundleBytes } = await buildMudBundle(SITE);
    console.log(`wrote ${mudBundlePath} (${(mudBundleBytes / 1024).toFixed(0)} KB)`);
    const { renderMudHtml } = await import(join(ROOT, "src", "services", "mud-viz.mjs"));
    const { mudSpeciesOf } = await import(join(ROOT, "src", "domain", "game-config.mjs"));
    // The roster each burrow may cast from, read off the burrow's own
    // adventurers in the order its source file places them — never a list
    // typed out here, which would go stale the moment a world's cast changed
    // and would have nothing to say about a world this file never saw. The
    // page's players slider decides how many of them play, and pickMudRoster
    // decides which.
    const rosterOf = (worldPayload) => worldPayload.facts
      .filter((f) => f.predicate === "rdf:type" && f.object === "adventurer")
      .map((f) => ({ id: f.subject, species: mudSpeciesOf(f.subject) }));
    const scenarios = worlds.map((worldPayload) => ({
      label: MUD_SCENARIO_LABELS[worldPayload.name] || worldPayload.name,
      worldPayload,
      characters: rosterOf(worldPayload),
    }));
    const mudSpriteTemplates = readSpriteLargeTemplateFiles();
    const mudPath = join(SITE, "mud.html");
    await writeF(mudPath, renderMudHtml({
      worldPayload: scenarios[0].worldPayload,
      characters: scenarios[0].characters,
      scenarios,
      spriteTemplates: mudSpriteTemplates,
    }));
    console.log(`wrote ${mudPath}`);
  }
}

// The site's service worker. What it caches is best-effort and volatile —
// browser storage can be evicted or cleared; every page works identically
// without it, this only stops a RETURN visitor re-paying for the big boot
// assets.
//
// Two rules keep a cached copy from outliving the file it copied:
//
//   1. The cache name carries a content hash of the whole precached set, not
//      just the release version. A content-only deploy — the seed rebuilt, a
//      bundle recompiled, no version bump — rolls the name, so the activate
//      step drops every entry of the build before it.
//   2. Only a URL that identifies its own content is read cache-first. The
//      seed's URL carries its content hash (the pages request it that way), so
//      a cache-first read can only return the copy the page asked for. Pages
//      and bundles have plain URLs, so they track the deploy over the network
//      and fall back to the cache only when the network fails.
function renderServiceWorker(version, { seedStamp, buildHash }) {
  const seedPath = seedStamp ? `./chat-seed.json?b=${seedStamp}` : "./chat-seed.json";
  return `"use strict";
const CACHE = ${JSON.stringify(`tmct-precache-v${version}-${buildHash}`)};
// Assets whose URL identifies their content, read cache-first. The seed's
// query is this build's own content hash; the vendor assets and the pack index
// ride the cache name for that instead.
const CONTENT_ADDRESSED = [
  ${JSON.stringify(seedPath)},
  "./vendor/wink.js",
  "./vendor/p2p.js",
  "./reference-pack/index.json",
];
// Pages and bundles: precached for an offline second visit, but always read
// network-first so a deploy reaches the browser on the next load.
const DEPLOY_TRACKING = [
  "./index.html",
  "./chat.html",
  "./ingest.html",
  "./research.html",
  "./chat-browser.bundle.js",
  "./sprites-browser.bundle.js",
];
// The page shell and its big boot assets. Cached one-by-one, tolerating any
// individual 404 (a build without the reference pack, say) — cache.addAll
// would refuse the whole install over one missing optional file.
const PRECACHE = DEPLOY_TRACKING.concat(CONTENT_ADDRESSED);
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
  const packArticle = url.pathname.includes("/reference-pack/articles/");
  const pageOrBundle = url.pathname.endsWith(".html") || url.pathname.endsWith("/") || url.pathname.endsWith(".bundle.js");
  // A page's own URL carries query strings of its own (an invite link), so the
  // deploy-tracking test comes first and reads the path alone.
  const contentAddressed = !pageOrBundle
    && (packArticle || CONTENT_ADDRESSED.some((p) => precacheUrl(p) === url.href));
  if (pageOrBundle) {
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
  } else if (contentAddressed) {
    // Cache-first, matched on the whole URL including its content hash: a
    // rebuilt seed asks by a different URL and misses on purpose.
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, res.clone());
      }
      return res;
    })());
  }
});
`;
}

{
  const version = siteVersion();
  // Hashed over the built files themselves, so the cache name moves whenever
  // any precached asset's bytes move — the seed hash is reused rather than
  // recomputed over its 90-odd MB a second time.
  const hashedAssets = [
    ["index.html", null], ["chat.html", null], ["ingest.html", null], ["research.html", null],
    ["chat-browser.bundle.js", null], ["sprites-browser.bundle.js", null],
    ["vendor/wink.js", null], ["vendor/p2p.js", null],
    ["chat-seed.json", seedStamp], ["reference-pack/index.json", null],
  ];
  const buildHash = createHash("sha256")
    .update(hashedAssets.map(([name, known]) => `${name}:${known ?? contentHash(join(SITE, name))}`).join("\n"))
    .digest("hex")
    .slice(0, 12);
  const swPath = join(SITE, "tmct-sw.js");
  writeFileSync(swPath, renderServiceWorker(version, { seedStamp, buildHash }));
  console.log(`wrote ${swPath} (cache tmct-precache-v${version}-${buildHash}, seed content ${seedStamp || "unhashed"})`);
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
