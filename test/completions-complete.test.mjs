// completions-complete.test.mjs — end-to-end verification for src/completions/complete.mjs's
// generateCompletion(), PLAN_COMPLETIONS.md §4's staging table (row 3) exit criterion made
// concrete: "A full end-to-end completion reads as one consistent voice and every sentence
// traces to a source span."
//
// Fixture, deliberately built the same way test/completions-stage0.test.mjs and
// test/completions-infer.test.mjs each build their own (a throwaway saveBlock() corpus + a
// small appendFact() memory, seeded fresh per test): three "Store" blocks that cluster into one
// group (mirroring stage0/stage2's own Store fixture shape — a key sentence + a shared, verbatim
// filler sentence PER STORE BLOCK ONLY, so pruning's top-K-per-group cutoff has real material to
// drop, and so the filler doesn't spuriously bridge an edge to the other blocks below), one
// singleton "Cache" block taught (via rdfs:subClassOf) to be an instance of "Store" — sharing
// exactly ONE content token ("store") with the store group, deliberately below group.mjs's
// OVERLAP_MIN=2 edge threshold, so it stays its own SEPARATE group (mirroring infer.mjs's own
// buffer/cache fixture, where inference fires ACROSS groups, not within one merged cluster) —
// and one off-topic "Lunch" block sharing no vocabulary with anything, its own singleton group,
// feeding no inference.
//
// Retrieval uses a BROAD prompt (covering every block's vocabulary, the same "pull in the whole
// corpus" technique test/completions-stage0.test.mjs's own clustering-shape test uses) so this
// suite exercises real cross-group pruning rather than depending on retrieveBlocks() itself
// filtering the off-topic/singleton material out before grouping ever sees it; a NARROWER query
// (generateCompletion's own `opts.query`, independent of the broad retrieval prompt) drives the
// query-focused ranking/pruning pass, so the Lunch block's sentences honestly score zero and get
// pruned for that reason, not for having never been retrieved at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveBlock } from "../src/adapters/memory/blocks.mjs";
import { appendFact, loadMemory } from "../src/adapters/memory/core.mjs";
import { generateCompletion } from "../src/completions/complete.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-completions-complete-"));
}

const BLOCKS = {
  "blk-store-1": "The Store class manages Task and User records for the application. It persists Task and User records via loadStore and saveStore. This detail is not important here.",
  "blk-store-2": "validateTask checks a Task record before Store saves the Task and User records. Store rejects an invalid Task record before it is saved. This detail is not important here.",
  "blk-store-3": "saveStore serializes the Store Task and User records to disk as JSON. Store always keeps Task and User records durable on disk. This detail is not important here.",
  "blk-cache-1": "Cache is a specialized kind related to Store internals for fast lookups. Cache eviction matters greatly for performance.",
  "blk-lunch": "Soup is a good lunch choice, reportedly excellent soup. Sandwiches are also fine for a midday lunch break.",
};

const BROAD_PROMPT = "store class task validate cache lunch soup";
const FOCUS_QUERY = "what does the Store class do";

async function seedRepo() {
  const dir = await tmpRepo();
  for (const [id, text] of Object.entries(BLOCKS)) await saveBlock(dir, { id, text });
  // cache IS-A store — mirrors completions-infer.test.mjs's own exemplifies+elaborates fixture
  // (cache/buffer there; store/cache here), grounding "store"/"cache" as graph-known terms.
  await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "store", provenance: "teach:chat" });
  return dir;
}

function run(dir, opts = {}) {
  return generateCompletion(dir, BROAD_PROMPT, { blockK: 10, query: FOCUS_QUERY, ...opts });
}

