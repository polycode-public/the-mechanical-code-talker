// chatflow-agents-debt-remeasure.test.mjs — HANDOVER.md item 12 / PLAN_AGENTS.md
// §3 "Re-measure inherited chat-surface debt". Freezes the read-only measurement
// pass this session ran against the three CEFR_ENGLISH_0.7.1-era gaps (pronoun/
// focus binding, discourse-count anaphora, temporal-over-relative composition):
// verdict for each is "narrowed, none fully closed" — see PLAN_AGENTS.md §3 for
// the full write-up. This file freezes the PASSING transcripts (so a future
// regression is caught) and the CONFIRMED-STILL-FAILING ones (asserted as their
// current, honest, wrong behavior — a future fix should update these
// assertions, not be surprised by them; same "dead-end frozen into a test"
// discipline this repo's other chatflow-tier*.test.mjs files already use).
//
// Two genuinely NEW, previously-undocumented confidently-wrong bugs surfaced
// while re-verifying Gap 1 and Gap 3 (not previously known, not silently
// dropped — see the per-test comments below for root causes):
//   BUG-A: the "ask" (yes/no) shape's calls check only scans the module-coarse
//          `calls` kind, never unioning the symbol-grain `callsSymbol` sibling
//          the forward/reverse shapes already union — src/ask.mjs, the
//          `shape === "ask"` branch's `kindsFor(kind)` call (~line 2925-2941),
//          vs. `KIND_UNIONS` (~line 134) which only defines a union for "uses".
//   BUG-B: a bare passive yes/no with no "by"-agent clause ("was X touched",
//          "is X imported", "is X called") is silently misparsed as an ACTIVE
//          forward query (X reads as the verb's SUBJECT, scanning X's OUTGOING
//          edges) instead of the intended PASSIVE reading (X as OBJECT,
//          incoming edges) — src/interpret/strategies/keywords.mjs's
//          parseKeywordSpot, the final `if (beforeText) return { shape:
//          "forward", ... }` fallback, never consults PASSIVE_AUX the way the
//          "by"-agent reversible-passive branch a few lines above does. This is
//          the deepened root cause behind Gap 3's cross-turn composition
//          failure below, not just a discourse-tracking gap.
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (same mechanism as chatflow-tier4/5/6), plus test/fixtures/entities.fixture.json
// via runTurn directly for Gap 1 (needs the fixture's asymmetric calls/
// callsSymbol edges: Widget.render --callsSymbol--> fnAlpha, no module-coarse
// `calls` edge between them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";
import { clearCache } from "../src/source.mjs";
import { fileURLToPath } from "node:url";

const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

async function driveSession(queries) {
  clearCache();
  const s = await createSession({ repoPath: REPO, env: {}, ephemeral: true });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return turns;
}

async function driveFixture(queries) {
  const g = await graph();
  let last = null;
  let focus = null;
  const turns = [];
  for (const q of queries) {
    const r = await runTurn(q, { config: CONFIG, graph: g, last, focus });
    turns.push(r);
    last = r.last;
    focus = r.focus;
  }
  return turns;
}

// ---- Gap 1 (pronoun/focus binding) ----

test("Gap 1 / BUG-A (confirmed FAILING): 'does it call X' after a forward-call turn resolves the pronoun correctly but the yes/no check false-negatives on a callsSymbol-only edge", async () => {
  const turns = await driveFixture(["what calls fnAlpha", "what does Widget.render call", "does it call fnAlpha"]);
  assert.match(turns[0].answer, /Widget\.render/, "reverse shape reads the real callsSymbol caller");
  assert.match(turns[1].answer, /^fnAlpha\.$/m, "forward shape unions calls+callsSymbol correctly");
  // BUG-A: this SHOULD be "Yes — ..." (Widget.render does call fnAlpha, per turn
  // 1/2 above) — frozen as the current, confirmed-wrong answer. A fix should
  // flip this assertion to the Yes form, not be surprised by it.
  assert.match(turns[2].answer, /^No — no calls edge found from Widget\.render to fnAlpha\./,
    "BUG-A: 'it' resolves fine (see turn 2's own forward answer), but the ask-shape's calls check " +
    "never unions callsSymbol the way forward/reverse do — a confidently-wrong 'No'");
});

