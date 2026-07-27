// The ING-8 whole-document equivalence checker: verifies harder paraphrase
// shapes ING-7's own checker (verifySubClassParaphrase) doesn't cover — non-isa
// relations, multi-sentence documents, and synonym substitution over the closed
// relation vocabulary. Unit coverage plus the held-out gate: the checker never
// accepts a pair the real judge (test-benchmarks/ingestbench's committed ING-8
// corpus) scored as NOT a faithful paraphrase — the same
// matcherTighterThanJudge discipline chatbench's own promotion pipeline holds
// its matchers to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  paraphraseRelation, recoverRelationTriple, verifyRelationParaphrase,
  recoverAnyTriple, recoverDocumentTriples, verifyIng8Paraphrase, RELATION_FAMILY_IDS,
} from "../../src/domain/paraphrase-ing8.mjs";
import { mulberry32, seededShuffle } from "../../src/domain/seeded-random.mjs";
import { fnv1a32 } from "../../src/domain/hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const INGESTBENCH = join(ROOT, "test-benchmarks", "ingestbench");

test("paraphraseRelation: deterministic — same (family, subject, object) always produces the same text", () => {
  assert.equal(paraphraseRelation("has", "bird", "feather"), paraphraseRelation("has", "bird", "feather"));
});

test("paraphraseRelation: every template in every family round-trips through recoverRelationTriple", () => {
  const pairs = { has: ["bird", "feather"], creates: ["weight", "pressure"], capableOf: ["bird", "fly"] };
  for (const family of RELATION_FAMILY_IDS) {
    const [s, o] = pairs[family];
    const seenTemplates = new Set();
    for (let variant = 0; variant < 6; variant += 1) {
      const text = paraphraseRelation(family, s, o, variant);
      const recovered = recoverRelationTriple(family, text);
      assert.ok(recovered, `expected ${JSON.stringify(text)} to recognize under family "${family}"`);
      assert.equal(recovered.subject, s);
      assert.equal(recovered.object, o);
      seenTemplates.add(text);
    }
    assert.ok(seenTemplates.size > 1, `sweep over family "${family}" should exercise more than one template`);
  }
});

test("recoverRelationTriple: unrecognized text and an unknown family both return null", () => {
  assert.equal(recoverRelationTriple("has", "bananas are tasty"), null);
  assert.equal(recoverRelationTriple("not-a-family", "bird has a feather"), null);
});

test("verifyRelationParaphrase: a genuine matching non-isa paraphrase verifies true", () => {
  assert.equal(verifyRelationParaphrase("has", "bird", "feather", "bird possesses a feather").verified, true);
});

test("verifyRelationParaphrase: a subject/object swap fails — no closure to re-derive over for a non-isa relation, so this is the whole safety net", () => {
  assert.equal(verifyRelationParaphrase("has", "bird", "feather", "feather has a bird").verified, false);
});

test("recoverAnyTriple: recognizes isa and every relation family, and returns null for free prose", () => {
  assert.deepEqual(recoverAnyTriple("dog is a kind of animal"), { family: "isa", subject: "dog", object: "animal" });
  assert.deepEqual(recoverAnyTriple("bird has a feather"), { family: "has", subject: "bird", object: "feather" });
  assert.deepEqual(recoverAnyTriple("weight creates pressure"), { family: "creates", subject: "weight", object: "pressure" });
  assert.deepEqual(recoverAnyTriple("bird can fly"), { family: "capableOf", subject: "bird", object: "fly" });
  assert.equal(recoverAnyTriple("bananas are tasty"), null);
});

test("recoverDocumentTriples: null the moment any sentence is unrecognized, never a partial list", () => {
  assert.equal(recoverDocumentTriples("Bird has a feather. Birds are covered in feathers."), null);
  assert.equal(recoverDocumentTriples(""), null);
  const triples = recoverDocumentTriples("Bird has a feather. Bird can fly.");
  assert.equal(triples.length, 2);
});

test("verifyIng8Paraphrase: a single isa fact re-derives through ING-7's own subclass closure", () => {
  const r = verifyIng8Paraphrase("Dog is a kind of animal.", "Every dog is an animal.");
  assert.equal(r.verified, true);
  assert.equal(r.method, "isa-closure");
});

test("verifyIng8Paraphrase: a single isa fact with a SWAPPED subject/object fails the closure re-derivation", () => {
  const r = verifyIng8Paraphrase("Dog is a kind of animal.", "Animal is a kind of dog.");
  assert.equal(r.verified, false);
});

