// The derived structures a payload maintains between writes — the prose index
// and the backward supersession pointers — against the ones a from-scratch
// derivation produces. Both routes end in `renormalizeAssembledPayload`, so the
// contract is deep equality: whatever a write leaves behind must be exactly the
// payload a caller assembling the same individuals from nothing would get.
//
// The sequences below are the ones a store actually runs through: an append, a
// re-write of a record already there, a supersession, a second supersession of
// the same record, a record dropping the tokens it used to carry, and a
// removal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  renormalizeAssembledPayload, renormalizeProseIndex,
} from "../../src/adapters/memory/rows.mjs";
import { buildProseIndex } from "../../src/domain/prose.mjs";

const FACT_CLASS = "Fact";
const SUPERSEDES_PROP = "mgx:supersedes";
const SUPERSEDED_BY_PROP = "mgx:supersededBy";

const attr = (prop, key, value) => ({ prop, key, value });

/** A Fact record: `tokens` is its prose token string, `supersedes` the records
 *  it replaces (space-joined, exactly as the stored attribute carries them). */
function fact(id, { tokens = "", supersedes = "", cls = FACT_CLASS } = {}) {
  const attributes = [attr("rdf:subject", "subject", id)];
  if (tokens) attributes.push(attr("mgx:hasProseTokens", "prose_tokens", tokens));
  if (supersedes) attributes.push(attr(SUPERSEDES_PROP, "supersedes", supersedes));
  return { id, label: id, class: cls, attributes };
}

/** The same individuals assembled from nothing: a fresh payload with no state
 *  carried over, which is what every equivalence check below compares against. */
function derivedFromScratch(individuals) {
  return renormalizeAssembledPayload({
    individuals: structuredClone(individuals), objectProperties: [],
  });
}

const comparable = (payload) => ({
  individuals: payload.individuals,
  proseIndex: payload.proseIndex,
  classes: payload.classes,
  generated_at: payload.generated_at,
});

/** Apply each step to one living payload, and after every step demand it deep-
 *  equals the payload a from-scratch derivation of the same individuals gives. */
function assertStepsAgree(steps, { renormalize = renormalizeAssembledPayload, compare = comparable } = {}) {
  const payload = { individuals: [], objectProperties: [] };
  renormalize(payload);
  for (const [label, step] of steps) {
    payload.individuals = step(payload.individuals);
    renormalize(payload);
    const fresh = derivedFromScratch(payload.individuals);
    assert.deepEqual(compare(payload), compare(fresh), `after ${label}`);
  }
}

const replace = (individuals, ind) => {
  const at = individuals.findIndex((i) => i.id === ind.id);
  if (at === -1) return [...individuals, ind];
  const next = [...individuals];
  next[at] = ind;
  return next;
};
const drop = (individuals, id) => individuals.filter((i) => i.id !== id);

test("a maintained payload derives the same prose index as one assembled from nothing, across append, rewrite, token loss and removal", () => {
  assertStepsAgree([
    ["the first append", (inds) => [...inds, fact("fact:a", { tokens: "red kite bird" })]],
    ["a second record sharing two words", (inds) => [...inds, fact("fact:b", { tokens: "red bird nest" })]],
    ["a third naming one word twice", (inds) => [...inds, fact("fact:c", { tokens: "nest nest twig" })]],
    ["rewriting a record's tokens", (inds) => replace(inds, fact("fact:a", { tokens: "blue heron" }))],
    ["a record losing its tokens outright", (inds) => replace(inds, fact("fact:b", { tokens: "" }))],
    ["a record that never had any", (inds) => [...inds, fact("fact:d")]],
    ["dropping a record", (inds) => drop(inds, "fact:c")],
    ["re-adding it with different tokens", (inds) => [...inds, fact("fact:c", { tokens: "twig heron" })]],
    ["emptying the payload", () => []],
  ]);
});

