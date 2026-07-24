// The committed examples/*/.tmct/graph.json fixtures are hand-stamped and shipped
// so a reader can see tmct answer without building a graph. Nothing on the chat
// path may rewrite them: each example's tmct.toml carries [graph] read_only, and
// this guard pins every fixture's bytes to a committed sha256 table so a future
// writer fails a test here instead of slipping past a reviewer's eye. A
// deliberate fixture change updates example-graph-hashes.json in the same commit.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..");
const HASHES = JSON.parse(readFileSync(path.join(HERE, "example-graph-hashes.json"), "utf8"));

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

test("every committed example graph.json matches its pinned sha256 (no chat write reflowed a fixture)", () => {
  for (const [rel, expected] of Object.entries(HASHES)) {
    const actual = sha256(readFileSync(path.join(REPO_ROOT, rel)));
    assert.equal(actual, expected, `${rel} drifted from its pinned hash — a chat session or edit rewrote it. If deliberate, update test/estate/example-graph-hashes.json.`);
  }
});

test("every committed example graph declares read_only in its tmct.toml", () => {
  for (const rel of Object.keys(HASHES)) {
    const tomlPath = path.join(REPO_ROOT, path.dirname(path.dirname(rel)), "tmct.toml");
    const toml = readFileSync(tomlPath, "utf8");
    assert.match(toml, /read_only\s*=\s*true/, `${tomlPath} must set [graph] read_only = true`);
  }
});

test("the pinned-hash guard actually catches a mutated fixture", () => {
  const [rel, expected] = Object.entries(HASHES)[0];
  const original = readFileSync(path.join(REPO_ROOT, rel));
  const mutated = Buffer.concat([original, Buffer.from(" ")]);
  assert.notEqual(sha256(mutated), expected, "a one-byte change must change the sha256 the guard compares");
});
