import test from "node:test";
import assert from "node:assert/strict";
import { loadRows, findById, countByStatus } from "../lib/store.mjs";

const TEXT = "1 | Buy milk | open\n\n2 | Water plants | done\n3 | Read book\n";

test("loadRows parses every non-blank line into a row (parseRow call site 1 of 2)", () => {
  const rows = loadRows(TEXT);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id: "1", title: "Buy milk", status: "open" });
});

test("loadRows skips blank lines rather than producing a null row", () => {
  const rows = loadRows(TEXT);
  assert.ok(rows.every((row) => row !== null));
});

test("findById and countByStatus read the loaded rows", () => {
  const rows = loadRows(TEXT);
  assert.equal(findById(rows, "2").title, "Water plants");
  assert.equal(findById(rows, "missing"), null);
  assert.equal(countByStatus(rows, "open"), 2);
});
