// scripts/build-demo-site.mjs — regenerate everything the demo site
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
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import { shortCommit, versionFileText } from "../src/domain/version-stamp.mjs";
import { importClosure } from "../src/adapters/import-closure.mjs";
import { readSpriteTemplateFiles } from "../src/adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../src/adapters/corpus/sprite-large-template-files.mjs";
import { ABOUT_PAGES, DEMO_PAGES, DEMO_PAGE_META, INDEX_META, RECEIPTS_META, CLAIMS_META, CLAIMS_PAGE_BLOCKS, HELP_META, SHARED_STYLESHEET } from "./site-pages.mjs";
import { escapeHtml } from "../src/services/viz-theme.mjs";
import { checkClaim, loadSchema } from "./claims/lib.mjs";

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

// Every page's head metadata: title, description, canonical link, and the
// og:*/twitter:* tags a link preview reads. A demo page and its about page
// share one DEMO_PAGE_META entry (title, description) and og:image; only
// their own canonical/og:url differ. og:image always points at
// scripts/gen-og-images.mjs's output — this build does not generate those
// PNGs itself.
const SITE_ORIGIN = "https://tmct.polycode.co.uk";

function renderMetaHeadBlock({ pageTitleTag, socialTitle, description, canonicalUrl, ogImageUrl }) {
  return [
    `<title>${escapeHtml(pageTitleTag)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${canonicalUrl}">`,
    `<meta property="og:title" content="${escapeHtml(socialTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${ogImageUrl}">`,
    `<meta property="og:url" content="${canonicalUrl}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="the-mechanical-code-talker">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${ogImageUrl}">`,
  ].join("\n");
}

/** A demo page's own head metadata: <slug>.html, its title suffixed the same
 *  " — tmct" on every page, its og:image at og/<slug>.png. */
function demoPageMeta(slug) {
  const { title, description } = DEMO_PAGE_META[slug];
  return {
    pageTitleTag: `${title} — tmct`,
    socialTitle: title,
    description,
    canonicalUrl: `${SITE_ORIGIN}/${slug}.html`,
    ogImageUrl: `${SITE_ORIGIN}/og/${slug}.png`,
  };
}

/** An about page shares its demo page's title, description and og:image;
 *  only its own canonical/og:url point at itself. */
function aboutPageMeta(slug) {
  return { ...demoPageMeta(slug), canonicalUrl: `${SITE_ORIGIN}/${slug}-about.html` };
}

/** The home page's head metadata. It keeps its own, longer <title> text —
 *  only the social tags use INDEX_META's shorter title. */
function indexHeadMeta() {
  return {
    pageTitleTag: "tmct — The Mechanical Code Talker",
    socialTitle: INDEX_META.title,
    description: INDEX_META.description,
    canonicalUrl: `${SITE_ORIGIN}/`,
    ogImageUrl: `${SITE_ORIGIN}/og/index.png`,
  };
}

/** The receipts page's head metadata. Not a demo page, so it has no about
 *  page and reuses the home page's og:image rather than getting its own. */
function receiptsHeadMeta() {
  return {
    pageTitleTag: `${RECEIPTS_META.title} — tmct`,
    socialTitle: RECEIPTS_META.title,
    description: RECEIPTS_META.description,
    canonicalUrl: `${SITE_ORIGIN}/receipts.html`,
    ogImageUrl: `${SITE_ORIGIN}/og/index.png`,
  };
}

/** The claims page's head metadata. Not a demo page, so it has no about
 *  page and reuses the home page's og:image rather than getting its own,
 *  same posture as receiptsHeadMeta. */
function claimsHeadMeta() {
  return {
    pageTitleTag: `${CLAIMS_META.title} — tmct`,
    socialTitle: CLAIMS_META.title,
    description: CLAIMS_META.description,
    canonicalUrl: `${SITE_ORIGIN}/claims.html`,
    ogImageUrl: `${SITE_ORIGIN}/og/index.png`,
  };
}

/** The help page's head metadata. Hand-authored and tracked like index.html
 *  and the about pages (it is a plain static document with no engine), so it
 *  fills through the same meta:begin/meta:end marker those pages carry
 *  rather than being written wholesale like receipts.html/claims.html. No
 *  paired about page, so it reuses the home page's og:image. */
function helpHeadMeta() {
  return {
    pageTitleTag: `${HELP_META.title} — tmct`,
    socialTitle: HELP_META.title,
    description: HELP_META.description,
    canonicalUrl: `${SITE_ORIGIN}/help.html`,
    ogImageUrl: `${SITE_ORIGIN}/og/index.png`,
  };
}

/** Overwrites a freshly rendered demo page's own <title> line with this
 *  build's full head-metadata block. Every renderXHtml still writes its own
 *  <title> so the module renders something sensible standalone; this is
 *  where the page-list metadata wins. `keepOwnTitle` keeps the renderer's
 *  title and adds only the tags after it — for pages whose titles carry live
 *  data (the ledger's fact count) that the page contract pins. */
function injectMetaHead(html, meta, { keepOwnTitle = false } = {}) {
  const titleLineRe = /<title>[^<]*<\/title>\n/;
  if (!titleLineRe.test(html)) throw new Error("no <title> line found to inject the head-metadata block into");
  if (!keepOwnTitle) return html.replace(titleLineRe, `${renderMetaHeadBlock(meta)}\n`);
  const tagsOnly = renderMetaHeadBlock(meta).split("\n").filter((line) => !line.startsWith("<title>")).join("\n");
  return html.replace(titleLineRe, (titleLine) => `${titleLine}${tagsOnly}\n`);
}

