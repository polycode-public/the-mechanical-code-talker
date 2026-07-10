// completions-prune.test.mjs — Stage 5 ("drop non-contributing elements") verification for
// src/completions/prune.mjs, per PLAN_COMPLETIONS.md §1.5/§4's own staging table (row 3): "any
// retrieved span that ends up in no surviving group, feeds no asserted inference, and is not
// selected by Stage 4's ranking gets cut, explicitly, with the drop recorded (not silently
// discarded)".
//
// Reading that sentence as an AND-of-three-conditions-to-drop (equivalently: KEEP on any of the
// three negations) is prune.mjs's own documented interpretation (see its file header); this
// suite exercises each branch directly with small, hand-built inputs (rankedByGroup supplied
// directly, not recomputed via rank.mjs — prune.mjs's own contract is that ranking is an INPUT,
// see its docblock), plus a determinism double-run diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneCompletion } from "../src/completions/prune.mjs";

function group(id, memberIds, label = id) {
  return { id, memberIds, label };
}

test("pruneCompletion(): top-K, positive-score sentences are KEPT; below-cutoff / zero-score sentences are DROPPED with an itemized reason", () => {
  const groups = [group("g:a", ["b1"])];
  const rankedByGroup = {
    "g:a": [
      { sentence: "Top sentence one.", score: 5, sourceBlockId: "b1" },
      { sentence: "Top sentence two.", score: 4, sourceBlockId: "b1" },
      { sentence: "Top sentence three.", score: 3, sourceBlockId: "b1" },
      { sentence: "Below cutoff sentence.", score: 2, sourceBlockId: "b1" }, // 4th, K=3 -> dropped
      { sentence: "Zero information sentence.", score: 0, sourceBlockId: "b1" },
    ],
  };
  const { kept, dropped } = pruneCompletion({ hits: [], groups, relations: [], rankedByGroup }, { maxSentencesPerGroup: 3 });

  assert.deepEqual(kept.map((k) => k.sentence), ["Top sentence one.", "Top sentence two.", "Top sentence three."]);
  for (const k of kept) {
    assert.equal(k.groupId, "g:a");
    assert.equal(k.groupLabel, "g:a");
    assert.equal(k.sourceBlockId, "b1");
  }

  assert.equal(dropped.length, 2);
  const belowCutoff = dropped.find((d) => d.item.sentence === "Below cutoff sentence.");
  assert.ok(belowCutoff, "the 4th-ranked sentence is dropped");
  assert.match(belowCutoff.reason, /grouped but zero relations touched it and it wasn't top-ranked/);
  assert.equal(belowCutoff.item.kind, "sentence");
  assert.equal(belowCutoff.item.groupId, "g:a");
  assert.equal(belowCutoff.item.sourceBlockId, "b1");

  const zeroInfo = dropped.find((d) => d.item.sentence === "Zero information sentence.");
  assert.ok(zeroInfo, "the zero-scored sentence is dropped");
  assert.match(zeroInfo.reason, /zero-information score/);
});

test("pruneCompletion(): a group with NO relation and NO qualifying sentence is entirely dropped, every sentence itemized", () => {
  const groups = [group("g:lunch", ["b-lunch"])];
  const rankedByGroup = {
    "g:lunch": [
      { sentence: "Soup is fine.", score: 0, sourceBlockId: "b-lunch" },
      { sentence: "Sandwiches too.", score: 0, sourceBlockId: "b-lunch" },
    ],
  };
  const { kept, dropped } = pruneCompletion({ hits: [], groups, relations: [], rankedByGroup });
  assert.deepEqual(kept, []);
  assert.equal(dropped.length, 2);
  assert.ok(dropped.every((d) => /zero-information score \(no informative\/query-focused tokens\) and its group feeds no asserted inference/.test(d.reason)));
});

test("pruneCompletion(): a group that FEEDS an asserted inference but clears NO ranking cutoff is not silenced — its single top-ranked sentence is salvaged as the relation anchor", () => {
  const groups = [group("g:a", ["b1"]), group("g:b", ["b2"])];
  const rankedByGroup = {
    "g:a": [
      { sentence: "Weak anchor sentence.", score: 0, sourceBlockId: "b1" },
      { sentence: "Even weaker sentence.", score: 0, sourceBlockId: "b1" },
    ],
    "g:b": [
      { sentence: "Strong sentence.", score: 9, sourceBlockId: "b2" },
    ],
  };
  const relations = [{ from: "g:a", to: "g:b", relation: "supports", licensingTest: "t", evidence: {} }];
  const { kept, dropped } = pruneCompletion({ hits: [], groups, relations, rankedByGroup });

  const keptA = kept.filter((k) => k.groupId === "g:a");
  assert.equal(keptA.length, 1, "exactly one sentence salvaged as g:a's relation anchor");
  assert.equal(keptA[0].sentence, "Weak anchor sentence.", "the TOP-ranked sentence (even at score 0) is the anchor, not an arbitrary one");

  const droppedA = dropped.filter((d) => d.item.groupId === "g:a");
  assert.equal(droppedA.length, 1);
  assert.match(droppedA[0].reason, /already anchored by a different sentence/);

  const keptB = kept.filter((k) => k.groupId === "g:b");
  assert.deepEqual(keptB.map((k) => k.sentence), ["Strong sentence."], "g:b's own strong sentence qualifies on ranking grounds regardless of the relation");
});

test("pruneCompletion(): a relation-feeding group whose sentences ALREADY qualify on ranking needs no salvage (no double-count, no phantom drop)", () => {
  const groups = [group("g:a", ["b1"])];
  const rankedByGroup = {
    "g:a": [{ sentence: "Already qualifies.", score: 3, sourceBlockId: "b1" }],
  };
  const relations = [{ from: "g:a", to: "g:z", relation: "supports" }];
  const { kept, dropped } = pruneCompletion({ hits: [], groups, relations, rankedByGroup });
  assert.deepEqual(kept.map((k) => k.sentence), ["Already qualifies."]);
  assert.equal(dropped.filter((d) => d.item.groupId === "g:a").length, 0);
});

test("pruneCompletion(): a hit that never lands in any group is dropped with reason 'never grouped' (defensive — group.mjs's own contract never actually produces this)", () => {
  const hits = [{ id: "orphan-hit", text: "nowhere" }];
  const { kept, dropped } = pruneCompletion({ hits, groups: [], relations: [], rankedByGroup: {} });
  assert.deepEqual(kept, []);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, "never grouped");
  assert.equal(dropped[0].item.id, "orphan-hit");
});

