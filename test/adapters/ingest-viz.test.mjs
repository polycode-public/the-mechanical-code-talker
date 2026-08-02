// ingest-viz: renderIngestHtml is a pure string builder — no engine state is
// embedded (it all arrives live via the sibling ingest-browser.bundle.js,
// exactly as chat-page-viz.mjs's own page works), so these tests pin the
// page's STRUCTURE (mirroring chat-page-viz.test.mjs's own style) plus
// factTripleParts and loadProgressLine, shared with research-viz.mjs from
// memory-panel-viz.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderIngestHtml } from "../../src/services/ingest-viz.mjs";
import { factTripleParts, loadProgressLine } from "../../src/services/memory-panel-viz.mjs";
import { createIngestSession, groundTextToFacts } from "../../src/surfaces/web/ingest-browser-entry.mjs";
import { createInMemoryStore, readFactRows, loadMemory, appendFact } from "../../src/adapters/memory/core.mjs";

// ---- factTripleParts: the pure row-shape reader ----------------------------

test("factTripleParts: reads subject/predicate/object/provenance as strings, defaulting to empty", () => {
  assert.deepEqual(
    factTripleParts({ subject: "beagle", predicate: "rdfs:subClassOf", object: "dog", provenance: "teach:chat:x" }),
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "dog", source: "", provenance: "teach:chat:x" },
  );
  assert.deepEqual(factTripleParts({}), { subject: "", predicate: "", object: "", source: "", provenance: "" });
  assert.deepEqual(factTripleParts(null), { subject: "", predicate: "", object: "", source: "", provenance: "" });
});

// ---- loadProgressLine: the boot statusline's pure aggregator ---------------

test("loadProgressLine: sums loaded and total bytes across assets into one MB line", () => {
  const line = loadProgressLine([
    { loaded: 524288, total: 1048576 },
    { loaded: 1048576, total: 3145728 },
  ]);
  assert.equal(line, "loading the engine… 1.5 MB / 4.0 MB");
});

test("loadProgressLine: with any total unknown, shows loaded bytes alone rather than inventing a denominator", () => {
  assert.equal(loadProgressLine([{ loaded: 1048576, total: 0 }]), "loading the engine… 1.0 MB");
});

test("loadProgressLine: an empty part list reads as zero loaded, never a crash", () => {
  assert.equal(loadProgressLine([]), "loading the engine… 0.0 MB");
});

// ---- renderIngestHtml: page structure --------------------------------------

test("renderIngestHtml: mounts the ingest engine bundle by a same-origin relative path only", () => {
  const html = renderIngestHtml();
  assert.match(html, /<script src="\.\/ingest-browser\.bundle\.js"><\/script>/);
  assert.ok(!/(?:src|href)=["']https?:/.test(html), "no external resource loads baked into the markup");
});

test("renderIngestHtml: registers the site service worker, tolerating its absence", () => {
  const html = renderIngestHtml();
  assert.match(html, /navigator\.serviceWorker\.register\("\.\/tmct-sw\.js"\)\.catch/);
});

test("renderIngestHtml: the two-pane layout (source textarea, canonical facts) is present", () => {
  const html = renderIngestHtml();
  assert.match(html, /id="source"/);
  assert.match(html, /id="facts"/);
  assert.match(html, /id="factCount"/);
  assert.match(html, /class="pills"/);
});

test("renderIngestHtml: carries exactly one h1, promoted from the page's own subtitle rather than a second heading beside it", () => {
  const html = renderIngestHtml();
  const h1s = [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)];
  assert.equal(h1s.length, 1, "exactly one h1 on the page");
  assert.equal(h1s[0][1], "ingest &mdash; paste or drop text. It keeps the facts it can ground and skips the rest.");
});

test("renderIngestHtml: deterministic — byte-identical output for identical input", () => {
  assert.equal(renderIngestHtml(), renderIngestHtml());
});

test("renderIngestHtml: exposes window.tmctIngestReady, the same boot-readiness hook the e2e tests wait on", () => {
  const html = renderIngestHtml();
  assert.match(html, /window\.tmctIngestReady = boot\(\)/);
});

test("renderIngestHtml: escapes a custom title", () => {
  const html = renderIngestHtml({ title: 'a <script>alert(1)</script> title' });
  assert.ok(!html.includes("<script>alert(1)</script> title"));
  assert.match(html, /&lt;script&gt;/);
});

test("renderIngestHtml: self-contained, both theme schemes present, reduced-motion respected", () => {
  const html = renderIngestHtml();
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes('data-theme="dark"') && html.includes('data-theme="light"'));
  assert.ok(html.includes("prefers-reduced-motion"));
});

