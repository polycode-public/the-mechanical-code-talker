// The Repository-Interface CONTRACT TEST SUITE — the compatibility kit.
// archive/PLAN_REPOSITORY_INTERFACE.md deliverable 3: "a runnable suite any implementation
// is tested against. Conformance = passing the suite, not matching prose."
//
// tmct's two reference providers (fixture, bootstrap) PASS it here in npm test.
// An external producer (seonix) runs the SAME `runConformance(makeProvider, …)`
// against its native implementation to claim conformance. Keep it provider-
// agnostic: the shared block asserts SHAPE + the error contract; the data-bearing
// block asserts real truth only where the provider carries data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  REPOSITORY_INTERFACE,
  INTERFACE_VERSION,
  MISS_REASONS,
  EDGE_KINDS,
  SERVICES,
  SOURCE_SERVICES,
  isHit,
  isMiss,
  hit,
  miss,
  invoke,
  toIndividual,
  toEdge,
} from "../src/repository-interface.mjs";
import { fixtureProvider } from "../src/providers/fixture.mjs";
import { bootstrapProvider } from "../src/providers/bootstrap.mjs";
import { runConformance, assertIndividual, assertEdge, assertResult } from "../src/conformance.mjs";

const REASONS = new Set(Object.values(MISS_REASONS));

// ---- run the kit against BOTH reference providers ----------------------------
runConformance("fixture", fixtureProvider);
runConformance("bootstrap", bootstrapProvider);

// =============================================================================
// Interface-definition invariants (the versioned shape + no doc drift)
// =============================================================================
test("machine shape: docs/repository-interface.schema.json matches the source const (no drift)", () => {
  const onDisk = JSON.parse(
    readFileSync(fileURLToPath(new URL("../docs/repository-interface.schema.json", import.meta.url)), "utf8"),
  );
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(REPOSITORY_INTERFACE)), "schema.json is a stale serialization of REPOSITORY_INTERFACE — regenerate it");
});

test("machine shape enumerates exactly the implemented services, each grounded", () => {
  assert.deepEqual(Object.keys(REPOSITORY_INTERFACE.services).sort(), [...SERVICES].sort());
  for (const [svcName, spec] of Object.entries(REPOSITORY_INTERFACE.services)) {
    assert.ok(spec.purpose && spec.purpose.length > 10, `${svcName} has a purpose`);
    assert.ok("args" in spec && "result" in spec, `${svcName} declares args + result`);
    for (const r of spec.misses || []) assert.ok(REASONS.has(r), `${svcName} miss "${r}" is in the closed set`);
  }
  assert.equal(REPOSITORY_INTERFACE.version, INTERFACE_VERSION);
  assert.equal(REPOSITORY_INTERFACE.ontology, "urn:tmct:core");
});

test("miss() rejects a reason outside the closed set", () => {
  assert.throws(() => miss("NOT_A_REASON"), TypeError);
  const m = miss(MISS_REASONS.NO_SOURCE, { detail: "x", term: "t" });
  assert.equal(m.ok, false);
  assert.equal(m.miss.reason, "NO_SOURCE");
});

test("hit() / toIndividual / toEdge produce the documented shapes", () => {
  assert.deepEqual(hit(42), { ok: true, value: 42 });
  const ind = toIndividual({ id: "x", label: "X", class: "Module", attributes: [{ key: "k", value: "v", prop: "mgx:p" }] });
  assertIndividual(ind, "toIndividual");
  assert.equal(toIndividual(null), null);
  const e = toEdge({ subject: "a", object: "b", subjectLabel: "A", weight: 3 }, { predicate: "imports", prop: "mgx:importsNamespace" });
  assertEdge(e, "toEdge");
  assert.equal(e.predicate, "imports");
  assert.equal(e.weight, 3);
});