test("pruneCompletion(): empty input -> empty kept/dropped, never throws", () => {
  assert.deepEqual(pruneCompletion(), { kept: [], dropped: [] });
  assert.deepEqual(pruneCompletion({}), { kept: [], dropped: [] });
  assert.deepEqual(pruneCompletion({ hits: [], groups: [], relations: [], rankedByGroup: {} }), { kept: [], dropped: [] });
});

test("pruneCompletion(): maxSentencesPerGroup is override-able and documented as a visible, non-silent cap", () => {
  const groups = [group("g:a", ["b1"])];
  const rankedByGroup = {
    "g:a": [
      { sentence: "One.", score: 3, sourceBlockId: "b1" },
      { sentence: "Two.", score: 2, sourceBlockId: "b1" },
    ],
  };
  const capped = pruneCompletion({ hits: [], groups, relations: [], rankedByGroup }, { maxSentencesPerGroup: 1 });
  assert.deepEqual(capped.kept.map((k) => k.sentence), ["One."]);
  assert.equal(capped.dropped.length, 1);

  const uncapped = pruneCompletion({ hits: [], groups, relations: [], rankedByGroup }, { maxSentencesPerGroup: 2 });
  assert.deepEqual(uncapped.kept.map((k) => k.sentence), ["One.", "Two."]);
  assert.equal(uncapped.dropped.length, 0);
});

test("pruneCompletion(): determinism — two runs over identical input produce byte-identical kept/dropped", () => {
  const groups = [group("g:b", ["b2"]), group("g:a", ["b1"])];
  const rankedByGroup = {
    "g:a": [
      { sentence: "A one.", score: 3, sourceBlockId: "b1" },
      { sentence: "A two.", score: 0, sourceBlockId: "b1" },
    ],
    "g:b": [{ sentence: "B one.", score: 1, sourceBlockId: "b2" }],
  };
  const relations = [{ from: "g:a", to: "g:b", relation: "elaborates" }];
  const run1 = pruneCompletion({ hits: [], groups, relations, rankedByGroup });
  const run2 = pruneCompletion({ hits: [], groups, relations, rankedByGroup });
  assert.deepEqual(run2, run1, "identical inputs must yield byte-identical prune output — any diff is a determinism bug");
  // group order in the OUTPUT is id-sorted regardless of input group array order
  assert.deepEqual(run1.kept.map((k) => k.groupId), ["g:a", "g:b"]);
});
