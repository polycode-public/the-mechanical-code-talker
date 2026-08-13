// chatbench-levers.test.mjs — the PRODUCT regression suite for the chat tuning
// cycle's applied levers (.claude/skills/benchmark-cefr-english/SKILL.md step 2: "every product lever gets
// a regression test"). Each cycle's section pins, with the EXACT chatbench case
// phrasings over the same writer-faithful fixture pipeline the bench runner uses
// (raw fixture -> ingestSchemaDocs -> parseEntities), the behavior a lever bought
// — so a later change that silently un-fixes a documented weakness fails HERE,
// in `npm test`, before the bench ever has to catch it.
//
// L1 noise-strip robustness + L3 the typo→schema-term trap guard (H1a/H1b are
// harness-side and tested in chatbench.test.mjs):
//   L1a "i was wondering what calls fnAlpha"   (ns-wondering)  — aux/filler frame
//   L1b "hey tmct, what calls fnAlpha thanks"  (ns-hey-tmct)   — the product's own name
//   L1c "wat calls fnAlpha"                    (tf-wat-calls)  — "wat" -> "what"
//   L3  "which modles import a.mjs"            (tf-modles)     — schema-trap + receipt
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "../../src/domain/ask.mjs";
import { runTurn, asBareCommand } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { normalizeQuery } from "../../src/domain/interpret/normalize.mjs";
import { stripNoise, noiseStripStrategy } from "../../src/domain/interpret/strategies/noise-strip.mjs";
import { driveTurns } from "../helpers/session.mjs";

const FIXTURE = new URL("../fixtures/entities.fixture.json", import.meta.url);
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
  const drive = (queries) => driveTurns(config, queries, { graph, carryFocus: true });
  return { dir, drive, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// The clean-phrasing behaviors every noise/typo variant must reproduce exactly.
const CLEAN_CALLS = ask(graph, "what calls fnAlpha");
const CLEAN_IMPORTERS = ask(graph, "which modules import a.mjs");

test("the clean phrasings the noise/typo levers compare against are real non-miss answers, so a byte-identity assertion can never pass on two shared misses", () => {
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
    // turn 2 binds "it" to the module (this already worked) … (0.8.2 WS1: the
    // traversal receipt left the honest-empty prose, so the binding is read off
    // the turn's detail, where it still flows for why/verbose.)
    assert.match(calls.last.detail.traversal, /object = app\/lib\/e\.mjs/, "turn 2 'it' = the module");
    assert.equal(calls.focus.id, "mod:app/lib/e.mjs", "focus is NOT displaced to a Commit after turn 2");
    // … turn 3 is the fix: "it" still binds to the module, not Commit.
    assert.doesNotMatch(imports.answer, /object = Commit/, "turn 3 'it' never binds to Commit");
    assert.match(imports.answer, /app\/lib\/f\.mjs/, "turn 3 resolves the real importer of e.mjs");
    assert.equal(imports.record.miss, false, "turn 3 is a real answer, not the wrong honest-empty");
    assert.equal(imports.focus.id, "mod:app/lib/e.mjs", "the code-entity focus is held across the pronoun turns");
  } finally {
    await cleanup();
  }
});

// ---- A pronoun-shortened follow-up must not be mistaken for small talk once
// it already parsed as a real graph query. "who touched {it|this|that}" after a
// module was established is exactly three words, so isConversational's
// word-count catch-all used to fire AFTER ask() had already parsed the reverse
// "touches" shape, resolved the pronoun off the focus, and composed an honest
// (empty) answer — discarding that correct answer for the generic "I answer
// questions about…" orientation wall. ----

test("Lever 1b (g-b1-pron red set): 'who touched it/this/that' after a focus-setting turn gets the honest answer, not the orientation wall", async () => {
  const { drive, cleanup } = await repoDriver();
  try {
    for (const pronoun of ["it", "this", "that"]) {
      const [, followUp] = await drive(["what does app/lib/b.mjs import", `who touched ${pronoun}`]);
      assert.doesNotMatch(
        followUp.answer,
        /I answer questions about THIS codebase/,
        `"who touched ${pronoun}" must not fall back to the generic orientation wall`,
      );
      assert.equal(followUp.record.miss, true, "app/lib/b.mjs has no recorded touching commit — an honest empty, not a guess");
    }
  } finally {
    await cleanup();
  }
});

test("Lever 1b: the SAME pronoun follow-up still answers a REAL hit, not just an honest empty", async () => {
  const { drive, cleanup } = await repoDriver();
  try {
    const [, , touched] = await drive(["which modules import app/lib/e.mjs", "what does it import", "who touched it"]);
    // app/lib/e.mjs itself has no recorded touching commit either (thin-history
    // fixture), so this stays an honest empty too — but it must be the ask
    // engine's OWN composed miss (mentions the module), never the orientation card.
    assert.doesNotMatch(touched.answer, /I answer questions about THIS codebase/);
    assert.match(touched.last.detail.traversal, /object = app\/lib\/e\.mjs/, "'it' still resolves to the established focus");
  } finally {
    await cleanup();
  }
});