// =============================================================================
// Capability negotiation — CAPABILITY_ABSENT is a value, not a wall
// =============================================================================
test("invoke() degrades an absent capability to miss(CAPABILITY_ABSENT), never throws", () => {
  const partial = { capabilities: ["resolve"], resolve: () => hit("here") };
  const absent = invoke(partial, "impact", "x");
  assert.ok(isMiss(absent) && absent.miss.reason === MISS_REASONS.CAPABILITY_ABSENT);
  assert.deepEqual(invoke(partial, "resolve", "x"), hit("here"));
  // A full reference provider trips CAPABILITY_ABSENT for nothing in SERVICES.
  const svc = fixtureProvider();
  const argsFor = (service) => {
    if (service === "edges") return ["no:id", EDGE_KINDS[0]];
    if (service === "architecture" || service === "untested" || service === "stats") return [{}];
    if (service === "search") return ["x", {}];
    if (service === "context") return ["x"];
    return ["no:id"];
  };
  for (const service of SERVICES) {
    const r = invoke(svc, service, ...argsFor(service));
    assert.ok(r && (r.ok === true || REASONS.has(r.miss.reason)), `${service} negotiates to a real Result`);
    if (isMiss(r)) assert.notEqual(r.miss.reason, MISS_REASONS.CAPABILITY_ABSENT, `${service} is implemented, not absent`);
  }
});

// =============================================================================
// Data-bearing conformance — real graph truth (fixture only)
// =============================================================================
test("[fixture] resolve → describe → members/subclasses/edges chain over real truth", () => {
  const svc = fixtureProvider();
  const r = svc.resolve("widget.mjs");
  assert.ok(isHit(r), "resolves a real module");
  assertIndividual(r.value.match, "fixture.resolve.match");
  const id = r.value.match.id;

  const d = svc.describe(id);
  assert.ok(isHit(d) && d.value.out.length > 0, "describe carries outgoing edges");
  for (const e of [...d.value.out, ...d.value.incoming]) assertEdge(e, "fixture.describe.edge");

  const members = svc.members("cls:widget");
  assert.ok(isHit(members));
  assert.deepEqual(members.value.methods.map((m) => m.id), ["m:render"]);

  const subs = svc.subclasses("cls:base");
  assert.ok(isHit(subs));
  assert.deepEqual(subs.value.subclasses.map((s) => s.label).sort(), ["Button", "Widget"]);

  const edges = svc.edges(id, "imports");
  assert.ok(isHit(edges) && edges.value.edges.length === 1);
  assertEdge(edges.value.edges[0], "fixture.edges");
});

test("[fixture] traversal + aggregates + history return real numbers", () => {
  const svc = fixtureProvider();
  assert.ok(svc.impact("mod:graph.mjs").value.total >= 2, "impact closure has dependents");
  assert.equal(svc.stats().value.total, 14);
  assert.ok(svc.untested().value.modules.some((m) => m.label === "pkg/core/graph.mjs"));
  const sig = svc.signature("m:render").value;
  assert.equal(sig.returns, "str");
  assert.equal(sig.raises, "ValueError");
  const commits = svc.history("m:render").value.commits;
  assert.equal(commits.length, 1);
  assert.equal(commits[0].author, "Grace Hopper");
});

test("[fixture] snippet/context are source-reaching → honest NO_SOURCE (span in detail)", () => {
  const svc = fixtureProvider();
  const snip = svc.snippet("m:render");
  assert.ok(isMiss(snip) && snip.miss.reason === MISS_REASONS.NO_SOURCE);
  assert.match(snip.miss.detail, /widget\.mjs/); // the span is still communicated honestly
  assert.ok(isMiss(svc.context("Widget")) && svc.context("Widget").miss.reason === MISS_REASONS.NO_SOURCE);
});

test("[fixture] search is provider-local lexical; ask returns the NL envelope", () => {
  const svc = fixtureProvider();
  const classes = svc.search("", { kind: "class" }).value.results;
  assert.deepEqual(classes.map((c) => c.label).sort(), ["Base", "Button", "Widget"]);
  const a = svc.ask("which modules import graph.mjs");
  assert.ok(isHit(a) && typeof a.value.content === "string" && a.value.tmct_ask);
});

