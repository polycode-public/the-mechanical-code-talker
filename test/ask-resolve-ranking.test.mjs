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
import { buildEntities } from "../src/graph-build.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { resolveObject, ask } from "../src/ask.mjs";

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

// ---- Part 6 negative regression (extension-pack batch, bias-weighted ranking) ----
// src/memory/bias.mjs's rankByBiasThenTrust is EXPLICITLY scoped to the memory
// Fact-listing lanes in chat.mjs — never to ask.mjs's resolveObjectCore (a
// different resolution layer entirely: code-graph ENTITY disambiguation, no
// provenance/bundle tag available at this point, and the operator's own
// "class" worked example was never a code-entity disambiguation case). This
// pins that resolveObjectCore still REFUSES on a genuine tie (the "index" case
// above) with zero bias-related behaviour change — cheap insurance against
// future scope creep into this resolver.
// ---- entry-point disambiguation ranking ("where is the main entry point
// defined"): the object names a ROLE, not a label, so resolveObject can only
// miss it. A closed basename vocabulary (index/main/app/server/cli/__main__)
// stands in for the role, ranked query-named basename > root proximity >
// non-fixture path, with the ranking disclosed — never one silent winner. ----

test("entry-point ranking on the large-scale graph: both vendored index.js roots surface, ranked and disclosed", () => {
  const r = ask(graph, "where is the main entry point defined");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(
    r.content,
    "ranked 2 entry-point matches; top: js-commander/index.js — also matched: js-express/index.js.",
  );
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label),
    ["js-commander/index.js", "js-express/index.js"]);
});

test("entry-point ranking: 'where is the entry point defined' (no 'main' word) ranks identically here", () => {
  const r = ask(graph, "where is the entry point defined");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /^ranked 2 entry-point matches; top: js-commander\/index\.js/);
});

const RANK_MODULES = [
  { path: "index.mjs", dotted: "index", imports: [], calls: [], defines: [] },
  { path: "src/main.mjs", dotted: "src.main", imports: [], calls: [], defines: [] },
  { path: "src/deep/nested/app.mjs", dotted: "src.deep.nested.app", imports: [], calls: [], defines: [] },
  { path: "test/fixtures/main.mjs", dotted: "test.fixtures.main", imports: [], calls: [], defines: [] },
  { path: "src/handlers/tasks.mjs", dotted: "src.handlers.tasks", imports: [], calls: [],
    defines: [{ name: "TaskController", kind: "class", lineno: 1, decorators: [] }] },
];

function rankGraph(modules) {
  const entities = buildEntities(modules, [], {});
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}

test("entry-point ranking order: a query-named basename ('main') beats root proximity, which beats a test-fixture path", () => {
  const g = rankGraph(RANK_MODULES);
  const r = ask(g, "where is the main entry point defined");
  assert.equal(r.tmct_ask.miss, false);
  // "main" is named in the query, so src/main.mjs outranks the shallower
  // index.mjs; the test/fixtures sibling ranks below the non-fixture main.
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label), [
    "src/main.mjs", "test/fixtures/main.mjs", "index.mjs", "src/deep/nested/app.mjs",
  ]);
  assert.match(r.content, /^ranked 4 entry-point matches; top: src\/main\.mjs — also matched: /);
});

test("entry-point ranking order: with no query-named basename, root proximity leads and every match is still disclosed", () => {
  const g = rankGraph(RANK_MODULES);
  const r = ask(g, "where is the entry point defined");
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label), [
    "index.mjs", "src/main.mjs", "test/fixtures/main.mjs", "src/deep/nested/app.mjs",
  ]);
  assert.equal(
    r.content,
    "ranked 4 entry-point matches; top: index.mjs — also matched: src/main.mjs, test/fixtures/main.mjs and src/deep/nested/app.mjs.",
  );
});

test("entry-point honest-miss control: a graph with no entry-point basenames declines and names the closed set", () => {
  const g = rankGraph([RANK_MODULES[4]]);
  const r = ask(g, "where is the main entry point defined");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /^no entry-point module found in the index — no module basename matches index, main, app, server, cli and __main__\./);
});

test("entry-point recognizer stays closed: 'where is main defined' (no 'entry point') keeps ordinary resolution", () => {
  const g = rankGraph(RANK_MODULES);
  const r = ask(g, "where is main defined");
  assert.doesNotMatch(r.content, /^ranked /, "a bare 'main' is an ordinary term, not the entry-point role");
});

test("Part 6 regression: resolveObjectCore is UNTOUCHED by bias-weighted ranking — a genuine tie still refuses (ambiguous:true), no bias import anywhere in ask.mjs", async () => {
  const r = resolveObject(graph, "index", { expectedClass: "Module" });
  assert.equal(r.ambiguous, true, "the genuine tie still refuses to silently pick a winner");
  assert.ok(r.candidates.length >= 1, "the tie still surfaces real candidates, never a fabricated single match");
  const { readFileSync: rfs } = await import("node:fs");
  const askSrc = rfs(new URL("../src/ask.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(askSrc, /memory\/bias\.mjs/, "ask.mjs never imports the bias module");
  assert.doesNotMatch(askSrc, /rankByBiasThenTrust/, "resolveObjectCore's own ranking is untouched by Part 6");
});