// version.txt: written fresh on every build, gitignored like every other
// build output under public/ — nothing here is committed, so there is
// nothing for it to drift against. post-deploy-smoke.mjs and wait-for-site.mjs
// both read it back to confirm a deploy actually served this build.
//
// The commit line is written only when CI_COMMIT_SHA is in the environment,
// so a local build's version.txt carries an empty commit line. A build
// cannot name the commit that adds it — wait-for-site.mjs treats an empty or
// absent commit line as "no commit stamped".
function writeVersionFile() {
  const version = siteVersion();
  const sha = process.env.CI_COMMIT_SHA;
  const text = versionFileText({ version, commit: sha ?? "", timestamp: new Date().toISOString() });
  const file = join(SITE, "version.txt");
  writeFileSync(file, text);
  console.log(`wrote ${file} (${version}${sha ? ` @ ${shortCommit(sha)}` : ""})`);
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

writeVersionFile();

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
// engine, same posture as the plan/adventure bundles below —
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
await writeF(ledgerPath, injectMetaHead(renderLedgerHtml({ ...ledgerData, memoryAskBundle, ledgerBundleAvailable: true, focusDigest, digestStructures: ledgerDigestStructures }), demoPageMeta("ledger"), { keepOwnTitle: true }));
console.log(`wrote ${ledgerPath} (${memoryAskBundle ? "chat dock enabled" : "no bundle — dock disabled"})`);

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
  // TOML is) and embedded in the page — chat.html's answer flow feeds these
  // rows to the chat bundle's live digest-bank twin (chat-browser-entry.mjs)
  // so a long answer leads with a composed digest instead of always falling
  // back to the flat list.
  const { readDigestStructures } = await import(join(ROOT, "src", "adapters/corpus/digest-bank.mjs"));
  const chatPagePath = join(SITE, "chat.html");
  await writeF(chatPagePath, injectMetaHead(renderChatHtml({ digestStructures: readDigestStructures(), seedStamp, seedBytes: seed.bytes }), demoPageMeta("chat")));
  console.log(`wrote ${chatPagePath}`);
}

// news.html: the news dashboard, over the SAME chat seed built just above —
// section 1 of PLAN_NEWS_FEED.md is explicit that news.html reuses
// chat-seed.json as-is rather than earning a second seed builder. Its own
// browser bundle and fixture set are built here too, the same posture as
// buildChatBundle above, so a plain `npm run demo:build` leaves nothing for
// the page to 404 on.
{
  const { renderNewsHtml } = await import(join(ROOT, "src", "services", "news-viz.mjs"));
  const { readDigestStructures } = await import(join(ROOT, "src", "adapters/corpus/digest-bank.mjs"));
  const { main: buildNewsBundle } = await import(join(here, "build-news-bundle.mjs"));
  const { outPath: newsBundlePath, size: newsBundleBytes, fixturesPath: newsFixturesPath, fixturesSize: newsFixturesBytes } = await buildNewsBundle(SITE);
  console.log(`wrote ${newsBundlePath} (${(newsBundleBytes / 1024).toFixed(0)} KB)`);
  console.log(`wrote ${newsFixturesPath} (${(newsFixturesBytes / 1024).toFixed(0)} KB)`);
  const newsPagePath = join(SITE, "news.html");
  await writeF(newsPagePath, injectMetaHead(renderNewsHtml({ digestStructures: readDigestStructures(), seedStamp, seedBytes: seed.bytes }), demoPageMeta("news")));
  console.log(`wrote ${newsPagePath}`);
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

// What each adventure scenario's dropdown entry says. The label names the
// difference that made the world worth shipping — how big it is, and what it
// is that makes it harder or easier — so picking one is a choice rather than
// a guess at what a hyphenated world id means. Declared here, above the
// sprite catalog block, because the scene composer's room vocabulary reads
// the same world names.
const ADVENTURE_SCENARIO_LABELS = {
  "ashcombe-hall": "ashcombe hall (6 rooms, 1 lock)",
  "lantern-cottage": "lantern cottage (3 rooms, no locks)",
  "greyvale-museum": "greyvale museum (9 rooms, 3 locks)",
};

// The sprite library catalog: every class either tier resolves a sprite for,
// grouped for browsing, each swatch resolved through the real
// resolveSpriteAsset/classAncestorChain (never hand-simulated) — see
// sprite-catalog-viz.mjs's own header for the real ontology-fact sources
// (the spider-fly world's SEED_TAXONOMY plus corpus/wordnet/wordnet-xl.jsonl)
// this step loads once, in Node, the same posture the ledger/adventure
// build steps above already take with their own build-time data.
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
  const { loadSpriteOntologyFactRows, loadAdventureSceneRoomClasses, renderSpriteCatalogHtml, renderSpriteCatalogLandingHtml, CATALOG_GROUPS } = await import(join(ROOT, "src", "services/sprite-catalog-viz.mjs"));
  const ontologyFactRows = await loadSpriteOntologyFactRows();
  // The scene composer's room vocabulary: the same worlds the adventure
  // page's scenario dropdown ships (the block below reads them again for its
  // own embed).
  const adventureRoomClasses = await loadAdventureSceneRoomClasses(Object.keys(ADVENTURE_SCENARIO_LABELS));
  const { main: buildSpritesBundle } = await import(join(here, "build-sprites-bundle.mjs"));
  const { outPath: spritesBundlePath, size: spritesBundleBytes } = await buildSpritesBundle(SITE);
  console.log(`wrote ${spritesBundlePath} (${(spritesBundleBytes / 1024).toFixed(0)} KB)`);

  const spritesPagePath = join(SITE, "sprites.html");
  const spritesHtml = renderSpriteCatalogLandingHtml({ iconTemplates: spriteTemplates, largeTemplates: spriteLargeTemplates, factRows: ontologyFactRows, spritesBundleAvailable: true, adventureRoomClasses });
  await writeF(spritesPagePath, injectMetaHead(spritesHtml, demoPageMeta("sprites")));
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
      adventureRoomClasses,
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
// (the full turn engine, same posture as the adventure bundle above —
// generated fresh per build, never committed) so the deployed
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
  await writeF(planPath, injectMetaHead(renderPlanHtml({ plan, rendersAs, sizeOrder, title: plan.goal?.text || "tmct plan" }), demoPageMeta("plan")));
  console.log(`wrote ${planPath} (${plan.actions.length} moves, ${plan.states.length} snapshots)`);
}