test("verifyIng8Paraphrase: a multi-sentence document verifies as the exact same (family, subject, object) SET, order irrelevant", () => {
  const r = verifyIng8Paraphrase(
    "Bird has a feather. Bird can fly.",
    "Bird knows how to fly. Bird possesses a feather.",
  );
  assert.equal(r.verified, true);
  assert.equal(r.method, "closed-template-set");
});

test("verifyIng8Paraphrase: an invented extra fact (more triples on the restatement side) is rejected, never guessed at", () => {
  const r = verifyIng8Paraphrase("Bird has a feather.", "Bird possesses a feather. Bird can fly.");
  assert.equal(r.verified, false);
  assert.equal(r.reason, "fact count mismatch");
});

test("verifyIng8Paraphrase: a dropped fact (fewer triples on the restatement side) is rejected the same way — a checker miss, not a false accept", () => {
  const r = verifyIng8Paraphrase("Bird has a feather. Bird can fly.", "Bird possesses a feather.");
  assert.equal(r.verified, false);
  assert.equal(r.reason, "fact count mismatch");
});

test("verifyIng8Paraphrase: text outside the closed template set is reported unrecognized, never a guess", () => {
  const r = verifyIng8Paraphrase("Bird has a feather.", "Birds are covered in feathers.");
  assert.equal(r.verified, false);
  assert.equal(r.reason, "unrecognized");
});

// ---- the held-out gate: the checker must never accept a pair the real judge
// rejected, over test-benchmarks/ingestbench's committed ING-8 corpus ----

async function loadJsonl(path) {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Ground truth for one caseId: TRUE only when every judged sample scored a
 *  perfect 2/2 both ways — a genuine, full paraphrase, not merely "close
 *  enough". Anything less (a dropped fact, an invented fact, a swap) is NOT a
 *  paraphrase for this checker's purposes. */
function judgeVerifiedLabel(judgedByCaseId, caseId) {
  const rows = judgedByCaseId.get(caseId) ?? [];
  if (!rows.length) return null;
  return rows.every((r) => r.scores?.forward === 2) && rows.every((r) => r.scores?.backward === 2);
}

/** The SAME deterministic 70/30 split the checker was validated against while
 *  it was built — a fixed seed distinct from the corpus generator's own, so the
 *  held-out slice is independent of which items the generator happened to
 *  enumerate first. */
function splitBuildHeldOut(candidates) {
  const rng = mulberry32((20260727 ^ fnv1a32("ing8-held-out-split")) >>> 0);
  const shuffled = seededShuffle(candidates, rng);
  const splitAt = Math.round(shuffled.length * 0.7);
  return { build: shuffled.slice(0, splitAt), heldOut: shuffled.slice(splitAt) };
}

test("held-out gate: the checker never verifies a pair the judge rejected, on the committed ING-8 corpus", async () => {
  const candidates = await loadJsonl(join(INGESTBENCH, "ing8-candidates.jsonl"));
  const judged = await loadJsonl(join(INGESTBENCH, "ing8-judged.jsonl"));
  const judgedByCaseId = new Map();
  for (const row of judged) {
    if (!judgedByCaseId.has(row.caseId)) judgedByCaseId.set(row.caseId, []);
    judgedByCaseId.get(row.caseId).push(row);
  }
  assert.equal(candidates.length, 200, "the committed ING-8 corpus is expected to hold exactly 200 pairs");

  const { build, heldOut } = splitBuildHeldOut(candidates);
  assert.ok(build.length > 0 && heldOut.length > 0);

  for (const [label, rows] of [["build", build], ["held-out", heldOut]]) {
    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (const row of rows) {
      const truth = judgeVerifiedLabel(judgedByCaseId, row.caseId);
      assert.notEqual(truth, null, `${row.caseId} has no judged rows in ing8-judged.jsonl`);
      const { verified } = verifyIng8Paraphrase(row.input, row.restatement);
      if (verified && truth) tp += 1;
      else if (!verified && !truth) tn += 1;
      else if (verified && !truth) fp += 1;
      else fn += 1;
    }
    // The invariant that matters: zero false positives. A false negative (the
    // checker misses a real paraphrase) is safe — that case still asks the
    // judge. A false positive is the one outcome this gate exists to forbid.
    assert.equal(fp, 0, `${label} set: the checker verified ${fp} pair(s) the judge rejected — the tighter-than-the-judge invariant is broken`);
    const accuracy = (tp + tn) / rows.length;
    assert.ok(accuracy > 0.9, `${label} set accuracy ${(accuracy * 100).toFixed(1)}% should clear 90%`);
  }
});
