// completions-stage2.test.mjs — Stage 2-of-staging verification for the
// mechanical text-generation pipeline ("Stage
// 4 — extractive ranking (graph-ranking/PageRank+IDF-style)"; Stage-0's naming convention —
// completions-stage0.test.mjs covered Stage 1+2 — is continued here by staging index,
// not pipeline-stage number).
//
// Stage 2's own exit criterion ("selected sentences cover the labeled key points of a
// hand-picked source set at a target recall") is made concrete here, not eyeballed: two
// hand-labeled fixtures (a 3-block/9-sentence group and a 2-block/4-sentence group), each with
// its "key point" sentences named explicitly, checked against rankSentences()'s own top-N
// output for a justified recall threshold. Plus a determinism double-run diff, the same
// discipline test/adapters/completions-stage0.test.mjs's own exit-criterion test applies to
// search+group.
//
// Recall-threshold reasoning (documented here, not just asserted):
//   - Fixture A (9 sentences: 6 hand-labeled key points + 3 identical generic filler
//     sentences, one filler per block) uses top-N = N = the key-point count (6) — the
//     natural "how many would a human pull for a 3-source summary" cut. Required recall is
//     0.8 (>= 5 of 6), not 1.0: PageRank/IDF tie-breaking is sensitive to small vocabulary
//     perturbations, so a single one-point miss should not fail the suite, but recall must
//     stay clearly above chance (6/9 ~= 0.67 is what a random top-6 draw would average) to
//     prove the ranking carries real signal, not noise.
//   - Fixture B (4 sentences: 2 key points + 2 identical filler, a smaller two-source group)
//     is deliberately small enough to demand the stronger, exact bar: both key points must
//     outrank both filler sentences (recall 1.0 at top-N=2) — with only 4 candidates, a
//     softer threshold would tolerate the ranker doing no better than chance.
//
// rankSentences() reads its PageRank/degree/tokenizer handles through an explicit `store`
// option and imports none of them, so every call below passes one. The real store
// (COMPLETIONS_STORE, what services/completions.mjs wires in production) is what the recall
// thresholds above are calibrated against, so that is what these fixtures rank through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSentences, splitBlockSentences } from "../../src/domain/completions/rank.mjs";
import { COMPLETIONS_STORE } from "../../src/services/completions.mjs";

// Fixture A: three "Store" blocks, each pairing a dense, cross-block-shared-vocabulary
// sentence (Store/Task/User/records) with an identical, deliberately generic filler
// sentence repeated verbatim across all three blocks (a genuine non-key aside, not a
// disguised key point).
const GROUP_STORE = {
  id: "g:store-test",
  members: [
    { id: "blk-a", text: "The Store class manages Task and User records for the application. It persists Task and User records via loadStore and saveStore. This detail is not important here." },
    { id: "blk-b", text: "validateTask checks a Task record before Store saves the Task and User records. Store rejects an invalid Task record before it is saved. This detail is not important here." },
    { id: "blk-c", text: "saveStore serializes the Store Task and User records to disk as JSON. Store always keeps Task and User records durable on disk. This detail is not important here." },
  ],
};

const STORE_KEY_POINTS = new Set([
  "The Store class manages Task and User records for the application.",
  "It persists Task and User records via loadStore and saveStore.",
  "validateTask checks a Task record before Store saves the Task and User records.",
  "Store rejects an invalid Task record before it is saved.",
  "saveStore serializes the Store Task and User records to disk as JSON.",
  "Store always keeps Task and User records durable on disk.",
]);
const STORE_TOP_N = STORE_KEY_POINTS.size; // 6 — "how many a human would pull for 3 sources"
const STORE_RECALL_THRESHOLD = 0.8; // >= 5 of 6; see file header for reasoning

// Fixture B: two "Logger" blocks, same key-sentence/generic-filler shape, small enough to
// demand exact top-N separation.
const GROUP_LOGGER = {
  id: "g:logger-test",
  members: [
    { id: "blk-logger-1", text: "Logger.info writes structured request log lines created by createLogger. This detail is not important here." },
    { id: "blk-logger-2", text: "parseBody and sendJson handle request and response bodies for the Logger-backed handlers. This detail is not important here." },
  ],
};
const LOGGER_KEY_POINTS = new Set([
  "Logger.info writes structured request log lines created by createLogger.",
  "parseBody and sendJson handle request and response bodies for the Logger-backed handlers.",
]);
const LOGGER_TOP_N = LOGGER_KEY_POINTS.size; // 2
const LOGGER_RECALL_THRESHOLD = 1.0; // exact bar; see file header for reasoning

test("Stage 2 exit criterion: top-N ranked sentences cover hand-labeled key points at the target recall (fixture A — 3 sources, 6 key points)", () => {
  const ranked = rankSentences(GROUP_STORE, { store: COMPLETIONS_STORE });
  assert.equal(ranked.length, 9, "3 blocks x 3 sentences each");
  const topN = ranked.slice(0, STORE_TOP_N);
  const hits = topN.filter((r) => STORE_KEY_POINTS.has(r.sentence)).length;
  const recall = hits / STORE_KEY_POINTS.size;
  assert.ok(
    recall >= STORE_RECALL_THRESHOLD,
    `recall ${recall} (${hits}/${STORE_KEY_POINTS.size}) must be >= ${STORE_RECALL_THRESHOLD}`,
  );
});