test("Gap 1 (confirmed FAILING, reclassified from the read-only pass): 'who touched it' after a calls-focused turn — pronoun DOES resolve (fnAlpha genuinely has no touchesSymbol edges), but the honest-empty template prints the literal word 'it' instead of substituting the resolved label", async () => {
  const turns = await driveFixture(["what calls fnAlpha", "who touched it"]);
  assert.match(turns[1].answer, /^No modules found whose module directly touches it\./,
    "wording bug: should name 'fnAlpha', not echo the raw pronoun 'it' — resolution itself succeeded");
});

test("Gap 1 (confirmed FAILING): 'was it touched recently' — 'recently' is misread as the ask-shape's comparison OBJECT term, not stripped as a temporal adverb", async () => {
  const turns = await driveFixture(["what calls fnAlpha", "was it touched recently"]);
  assert.match(turns[1].answer, /^couldn't resolve one of the terms in this question\.$/m,
    "'recently' fails to resolve as a graph entity because it was parsed as the object, not filtered as a modifier");
});

// ---- Gap 2 (discourse-count anaphora) ----

test("Gap 2 (confirmed PASSING): relation-filter discourse count — 'how many of those also import Y' and '...are tested' both count the prior set correctly", async () => {
  const a = await driveSession(["which modules import http.mjs", "how many of those also import logger.mjs"]);
  assert.match(a[0].answer, /base\.mjs/);
  assert.match(a[0].answer, /router\.mjs/);
  assert.match(a[0].answer, /tasks\.mjs/);
  assert.match(a[1].answer, /^1 module\./, "only router.mjs of the three also imports logger.mjs");

  const b = await driveSession(["which modules import http.mjs", "how many of those are tested"]);
  assert.match(b[1].answer, /^1 module\./, "only tasks.mjs of the three is tested");
});

test("Gap 2 (confirmed FAILING): a BARE entity-type filter follow-up with no relation verb ('which of them are functions') still doesn't parse", async () => {
  const turns = await driveSession(["which modules import http.mjs", "which of them are functions"]);
  assert.match(turns[1].answer, /couldn't compile this compositional question/,
    "bare-type discourse filters (no relation verb) remain unbuilt, unlike relation-filter counts above");
});

// ---- Gap 3 (temporal-over-relative composition) ----

test("Gap 3 (confirmed PASSING): single-turn temporal filtering gives real, dated answers", async () => {
  const turns = await driveSession(["what changed since 2026-01-01"]);
  assert.match(turns[0].answer, /^\d+ commit\(s\) changed since 2026-01-01:/);
  assert.match(turns[0].answer, /2026-05-24/);
});

test("Gap 3 (confirmed FAILING): cross-turn 'was that before X was touched' composition isn't built — AND the fresh-query fallback it falls through to is itself wrong (BUG-B)", async () => {
  const turns = await driveSession(["what changed before 1b2c3d4e5f60", "was that before logger.mjs was touched"]);
  assert.match(turns[0].answer, /^\d+ commit\(s\) changed before 1b2c3d4e5f60:/);
  // Not a real composition answer — falls through to a fresh, bare "was logger.mjs
  // touched" read, which BUG-B then answers wrongly (logger.mjs genuinely has a
  // recorded touching commit, e5f6a1b2c3d4 — confirmed via the working "has X been
  // touched" phrasing in the next test).
  assert.match(turns[1].answer, /^src\/lib\/logger\.mjs has no touches edges in the index\./);
});

test("BUG-B (confirmed FAILING, new finding): bare passive 'is/was X touched|imported|called' with no by-agent clause reads X as the ACTIVE subject (outgoing edges), not the PASSIVE object (incoming edges) — false negative on a module with real incoming edges", async () => {
  // ground truth: store.mjs has 3 recorded touching commits (working phrasing).
  const truth = await driveSession(["has store.mjs been touched"]);
  assert.match(truth[0].answer, /was last touched by commit 1b2c3d4e5f60/);

  // BUG-B: the equally-natural passive phrasing gives a confidently-wrong "no edges".
  const bad = await driveSession(["was store.mjs touched"]);
  assert.match(bad[0].answer, /^src\/core\/store\.mjs has no touches edges in the index\./,
    "BUG-B: false negative — store.mjs demonstrably HAS touches edges (see the working phrasing above)");

  const alsoBad = await driveSession(["is model.mjs imported"]);
  assert.match(alsoBad[0].answer, /^src\/core\/model\.mjs has no imports edges in the index\./,
    "BUG-B: model.mjs is imported by store.mjs/validate.mjs/tasks.mjs/users.mjs — also a false negative");
});
