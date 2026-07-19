// scripts/build-demo-site.mjs — regenerate everything the GitLab Pages site
// generates rather than tracks:
//
//   engine/           unmodified copies of the engine sources the in-page demo runs
//   demo-graph.json   the example code graph (see build-demo-graph.mjs)
//   demo-memory.json  the taught payload behind the ledger (see build-demo-memory.mjs)
//   ledger.html       the memory ledger, with the ask bundle inlined
//   plan.html         an animated replay of the solved hanoi-3 game
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

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

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

execFileSync(process.execPath, [join(here, "build-demo-graph.mjs"), join(SITE, "demo-graph.json")], { stdio: "inherit" });

// The ledger hero: build the memory payload through the real teach paths, then
// render public/ledger.html (self-contained, memory-ask bundle inlined) —
// the same page `tmct viz --ledger` writes, so the site can't drift from it.
const { main: buildDemoMemory } = await import(join(here, "build-demo-memory.mjs"));
const { outPath: memoryPath } = await buildDemoMemory(join(SITE, "demo-memory.json"));
const { readFile: readF, writeFile: writeF } = await import("node:fs/promises");
const { computeLedgerDataFromPayload, renderLedgerHtml, readMemoryAskBundle } = await import(join(ROOT, "src", "services/ledger-viz.mjs"));
const payload = JSON.parse(await readF(memoryPath, "utf8"));
const ledgerData = computeLedgerDataFromPayload(payload, {});
const memoryAskBundle = await readMemoryAskBundle();
const ledgerPath = join(SITE, "ledger.html");
await writeF(ledgerPath, renderLedgerHtml({ ...ledgerData, memoryAskBundle }));
console.log(`wrote ${ledgerPath} (${memoryAskBundle ? "chat dock enabled" : "no bundle — dock disabled"})`);

// The home page's embedded chat: the full-engine browser bundle plus its
// starter-memory seed, both generated (never committed) so the page always
// serves what src/ builds today.
//
// public/chat-ui.mjs imports the shared ticker helper as a plain sibling ES
// module (viz-ticker.mjs's own header names this exact usage), so a literal,
// unmodified copy travels alongside it here — the same posture as
// public/engine/src/'s copy of the domain sources above, just one file.
cpSync(join(SRC, "services", "viz-ticker.mjs"), join(SITE, "viz-ticker.mjs"));
console.log(`copied viz-ticker.mjs into ${SITE}`);
const { main: buildChatBundle } = await import(join(here, "build-chat-bundle.mjs"));
const { outPath: chatBundlePath, size: chatBundleBytes } = await buildChatBundle(SITE);
console.log(`wrote ${chatBundlePath} (${(chatBundleBytes / 1024).toFixed(0)} KB)`);
const { main: buildChatSeed } = await import(join(here, "build-chat-seed.mjs"));
const seed = await buildChatSeed(join(SITE, "chat-seed.json"));
console.log(`wrote ${seed.outPath} (${seed.facts} facts, ${(seed.bytes / 1024).toFixed(0)} KB)`);

// The reference pack's browser subset (public/reference-pack/): cut from the
// full pack when this machine carries one; skipped when it doesn't — the
// page's fetch provider then reads null and a pack lookup stays the ordinary
// honest miss. A pack that IS present but missing an allowlisted term still
// fails the build loudly (build-demo-pack's own check).
{
  const { referencePackDir } = await import(join(ROOT, "src", "adapters", "corpus", "reference-pack.mjs"));
  const packDir = referencePackDir();
  if (existsSync(join(packDir, "index.json.gz"))) {
    const { buildDemoPack } = await import(join(here, "build-demo-pack.mjs"));
    const { REFERENCE_PACK_TERMS } = await import(join(ROOT, "public", "chat-demos.mjs"));
    const packOut = join(SITE, "reference-pack");
    rmSync(packOut, { recursive: true, force: true });
    const manifest = buildDemoPack({ srcDir: packDir, terms: REFERENCE_PACK_TERMS, outDir: packOut });
    console.log(`wrote ${packOut} (${Object.keys(manifest.terms).length} terms)`);
  } else {
    console.log(`reference pack not present at ${packDir} — demo pack skipped (run \`npm run gen:reference-pack\` to enable)`);
  }
}

// The sprite tier meant to be looked at closely (400px, gradient/highlight
// material shading, data/sprites-large/*.toml): excluded from the npm
// package entirely (package.json's own "!data/sprites-large/"), so only
// this build step's own generated public/sprites-pack/ carries it to the
// deployed site. No page FETCHES this pack client-side yet — this step just
// confirms the pack itself builds; sprites.html below reads the same large
// tier a different way, straight off disk at build time, same as every
// other viz page's build-time data.
{
  const { buildDemoSpritesPack } = await import(join(here, "build-demo-sprites-pack.mjs"));
  const spritesPackOut = join(SITE, "sprites-pack");
  rmSync(spritesPackOut, { recursive: true, force: true });
  const { manifest, bytes } = buildDemoSpritesPack({ outDir: spritesPackOut });
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
  const spritesPagePath = join(SITE, "sprites.html");
  const spritesHtml = renderSpriteCatalogHtml({ iconTemplates: spriteTemplates, largeTemplates: spriteLargeTemplates, factRows: ontologyFactRows });
  await writeF(spritesPagePath, spritesHtml);
  console.log(`wrote ${spritesPagePath}`);
}

// The plan render: solve the hanoi-3 game through the real planner and keep the
// animated replay. This shells out to the binary a reader would run, so the page
// shows the artefact they get rather than one built a private way.
const HANOI_PROMPT =
  "disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a. " +
  "the goal is that every disk rests on peg-c. solve it.";
const planPath = join(SITE, "plan.html");
const planDir = mkdtempSync(join(tmpdir(), "tmct-demo-plan-"));
// stdin stays closed: chat reads it when it is open, and this run is scripted
// entirely by --prompt. The timeout is generous because these spawns load the
// wink model, and a build sharing a machine with a full test run has been seen
// to take minutes for work that takes seconds idle.
const runTmct = (args) =>
  execFileSync(process.execPath, [join(ROOT, "bin", "tmct.mjs"), ...args], {
    cwd: planDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 480_000,
  });
try {
  runTmct(["init"]);
  runTmct(["import", "--file", join(planDir, ".tmct", "imports", "games", "hanoi-3.txt")]);
  const solved = runTmct(["chat", "--prompt", HANOI_PROMPT, "--render", "blocks", "--output", planPath]);
  console.log(`wrote ${planPath} (${/\((.*?)\)\s*$/.exec(solved.trim())?.[1] ?? "rendered"})`);
} finally {
  rmSync(planDir, { recursive: true, force: true });
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
  await writeF(spiderFlyPath, renderSpiderFlyHtml({ spriteTemplates }));
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
    await writeF(adventurePath, renderAdventureHtml({ worldPayload, spriteTemplates }));
    console.log(`wrote ${adventurePath}`);
  }
}
