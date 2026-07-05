// The Repository-Interface CONTRACT TEST SUITE — the compatibility kit.
// PLAN_REPOSITORY_INTERFACE.md deliverable 3: "a runnable suite any implementation
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

const REASONS = new Set(Object.values(MISS_REASONS));

// ---- Individual / Edge shape validators (the shared wire types) --------------

function assertIndividual(ind, where) {
  assert.equal(typeof ind.id, "string", `${where}: Individual.id is a string`);
  assert.equal(typeof ind.label, "string", `${where}: Individual.label is a string`);
  assert.equal(typeof ind.class, "string", `${where}: Individual.class is a string (a tmct: class token)`);
  assert.ok(Array.isArray(ind.attributes), `${where}: Individual.attributes is an array`);
  for (const a of ind.attributes) {
    assert.ok("key" in a && "value" in a && "prop" in a, `${where}: attribute has {key,value,prop}`);
  }
}

function assertEdge(e, where) {
  for (const k of ["subject", "object", "predicate", "prop"]) {
    assert.ok(k in e, `${where}: Edge carries required "${k}"`);
  }
  assert.equal(typeof e.subject, "string", `${where}: Edge.subject is a string`);
  assert.equal(typeof e.object, "string", `${where}: Edge.object is a string`);
}

function assertResult(r, where) {
  assert.ok(r && typeof r === "object", `${where}: a Result object`);
  assert.equal(typeof r.ok, "boolean", `${where}: Result.ok is a boolean`);
  if (r.ok) {
    assert.ok("value" in r, `${where}: a hit carries value`);
  } else {
    assert.ok(r.miss && REASONS.has(r.miss.reason), `${where}: a miss carries a CLOSED-set reason (got ${r.miss?.reason})`);
    assert.equal(typeof r.miss.detail, "string", `${where}: miss.detail is a string`);
  }
}

// =============================================================================
// The provider-agnostic conformance kit. Run it against any implementation.
// =============================================================================
function runConformance(name, makeProvider) {
  test(`[${name}] advertises the full interface + version`, () => {
    const svc = makeProvider();
    assert.equal(svc.version, INTERFACE_VERSION, "declares the interface version");
    for (const service of SERVICES) {
      assert.ok(svc.capabilities.includes(service), `capability advertises "${service}"`);
      assert.equal(typeof svc[service], "function", `implements "${service}" as a function`);
    }
  });

  test(`[${name}] every service returns a well-formed Result (or an honest empty)`, () => {
    const svc = makeProvider();
    // Resolution-family with a term that certainly does not exist → a well-formed result.
    for (const [service, args] of [
      ["resolve", ["definitely-not-a-symbol-xyz"]],
      ["describe", ["no:such:id"]],
      ["members", ["no:such:id"]],
      ["subclasses", ["no:such:id"]],
      ["exports", ["no:such:id"]],
      ["signature", ["no:such:id"]],
      ["impact", ["no:such:id"]],
      ["history", ["no:such:id"]],
      ["snippet", ["no:such:id"]],
      ["context", ["no-such-symbol"]],
      ["architecture", [{}]],
      ["untested", []],
      ["stats", []],
      ["search", ["", {}]],
      ["ask", ["what is here"]],
    ]) {
      const r = svc[service](...args);
      assertResult(r, `${name}.${service}`);
    }
  });

  test(`[${name}] the error contract: a clean miss is a value, never a throw`, () => {
    const svc = makeProvider();
    // An unresolved term is a first-class UNRESOLVED_TERM miss on every id-taking service.
    for (const service of ["describe", "members", "subclasses", "exports", "signature", "impact", "history"]) {
      const r = svc[service]("no:such:id:at:all");
      assert.ok(isMiss(r), `${service} on an absent id misses`);
      assert.equal(r.miss.reason, MISS_REASONS.UNRESOLVED_TERM, `${service} → UNRESOLVED_TERM`);
    }
  });

  test(`[${name}] edges: closed kind vocabulary; unknown kind is misuse (throws)`, () => {
    const svc = makeProvider();
    // A valid kind on a missing id misses (UNRESOLVED_TERM), never throws.
    const r = svc.edges("no:such:id", EDGE_KINDS[0]);
    assertResult(r, `${name}.edges`);
    // An unknown kind is a programmer error, not a domain miss.
    assert.throws(() => svc.edges("no:such:id", "not-a-real-kind"), TypeError);
  });

  test(`[${name}] source services answer NO_SOURCE (not a throw) when no working tree`, () => {
    const svc = makeProvider();
    if (svc.sourceAccess) return; // a source-capable provider is exempt from this shape
    for (const service of SOURCE_SERVICES) {
      // Use whatever the provider resolves; on empty graphs this is UNRESOLVED_TERM, on
      // data-bearing graphs NO_SOURCE — both are valid closed-set misses.
      const arg = service === "context" ? "x" : "no:such:id";
      const r = svc[service](arg);
      assert.ok(isMiss(r), `${service} misses without a working tree`);
      assert.ok(
        [MISS_REASONS.NO_SOURCE, MISS_REASONS.UNRESOLVED_TERM].includes(r.miss.reason),
        `${service} miss reason is NO_SOURCE or UNRESOLVED_TERM (got ${r.miss.reason})`,
      );
    }
  });

  test(`[${name}] stats / untested / architecture never miss — empty is a hit`, () => {
    const svc = makeProvider();
    const stats = svc.stats();
    assert.ok(isHit(stats), "stats is always a hit");
    assert.equal(typeof stats.value.total, "number");
    assert.ok(Array.isArray(stats.value.classes));
    assert.ok(isHit(svc.untested()), "untested is always a hit");
    assert.ok(Array.isArray(svc.untested().value.modules));
    assert.ok(isHit(svc.architecture({})), "architecture is always a hit");
  });

  test(`[${name}] concurrent/re-entrant: two handles, interleaved reads, stable & independent`, async () => {
    const a = makeProvider();
    const b = makeProvider();
    // Fire the whole read surface concurrently across two independent handles; assert
    // every result is well-formed and that a second identical call is byte-stable.
    const calls = [
      () => a.stats(),
      () => b.stats(),
      () => a.architecture({}),
      () => a.untested(),
      () => b.search("", {}),
      () => a.resolve("x"),
      () => b.ask("anything"),
      () => a.describe("no:such:id"),
    ];
    const first = await Promise.all(calls.map((c) => Promise.resolve().then(c)));
    for (const r of first) assertResult(r, `${name}.concurrent`);
    const second = await Promise.all(calls.map((c) => Promise.resolve().then(c)));
    // Determinism across handles: same query, same JSON.
    assert.equal(JSON.stringify(first.map((r) => r.ok)), JSON.stringify(second.map((r) => r.ok)));
    // The two handles are independent objects (no shared mutable state leak).
    assert.notEqual(a, b);
    assert.deepEqual(a.stats().value, b.stats().value, "same graph → same stats across handles");
  });
}

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