test("Stage 2 exit criterion: top-N ranked sentences cover hand-labeled key points at the target recall (fixture B — 2 sources, 2 key points, exact bar)", () => {
  const ranked = rankSentences(GROUP_LOGGER, { store: COMPLETIONS_STORE });
  assert.equal(ranked.length, 4, "2 blocks x 2 sentences each");
  const topN = ranked.slice(0, LOGGER_TOP_N);
  const hits = topN.filter((r) => LOGGER_KEY_POINTS.has(r.sentence)).length;
  const recall = hits / LOGGER_KEY_POINTS.size;
  assert.ok(
    recall >= LOGGER_RECALL_THRESHOLD,
    `recall ${recall} (${hits}/${LOGGER_KEY_POINTS.size}) must be >= ${LOGGER_RECALL_THRESHOLD}`,
  );
});

test("rankSentences(): every result is source-tagged back to its member block id", () => {
  const ranked = rankSentences(GROUP_STORE, { store: COMPLETIONS_STORE });
  for (const r of ranked) {
    assert.equal(typeof r.sentence, "string");
    assert.ok(r.sentence.length > 0);
    assert.equal(typeof r.score, "number");
    assert.ok(Number.isFinite(r.score));
    assert.ok(GROUP_STORE.members.some((m) => m.id === r.sourceBlockId), "sourceBlockId traces to a real member");
  }
});

test("rankSentences(): determinism — two runs over the identical group produce byte-identical ranked output", () => {
  const run1 = rankSentences(GROUP_STORE, { store: COMPLETIONS_STORE });
  const run2 = rankSentences(GROUP_STORE, { store: COMPLETIONS_STORE });
  assert.deepEqual(run2, run1, "identical input must yield byte-identical ranked sentence lists — any diff is a determinism bug");

  const run3 = rankSentences(GROUP_LOGGER, { store: COMPLETIONS_STORE });
  const run4 = rankSentences(GROUP_LOGGER, { store: COMPLETIONS_STORE });
  assert.deepEqual(run4, run3);
});

test("rankSentences(): query-focused mode only IDF-sums tokens overlapping the query (a sentence with zero overlap scores 0)", () => {
  const ranked = rankSentences(GROUP_LOGGER, { query: "Logger createLogger", store: COMPLETIONS_STORE });
  const zeroScored = ranked.filter((r) => r.score === 0);
  // both filler sentences ("This detail is not important here.") share no content token with
  // the query, so they honestly score 0 rather than falling back to self-weighting.
  assert.ok(zeroScored.length >= 2, "sentences with zero query-token overlap must score 0, never a guessed fallback");
  // the top-ranked sentence under this query must be a real, non-zero-scoring key point.
  assert.ok(ranked[0].score > 0);
});

test("rankSentences(): a zero-score tie breaks by codepoint sourceBlockId order, not locale order, whichever way the members arrived", () => {
  // "zebra" sorts BEFORE "élan" in codepoint order (z=0x7A < é=0xE9) but AFTER
  // it under locale-aware collation, so this only holds under codepoint order.
  // The query shares no token with either sentence, so both score 0 and the
  // tiebreak alone decides the order.
  const group = {
    members: [
      { id: "zebra", text: "Widgets exist in this system." },
      { id: "élan", text: "Gadgets exist in this system." },
    ],
  };
  const forward = rankSentences(group, { query: "nomatchtoken", store: COMPLETIONS_STORE });
  const reversed = rankSentences({ members: [...group.members].reverse() }, { query: "nomatchtoken", store: COMPLETIONS_STORE });
  assert.deepEqual(forward.map((r) => r.sourceBlockId), reversed.map((r) => r.sourceBlockId),
    "member array arrival order never changes the ranked order");
  assert.ok(forward.every((r) => r.score === 0), "both sentences share no token with the query, so both honestly score 0");
  assert.deepEqual(forward.map((r) => r.sourceBlockId), ["zebra", "élan"]);
});

test("rankSentences(): [] / no members -> [] (no crash on empty input)", () => {
  assert.deepEqual(rankSentences({ members: [] }, { store: COMPLETIONS_STORE }), []);
  assert.deepEqual(rankSentences({}, { store: COMPLETIONS_STORE }), []);
  assert.deepEqual(rankSentences(null, { store: COMPLETIONS_STORE }), []);
});

test("splitBlockSentences(): splits on sentence-ending punctuation, trims, drops empties, preserves order", () => {
  assert.deepEqual(
    splitBlockSentences("Store persists records. It validates before saving! Does it cache too?"),
    ["Store persists records.", "It validates before saving!", "Does it cache too?"],
  );
});

test("splitBlockSentences(): a Q/A-shaped block (newline-separated) splits per line, not merged", () => {
  assert.deepEqual(
    splitBlockSentences("Q: what does the Store class do?\nA: Store holds Task and User records and persists them via loadStore and saveStore."),
    [
      "Q: what does the Store class do?",
      "A: Store holds Task and User records and persists them via loadStore and saveStore.",
    ],
  );
});

test("splitBlockSentences(): blank text / whitespace-only -> []", () => {
  assert.deepEqual(splitBlockSentences(""), []);
  assert.deepEqual(splitBlockSentences("   \n  \n"), []);
  assert.deepEqual(splitBlockSentences(null), []);
});
