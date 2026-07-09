// ask-resolve-ranking.test.mjs — reproduces (and locks the fix for) a disambiguation-
// candidate-ranking bug seonix found dogfooding tmct at real scale (27,929 modules):
// resolveObject's tier-3 scoring (src/ask.mjs) ranked a genuine EXACT basename match
// ("verify-shipped" -> scripts/verify-shipped.mjs) BELOW sibling files that merely
// shared a component ("verify-*.mjs") — the sibling candidates outranked the file that
// was literally named after the term. This never reproduced on tmct's own tiny
// examples/mini-webapp / examples/polyglot fixtures (too few same-directory siblings to
// collide), so this test drives against test/fixtures/large-scale/ — a committed,
// pre-built graph over real vendored source (commander.js + express.js, 14 modules
// across two "repos") with exactly this multi-sibling shape.
//
// The fix (src/ask.mjs, resolveObject's undotted/unslashed tier-3 branch): a new
// basename-exact/prefix/suffix check runs BEFORE the raw-containment/overlap passes,
// scoring an exact stem match at 5000, a prefix/suffix stem match at ~4000, strictly
// above the (now length-normalized) overlap tier — so a clean exact/prefix/suffix hit
// can never be beaten by a same-directory sibling that only shares a component.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { resolveObject } from "../src/ask.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/large-scale/.tmct/graph.json", import.meta.url));
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
  // both index.js files are equally exact basename matches (tier score 5000 each) —
  // a real tie, never a silently-picked "wrong" single winner.
  const allLabels = [r.match?.label, ...r.candidates.map((c) => c.label)].sort();
  assert.deepEqual(allLabels, ["js-commander/index.js", "js-express/index.js"]);
  // the winner (and every candidate) must be one of the two genuine exact matches —
  // never some unrelated partial-overlap sibling outranking (or crowding out) them.
  assert.ok(["js-commander/index.js", "js-express/index.js"].includes(r.match?.label));
});

test("cross-'repo' case: an exact basename match in js-express ('request') isn't beaten or joined by an unrelated js-commander candidate", () => {
  const r = resolveObject(graph, "request", { expectedClass: "Module" });
  assert.equal(r.match?.label, "js-express/lib/request.js");
  assert.equal(r.ambiguous, false);
  assert.deepEqual(r.candidates, []);
  // no js-commander module should ever surface as a candidate for a term that only
  // matches a js-express file's exact basename.
  assert.ok(!r.candidates.some((c) => c.label.startsWith("js-commander/")));
});

test("cross-'repo' case: an exact basename match in js-commander ('argument') isn't beaten or joined by an unrelated js-express candidate", () => {
  const r = resolveObject(graph, "argument", { expectedClass: "Module" });
  assert.equal(r.match?.label, "js-commander/lib/argument.js");
  assert.equal(r.ambiguous, false);
  assert.deepEqual(r.candidates, []);
  assert.ok(!r.candidates.some((c) => c.label.startsWith("js-express/")));
});