// Each label names the difference that made the layout worth shipping, not
// just its size: what the board does to the chase is the reason to switch to
// it. None state a cast count — the page's own sliders pick that at play
// time, so a fixed number in the label would just be a stale default the
// page immediately overrides.
const MUDIII_SCENARIO_LABELS = {
  "town-square": "town square (12x12)",
  "town-square-market": "market row (10x10, stall lanes to corner a goblin in)",
  "town-square-chapel": "chapel yard (14x14, open ground)",
  "river-crossing": "river crossing (fox, goat, cabbage and a farmer)",
};

// The river-crossing puzzle carries no town-square layout of its own (section
// 10 of PLAN_RIVER_CROSSING.md): its four passengers are placed by the
// world's own facts rather than minted by a roster, and nothing about it is a
// grid an animal walks around. This is only the fallback board size the 3D
// scene draws its empty floor at when a page opens on that scenario.
const RIVER_CROSSING_GRID_SIZE = 6;

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
    await writeF(adventurePath, injectMetaHead(renderAdventureHtml({
      worldPayload: scenarios[0].worldPayload,
      scenarios,
      spriteTemplates,
      largeSpriteTemplates: largeSpriteManifest ? largeSpriteManifest.templates : [],
    }), demoPageMeta("adventure")));
    console.log(`wrote ${adventurePath}`);
  }
}

// The mudiii demo: the town square in three, plus the two alternates its
// scenario dropdown offers. The three vendor asset is built inside this block
// rather than beside the wink one, because it is the only page that loads it —
// a build with no town-square world in the pack should not pay an 800 KB
// compile for a page it is not going to write.
{
  const worlds = await loadScenarioWorlds(["town-square", "town-square-market", "town-square-chapel", "river-crossing"]);
  if (!worlds.length) {
    console.log("no town-square worlds found in the worlds pack — the mudiii demo has no world to embed, so this is a heads-up, not a build failure");
  } else {
    const { buildThreeVendor } = await import(join(here, "build-three-vendor.mjs"));
    const { outPath: threePath, bytes: threeBytes } = await buildThreeVendor(SITE);
    console.log(`wrote ${threePath} (${(threeBytes / 1024).toFixed(0)} KB)`);
    const { main: buildMudiiiBundle } = await import(join(here, "build-mudiii-bundle.mjs"));
    const { outPath: mudiiiBundlePath, size: mudiiiBundleBytes } = await buildMudiiiBundle(SITE);
    console.log(`wrote ${mudiiiBundlePath} (${(mudiiiBundleBytes / 1024).toFixed(0)} KB)`);
    const { renderMudiiiHtml } = await import(join(ROOT, "src", "services", "mudiii-viz.mjs"));
    const { MUDIII_ROLES } = await import(join(ROOT, "src", "services", "predator-prey.mjs"));
    const { layoutNamed } = await import(join(ROOT, "src", "domain", "town-square-world.mjs"));
    const assetManifest = JSON.parse(readFileSync(join(ROOT, "data", "mudiii-assets.json"), "utf8")).assets;
    // The cast each square opens with. It comes from the layout's own counts
    // rather than the world's fact rows, because a town-square world ships the
    // BOARD only — the engine mints the animals onto it at start, at seeded
    // cells, so there is no cast in the pack to read. The ids here are the
    // ones startTownSquareGame will mint, so the deck and the HUD can draw the
    // opening cast before the first turn runs.
    //
    // The river-crossing puzzle has no layout (layoutNamed returns null for
    // it — it is not a town square) and needs no minted cast either: its four
    // passengers are already placed by the world's own facts. An empty agents
    // list is the honest opening roster for a world nobody's engine casts.
    const castOf = (worldPayload) => {
      const layout = layoutNamed(worldPayload.name);
      if (!layout) return [];
      const { cast } = layout;
      return [
        ...Array.from({ length: cast.predators }, (_, i) => ({ id: `${MUDIII_ROLES.predator.idPrefix}-${i + 1}`, role: "predator" })),
        ...Array.from({ length: cast.prey }, (_, i) => ({ id: `${MUDIII_ROLES.prey.idPrefix}-${i + 1}`, role: "prey" })),
      ];
    };
    const scenarios = worlds.map((worldPayload) => {
      const layout = layoutNamed(worldPayload.name);
      return {
        label: MUDIII_SCENARIO_LABELS[worldPayload.name] || worldPayload.name,
        worldPayload,
        agents: castOf(worldPayload),
        gridSize: layout ? layout.gridSize : RIVER_CROSSING_GRID_SIZE,
        // No roster, no ticking, no chase: the page shows this scenario's own
        // actor card and puzzle plan instead of the fox/goblin HUD. See
        // mudiii-viz.mjs's pageScript for what this flag turns on and off.
        puzzle: !layout,
      };
    });
    const mudiiiPath = join(SITE, "mudiii.html");
    await writeF(mudiiiPath, injectMetaHead(renderMudiiiHtml({
      worldPayload: scenarios[0].worldPayload,
      agents: scenarios[0].agents,
      scenarios,
      assetManifest,
    }), demoPageMeta("mudiii")));
    console.log(`wrote ${mudiiiPath}`);
  }
}