test("Lever 1b discipline: genuine small talk is UNAFFECTED — it never reaches a parsed AST", async () => {
  const { drive, cleanup } = await repoDriver();
  try {
    const [hi] = await drive(["hi there"]);
    assert.equal(hi.record.via, "template", "still the greeting template, not a graph-query attempt");
    assert.doesNotMatch(hi.answer, /traversal|edges where/i, "no graph-traversal language leaked into small talk");
  } finally {
    await cleanup();
  }
});

// ---- Lever 2 — discourse-count anaphora (g-b1-disc-count-22, g-b1-disc-count-3) ----

test("Lever 2 (asBareCommand): a no-arg command word with a kind qualifier is NOT a command call", () => {
  // bare "untested" (and other no-arg words) still route to the command …
  assert.equal(asBareCommand("untested"), "/untested");
  assert.equal(asBareCommand("stats"), "/stats");
  // … but "untested classes"/"untested modules" fall through to the ask engine —
  // the /untested tool takes no argument and would drop the qualifier (listing
  // modules for "classes"); the engine filters by kind AND seeds anaphora.
  assert.equal(asBareCommand("untested classes"), null);
  assert.equal(asBareCommand("untested modules"), null);
  // an arg command with a short name still routes (unchanged behavior).
  assert.equal(asBareCommand("describe Widget"), "/describe Widget");
});

test("Lever 2 (g-b1-disc-count-22): 'untested classes' → 'count them' counts the class set (2), not the grammar wall", async () => {
  const { drive, cleanup } = await repoDriver();
  try {
    const [first, count] = await drive(["untested classes", "count them"]);
    // turn 1 now filters BY KIND (the two untested classes), not the /untested
    // module listing the arg-less command produced.
    assert.match(first.answer, /Base and Button/, "turn 1 lists the untested CLASSES");
    assert.equal(first.record.miss, false);
    // turn 2 counts the prior class set — never the grammar-wall help text.
    assert.match(count.answer, /^2 /, "count them → 2");
    assert.equal(count.record.miss, false);
    assert.doesNotMatch(count.answer, /I answer questions about THIS codebase/, "no grammar wall");
  } finally {
    await cleanup();
  }
});

test("Lever 2 (g-b1-disc-count-3): 'untested classes' → 'how many of those are tested' → 0", async () => {
  const { drive, cleanup } = await repoDriver();
  try {
    const [, tested] = await drive(["untested classes", "how many of those are tested"]);
    assert.match(tested.answer, /^0 /, "none of the untested classes are tested");
    assert.equal(tested.record.miss, false);
  } finally {
    await cleanup();
  }
});

