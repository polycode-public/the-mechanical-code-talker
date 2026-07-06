// chatbench-levers.test.mjs — the PRODUCT regression suite for the chat tuning
// cycle's applied levers (SKILL_TUNING_CYCLE.md step 2: "every product lever gets
// a regression test"). Each cycle's section pins, with the EXACT chatbench case
// phrasings over the same writer-faithful fixture pipeline the bench runner uses
// (raw fixture -> ingestSchemaDocs -> parseEntities), the behavior a lever bought
// — so a later change that silently un-fixes a documented weakness fails HERE,
// in `npm test`, before the bench ever has to catch it.
//
// Cycle 2 (CHATBENCH_001's ranked board — L1 noise-strip robustness + L3 the
// typo→schema-term trap guard; H1a/H1b are harness-side and tested in
// chatbench.test.mjs):
//   L1a "i was wondering what calls fnAlpha"   (ns-wondering)  — aux/filler frame
//   L1b "hey tmct, what calls fnAlpha thanks"  (ns-hey-tmct)   — the product's own name
//   L1c "wat calls fnAlpha"                    (tf-wat-calls)  — "wat" -> "what"
//   L3  "which modles import a.mjs"            (tf-modles)     — schema-trap + receipt
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "../src/ask.mjs";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";
import { normalizeQuery } from "../src/interpret/normalize.mjs";
import { stripNoise, noiseStripStrategy } from "../src/interpret/strategies/noise-strip.mjs";

const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url);
const FIXTURE_PAYLOAD = JSON.parse(await readFile(FIXTURE, "utf8"));
const graph = parseEntities(ingestSchemaDocs(FIXTURE_PAYLOAD));

/** A temp repo whose .tmct/graph.json carries the fixture, plus the in-memory graph.
 *  The multi-turn levers below need BOTH: `config.graphFile` for the command path's
 *  dispatchTool, and the parsed `graph` for the focus/anaphora threading. Returns a
 *  `drive(queries)` that threads focus + last exactly as the session shell does. */
