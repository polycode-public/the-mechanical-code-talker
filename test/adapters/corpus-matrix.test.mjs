import test from "node:test";
import assert from "node:assert/strict";

import {
  groupOfKey, keyOfRow, isNegativeKey, tallyRows, behaviourGroups,
  thinGroups, groupsWithNoNegativeRow, lanesOfGroup, matrixRows, renderTable,
} from "../../src/domain/corpus-matrix.mjs";

const entries = (...pairs) => pairs.map(([lane, key]) => ({ lane, row: { key } }));

test("a key group is its first two dot-segments", () => {
  assert.equal(groupOfKey("ask.alias.two-hop.resolves"), "ask.alias");
});

test("a key shorter than two segments is its own group", () => {
  assert.equal(groupOfKey("greeting"), "greeting");
});

test("a row with no key is counted under a named placeholder, not dropped", () => {
  assert.equal(keyOfRow({}), "(no key)");
  assert.equal(keyOfRow({ key: "ask.alias" }), "ask.alias");
});

test("a key naming a miss, guard or negation reads as negative", () => {
  for (const key of ["ask.alias.honest-miss", "ask.x.guard", "ask.x.negation", "ask.x.declines", "ask.x.refuses"]) {
    assert.equal(isNegativeKey(key), true, key);
  }
});

test("a happy-path key does not read as negative", () => {
  assert.equal(isNegativeKey("ask.alias.two-hop.resolves"), false);
});

test("the negative match is a substring, so a longer word containing one counts", () => {
  assert.equal(isNegativeKey("ask.x.dismissal"), true);
});

test("tallyRows counts rows per group per lane", () => {
  const { counts } = tallyRows(entries(
    ["ask", "ask.alias.one"],
    ["ask", "ask.alias.two"],
    ["chat", "ask.alias.three"],
    ["chat", "ask.other.one"],
  ));
  assert.equal(counts.get("ask.alias").get("ask"), 2);
  assert.equal(counts.get("ask.alias").get("chat"), 1);
  assert.equal(counts.get("ask.other").get("chat"), 1);
  assert.equal(counts.get("ask.alias").get("nowhere"), undefined);
});

test("tallyRows keeps every distinct full key a group was built from", () => {
  const { fullKeys } = tallyRows(entries(["ask", "ask.alias.one"], ["ask", "ask.alias.one"], ["ask", "ask.alias.two"]));
  assert.deepEqual([...fullKeys.get("ask.alias")].sort(), ["ask.alias.one", "ask.alias.two"]);
});

test("tallyRows counts a repeated key twice even though the key set holds it once", () => {
  const tally = tallyRows(entries(["ask", "ask.alias.one"], ["ask", "ask.alias.one"]));
  assert.equal(tally.counts.get("ask.alias").get("ask"), 2);
  assert.equal(tally.fullKeys.get("ask.alias").size, 1);
});

test("tallyRows on no rows yields empty indexes", () => {
  const { counts, fullKeys } = tallyRows([]);
  assert.equal(counts.size, 0);
  assert.equal(fullKeys.size, 0);
});

test("bench.* groups are excluded from the heuristics — a bench row asserts a rig runs", () => {
  const tally = tallyRows(entries(["bench", "bench.smoke.one"], ["ask", "ask.alias.one"]));
  assert.deepEqual(behaviourGroups(tally), ["ask.alias"]);
  assert.deepEqual(thinGroups(tally), ["ask.alias"]);
  assert.deepEqual(groupsWithNoNegativeRow(tally), ["ask.alias"]);
});

test("a group with one row across all lanes is thin", () => {
  const tally = tallyRows(entries(["ask", "ask.thin.one"], ["ask", "ask.fat.one"], ["chat", "ask.fat.two"]));
  assert.deepEqual(thinGroups(tally), ["ask.thin"]);
});

test("a group is not thin when its single row per lane totals more than one", () => {
  const tally = tallyRows(entries(["ask", "ask.spread.one"], ["chat", "ask.spread.two"]));
  assert.deepEqual(thinGroups(tally), []);
});

test("a group whose keys never name a miss is listed as having no negative row", () => {
  const tally = tallyRows(entries(
    ["ask", "ask.covered.resolves"],
    ["ask", "ask.covered.honest-miss"],
    ["ask", "ask.bare.resolves"],
    ["ask", "ask.bare.also-resolves"],
  ));
  assert.deepEqual(groupsWithNoNegativeRow(tally), ["ask.bare"]);
});

test("one negative row anywhere in the group covers it", () => {
  const tally = tallyRows(entries(["ask", "ask.x.resolves"], ["chat", "ask.x.guard"]));
  assert.deepEqual(groupsWithNoNegativeRow(tally), []);
});

test("the heuristics are independent — a thin group with a negative key is thin only", () => {
  const tally = tallyRows(entries(["ask", "ask.x.honest-miss"]));
  assert.deepEqual(thinGroups(tally), ["ask.x"]);
  assert.deepEqual(groupsWithNoNegativeRow(tally), []);
});

test("lanesOfGroup names the lanes a group has rows in", () => {
  const tally = tallyRows(entries(["ask", "ask.x.one"], ["chat", "ask.x.two"]));
  assert.deepEqual(lanesOfGroup(tally, "ask.x"), ["ask", "chat"]);
});

test("matrixRows puts a header first, then one row per group, sorted", () => {
  const tally = tallyRows(entries(["ask", "b.one.x"], ["ask", "a.one.x"]));
  assert.deepEqual(matrixRows(tally, ["ask", "chat"]), [
    ["key", "ask", "chat"],
    ["a.one", "1", ""],
    ["b.one", "1", ""],
  ]);
});

test("matrixRows leaves a cell empty where a lane has no row for the group", () => {
  const tally = tallyRows(entries(["ask", "a.one.x"], ["chat", "a.one.y"], ["chat", "b.one.x"]));
  assert.deepEqual(matrixRows(tally, ["ask", "chat"]), [
    ["key", "ask", "chat"],
    ["a.one", "1", "1"],
    ["b.one", "", "1"],
  ]);
});

test("renderTable pads every column to its widest cell and rules off the header", () => {
  assert.equal(
    renderTable([["key", "ask"], ["a.long.group", "1"], ["b", "20"]]),
    [
      "key           ask",
      "------------  ---",
      "a.long.group  1",
      "b             20",
    ].join("\n"),
  );
});

test("renderTable trims trailing padding, so an empty last cell leaves no whitespace", () => {
  const lines = renderTable([["key", "ask"], ["a.group", ""]]).split("\n");
  assert.equal(lines.at(-1), "a.group");
});

test("renderTable widens a column its header outgrows", () => {
  assert.equal(renderTable([["key", "lane"], ["a", "1"]]).split("\n").at(-1), "a    1");
});

test("renderTable renders a header with no body rows", () => {
  assert.equal(renderTable([["key", "ask"]]), "key  ask\n---  ---");
});
