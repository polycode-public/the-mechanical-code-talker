// resolveObject's tier-3 ranking against the committed large-scale fixture
// (test/fixtures/large-scale/): an exact basename match must beat — and never
// be joined by — same-directory or cross-tree siblings that merely share a
// path component, while a genuine equal-score tie still refuses to pick a
// silent winner. The chat-visible half of this fixture's coverage (entry-point
// role ranking) lives in the grammar corpus lane (grammar.resolve.entry-point).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { resolveObject } from "../../src/domain/ask.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/large-scale/.tmct/graph.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

const moduleLabels = graph.individuals.filter((i) => i.class === "Module").map((i) => i.label).sort();

test("sanity: the large-scale fixture graph is loaded with both vendored trees' modules present", () => {
  assert.equal(moduleLabels.length, 14);
  assert.ok(moduleLabels.includes("js-commander/lib/option.js"));
  assert.ok(moduleLabels.includes("js-commander/lib/suggestSimilar.js"));
  assert.ok(moduleLabels.includes("js-express/lib/request.js"));
});

test("exact basename beats same-directory siblings: 'option' resolves to lib/option.js alone, not a js-commander/lib/* sibling", () => {
  const r = resolveObject(graph, "option", { expectedClass: "Module" });
  assert.equal(r.match?.label, "js-commander/lib/option.js");
  assert.equal(r.ambiguous, false);
  assert.deepEqual(r.candidates, []);
});

test("exact basename beats same-directory siblings: 'suggestSimilar' resolves to lib/suggestSimilar.js alone", () => {
  const r = resolveObject(graph, "suggestSimilar", { expectedClass: "Module" });
  assert.equal(r.match?.label, "js-commander/lib/suggestSimilar.js");
  assert.equal(r.ambiguous, false);
  assert.deepEqual(r.candidates, []);
});

test("genuinely ambiguous term ('index' — both vendored trees have an index.js) still returns ambiguous:true with real candidates, exact match ranked first", () => {
  const r = resolveObject(graph, "index", { expectedClass: "Module" });
  assert.equal(r.ambiguous, true);
  // both index.js files are equally exact basename matches — a real tie, never
  // a silently-picked "wrong" single winner.
  const allLabels = [r.match?.label, ...r.candidates.map((c) => c.label)].sort();
  assert.deepEqual(allLabels, ["js-commander/index.js", "js-express/index.js"]);
  assert.ok(["js-commander/index.js", "js-express/index.js"].includes(r.match?.label));
});

test("cross-'repo' case: an exact basename match in js-express ('request') isn't beaten or joined by an unrelated js-commander candidate", () => {
  const r = resolveObject(graph, "request", { expectedClass: "Module" });
  assert.equal(r.match?.label, "js-express/lib/request.js");
  assert.equal(r.ambiguous, false);
  assert.deepEqual(r.candidates, []);
  assert.ok(!r.candidates.some((c) => c.label.startsWith("js-commander/")));
});

test("cross-'repo' case: an exact basename match in js-commander ('argument') isn't beaten or joined by an unrelated js-express candidate", () => {
  const r = resolveObject(graph, "argument", { expectedClass: "Module" });
  assert.equal(r.match?.label, "js-commander/lib/argument.js");
  assert.equal(r.ambiguous, false);
  assert.deepEqual(r.candidates, []);
  assert.ok(!r.candidates.some((c) => c.label.startsWith("js-express/")));
});

test("resolveObjectCore stays bias-free: a genuine tie still refuses (ambiguous:true), and ask.mjs never imports the memory bias module", async () => {
  const r = resolveObject(graph, "index", { expectedClass: "Module" });
  assert.equal(r.ambiguous, true, "the genuine tie still refuses to silently pick a winner");
  assert.ok(r.candidates.length >= 1, "the tie still surfaces real candidates, never a fabricated single match");
  const { readFileSync: rfs } = await import("node:fs");
  const askSrc = rfs(new URL("../../src/domain/ask.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(askSrc, /memory\/bias\.mjs/, "ask.mjs never imports the bias module");
  assert.doesNotMatch(askSrc, /rankByBiasThenTrust/, "resolveObjectCore's own ranking is untouched by bias weighting");
});
