import test from "node:test";
import assert from "node:assert/strict";
import { renderRow, renderList } from "../lib/render.mjs";

test("renderRow formats id, title, and an uppercased status", () => {
  assert.equal(renderRow({ id: "1", title: "Buy milk", status: "open" }), "1    Buy milk [OPEN]");
});

test("renderList joins multiple rendered rows with newlines", () => {
  const rows = [
    { id: "1", title: "Buy milk", status: "open" },
    { id: "2", title: "Water plants", status: "done" },
  ];
  assert.equal(renderList(rows), "1    Buy milk [OPEN]\n2    Water plants [DONE]");
});