// =============================================================================
// 2a/2b/2c: search() is REALLY ranked (not a flat substring filter), edges()/
// impact() take optional pagination/depth args, additive and backward-compatible.
// =============================================================================
test("[fixture] search(): module-mode is ranked (path/symbol/import-proximity), not flat filter order", () => {
  const svc = fixtureProvider();
  const labels = svc.search("widget").value.results.map((r) => r.label);
  // widget.mjs itself outranks its own test module (path match beats a looser one) — the OLD flat
  // filter had no ranking at all, so this ordering is only guaranteed by the new scored search.
  assert.deepEqual(labels, ["pkg/ui/widget.mjs", "pkg/test/widget.test.mjs"]);
});

test("[fixture] search(): symbol-mode honours name (regex) + decorator filters, module-mode does not", () => {
  const svc = fixtureProvider();
  const named = svc.search("", { kind: "class", name: "^W" }).value.results;
  assert.deepEqual(named.map((c) => c.label), ["Widget"]);
  const decorated = svc.search("", { kind: "method", decorator: "property" }).value.results;
  assert.deepEqual(decorated.map((m) => m.label), ["Widget.render"]);
  // module mode: a name filter that would exclude everything if it applied here is simply ignored
  // (renderSearch's module branch never supported name/decorator either — no new semantic invented).
  const modules = svc.search("widget", { name: "definitely-does-not-match-anything" }).value.results;
  assert.ok(modules.length > 0, "module-mode search ignores the name filter, unlike symbol-mode");
});

test("[fixture] search(): limit/offset paginate the full ranked array", () => {
  const svc = fixtureProvider();
  const all = svc.search("", { kind: "class" }).value.results;
  assert.equal(all.length, 3);
  const page1 = svc.search("", { kind: "class", limit: 2 }).value.results;
  const page2 = svc.search("", { kind: "class", limit: 2, offset: 2 }).value.results;
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 1);
  assert.deepEqual([...page1, ...page2].map((c) => c.id), all.map((c) => c.id));
});

test("[fixture] edges(): optional { limit, offset } paginate; omitted limit is unchanged full-list behavior", () => {
  const svc = fixtureProvider();
  const full = svc.edges("mod:widget.mjs", "defines").value.edges;
  assert.equal(full.length, 2, "widget.mjs defines Widget + register");
  const first = svc.edges("mod:widget.mjs", "defines", { limit: 1 }).value.edges;
  const second = svc.edges("mod:widget.mjs", "defines", { limit: 1, offset: 1 }).value.edges;
  assert.deepEqual(first, [full[0]]);
  assert.deepEqual(second, [full[1]]);
  // omitted limit (no opts arg at all) stays byte-identical to the pre-pagination call.
  assert.deepEqual(svc.edges("mod:widget.mjs", "defines"), { ok: true, value: { kind: "defines", edges: full } });
});

test("[fixture] impact(): optional { maxDepth } threads straight into impactClosure", () => {
  const svc = fixtureProvider();
  const full = svc.impact("mod:graph.mjs").value;
  assert.equal(full.levels.length, 2, "button.mjs is a depth-2 dependent via widget.mjs");
  const shallow = svc.impact("mod:graph.mjs", { maxDepth: 1 }).value;
  assert.equal(shallow.levels.length, 1, "maxDepth:1 stops before the depth-2 dependent");
  assert.ok(shallow.total < full.total);
});

// =============================================================================
// Bootstrap conformance — the provider with no data still conforms (honest empties)
// =============================================================================
test("[bootstrap] every id-taking service misses UNRESOLVED_TERM; aggregates are empty hits", () => {
  const svc = bootstrapProvider();
  assert.ok(isMiss(svc.resolve("anything")) && svc.resolve("anything").miss.reason === MISS_REASONS.UNRESOLVED_TERM);
  assert.deepEqual(svc.stats().value, { total: 0, classes: [], truncated: false });
  assert.deepEqual(svc.untested().value, { modules: [] });
  assert.deepEqual(svc.architecture({}).value, { modules: 0, packages: [], hubs: [] });
  assert.deepEqual(svc.search("x", {}).value, { results: [] });
});