async function repoDriver() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-levers-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(FIXTURE_PAYLOAD));
  const config = { graphFile: join(dir, ".tmct", "graph.json") };
  const drive = async (queries) => {
    const out = [];
    let last = null;
    let focus = null;
    for (const q of queries) {
      clearCache();
      const r = await runTurn(q, { config, graph, last, focus });
      out.push(r);
      last = r.last;
      focus = r.focus;
    }
    return out;
  };
  return { dir, drive, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// The clean-phrasing behaviors every noise/typo variant must reproduce exactly.
const CLEAN_CALLS = ask(graph, "what calls fnAlpha");
const CLEAN_IMPORTERS = ask(graph, "which modules import a.mjs");

test("cycle-2 fixture sanity: the clean phrasings behave as CHATBENCH_001 documents", () => {
  // CORRECTNESS FIX (cycle W2P): "what calls fnAlpha" now reads the symbol-level caller
  // Widget.render off the callsSymbol edge (BEFORE: the module-coarse honest empty "No
  // modules found whose module directly calls fnAlpha", miss:true). The noise/typo levers
  // below still assert byte-identity to THIS clean answer, so their robustness purpose is
  // unchanged — only the clean answer itself is now the correct, non-empty one.
  assert.match(CLEAN_CALLS.content, /Widget\.render/);
  assert.equal(CLEAN_CALLS.tmct_ask.miss, false);
  // the three importers, positively
  assert.match(CLEAN_IMPORTERS.content, /app\/lib\/b\.mjs/);
  assert.equal(CLEAN_IMPORTERS.tmct_ask.miss, false);
});

// ---- L1 — noise-strip robustness (ns-wondering, ns-hey-tmct, tf-wat-calls) ----

test("L1a (ns-wondering): 'i was wondering what calls fnAlpha' answers like the clean phrasing — never 'couldn't resolve'", () => {
  const r = ask(graph, "i was wondering what calls fnAlpha");
  assert.equal(r.content, CLEAN_CALLS.content, "byte-identical to the clean phrasing's answer");
  assert.equal(r.tmct_ask.miss, false, "the same real answer the clean phrasing gets");
  assert.doesNotMatch(r.content, /couldn't resolve/);
});

test("L1b (ns-hey-tmct): the product's own name used as an address strips — 'hey tmct, what calls fnAlpha thanks'", () => {
  const r = ask(graph, "hey tmct, what calls fnAlpha thanks");
  assert.equal(r.content, CLEAN_CALLS.content);
  assert.equal(r.tmct_ask.miss, false);
  assert.doesNotMatch(r.content, /couldn't resolve/);
  // and the strip layer itself treats "tmct" as a vocative (curated noise)
  const { dropped } = stripNoise("tmct what calls fnAlpha thanks", null);
  assert.ok(dropped.includes("tmct"), `"tmct" is strippable noise (dropped: ${dropped})`);
});

test("L1c (tf-wat-calls): 'wat' is repaired to 'what' before either strategy parses", () => {
  assert.equal(normalizeQuery("wat calls fnAlpha"), "what calls fnAlpha");
  const r = ask(graph, "wat calls fnAlpha");
  assert.equal(r.content, CLEAN_CALLS.content);
  assert.equal(r.tmct_ask.miss, false);
  // the correction never rewrites a module literally named wat.mjs (dotted-extension guard)
  assert.equal(normalizeQuery("which modules import wat.mjs"), "which modules import wat.mjs");
});

test("L1 (strategy seam): noise-strip's tier-2 keyword-spot re-parse recovers non-template questions the anchored re-parse alone cannot", () => {
  // post-normalization text of ns-hey-tmct: "hey"/"thanks" are FILLER/noise but
  // "what calls fnAlpha" is a KEYWORD-SPOT shape, not an anchored template — the
  // cycle-1 strategy returned null here and the turn died as "couldn't resolve".
  const res = noiseStripStrategy.run("tmct, what calls fnAlpha thanks", { nlp: null });
  assert.ok(res, "the strategy now yields a candidate");
  assert.equal(res.class, "noise-stripped");
  const parsed = res.candidates[0].parsed;
  assert.equal(parsed.shape, "reverse");
  assert.equal(parsed.kind, "calls");
  assert.equal(parsed.object, "fnAlpha");
});

test("L1 regression watch: the passing noise/typo cases keep their exact answers", async () => {
  // tf-whcih-imprt — the curated double-typo repair stays byte-identical to clean
  const typo = ask(graph, "whcih modules imprt a.mjs");
  assert.equal(typo.content, CLEAN_IMPORTERS.content);
  // ns-um-hey / ns-could-you — filler/politeness frames still strip to the clean answer
  assert.equal(ask(graph, "um hey so like which modules import a.mjs please").content, CLEAN_IMPORTERS.content);
  assert.equal(ask(graph, "could you tell me which modules import a.mjs").content, CLEAN_IMPORTERS.content);
  // ns-so-uh-count — the chat-level count intercept (runTurn) is untouched
  const count = await runTurn("so, uh, how many classes are there then", { graph });
  assert.equal(count.answer, "3 classes.");
});

// ---- L3 — the typo→schema-term trap guard (tf-modles) ----

test("L3 (tf-modles): 'which modles import a.mjs' prefers the kind-noun reading WITH the repair receipt — never the schema-class pivot", () => {
  const r = ask(graph, "which modles import a.mjs");
  // the repair receipt names the re-read question, next to the real answer
  assert.match(r.content, /^read as "which modules import a\.mjs" — /);
  assert.match(r.content, /app\/lib\/b\.mjs/);
  assert.match(r.content, /app\/lib\/c\.mjs/);
  assert.match(r.content, /app\/lib\/e\.mjs/);
  assert.equal(r.tmct_ask.miss, false);
  // the confidently-wrong cycle-1 answer shape is gone
  assert.doesNotMatch(r.content, /no imports edge found from Module/);
  // and the trace records the kind-noun re-read
  assert.equal(r.tmct_ask.relaxed?.to, "which modules import a.mjs");
});

test("L3 guard narrowness: exact schema-vocabulary surfaces are untouched", () => {
  // the meta surface still answers questions about the graph's own vocabulary
  const meta = ask(graph, "what does cochange mean");
  assert.equal(meta.tmct_ask.miss, false);
  assert.match(meta.content, /predicate/i);
  // an EXACT schema-class term is a tier-1 resolution, never trapped
  const exact = ask(graph, "does Module import a.mjs");
  assert.doesNotMatch(exact.content, /read as/);
  // and the clean kind-noun question gains no receipt (the guard never fires
  // without a fuzzy-only schema hit)
  assert.doesNotMatch(CLEAN_IMPORTERS.content, /read as|assuming you meant/);
  assert.equal(CLEAN_IMPORTERS.tmct_ask.relaxed, null);
});

// ============================================================================
// CHATBENCH_0.7.1 — Phase 11 Track 1 levers (pronoun binding, discourse-count,
// temporal-over-relative composition). Each drives real turns through runTurn.
// ============================================================================

// ---- Lever 1 — pronoun / focus binding (g-b1-pron-25: the "it → Commit" mis-bind) ----

test("Lever 1 (g-b1-pron-25): 'it' keeps binding to the focus module, never jumps to a Commit", async () => {
  const { drive, cleanup } = await repoDriver();
  try {
    // The exact transcript: /describe a module, then two pronoun follow-ups. The
    // second follow-up USED to mis-bind — "it" substring-matched the "Commit" schema
    // node (label contains "it"), so the traversal read "object = Commit".
    const [d, calls, imports] = await drive([
      "/describe app/lib/e.mjs",
      "what calls it",
      "which modules import it",
    ]);
    assert.match(d.answer, /app\/lib\/e\.mjs — Module/, "describe sets the module focus");
    // turn 2 binds "it" to the module (this already worked) …
    assert.match(calls.answer, /object = app\/lib\/e\.mjs/, "turn 2 'it' = the module");
    assert.equal(calls.focus.id, "mod-e", "focus is NOT displaced to a Commit after turn 2");
    // … turn 3 is the fix: "it" still binds to the module, not Commit.
    assert.doesNotMatch(imports.answer, /object = Commit/, "turn 3 'it' never binds to Commit");
    assert.match(imports.answer, /app\/lib\/f\.mjs/, "turn 3 resolves the real importer of e.mjs");
    assert.equal(imports.record.miss, false, "turn 3 is a real answer, not the wrong honest-empty");
    assert.equal(imports.focus.id, "mod-e", "the code-entity focus is held across the pronoun turns");
  } finally {
    await cleanup();
  }
});
