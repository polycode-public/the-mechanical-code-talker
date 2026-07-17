// Replays the home page's transcripts against the live CLI. The page shows them
// as terminal output, so every line it shows must be a line the product prints,
// in the order shown. Without this the page's examples are only strings a
// browser test can find in the DOM: true of the page, and no evidence about the
// product.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { extractPageSessions } from "./helpers/page-examples.mjs";
import { repoRoot, runSessionBlock } from "../test/readme/harness.mjs";

const INDEX = join(repoRoot, "public", "index.html");
const sessions = extractPageSessions(INDEX);

test("every transcript the home page prints is marked as one the CLI must reproduce", () => {
  assert.ok(sessions.length > 0, "the home page carries at least one replayable transcript");
});

for (const block of sessions) {
  test(`index.html line ${block.startLine}: "${block.label}" replays against the live CLI`, () => {
    runSessionBlock(block);
  });
}