// The hand-authored pages (index.html, help.html, and the about pages —
// TRACKED_PAGES in scripts/site-pages.mjs is the source of truth)
// carry a <!-- meta:begin -->/<!-- meta:end --> marker pair in their tracked
// <head> in place of their own <title>/<meta name="description"> lines; this
// fills the marker's interior fresh on every build, so a title/description
// edit only ever needs to land in scripts/site-pages.mjs.
{
  const markerRe = /<!-- meta:begin -->[\s\S]*?<!-- meta:end -->/;
  const fillMetaMarker = (path, meta) => {
    const html = readFileSync(path, "utf8");
    if (!markerRe.test(html)) throw new Error(`${path} has no <!-- meta:begin -->/<!-- meta:end --> marker to fill`);
    writeFileSync(path, html.replace(markerRe, `<!-- meta:begin -->\n${renderMetaHeadBlock(meta)}\n<!-- meta:end -->`));
  };
  fillMetaMarker(join(SITE, "index.html"), indexHeadMeta());
  fillMetaMarker(join(SITE, "help.html"), helpHeadMeta());
  for (const slug of DEMO_PAGES) fillMetaMarker(join(SITE, `${slug}-about.html`), aboutPageMeta(slug));
  console.log(`filled meta:begin/meta:end blocks in index.html, help.html and ${DEMO_PAGES.length} about pages`);
}

const GITLAB_REPO_URL = "https://gitlab.com/polycode-projects/the-mechanical-code-talker";

const fmtInt = (n) => Number(n).toLocaleString("en-US");
const fmtMs = (n) => Number(n).toFixed(2);

/** receipts.html: every figure on the page reads straight from a committed
 *  file at build time and carries a data-source="<file>#<path>" attribute
 *  naming exactly where it came from — test/estate/receipts.test.mjs re-reads
 *  those same files and checks every figure against them. Nothing here is
 *  typed in by hand. */