test("generateCompletion(): every output sentence traces to a real source span (block id + group id) in sourceSpans", async () => {
  const dir = await seedRepo();
  try {
    const result = await run(dir);
    assert.ok(!result.declined, "the seeded corpus must produce a completion, not a decline");
    assert.ok(result.sourceSpans.length > 0, "at least one sentence survives pruning");

    for (const span of result.sourceSpans) {
      assert.ok(typeof span.sourceBlockId === "string" && span.sourceBlockId in BLOCKS,
        `sourceBlockId "${span.sourceBlockId}" must trace to a real seeded block`);
      assert.ok(typeof span.groupId === "string" && span.groupId.length > 0);
      // the sentence text itself must be a literal substring of its named source block — this
      // is the extractive-fidelity bar: nothing invented, everything traced verbatim.
      assert.ok(BLOCKS[span.sourceBlockId].includes(span.sentence),
        `sentence "${span.sentence}" must appear verbatim in block "${span.sourceBlockId}"`);
    }

    // every WORD in the final text is one of the kept sentences' own words, in the same
    // order — assembled purely by joining sourceSpans' own sentences with a single space, then
    // passed through finish()'s grammar pass, which mutates only casing/punctuation.
    const rawJoin = result.sourceSpans.map((s) => s.sentence).join(" ");
    const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) || [];
    assert.deepEqual(words(result.text), words(rawJoin), "the grammar pass changes only casing/punctuation, never words");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateCompletion(): the drop log is non-empty and itemized (some spans are known-prunable in this corpus)", async () => {
  const dir = await seedRepo();
  try {
    const result = await run(dir, { maxSentencesPerGroup: 3 });
    assert.ok(result.dropped.length > 0, "at least one span must be pruned in this corpus");
    for (const d of result.dropped) {
      assert.ok(d.item && typeof d.item === "object", "every drop entry names a concrete item");
      assert.equal(typeof d.reason, "string");
      assert.ok(d.reason.length > 0, "every drop entry carries a human-readable, non-empty reason");
    }
    // the off-topic Lunch block shares no Store-focused query overlap and feeds no inference —
    // every one of its sentences must be among the dropped items, each reason naming the
    // zero-information path.
    const lunchDrops = result.dropped.filter((d) => d.item.sourceBlockId === "blk-lunch");
    assert.ok(lunchDrops.length > 0, "the off-topic Lunch block contributes at least one dropped span");
    for (const d of lunchDrops) assert.match(d.reason, /zero-information score/);
    // no sentence appears in both kept and dropped
    const keptSentences = new Set(result.sourceSpans.map((s) => s.sentence));
    for (const d of result.dropped) {
      if (d.item.sentence) assert.ok(!keptSentences.has(d.item.sentence), "a sentence is never both kept and dropped");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateCompletion(): Stage 3 relations fire (exemplifies + elaborates between the cache and store groups) and are surfaced untouched by pruning", async () => {
  const dir = await seedRepo();
  try {
    const result = await run(dir);
    assert.ok(result.relations.length > 0, "the taught cache-IS-A-store fact must license at least one cross-group relation");
    const kinds = new Set(result.relations.map((r) => r.relation));
    assert.ok(kinds.has("exemplifies") || kinds.has("elaborates"),
      "the cache/store fixture must license at least one of its two designed relations");
    for (const r of result.relations) {
      assert.equal(typeof r.licensingTest, "string");
      assert.ok(r.licensingTest.length > 0, "every relation cites its concrete licensing test");
      assert.ok(r.evidence && typeof r.evidence === "object", "every relation carries cited evidence");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateCompletion(): the grammar pass capitalises EVERY internal sentence boundary, not just the first/last", async () => {
  const dir = await seedRepo();
  try {
    const result = await run(dir);
    assert.ok(!result.declined);
    // every sentence-ending stop followed by whitespace must be followed by an uppercase letter
    // (or end of string, or another protected/non-letter token) — never a lowercase letter.
    const violations = [...result.text.matchAll(/[.!?]\s+([a-z])/g)];
    assert.deepEqual(violations.map((m) => m[0]), [], "no internal sentence boundary is left lowercase");
    // the text does not open lowercase either (sentence-capitalisation force-enabled for this
    // pipeline, unlike the parked chat-voice default).
    assert.match(result.text, /^[A-Z]/, "the completion opens capitalised");
    // no doubled terminal punctuation anywhere (ruleTerminal's own generalised job)
    assert.doesNotMatch(result.text, /[.!?]{2,}/, "no run of doubled sentence stops survives the grammar pass");
    assert.ok((result.text.match(/[.!?]/g) || []).length >= 2, "the assembled completion has at least two sentences");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateCompletion(): determinism — two runs over the identical corpus + prompt produce byte-identical output", async () => {
  const dir = await seedRepo();
  try {
    const memory = await loadMemory(dir);
    const run1 = await run(dir, { memory });
    const run2 = await run(dir, { memory });
    assert.deepEqual(run2, run1, "identical inputs must yield a byte-identical completion — any diff is a determinism bug");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateCompletion(): an empty corpus / no-match prompt declines honestly rather than fabricating a completion", async () => {
  const dir = await tmpRepo();
  try {
    const result = await generateCompletion(dir, "anything at all", {});
    assert.equal(result.declined, true);
    assert.equal(result.text, "");
    assert.deepEqual(result.sourceSpans, []);
    assert.equal(typeof result.reason, "string");
    assert.ok(result.reason.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
