import test from "node:test";
import assert from "node:assert/strict";
import { previewFirstRow, run } from "../app.mjs";

const TEXT = "1 | Buy milk | open\n2 | Water plants | done\n";

test("previewFirstRow parses the text's first line directly (parseRow call site 2 of 2)", () => {
  assert.deepEqual(previewFirstRow(TEXT), { id: "1", title: "Buy milk", status: "open" });
});

test("previewFirstRow returns null for empty text", () => {
  assert.equal(previewFirstRow(""), null);
});

test("run wires parse, store, and render together end to end", () => {
  const result = run(TEXT);
  assert.equal(result.openCount, 1);
  assert.equal(result.firstRow.title, "Buy milk");
  assert.match(result.rendered, /Water plants \[DONE\]/);
});