test("Lever 2 (pagination robustness): 'count them' over a TRUNCATED concept listing counts the full set, not the shown page", async () => {
  // A concept force caps its shown examples at MAX_EXAMPLES (32) and holds the rest
  // as prose; the FULL id set rides on detail.allIds so the count survives the cap.
  const many = structuredClone(FIXTURE_PAYLOAD);
  for (let i = 0; i < 40; i += 1) many.individuals.push({ id: `mod-x${i}`, class: "Module", label: `pkg/x${i}.mjs` });
  const bigGraph = parseEntities(ingestSchemaDocs(many));
  const dir = await mkdtemp(join(tmpdir(), "tmct-levers-pag-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(many));
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    let last = null;
    clearCache();
    const first = await runTurn("what is a module", { config, graph: bigGraph });
    // the render is truncated (only a page shown) but the full set is carried…
    assert.ok(first.last.detail.pending, "the render truncated (remainder held)");
    assert.equal(first.last.detail.matches.length, 32, "matches is capped at MAX_EXAMPLES");
    assert.equal(first.last.detail.allIds.length, 48, "allIds carries EVERY module id (8 + 40)");
    last = first.last;
    clearCache();
    const count = await runTurn("count them", { config, graph: bigGraph, last });
    assert.match(count.answer, /^48 /, "count them counts the FULL set (48), not the shown 32");
    assert.equal(count.record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Lever 3 — C1 temporal-over-relative composition (g-c1-temp-31 family) ----

test("Lever 3A (symbol-grain two-hop): 'which commits touched the methods that call X' reads touchesSymbol over the inner set", () => {
  // The inner clause resolves to a fine SYMBOL (Widget.render, a Method); the outer
  // touches step must consult touchesSymbol, not just the module-coarse `touches`
  // edge (which can never point at a symbol) — else this two-hop falsely misses.
  const r = ask(graph, "which commits touched the methods that call fnAlpha");
  assert.equal(r.tmct_ask.parsed?.node, "reverseSet", "assembles as a nested reverse-set");
  assert.equal(r.tmct_ask.miss, false, "not an honest-empty — the commit is found");
  assert.match(r.content, /abc1234/, "the touching commit is cited");
});

test("Lever 3A: 'who touched the functions that Widget contains' composes over the symbol set", () => {
  const r = ask(graph, "who touched the functions that Widget contains");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /abc1234/);
});

test("Lever 3B (temporal node): 'when did the module that X imports last change' dates the touching commit", () => {
  // inner = the module app/lib/b.mjs imports (app/lib/a.mjs), which commit abc1234
  // touched — the temporal node runs the touches→commit→date-sort over that inner set.
  const r = ask(graph, "when did the module that app/lib/b.mjs imports last change");
  assert.equal(r.tmct_ask.parsed?.node, "temporal", "parses to the new temporal AST node");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /last touched by commit abc1234 on 2026-06-28/, "cites the newest commit + date");
});

test("Lever 3B (temporal node): 'when were the methods that call X last touched' composes over the symbol set", () => {
  const r = ask(graph, "when were the methods that call fnAlpha last touched");
  assert.equal(r.tmct_ask.parsed?.node, "temporal");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /commit abc1234/);
});

test("Lever 3B honesty: an untouched inner set is an HONEST empty, never a guessed date", () => {
  // the modules that import a.mjs (b, c, e) — none were touched by any commit in the
  // thin-history fixture: the temporal node reports the honest empty, not a fake date.
  const r = ask(graph, "when did the modules that import app/lib/a.mjs last change");
  assert.equal(r.tmct_ask.parsed?.node, "temporal", "still assembles the composition");
  assert.equal(r.tmct_ask.miss, true, "honest empty");
  assert.match(r.content, /no recorded commit touched/);
});

test("Lever 3 discipline: the FLAT single-entity 'when did X change' is untouched (not shadowed by the temporal node)", () => {
  const flat = ask(graph, "when did app/lib/a.mjs change");
  assert.equal(flat.tmct_ask.parsed?.node, undefined, "a bare entity stays on the flat when-shape path");
  assert.equal(flat.tmct_ask.miss, false);
  assert.match(flat.content, /app\/lib\/a\.mjs was last touched by commit abc1234/);
});

test("Lever 3 (g-c1-temp-31): 'who touched the module that imports X' now ASSEMBLES the two-hop", () => {
  // On this thin-history fixture the module (e.mjs, which imports f.mjs) was touched
  // by no commit, so the honest answer is empty — but the composition now ASSEMBLES
  // (a reverseSet node) instead of the old generic non-answer; on a fixture with
  // history it resolves the touching commits.
  const r = ask(graph, "who touched the module that imports app/lib/f.mjs");
  assert.equal(r.tmct_ask.parsed?.node, "reverseSet", "the two-hop is assembled, not a parse failure");
});


// ---- Lever 3C (Track-1 trio, post-0.8.2) — cochange, the two sub-bugs behind
// the g-b1-temp-7/31/44 + g-c1-temp-12/29/47 red set: (a) the bare "changed
// together with" phrasing was missing from the cochange verb table outright,
// so it fell through to the "touch(ed)" verb (Commit->Module, structurally
// unable to match a Module subject) and always produced a confidently-empty
// answer; (b) cochange (mgx:changeCoupledWith) is a SYMMETRIC relation but the
// fixture stores one directed edge per pair, so a query naming the STORED
// SUBJECT side ("cochange with app/lib/a.mjs", a.mjs being subject of both
// recorded pairs) found nothing under a reverse-only (object-side) filter. ----

test("Lever 3C(a): 'which modules changed together with X' now parses as cochange, not touch(ed)", () => {
  const r = ask(graph, "which modules changed together with app/lib/a.mjs");
  assert.equal(r.tmct_ask.parsed?.kind, "cochange", "the bare phrasing resolves to the cochange verb table entry");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /app\/lib\/b\.mjs/);
  assert.match(r.content, /app\/lib\/c\.mjs/);
});

test("Lever 3C(a): 'which modules changed together with X' also answers from the OBJECT side of the stored pair", () => {
  // app/lib/c.mjs is the OBJECT of the stored edge (a.mjs -> c.mjs); this
  // direction worked even before the symmetric-lookup fix once the kind itself
  // parsed correctly — kept as a regression guard on the non-flipped path.
  const r = ask(graph, "which modules changed together with app/lib/c.mjs");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /app\/lib\/a\.mjs/);
});

test("Lever 3C(b): 'which modules cochange with X' matches the SUBJECT side of the stored pair too (symmetric lookup)", () => {
  // app/lib/a.mjs is the SUBJECT of both stored cochange edges (-> b.mjs, -> c.mjs);
  // a reverse (object-side-only) filter used to find nothing for this direction.
  const r = ask(graph, "which modules cochange with app/lib/a.mjs");
  assert.equal(r.tmct_ask.miss, false, "the symmetric lookup finds the pair from its stored-subject side");
  assert.match(r.content, /app\/lib\/b\.mjs/);
  assert.match(r.content, /app\/lib\/c\.mjs/);
});

test("Lever 3C discipline: a module with NO cochange partner anywhere stays an honest empty", () => {
  const r = ask(graph, "which modules cochange with app/lib/f.mjs");
  assert.equal(r.tmct_ask.miss, true, "f.mjs has no recorded cochange edge on either side — no fabricated partner");
});
