// The chatbench runner scrubs the per-run-volatile fact-recall citation
// (ace:chat:<uuidv7>@<ISO stamp>) so assert-recall rows are byte-reproducible
// across identical runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runChat } from "../../src/services/chat.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { runSessionCase } from "../../chatbench/run.mjs";
import { parseSessionJsonl, parseSessionLog, turnKey } from "../../src/services/sessions.mjs";

const FIXTURE = new URL("../fixtures/entities.fixture.json", import.meta.url);

test("assert-recall rows are byte-reproducible — the ace:chat:<uuid>@<ts> citation is scrubbed", async () => {
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  ingestSchemaDocs(payload);
  const graphJson = JSON.stringify(payload);
  const caseDef = {
    id: "qw-assert-recall", tags: ["graded"], grade: "C1", construction: "assert-recall",
    mode: "session", graph: "fixture",
    turns: [
      { say: "every class is a category", session: 1, expect: { miss: false } },
      { say: "what did i tell you last time", session: 2, expect: { miss: false, answerMatch: ["category"] } },
    ],
  };
  const deps = { runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson, clearCache };
  const run1 = await runSessionCase(caseDef, deps);
  const run2 = await runSessionCase(caseDef, deps);
  const recall1 = run1.transcript[1].answer;
  const recall2 = run2.transcript[1].answer;
  assert.match(recall1, /category/, "the recall still names the asserted fact (tier-1 unaffected)");
  assert.match(recall1, /ace:chat:<session>@<ts>/, "the volatile citation is folded to the stable placeholder");
  assert.doesNotMatch(recall1, /ace:chat:[0-9a-f]{8}-/i, "no raw uuidv7 leaks into the recorded answer");
  assert.doesNotMatch(recall1, /@\d{4}-\d{2}-\d{2}T/, "no raw wall-clock stamp leaks into the recorded answer");
  assert.equal(recall1, recall2, "two identical runs record byte-identical recall answers");
});
