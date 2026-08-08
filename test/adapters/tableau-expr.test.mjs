// tableau-expr.test.mjs — the ALC concept-expression AST: canonicalKey
// stability/dedup and toNNF's correctness across every connective, plus the
// sorted-cs invariant and-rule/or-rule/clash-detection all lean on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalKey, toNNF } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });

test("canonicalKey: structurally equal expressions produce the same key", () => {
  const a = { t: "and", cs: [atom("cat"), atom("dog")] };
  const b = { t: "and", cs: [atom("dog"), atom("cat")] }; // built in the other order
  assert.equal(canonicalKey(a), canonicalKey(b));
});

test("canonicalKey: structurally different expressions produce different keys", () => {
  assert.notEqual(canonicalKey(atom("cat")), canonicalKey(atom("dog")));
  assert.notEqual(canonicalKey(atom("cat")), canonicalKey({ t: "not", c: atom("cat") }));
  assert.notEqual(canonicalKey({ t: "some", r: "has", c: atom("valve") }), canonicalKey({ t: "all", r: "has", c: atom("valve") }));
});

test("canonicalKey: every connective produces a distinct, stable key", () => {
  const cases = [
    { t: "top" },
    { t: "bot" },
    atom("cat"),
    { t: "nom", ind: "rex" },
    { t: "not", c: atom("cat") },
    { t: "and", cs: [atom("cat"), atom("dog")] },
    { t: "or", cs: [atom("cat"), atom("dog")] },
    { t: "some", r: "has", c: atom("valve") },
    { t: "all", r: "has", c: atom("valve") },
    { t: "atLeast", n: 2, r: "has", c: atom("wheel") },
    { t: "atMost", n: 0, r: "has", c: atom("wheel") },
  ];
  const keys = cases.map(canonicalKey);
  assert.equal(new Set(keys).size, keys.length, "every case must produce a unique key");
  for (const [expr, key] of cases.map((e, i) => [e, keys[i]])) assert.equal(canonicalKey(expr), key, "canonicalKey must be stable across repeated calls");
});

test("canonicalKey: rejects a malformed expression rather than guessing", () => {
  assert.throws(() => canonicalKey(null));
  assert.throws(() => canonicalKey({ t: "madeUp" }));
});

test("toNNF: double negation collapses", () => {
  const expr = { t: "not", c: { t: "not", c: atom("cat") } };
  assert.equal(canonicalKey(toNNF(expr)), canonicalKey(atom("cat")));
});

test("toNNF: top and bottom negate to each other", () => {
  assert.equal(canonicalKey(toNNF({ t: "not", c: { t: "top" } })), "bot");
  assert.equal(canonicalKey(toNNF({ t: "not", c: { t: "bot" } })), "top");
});

test("toNNF: negated atom and nominal stay negated atoms/nominals", () => {
  assert.equal(canonicalKey(toNNF({ t: "not", c: atom("cat") })), canonicalKey({ t: "not", c: atom("cat") }));
  assert.equal(canonicalKey(toNNF({ t: "not", c: { t: "nom", ind: "rex" } })), canonicalKey({ t: "not", c: { t: "nom", ind: "rex" } }));
});

test("toNNF: De Morgan over and/or, negation pushed to the leaves", () => {
  const expr = { t: "not", c: { t: "and", cs: [atom("cat"), atom("dog")] } };
  const nnf = toNNF(expr);
  assert.equal(nnf.t, "or");
  assert.equal(canonicalKey(nnf), canonicalKey({ t: "or", cs: [{ t: "not", c: atom("cat") }, { t: "not", c: atom("dog") }] }));

  const expr2 = { t: "not", c: { t: "or", cs: [atom("cat"), atom("dog")] } };
  const nnf2 = toNNF(expr2);
  assert.equal(nnf2.t, "and");
  assert.equal(canonicalKey(nnf2), canonicalKey({ t: "and", cs: [{ t: "not", c: atom("cat") }, { t: "not", c: atom("dog") }] }));
});

test("toNNF: some/all swap under negation, filler keeps its own polarity", () => {
  const some = { t: "some", r: "has", c: atom("valve") };
  const negSome = toNNF({ t: "not", c: some });
  assert.equal(negSome.t, "all");
  assert.equal(canonicalKey(negSome.c), canonicalKey({ t: "not", c: atom("valve") }));

  const all = { t: "all", r: "has", c: atom("valve") };
  const negAll = toNNF({ t: "not", c: all });
  assert.equal(negAll.t, "some");
  assert.equal(canonicalKey(negAll.c), canonicalKey({ t: "not", c: atom("valve") }));
});

test("toNNF: nested some/or pushes negation all the way to the atoms", () => {
  const expr = { t: "not", c: { t: "some", r: "has", c: { t: "or", cs: [atom("cat"), atom("dog")] } } };
  const nnf = toNNF(expr);
  assert.equal(nnf.t, "all");
  assert.equal(nnf.c.t, "and");
  assert.deepEqual(nnf.c.cs.map((c) => c.t), ["not", "not"]);
});

test("toNNF: atLeast/atMost flip connective and threshold under negation, filler untouched", () => {
  const atLeast = { t: "atLeast", n: 2, r: "has", c: atom("wheel") };
  const negAtLeast = toNNF({ t: "not", c: atLeast });
  assert.deepEqual(negAtLeast, { t: "atMost", n: 1, r: "has", c: atom("wheel") });

  const atMost = { t: "atMost", n: 0, r: "has", c: atom("wheel") };
  const negAtMost = toNNF({ t: "not", c: atMost });
  assert.deepEqual(negAtMost, { t: "atLeast", n: 1, r: "has", c: atom("wheel") });
});

test("toNNF: and/or children come out sorted by canonicalKey — the sorted-cs invariant", () => {
  const unsorted = { t: "and", cs: [atom("zebra"), atom("aardvark"), atom("mongoose")] };
  const nnf = toNNF(unsorted);
  const keys = nnf.cs.map(canonicalKey);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
});

test("toNNF: negating an and/or also leaves the flipped children sorted", () => {
  const expr = { t: "not", c: { t: "or", cs: [atom("zebra"), atom("aardvark")] } };
  const nnf = toNNF(expr);
  const keys = nnf.cs.map(canonicalKey);
  assert.deepEqual(keys, [...keys].sort());
});

test("toNNF: rejects a malformed expression rather than guessing", () => {
  assert.throws(() => toNNF(undefined));
  assert.throws(() => toNNF({ t: "madeUp" }));
});
