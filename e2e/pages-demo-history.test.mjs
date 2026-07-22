// The home page's demo box scripts an opening exchange: five question/answer
// pairs it types out before handing the reader the prompt. They are shown as
// what tmct said, so they must be what tmct says. This replays them through the
// real engine against the graph the page ships, and asserts each answer word for
// word.
//
// The pairs are read out of the module's source rather than imported: demo-ui.mjs
// reaches for `document` as it loads, so it only runs in a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/services/chat.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { repoRoot } from "../test/readme/harness.mjs";

const DEMO_UI = join(repoRoot, "public", "demo-ui.mjs");

// The graph is generated into a private temp file rather than read from
// public/: this file must pass on a fresh checkout, whatever else ran first.
const DEMO_GRAPH = join(mkdtempSync(join(tmpdir(), "tmct-demo-graph-")), "demo-graph.json");
execFileSync("node", [join(repoRoot, "scripts", "build-demo-graph.mjs"), DEMO_GRAPH], { encoding: "utf8" });

// runTurn returns the answer with the CLI's trailer ("Goal (inferred): …",
// "Canonical: …") appended. The demo box renders the answer text alone, so the
// comparison is against the same part a reader sees.
const answerText = (turn) => turn.answer.split("\n\nGoal (inferred):")[0].trimEnd();

/** The scripted turns, read off `const HISTORY = [...]` in the demo's source. */
function readScriptedTurns() {
  const source = readFileSync(DEMO_UI, "utf8");
  const block = /const HISTORY = \[([\s\S]*?)\n\];/.exec(source);
  assert.ok(block, "demo-ui.mjs declares a HISTORY array of scripted turns");
  const turns = [...block[1].matchAll(/\{ q: (".*?"), a: (".*?") \},/g)].map(([, q, a]) => ({
    q: JSON.parse(q),
    a: JSON.parse(a),
  }));
  assert.ok(turns.length > 0, "the HISTORY array parses into scripted turns");
  return turns;
}

test("every answer the demo box types out is the answer the engine gives", async () => {
  const graph = parseEntities(JSON.parse(readFileSync(DEMO_GRAPH, "utf8")));
  const config = { graphFile: DEMO_GRAPH };
  let focus = null;
  let last = null;
  for (const { q, a } of readScriptedTurns()) {
    const result = await runTurn(q, { config, graph, focus, last });
    assert.equal(answerText(result), a, `the demo box's scripted answer to "${q}" is what the engine returns`);
    last = result;
    if (result.focus) focus = result.focus;
  }
});

test("the pronoun turns resolve against the standing focus rather than missing", async () => {
  const graph = parseEntities(JSON.parse(readFileSync(DEMO_GRAPH, "utf8")));
  const config = { graphFile: DEMO_GRAPH };
  let focus = null;
  let last = null;
  for (const { q } of readScriptedTurns()) {
    const result = await runTurn(q, { config, graph, focus, last });
    // The exchange's whole point is that "it" keeps meaning Task across turns.
    // A miss here still renders on the page as though tmct had answered.
    assert.doesNotMatch(answerText(result), /needs a selected node to refer to/, `"${q}" resolves its pronoun`);
    last = result;
    if (result.focus) focus = result.focus;
  }
});
