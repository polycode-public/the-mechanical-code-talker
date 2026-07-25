// Runs the README's e2e-marked example blocks: fresh-repo corpus imports and
// puzzle solves that are too slow for the fast tier (test/readme/readme.test.mjs
// covers everything else). Two of them (README lines ~145 and ~872) run a full
// site build or a full persona-size-large corpus chain and cost minutes each;
// those only run with TMCT_CHECK_README=1 set, which `npm run check:readme`
// does — run it locally after changing the CLI surface, the library's public
// exports, or a flow a README example walks through. The rest stay in every
// per-push run.
import test from "node:test";
import { extractReadmeBlocks } from "../test/readme/extract.mjs";
import { README_PATH, runBashBlock, runJsBlock, runSessionBlock } from "../test/readme/harness.mjs";

const runners = { bash: runBashBlock, js: runJsBlock, session: runSessionBlock };
const checkHeavyExamples = process.env.TMCT_CHECK_README === "1";

for (const block of extractReadmeBlocks(README_PATH)) {
  if (!block.attrs.e2e || block.attrs.skip) continue;
  const heavy = block.attrs.heavy === true;
  test(
    `README line ${block.startLine}: the ${heavy ? "heavy " : ""}${block.tag} example runs clean end to end`,
    { skip: heavy && !checkHeavyExamples && "set TMCT_CHECK_README=1 (or run `npm run check:readme`) to run this one" },
    () => {
      runners[block.tag](block);
    },
  );
}
