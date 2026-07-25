// The home page's demo box picks a question by filling a template with a random
// substitution, so every pair the sets can produce is a question a reader might
// be shown. The sets are pruned to entries that resolve; this asks all of them
// against the graph the page ships and fails on any that misses.
//
// The demo picks at random, so an untested pair is a miss waiting for the reader
// who happens to draw it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATES } from "../public/demo-templates.mjs";
import { ask } from "../src/domain/ask.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { repoRoot } from "../test/readme/harness.mjs";

// The graph is generated into a private temp file rather than read from
// public/: this file must pass on a fresh checkout, whatever else ran first.
const DEMO_GRAPH = join(mkdtempSync(join(tmpdir(), "tmct-demo-graph-")), "demo-graph.json");
execFileSync("node", [join(repoRoot, "scripts", "build-demo-graph.mjs"), DEMO_GRAPH], { encoding: "utf8" });
const graph = parseEntities(JSON.parse(readFileSync(DEMO_GRAPH, "utf8")));

/** Every question the demo can build: each template across its substitutions. */
function everyQuestion() {
  return TEMPLATES.flatMap((template) =>
    (template.slot ?? [null]).map((slot) => ({ id: template.id, query: template.text(slot) })),
  );
}

test("every question the demo box can build answers against the graph it ships", () => {
  const missed = everyQuestion()
    .map((question) => ({ ...question, result: ask(graph, question.query, {}) }))
    .filter(({ result }) => result.tmct_ask?.miss);
  assert.deepEqual(
    missed.map(({ id, query }) => `${id}: ${query}`),
    [],
    "a template/substitution pair the demo can pick must answer, or leave the substitution set",
  );
});

test("every template contributes at least one question", () => {
  const built = new Set(everyQuestion().map(({ id }) => id));
  for (const { id } of TEMPLATES) {
    assert.ok(built.has(id), `${id} builds a question rather than sitting unreachable`);
  }
});