test("a maintained payload derives the same backward supersession pointers as one assembled from nothing", () => {
  assertStepsAgree([
    ["three plain records", () => [fact("fact:a"), fact("fact:b"), fact("fact:c")]],
    ["a supersedes b", (inds) => replace(inds, fact("fact:a", { supersedes: "fact:b" }))],
    ["c supersedes b as well", (inds) => replace(inds, fact("fact:c", { supersedes: "fact:b" }))],
    ["a moves its supersession to c", (inds) => replace(inds, fact("fact:a", { supersedes: "fact:c" }))],
    ["a supersedes two at once", (inds) => replace(inds, fact("fact:a", { supersedes: "fact:b fact:c" }))],
    ["a stops superseding anything", (inds) => replace(inds, fact("fact:a"))],
    ["a superseding record leaves the payload", (inds) => drop(inds, "fact:c")],
    ["a record superseding one that is not here", (inds) => replace(inds, fact("fact:a", { supersedes: "fact:gone" }))],
    ["a non-Fact record naming a supersession", (inds) => [...inds, fact("src:x", { supersedes: "fact:b", cls: "Source" })]],
  ]);
});

test("prose tokens and supersessions moving together reconcile the same as a fresh derivation", () => {
  assertStepsAgree([
    ["two records with tokens", () => [fact("fact:a", { tokens: "one two" }), fact("fact:b", { tokens: "two three" })]],
    ["a supersedes b and re-words", (inds) => replace(inds, fact("fact:a", { tokens: "two three", supersedes: "fact:b" }))],
    ["b re-words under its pointer", (inds) => replace(inds, fact("fact:b", { tokens: "four" }))],
    ["a third record supersedes a", (inds) => [...inds, fact("fact:c", { tokens: "one", supersedes: "fact:a" })]],
    ["b leaves", (inds) => drop(inds, "fact:b")],
  ]);
});

test("a record arriving with no backward pointer still gains the one its successors imply", () => {
  const payload = { individuals: [], objectProperties: [] };
  renormalizeAssembledPayload(payload);
  payload.individuals = [fact("fact:a", { supersedes: "fact:b" })];
  renormalizeAssembledPayload(payload);
  // The row form of a superseded record never carries the backward pointer, so
  // it lands here exactly as a row would project it.
  payload.individuals = [...payload.individuals, fact("fact:b")];
  renormalizeAssembledPayload(payload);
  const landed = payload.individuals.find((i) => i.id === "fact:b");
  assert.deepEqual(
    landed.attributes.find((a) => a.prop === SUPERSEDED_BY_PROP),
    { prop: SUPERSEDED_BY_PROP, key: "supersededBy", value: "fact:a" },
  );
  assert.deepEqual(comparable(payload), comparable(derivedFromScratch(payload.individuals)));
});

test("the prose-index-only pass tracks buildProseIndex across the same sequence", () => {
  const payload = { individuals: [], objectProperties: [] };
  const steps = [
    ["append", (inds) => [...inds, fact("fact:a", { tokens: "alpha beta" })]],
    ["a second sharing a word", (inds) => [...inds, fact("fact:b", { tokens: "beta gamma" })]],
    ["rewrite", (inds) => replace(inds, fact("fact:a", { tokens: "gamma gamma" }))],
    ["token loss", (inds) => replace(inds, fact("fact:b", { tokens: "" }))],
    ["removal", (inds) => drop(inds, "fact:a")],
  ];
  renormalizeProseIndex(payload);
  for (const [label, step] of steps) {
    payload.individuals = step(payload.individuals);
    renormalizeProseIndex(payload);
    assert.deepEqual(payload.proseIndex, buildProseIndex(payload.individuals), `after ${label}`);
  }
});

test("a payload whose prose index was replaced under it derives again instead of patching the wrong object", () => {
  const payload = { individuals: [fact("fact:a", { tokens: "alpha" })], objectProperties: [] };
  renormalizeProseIndex(payload);
  payload.proseIndex = { stale: ["fact:zzz"] };
  payload.individuals = [...payload.individuals, fact("fact:b", { tokens: "beta" })];
  renormalizeProseIndex(payload);
  assert.deepEqual(payload.proseIndex, buildProseIndex(payload.individuals));
});

test("one fact set fed in two orders derives the same payload", () => {
  const individuals = [
    fact("fact:c", { tokens: "gamma alpha", supersedes: "fact:a" }),
    fact("fact:a", { tokens: "alpha beta" }),
    fact("fact:b", { tokens: "beta", supersedes: "fact:a" }),
  ];
  const forward = derivedFromScratch(individuals);
  const reversed = derivedFromScratch([...individuals].reverse());
  assert.deepEqual(comparable(forward), comparable(reversed));
});