function renderReceiptsHtml({ receipts }) {
  const { latencyMs, graph, pages, host } = receipts;
  const RJ = "test-benchmarks/receipts/receipts.json";
  const pageRows = pages.map((p, i) => `
        <li><code>${escapeHtml(p.slug)}</code>: raw <strong data-source="${RJ}#pages[${i}].bytesRaw">${fmtInt(p.bytesRaw)}</strong> bytes,
          wire <strong data-source="${RJ}#pages[${i}].bytesWire">${fmtInt(p.bytesWire)}</strong> bytes</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>placeholder</title>
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<link rel="stylesheet" href="./${SHARED_STYLESHEET}">
</head>
<body>
<a class="skip-link" href="#receipts-main">Skip to the page</a>
<div class="about-shell">
  <nav class="about-nav" aria-label="Sections of this page">
    <a class="about-back" href="./index.html">&larr; tmct home</a>
    <p class="eyebrow">On this page</p>
    <ol class="about-crumbs">
      <li><a href="#latency">Query latency</a></li>
      <li><a href="#size">Graph and page size</a></li>
      <li><a href="#cost">Running cost</a></li>
      <li><a href="#chain">Supply chain</a></li>
    </ol>
  </nav>

  <main class="about-main" id="receipts-main">
    <header class="about-head">
      <p class="eyebrow">receipts</p>
      <h1>The numbers behind the claims</h1>
      <p class="lede">Every figure on this page comes from a file committed to the repository, read at build time. The small print under each one names that file.</p>
    </header>

    <section class="about-section" id="latency">
      <h2>Query latency</h2>
      <p>100 <code>ask()</code> calls against the graph the chat page embeds, timed with <code>performance.now()</code>, drawn from a fixed, ordered case list.</p>
      <ul>
        <li>p50: <strong data-source="${RJ}#latencyMs.p50">${fmtMs(latencyMs.p50)}</strong> ms</li>
        <li>p90: <strong data-source="${RJ}#latencyMs.p90">${fmtMs(latencyMs.p90)}</strong> ms</li>
        <li>p99: <strong data-source="${RJ}#latencyMs.p99">${fmtMs(latencyMs.p99)}</strong> ms</li>
        <li>max: <strong data-source="${RJ}#latencyMs.max">${fmtMs(latencyMs.max)}</strong> ms</li>
      </ul>
      <p class="source-note">n = <span data-source="${RJ}#latencyMs.n">${fmtInt(latencyMs.n)}</span> queries, measured on
        <span data-source="${RJ}#host.model">${escapeHtml(host.model)}</span>
        (<span data-source="${RJ}#host.cores">${fmtInt(host.cores)}</span> cores).
        Source: <code>${RJ}</code>, regenerated by <code>npm run bench:receipts</code>.</p>
    </section>

    <section class="about-section" id="size">
      <h2>Graph and page size</h2>
      <p>The starter memory the demo pages embed, and what each built page costs on the wire.</p>
      <ul>
        <li>facts: <strong data-source="${RJ}#graph.facts">${fmtInt(graph.facts)}</strong></li>
        <li>individuals: <strong data-source="${RJ}#graph.individuals">${fmtInt(graph.individuals)}</strong></li>
        <li>graph, raw: <strong data-source="${RJ}#graph.bytesRaw">${fmtInt(graph.bytesRaw)}</strong> bytes</li>
        <li>graph, brotli: <strong data-source="${RJ}#graph.bytesBrotli">${fmtInt(graph.bytesBrotli)}</strong> bytes</li>
      </ul>
      <p>Per built page, raw and wire (brotli) bytes:</p>
      <ul>${pageRows}
      </ul>
      <p class="source-note">Source: <code>${RJ}</code>. Cross-checked against
        <a href="${GITLAB_REPO_URL}/-/blob/main/reports/PAGE_WEIGHTS.md">reports/PAGE_WEIGHTS.md</a>,
        which measures the same deployed pages with a curl-per-asset pass and a real Chromium cold load.</p>
    </section>

    <section class="about-section" id="cost">
      <h2>Running cost</h2>
      <p>tmct ships as a static site. The engine runs in your browser, and every answer comes from the graph already on the page. No request reaches an inference API to answer a question. A static build costs the same to host whether one visitor arrives or a thousand, so the running cost is $0 by design.</p>
    </section>

    <section class="about-section" id="chain">
      <h2>Supply chain</h2>
      <p>The <a href="https://www.npmjs.com/package/@polycode-projects/the-mechanical-code-talker">npm package</a> carries Sigstore-signed provenance naming the GitLab pipeline that built it. Every published version also gets a <a href="${GITLAB_REPO_URL}/-/releases">GitLab release</a> tag pinned to the exact commit that pipeline ran against. Follow both and an install traces back to the source it was built from.</p>
    </section>
  </main>
</div>
<script type="module" src="./about-nav.mjs"></script>
</body>
</html>
`;
}

{
  const receiptsJsonPath = join(ROOT, "test-benchmarks", "receipts", "receipts.json");
  const receipts = JSON.parse(readFileSync(receiptsJsonPath, "utf8"));
  const receiptsPath = join(SITE, "receipts.html");
  writeFileSync(receiptsPath, injectMetaHead(renderReceiptsHtml({ receipts }), receiptsHeadMeta()));
  console.log(`wrote ${receiptsPath} (${receipts.pages.length} pages)`);
}

// claims.html: every figure reads straight from a committed results/claims/
// <name>.json at build time, the same posture renderReceiptsHtml takes
// above. CLAIMS_PAGE_BLOCKS (scripts/site-pages.mjs) is the one declared
// list of which JSON file backs which block; loadClaimBlock below is the
// build-time gate — a missing or schema-invalid file named there fails the
// whole build rather than shipping a page with a blank or stale figure.
const GITLAB_BLOB = (relPath) => `${GITLAB_REPO_URL}/-/blob/main/${relPath}`;

function loadClaimBlock(name) {
  const relPath = `results/claims/${name}.json`;
  const path = join(ROOT, relPath);
  if (!existsSync(path)) {
    throw new Error(`claims page: block "${name}" is declared in CLAIMS_PAGE_BLOCKS but ${relPath} does not exist`);
  }
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const problems = checkClaim(payload, loadSchema());
  if (problems.length) {
    throw new Error(`claims page: ${relPath} failed schema validation:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return payload;
}

const claimCommand = (name) => `npm run claim:${name}`;
const q = (s) => `&ldquo;${escapeHtml(s)}&rdquo;`;

/** The shared shell every claim block renders through: a kicker (block id),
 *  a flat sentence, a figure, a "what this does not mean" line, a one-line
 *  note on which admission standard the block meets, and a footer naming
 *  the source file, the command that regenerates it, and links out. */
function claimFigureBlock({ id, kicker, sentence, figureHtml, notMean, standard, jsonName, demoHref }) {
  const demo = demoHref ? ` &middot; <a href="./${demoHref}">try it in ${demoHref}</a>` : "";
  return `
      <article class="claim-block" id="${id}" data-source="results/claims/${jsonName}.json">
        <p class="claim-block-kicker"><span>${kicker}</span></p>
        <p class="claim-block-sentence">${sentence}</p>
        ${figureHtml}
        <p class="not-mean"><strong>What this does not mean:</strong> ${notMean}</p>
        <p class="claim-block-standard"><strong>Meets the standard:</strong> ${standard}</p>
        <p class="claim-block-links">
          <span>Source: <code>results/claims/${jsonName}.json</code>, regenerated by <code>${claimCommand(jsonName)}</code>.</span>
          <a href="${GITLAB_BLOB(`results/claims/${jsonName}.json`)}">view JSON</a>${demo}
        </p>
      </article>`;
}

/** claims.html: one block per name CLAIMS_PAGE_BLOCKS declares, every
 *  figure read from `blocks` — one loadClaimBlock() result per name — at
 *  build time. No number in this function's own source is a claim figure;
 *  every one below is read off `blocks` or `plannerButton`. */
function renderClaimsHtml({ blocks, plannerButton }) {
  const planner = blocks.planner;
  const proseBand = blocks["prose-band"];
  const commonsenseqa = blocks.commonsenseqa;
  const syllogist = blocks.syllogist;

  const plannerRows = Object.entries(planner.detail.domains).map(([domainName, d]) => `
          <tr>
            <td>${escapeHtml(domainName)}</td>
            <td data-source="results/claims/planner.json#detail.domains.${domainName}.largestUnder1s">${fmtInt(d.largestUnder1s)} ${escapeHtml(d.unit)}</td>
            <td data-source="results/claims/planner.json#detail.domains.${domainName}.firstOver10s">${fmtInt(d.firstOver10s)} ${escapeHtml(d.unit)}</td>
          </tr>`).join("");
  const river = planner.detail.domains.river;
  const c7 = claimFigureBlock({
    id: "c7-planner", kicker: "C7",
    sentence: `tmct solves a taught Hanoi puzzle in under a second up to this many disks.`,
    figureHtml: `<p class="claim-block-figure" data-source="results/claims/planner.json#value">${fmtInt(planner.value)}<span class="unit">disks, largest solved under 1s</span></p>
        <table>
          <thead><tr><th>domain</th><th>largest under 1s</th><th>first over 10s</th></tr></thead>
          <tbody>${plannerRows}
          </tbody>
        </table>
        <p class="claim-block-sentence">The river row is the wolf/goat/cabbage crossing (<a href="./mudiii.html">mudiii.html</a>'s fourth scenario), scaled past the three passengers the classic puzzle names: it still solves the classic optimum at <span data-source="results/claims/planner.json#detail.domains.river.largestUnder1s">${fmtInt(river.largestUnder1s)} passengers</span> under a second, and the search first runs past 10 seconds at <span data-source="results/claims/planner.json#detail.domains.river.firstOver10s">${fmtInt(river.firstOver10s)} passengers</span> — not because the search slows down looking, but because past that size no first move can leave every guarded pair covered, so it reports the honest miss straight away and the slowdown is the miss itself getting more expensive to state, never a shortened plan standing in for a real one.</p>`,
    notMean: `The search does not scale without bound. Past the "largest under 1s" size, each domain eventually runs over 10 seconds and is killed by its own timeout rather than left to search indefinitely. See the "first over 10s" column above.`,
    standard: "the scaling wall sets the denominator here, and you can recheck it yourself with the device button below.",
    jsonName: "planner", demoHref: "plan.html",
  });

  const bench = `
      <div class="claims-bench" id="benchmark-device" data-source="results/claims/planner.json#detail.domains.${plannerButton.domain}">
        <p class="claim-block-sentence">Run the same measurement on this device: solve a ${fmtInt(plannerButton.size)}-disk Hanoi puzzle in your browser, through the same code that produced C7.</p>
        <button class="claims-bench-btn" id="claims-bench-run" type="button">Run it on this device</button>
        <p class="claims-bench-result" id="claims-bench-result" aria-live="polite">Committed: <span class="ink">${fmtMs(plannerButton.committedMs)} ms</span> on ${escapeHtml(plannerButton.hardware)}.</p>
      </div>`;

  const l1 = claimFigureBlock({
    id: "l1-prose-band", kicker: "L1",
    sentence: "Unedited Simple Wikipedia prose grounds into a stored fact this often, sentence by sentence.",
    figureHtml: `<p class="claim-block-figure" data-source="results/claims/prose-band.json#value">${proseBand.value}<span class="unit">% of ${fmtInt(proseBand.detail.sentenceCount)} sentences</span></p>`,
    notMean: `This is raw, unedited prose pulled in unfiltered, not the corpus tmct ships with. ${fmtInt(proseBand.detail.skippedCount)} of ${fmtInt(proseBand.detail.sentenceCount)} sentences were skipped, most for an ungrounded content word such as ${proseBand.detail.topUngroundedTerms.map((t) => q(t.term)).join(" or ")}.`,
    standard: "external input, unedited Simple Wikipedia prose tmct&rsquo;s author did not write or curate.",
    jsonName: "prose-band", demoHref: "chat.html",
  });

  const l2 = claimFigureBlock({
    id: "l2-commonsenseqa", kicker: "L2",
    sentence: "Asked a five-way commonsense multiple-choice question, tmct picks an option only when one grounds against the graph, and picks the right one this often.",
    figureHtml: `<p class="claim-block-figure" data-source="results/claims/commonsenseqa.json#value">${fmtInt(commonsenseqa.value)}<span class="unit">of ${fmtInt(commonsenseqa.detail.sampleSize)} questions</span></p>
        <p class="claim-block-figure-split"><span data-source="results/claims/commonsenseqa.json#detail.answered">${fmtInt(commonsenseqa.detail.answered)}</span> answered, <span data-source="results/claims/commonsenseqa.json#detail.refused">${fmtInt(commonsenseqa.detail.refused)}</span> refused, <span data-source="results/claims/commonsenseqa.json#detail.abstained">${fmtInt(commonsenseqa.detail.abstained)}</span> abstained.</p>
        <p>Of the ${fmtInt(commonsenseqa.detail.sampleSize)} questions, <span data-source="results/claims/commonsenseqa.json#detail.sourceEdgePresent">${fmtInt(commonsenseqa.detail.sourceEdgePresent)}</span> had the answer stated in the graph at all; <span data-source="results/claims/commonsenseqa.json#detail.correctWhenSourceEdgePresent">${fmtInt(commonsenseqa.detail.correctWhenSourceEdgePresent)}</span> of those got picked. The gap between those two numbers is knowledge present but not selected. The rest is knowledge absent from the seed.</p>`,
    notMean: `This is not a reasoning score. CommonsenseQA's distractors were pulled from ConceptNet on the same relation as the answer, so an option having an edge to the source concept is close to no evidence at all. A refusal here means several options grounded equally well and tmct reported the tie rather than breaking it. An abstention means nothing in the graph connected the question to any option. Neither is a wrong answer, and neither is dressed up as one. Three of the stems it missed: ${commonsenseqa.detail.exampleStems.map((s) => q(s)).join(", ")}.`,
    standard: "external input: the CommonsenseQA dev split, authored outside this repository from ConceptNet, the same source the shipped corpus slice is cut from, selected by a committed deterministic rule and attributed in test-benchmarks/claims/commonsenseqa-sample.NOTICE.",
    jsonName: "commonsenseqa", demoHref: "chat.html",
  });

  const c8 = claimFigureBlock({
    id: "c8-syllogist", kicker: "C8",
    sentence: "A query the ask lane can't prove alone, /classify and /prove can sometimes close by reasoning through class expressions and disjunctions.",
    figureHtml: `<p class="claim-block-figure" data-source="results/claims/syllogist.json#delta">+${fmtInt(syllogist.delta)}<span class="unit">${syllogist.unit}</span></p>
        <p class="claim-block-figure-split">Of ${fmtInt(syllogist.detail.cases)} INF-7/INF-8 inference cases tested: before ${fmtInt(syllogist.before)}, after ${fmtInt(syllogist.after)}.</p>
        <p>Budget exhausted on ${fmtInt(syllogist.detail.budgetExhausted)} cases. Committed verdicts: ${JSON.stringify(syllogist.detail.beforeVerdicts).replace(/[{}]/g, "").replace(/"/g, "").replace(/,/g, ", ")} → ${JSON.stringify(syllogist.detail.afterVerdicts).replace(/[{}]/g, "").replace(/"/g, "").replace(/,/g, ", ")}.</p>`,
    notMean: `This measurement captures the current state as-is. INF-7/INF-8 are the benchmark cases that test whether phases 2 (EL wiring) and 4 (SHOIQ) of the plan deliver a real, counted improvement on the chat surface. The delta of 0 indicates the targeted verdicts have not yet shifted as the plan predicts.`,
    standard: "measured through the shipped engine against test-benchmarks/infbench/cases.jsonl; 48 inference benchmark cases covering nested existentials, disjunctions, and cardinality clashes.",
    jsonName: "syllogist", demoHref: "chat.html",
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>placeholder</title>
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});</script>
<link rel="stylesheet" href="./${SHARED_STYLESHEET}">
</head>
<body>
<a class="skip-link" href="#claims-main">Skip to the page</a>
<div class="about-shell">
  <nav class="about-nav" aria-label="Blocks on this page">
    <a class="about-back" href="./index.html">&larr; tmct home</a>
    <p class="eyebrow">On this page</p>
    <ol class="about-crumbs">
      <li><a href="#c7-planner">Hanoi planner</a></li>
      <li><a href="#l1-prose-band">Prose grounding</a></li>
      <li><a href="#l2-commonsenseqa">CommonsenseQA</a></li>
      <li><a href="#c8-syllogist">Syllogist reasoning</a></li>
    </ol>
  </nav>

  <main class="about-main" id="claims-main">
    <header class="about-head">
      <p class="eyebrow">claims</p>
      <h1>Claims and limits</h1>
    </header>

    <div class="claim-block-grid">${c7}${l1}${l2}${c8}
    </div>
    ${bench}

    <footer>
      <p>MPL-2.0 &middot;
        <a href="https://gitlab.com/polycode-projects/the-mechanical-code-talker">repository</a>
        &middot;
        <a href="https://www.npmjs.com/package/@polycode-projects/the-mechanical-code-talker">npm</a>
        &middot; <a href="./index.html">tmct home</a>
        &middot; <a href="./receipts.html">receipts</a>
        &middot; &copy; Polycode Limited.</p>
    </footer>
  </main>
</div>
<script src="./claims-browser.bundle.js"></script>
<script type="module">
const PLANNER_BUTTON = ${JSON.stringify(plannerButton)};
const WINK_LOAD_TIMEOUT_MS = 8000;
let winkReady = null;
function winkTimeout(ms, reason) {
  return new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error(reason)); }, ms); });
}
function tryLoadWink() {
  if (winkReady) return winkReady;
  winkReady = Promise.race([import("./vendor/wink.js"), winkTimeout(WINK_LOAD_TIMEOUT_MS, "wink vendor asset load timed out")])
    .then(function (mod) {
      window.tmctClaims.registerWinkModel(function () { return { winkNLP: mod.winkNLP, model: mod.model }; });
    })
    .catch(function (err) {
      console.warn("tmct claims: the wink vendor asset failed to load, continuing without the lemma/POS tier", err);
    });
  return winkReady;
}
const runBtn = document.getElementById("claims-bench-run");
const resultEl = document.getElementById("claims-bench-result");
const committedLine = "Committed: <span class=\\"ink\\">" + PLANNER_BUTTON.committedMs.toFixed(2) + " ms</span> on " + PLANNER_BUTTON.hardware + ".";
runBtn.addEventListener("click", function () {
  runBtn.disabled = true;
  resultEl.textContent = "solving...";
  tryLoadWink()
    .then(function () { return window.tmctClaims.solvePlannerInstance(PLANNER_BUTTON.domain, PLANNER_BUTTON.size); })
    .then(function (result) {
      if (result && result.solved) {
        resultEl.innerHTML = "Your device: <span class=\\"ink\\">" + result.ms.toFixed(2) + " ms</span>. " + committedLine;
      } else {
        const reason = result && result.declined
          ? "the teach step \\"" + result.declined.sentence + "\\" was declined (" + result.declined.via + ")"
          : "no plan found within the search bound";
        resultEl.textContent = "could not run on this device: " + reason;
      }
    })
    .catch(function (err) {
      resultEl.textContent = "could not run on this device: " + (err && err.message ? err.message : String(err));
    })
    .finally(function () {
      runBtn.disabled = false;
    });
});
</script>
<script type="module" src="./about-nav.mjs"></script>
</body>
</html>
`;
}

{
  const { main: buildClaimsBundle } = await import(join(here, "build-claims-bundle.mjs"));
  const { outPath: claimsBundlePath, size: claimsBundleBytes } = await buildClaimsBundle(SITE);
  console.log(`wrote ${claimsBundlePath} (${(claimsBundleBytes / 1024).toFixed(0)} KB)`);

  const claimBlockNames = [...new Set(CLAIMS_PAGE_BLOCKS)];
  const blocks = Object.fromEntries(claimBlockNames.map((name) => [name, loadClaimBlock(name)]));

  const hanoi = blocks.planner.detail.domains.hanoi;
  const hanoiAtLargest = hanoi.sizes.find((s) => s.size === hanoi.largestUnder1s);
  const plannerButton = {
    domain: "hanoi",
    size: hanoi.largestUnder1s,
    committedMs: hanoiAtLargest.medianMs,
    hardware: blocks.planner.hardware,
  };

  const claimsPath = join(SITE, "claims.html");
  writeFileSync(claimsPath, injectMetaHead(renderClaimsHtml({ blocks, plannerButton }), claimsHeadMeta()));
  console.log(`wrote ${claimsPath} (${claimBlockNames.length} declared blocks)`);
}

// robots.txt and sitemap.xml: the live site was serving both as an HTTP 403
// because neither existed in the build, which search engines read as the
// whole site being blocked from crawling.
const ROBOTS_TXT = `User-agent: *
Allow: /
Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;

