// The (id → provenance) Fact-row diff `tmct extract` uses to ask what one turn
// actually wrote. Provenance is the key, so a re-assertion that unions a new
// tag onto an existing row counts as touched while an untouched row does not.
import test from "node:test";
import assert from "node:assert/strict";

import { touchedFactRows } from "../../src/domain/memory/touched-facts.mjs";

const row = (id, provenance, rest = {}) => ({ id, provenance, subject: "cache", predicate: "rdfs:subClassOf", object: "store", ...rest });

test("a row that was not there before is touched", () => {
  const before = [row("a", "teach:chat:1")];
  const after = [row("a", "teach:chat:1"), row("b", "ace:chat:2")];
  assert.deepEqual(touchedFactRows(before, after).map((r) => r.id), ["b"]);
});

test("a row whose provenance gained an entry is touched — a re-assertion counts", () => {
  const before = [row("a", "teach:chat:1")];
  const after = [row("a", "teach:chat:1,extracted:notes.txt")];
  assert.deepEqual(touchedFactRows(before, after).map((r) => r.id), ["a"]);
});

test("a row carried through unchanged is not touched", () => {
  const before = [row("a", "teach:chat:1"), row("b", "ace:chat:2")];
  assert.deepEqual(touchedFactRows(before, before.map((r) => ({ ...r }))), []);
});

test("a write that stored no Fact at all touches nothing — the rule-teach shapes store a Rule", () => {
  const before = [row("a", "teach:chat:1")];
  assert.deepEqual(touchedFactRows(before, [row("a", "teach:chat:1")]), []);
  assert.deepEqual(touchedFactRows([], []), []);
});

test("the first write into an empty memory touches every row it made", () => {
  const after = [row("a", "ace:chat:1"), row("b", "ace:chat:2")];
  assert.deepEqual(touchedFactRows([], after).map((r) => r.id), ["a", "b"]);
});

test("the touched rows are the after-snapshot's own objects, so the caller reads current values", () => {
  const after = [row("a", "extracted:notes.txt", { quantifier: "some" })];
  const [touched] = touchedFactRows([row("a", "teach:chat:1")], after);
  assert.equal(touched, after[0]);
  assert.equal(touched.quantifier, "some");
});

test("a row deleted between the snapshots is not reported — only what the write left behind", () => {
  const before = [row("a", "teach:chat:1"), row("gone", "teach:chat:9")];
  assert.deepEqual(touchedFactRows(before, [row("a", "teach:chat:1")]), []);
});