test("renderIngestHtml: fits a narrow viewport — the panes stack rather than overflowing", () => {
  const html = renderIngestHtml();
  assert.match(html, /max-width: 720px[\s\S]{0,100}grid-template-columns: 1fr; grid-template-rows: 1fr 1fr;/);
});

// ---- seed parity: on by default, with a toggle and a real fetch -----------

test("renderIngestHtml: seeds from the same chat-seed.json chat.html embeds, with progress reported", () => {
  const html = renderIngestHtml();
  assert.match(html, /loadSeedPayload\(fetchWithProgress, "\.\/chat-seed\.json"/);
  assert.match(html, /<input type="checkbox" id="seedToggle" checked>/, "the seed toggle ships checked — seeded by default");
});

test("renderIngestHtml: the seed toggle persists under its own storage key, off skipping the fetch outright", () => {
  const html = renderIngestHtml();
  assert.match(html, /"tmct\.ingest\.seed"/);
  assert.match(
    html,
    /if \(!seedToggleEl\.checked\) \{\s*seedPayload = null;\s*seedFacts = 0;\s*setSeedPhase\("skipped"\);\s*return;\s*\}/,
    "the off branch never even attempts the request, and says it skipped rather than that it failed",
  );
});

test("renderIngestHtml: the fuzzy low-trust tier checkbox ships off by default", () => {
  const html = renderIngestHtml();
  assert.match(html, /<input type="checkbox" id="fuzzyToggle">/);
  assert.ok(!html.includes('id="fuzzyToggle" checked'));
  assert.match(html, /optimistic: fuzzyToggleEl\.checked/);
});

// ---- the docked memory panel: shared with chat.html ------------------------

test("renderIngestHtml: the memory-panel-viz helpers are spliced in, not reimplemented", () => {
  const html = renderIngestHtml();
  assert.match(html, /const bandLabelFor = /);
  assert.match(html, /const statsSummaryLine = /);
  assert.match(html, /const fetchWithProgress = /);
  assert.match(html, /const renderStatsPanelInto = /);
  assert.match(html, /class="statsPanel" id="statsPanel"/);
});

test("renderIngestHtml: the docked panel hides on a narrow viewport, matching chat.html's own breakpoint", () => {
  const html = renderIngestHtml();
  assert.match(html, /max-width: 860px\)\s*\{\s*\n\s*\.statsPanel \{ display: none; \}/);
});

// ---- persistence: kept on this device, same convention as chat.html -------

test("renderIngestHtml: the device store opens under a version, fact-count and seed-content stamp, and boot tries a restore before falling back to the fresh seed", () => {
  const html = renderIngestHtml();
  assert.match(html, /openPersistedStore\(\{ storeKey: "ingest", stamp: siteVersion \+ ":" \+ seedFacts \+ ":" \+ SEED_STAMP \}\)/);
  assert.match(html, /persist\.load\(\)/);
});

test("renderIngestHtml: a grounded ingest schedules a debounced save of a payload snapshot, never a save per keystroke or of the live object", () => {
  const html = renderIngestHtml();
  assert.match(html, /structuredClone\(session\.memoryDir\.payload\)/);
  assert.match(html, /setTimeout\(\(\) => \{[\s\S]*?persist\.save/, "the save runs on a timer, not inline in the ingest call");
  assert.match(html, /\}, 500\)/, "the debounce window is present");
});

test("renderIngestHtml: reset-to-seed clears the persisted store and reloads; forget-everything rebuilds the session without reloading", () => {
  const html = renderIngestHtml();
  assert.match(html, /id="reinitStore"/);
  assert.match(html, /window\.location\.reload\(\)/);
  assert.match(html, /async function forgetEverything\(\) \{/);
  assert.ok(!/async function forgetEverything\(\) \{[\s\S]{0,400}?location\.reload/.test(html), "forget-everything never reloads the page");
});

// ---- the persistent session: one store across ingest clicks ---------------

test("renderIngestHtml: the ingest click never recreates the session — the click handler reads the existing one", () => {
  const html = renderIngestHtml();
  const handler = html.slice(html.indexOf('ingestBtn.addEventListener("click"'), html.indexOf("// ---- download the canonical facts"));
  assert.ok(!handler.includes("createIngestSession"), "the ingest click path never calls createIngestSession itself");
  assert.match(handler, /session\.ingest\(text/);
});

test("renderIngestHtml: clear only resets the UI, never the session", () => {
  const html = renderIngestHtml();
  const handler = html.slice(html.indexOf('clearBtn.addEventListener("click"'), html.indexOf("window.tmctIngestReady = boot()"));
  assert.ok(!handler.includes("createIngestSession"), "clear never rebuilds the session");
  assert.match(handler, /clearFactsPane\(\)/);
});

test("renderIngestHtml: export facts (renamed from download canonical) and reset to seed sit in the actions row", () => {
  const html = renderIngestHtml();
  assert.match(html, /<button type="button" class="btn" id="downloadBtn" disabled>export facts<\/button>/);
  assert.match(html, /<button type="button" class="btn" id="reinitStore"[^>]*>reset to seed<\/button>/);
});

// ---- groundTextToFacts / createIngestSession: the page's real seam --------
// The wiring behind the structure above — citation stripping, the
// clause/pronoun fallback, the optimistic tier and the O(sentences) row-diff
// fast path — exercised directly against the real recognizer, the same
// engine every e2e page click drives.

test("createIngestSession: a plain teach sentence grounds; a question is honestly skipped", async () => {
  const session = createIngestSession();
  const summary = await session.ingest("A beagle is a kind of dog. How are you today?");
  assert.equal(summary.sentences, 2);
  assert.equal(summary.recognized, 1);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(summary.facts.map((f) => [f.subject, f.predicate, f.object]), [["beagle", "rdfs:subClassOf", "dog"]]);
});

test("createIngestSession: onFact is awaited once per grounded row, in reading order", async () => {
  const session = createIngestSession();
  const seen = [];
  await session.ingest("A beagle is a kind of dog. A dog is a kind of animal.", {
    onFact: async (fact) => { seen.push(fact.subject); },
  });
  assert.deepEqual(seen, ["beagle", "dog"]);
});

test("groundTextToFacts: a citation marker glued onto a sentence boundary never blocks the read that carries it", async () => {
  const memoryDir = createInMemoryStore();
  const summary = await groundTextToFacts(
    "Sales are closely connected with marketing.[3] Sales and marketing have the same goal. Is this clear?",
    { memoryDir, sessionId: "x" },
  );
  assert.ok(summary.facts.some((f) => f.subject === "sales" && f.predicate === "mgx:connected-with" && f.object === "marketing"));
  assert.ok(summary.facts.some((f) => f.subject === "sales" && f.predicate === "mgx:same-goal-as" && f.object === "marketing"), "the leading [3] residue on the next sentence never blocks its own read");
  assert.ok(!summary.facts.some((f) => /\[|\]|3/.test(f.object) || /\[|\]|3/.test(f.subject)), "no citation residue rides into a stored term");
});

test("groundTextToFacts: a whole-sentence miss falls back to its own clause fragment, grounding what the run-on itself never would", async () => {
  const memoryDir = createInMemoryStore();
  const summary = await groundTextToFacts(
    "Zorbles are fast animals, and zorbles and quombats have the same habitat. Is this clear?",
    { memoryDir, sessionId: "x" },
  );
  assert.ok(summary.facts.some((f) => f.subject === "quombats" && f.object === "same habitat"), "the trailing clause fragment grounds on its own, once the whole run-on sentence misses");
});

test("groundTextToFacts: a pronoun-led sentence resolves against the paragraph's last unique grounded subject", async () => {
  const memoryDir = createInMemoryStore();
  const summary = await groundTextToFacts("A beagle is a kind of dog. It is closely connected with hunting.", { memoryDir, sessionId: "x" });
  assert.ok(summary.facts.some((f) => f.subject === "beagle" && f.predicate === "mgx:connected-with" && f.object === "hunting"));
  assert.ok(!summary.facts.some((f) => f.subject === "it"), "the pronoun itself is never stored as a subject");
});

test("groundTextToFacts: the pronoun carry resets at a blank line — a new paragraph never resolves against the last one's subject", async () => {
  const memoryDir = createInMemoryStore();
  const summary = await groundTextToFacts("A beagle is a kind of dog.\n\nIt is closely connected with hunting.", { memoryDir, sessionId: "x" });
  assert.ok(!summary.facts.some((f) => f.predicate === "mgx:connected-with"), "no antecedent survives the paragraph break, so the pronoun sentence stays an honest skip");
});

test("groundTextToFacts: the optimistic tier is off unless requested, and tags whatever it does ground as low-trust", async () => {
  const memoryDir = createInMemoryStore();
  const strict = await groundTextToFacts("A quombat is basically a wodget.", { memoryDir, sessionId: "x" });
  assert.equal(strict.recognized, 0);

  const memoryDir2 = createInMemoryStore();
  const fuzzy = await groundTextToFacts("A quombat is basically a wodget.", { memoryDir: memoryDir2, sessionId: "x", optimistic: true });
  assert.equal(fuzzy.recognized, 1);
  assert.equal(fuzzy.facts[0].provenance, "optimistic-extract:page");
});

test("groundTextToFacts: no graph is ever passed to the turn engine — an ordinary \"the number of X\" phrase still teaches, not a code-graph count miss", async () => {
  const memoryDir = createInMemoryStore();
  const summary = await groundTextToFacts(
    "Sales are activities related to selling or the number of goods sold in a period.",
    { memoryDir, sessionId: "x" },
  );
  assert.ok(summary.facts.some((f) => f.subject === "sales" && f.predicate === "rdfs:subClassOf" && f.object === "activity"));
  assert.ok(summary.facts.some((f) => f.subject === "sales" && f.predicate === "mgx:related-to" && f.object === "selling"));
});

test("groundTextToFacts: a Rule-only teach (no Fact row touched) counts as an honest skip, not a grounded sentence", async () => {
  const memoryDir = createInMemoryStore();
  // "a <name> is a <base1> of a <base2>" mints a compose2 Rule row, never a
  // Fact row — the shape the perf fast path's row-length compare must still
  // classify as "nothing to keep", even though the turn itself asserted.
  const summary = await groundTextToFacts("A grandparent is a parent of a parent.", { memoryDir, sessionId: "x" });
  assert.equal(summary.recognized, 0);
  assert.equal(summary.facts.length, 0);
});

test("groundTextToFacts: the row-length fast path never mis-skips a real fact once the store already holds unrelated rows", async () => {
  const memoryDir = createInMemoryStore();
  await appendFact(memoryDir, { subject: "unrelated", predicate: "rdfs:subClassOf", object: "thing", provenance: "seed:test" });
  const before = readFactRows(await loadMemory(memoryDir)).length;
  const summary = await groundTextToFacts("A beagle is a kind of dog.", { memoryDir, sessionId: "x" });
  assert.equal(summary.recognized, 1);
  const after = readFactRows(await loadMemory(memoryDir)).length;
  assert.equal(after, before + 1, "exactly one new row landed, on top of what the store already held");
});

test("renderIngestHtml: the seed is fetched by a content-stamped URL, so a rebuilt seed can never be served from the service worker's cache of the old one", () => {
  const stamped = renderIngestHtml({ seedStamp: "deadbeef0002" });
  assert.match(stamped, /const SEED_STAMP = "deadbeef0002";/);
  assert.match(stamped, /loadSeedPayload\(fetchWithProgress, "\.\/chat-seed\.json", SEED_QUERY/);
  assert.match(renderIngestHtml(), /const SEED_STAMP = "";/);
});

test("renderIngestHtml: reset-to-seed drops the service worker's asset cache as well as the taught-facts store", () => {
  const html = renderIngestHtml();
  assert.match(html, /const clearSiteAssetCaches = async function clearSiteAssetCaches/);
  assert.match(
    html,
    /el\("reinitStore"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?await persist\.clear\(\);[\s\S]*?await clearSiteAssetCaches\(\);[\s\S]*?window\.location\.reload\(\)/,
  );
});

test("renderIngestHtml: the memory's fact count rides in the topbar, not only the status line", () => {
  const html = renderIngestHtml();
  assert.match(html, /<span class="fact-pill" id="factPill" aria-live="polite"/);
  assert.match(html, /lastStatsTotal = Number\(stats\.total \|\| 0\);\s*renderFactPill\(\);/);
});

test("renderIngestHtml: the same pill reports the starter memory's real load progress and its phases, matching chat.html", () => {
  const html = renderIngestHtml({ seedBytes: 93_496_025 });
  assert.match(html, /const SEED_BYTES = 93496025;/);
  assert.match(html, /return Math\.min\(100, Math\.floor\(\(seedLoadedBytes \/ seedTotalBytes\) \* 100\)\);/);
  assert.match(html, /if \(!\(seedTotalBytes > 0\)\) return null;/, "no true total means no percentage, rather than a guessed one");
  assert.match(html, /setSeedPhase\("indexing"/);
  assert.match(html, /setSeedPhase\("ready"\)/);
  assert.match(html, /setSeedPhase\("failed", \{ error: outcome\.status\.error/);
  assert.match(html, /console\.error\("tmct ingest: chat-seed\.json unavailable/);
});

// ---- the ask dock: a question put to what this session ingested -----------

test("renderIngestHtml: the ask dock sits under the facts pane, disabled until the engine opens a session", () => {
  const html = renderIngestHtml();
  assert.match(html, /<form class="askDock" id="askForm"/);
  assert.match(html, /<input type="text" id="askq"[^>]*disabled>/);
  assert.match(html, /<button type="submit" class="askGo" id="askGo" disabled>ask<\/button>/);
  assert.match(html, /<div id="askLog" aria-live="polite"><\/div>/);
  assert.ok(html.indexOf('id="askForm"') > html.indexOf('id="facts"'), "the dock follows the facts it questions");
});

test("renderIngestHtml: a submitted question tries the graph route first and the turn engine only on its miss", () => {
  const html = renderIngestHtml();
  const handler = html.slice(html.indexOf('askFormEl.addEventListener("submit"'), html.indexOf("// ---- memory stats"));
  assert.ok(handler.indexOf("window.tmct.ask(q)") < handler.indexOf("window.tmct.turn(q)"), "ask leads, turn follows");
  assert.match(handler, /if \(asked && asked\.answer && !asked\.miss\)/, "a missed ask never renders as an answer");
  assert.match(handler, /!\(turned\.record && turned\.record\.miss\)/, "a missed turn never renders as an answer either");
  assert.match(handler, /addAskLine\("miss", askMissNote\(\)\)/);
});

test("renderIngestHtml: the miss note names the kinds this memory really holds rather than an invented example", () => {
  const html = renderIngestHtml();
  assert.match(html, /session\.askableClasses\(\)/);
  assert.match(html, /"I can't ground that in what you've ingested\. The kinds it holds: " \+ kinds/);
});

// ---- the session's own ask/turn wiring -----------------------------------

test("createIngestSession: a fresh session holds an empty graph, so a turn keeps the plain conversational reading", () => {
  const session = createIngestSession();
  assert.deepEqual(session.graph.individuals, []);
  assert.deepEqual(session.askableClasses(), []);
});

test("createIngestSession: turn reads back a fact the page just ingested, and refuses one it never saw", async () => {
  const session = createIngestSession();
  await session.ingest("A beagle is a kind of dog.");
  const recall = await session.turn("what is a beagle");
  assert.equal(recall.record.miss, false);
  assert.match(recall.answer, /kind of dog/);
  const missed = await session.turn("what is a quombat");
  assert.match(missed.answer, /isn't a term in this graph's own vocabulary|don't know/);
});

test("createIngestSession: the projected graph follows the store — an ingest and a taught turn both land in a later question", async () => {
  const session = createIngestSession();
  await session.ingest("A beagle is a kind of dog.");
  await session.refreshGraph();
  assert.deepEqual(session.askableClasses(), ["dog"]);

  const taught = await session.turn("remember: a poodle is a kind of dog");
  assert.equal(taught.record.via, "assert");
  await session.refreshGraph();
  assert.deepEqual(
    session.graph.individuals.filter((i) => i.class === "dog").map((i) => i.id).sort(),
    ["beagle", "poodle"],
  );
});
