// Runs the README's fast runnable blocks against the live product, so a
// documented example that stops working fails the suite. Heavy blocks
// (attrs.e2e) run from e2e/readme-examples.test.mjs instead; skip-marked
// blocks never run.
import test from "node:test";
import assert from "node:assert/strict";
import { extractReadmeBlocks } from "./extract.mjs";
import {
  README_PATH,
  runJsBlock,
  runBashBlock,
  runSessionBlock,
  runOutputBlock,
  assertHelpExcerpt,
  validateTomlBlock,
} from "./harness.mjs";

const blocks = extractReadmeBlocks(README_PATH);
const stdoutByIndex = new Map();

test("every README fence carries a recognized harness tag", () => {
  for (const block of blocks) {
    assert.match(
      block.tag,
      /^(js|bash|session|output|output:help:[\w-]+|toml|text)$/,
      `README line ${block.startLine}: untagged or unrecognized info string "${block.tag}"`,
    );
  }
});

for (const block of blocks) {
  if (block.attrs.e2e || block.attrs.skip || block.tag === "text") continue;
  const label = `README line ${block.startLine}`;

  if (block.tag === "js") {
    test(`${label}: the js example runs clean against the packaged exports`, () => {
      stdoutByIndex.set(block.index, runJsBlock(block));
    });
  } else if (block.tag === "bash") {
    test(`${label}: the shell example runs clean end to end`, () => {
      stdoutByIndex.set(block.index, runBashBlock(block));
    });
  } else if (block.tag === "session") {
    test(`${label}: the transcript replays against the live CLI`, () => {
      runSessionBlock(block);
    });
  } else if (block.tag === "output") {
    test(`${label}: the shown output matches a fresh run`, () => {
      runOutputBlock(block, stdoutByIndex.get(block.pairedRunnableIndex));
    });
  } else if (block.tag.startsWith("output:help:")) {
    test(`${label}: the ${block.tag.slice("output:help:".length)} help excerpt is verbatim in tmct --help`, () => {
      assertHelpExcerpt(block);
    });
  } else if (block.tag === "toml") {
    test(`${label}: the tmct.toml reference loads through the config loader`, async () => {
      await validateTomlBlock(block);
    });
  }
}