function renderSitemapXml() {
  const locs = [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/receipts.html`, `${SITE_ORIGIN}/claims.html`, `${SITE_ORIGIN}/help.html`];
  for (const slug of DEMO_PAGES) {
    locs.push(`${SITE_ORIGIN}/${slug}.html`);
    locs.push(`${SITE_ORIGIN}/${slug}-about.html`);
  }
  const entries = locs.map((loc) => `  <url><loc>${loc}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

{
  const robotsPath = join(SITE, "robots.txt");
  writeFileSync(robotsPath, ROBOTS_TXT);
  console.log(`wrote ${robotsPath}`);
  const sitemapXml = renderSitemapXml();
  const sitemapPath = join(SITE, "sitemap.xml");
  writeFileSync(sitemapPath, sitemapXml);
  console.log(`wrote ${sitemapPath} (${(sitemapXml.match(/<loc>/g) || []).length} locs)`);
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
  "./vendor/three.js",
  "./reference-pack/index.json",
];
// Pages, stylesheets and bundles: precached for an offline second visit, but
// always read network-first so a deploy reaches the browser on the next load.
// The about pages come from scripts/site-pages.mjs, so adding one to that list
// caches it here without a second edit.
const DEPLOY_TRACKING = [
  "./index.html",
  "./og/index.png",
  "./chat.html",
  "./help.html",
${ABOUT_PAGES.map((p) => `  ${JSON.stringify(`./${p}`)},`).join("\n")}
  ${JSON.stringify(`./${SHARED_STYLESHEET}`)},
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
  const pageOrBundle = url.pathname.endsWith(".html") || url.pathname.endsWith("/")
    || url.pathname.endsWith(".bundle.js") || url.pathname.endsWith(".css");
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
    ["index.html", null], ["chat.html", null], ["help.html", null],
    ...ABOUT_PAGES.map((p) => [p, null]), [SHARED_STYLESHEET, null],
    ["chat-browser.bundle.js", null], ["sprites-browser.bundle.js", null],
    ["vendor/wink.js", null], ["vendor/p2p.js", null], ["vendor/three.js", null],
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

// Precompressed siblings (.gz/.br) for every sizable text asset, last, added to
// the finished site: served from the deployment when they
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
