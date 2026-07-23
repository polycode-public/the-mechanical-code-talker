import test from "node:test";
import assert from "node:assert/strict";
import { parseRow, isBlank } from "../lib/parse.mjs";

test("parseRow parses a well-formed line into a task record", () => {
  assert.deepEqual(parseRow("1 | Buy milk | open"), { id: "1", title: "Buy milk", status: "open" });
});

test("parseRow returns null when the id or title is missing", () => {
  assert.equal(parseRow("| no id"), null);
  assert.equal(parseRow("2 |"), null);
});

test("parseRow defaults status to open when omitted", () => {
  assert.equal(parseRow("3 | Water plants").status, "open");
});

test("isBlank recognizes empty and whitespace-only lines", () => {
  assert.equal(isBlank(""), true);
  assert.equal(isBlank("   "), true);
  assert.equal(isBlank("1 | x"), false);
});
