// Runs the README's heavy (e2e-marked) example blocks: fresh-repo corpus
// imports and puzzle solves that are too slow for the fast tier. Same
// extractor and assertions as test/readme/readme.test.mjs.
import test from "node:test";
import { extractReadmeBlocks } from "../test/readme/extract.mjs";
import { README_PATH, runBashBlock, runJsBlock, runSessionBlock } from "../test/readme/harness.mjs";

const runners = { bash: runBashBlock, js: runJsBlock, session: runSessionBlock };

for (const block of extractReadmeBlocks(README_PATH)) {
  if (!block.attrs.e2e || block.attrs.skip) continue;
  test(`README line ${block.startLine}: the heavy ${block.tag} example runs clean end to end`, () => {
    runners[block.tag](block);
  });
}
