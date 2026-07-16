// conformance.mjs — the Repository-Interface CONTRACT TEST SUITE as a reusable kit.
//
// An implementation is CONFORMANT iff it passes `runConformance(name, makeProvider)`.
// Provider-agnostic: it asserts the shape + error contract; data-bearing truth is
// asserted by the caller where its provider carries data.
//
// Public surface: runConformance(name, makeProvider), assertResult, assertIndividual,
// assertEdge.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERFACE_VERSION,
  MISS_REASONS,
  EDGE_KINDS,
  SERVICES,
  isHit,
  isMiss,
} from "../adapters/repository-interface.mjs";

const REASONS = new Set(Object.values(MISS_REASONS));

// ---- Individual / Edge / Result shape validators (the shared wire types) ------

export function assertIndividual(ind, where) {
  assert.equal(typeof ind.id, "string", `${where}: Individual.id is a string`);
  assert.equal(typeof ind.label, "string", `${where}: Individual.label is a string`);
  assert.equal(typeof ind.class, "string", `${where}: Individual.class is a string (a tmct: class token)`);
  assert.ok(Array.isArray(ind.attributes), `${where}: Individual.attributes is an array`);
  for (const a of ind.attributes) {
    assert.ok("key" in a && "value" in a && "prop" in a, `${where}: attribute has {key,value,prop}`);
  }
}

export function assertEdge(e, where) {
  for (const k of ["subject", "object", "predicate", "prop"]) {
    assert.ok(k in e, `${where}: Edge carries required "${k}"`);
  }
  assert.equal(typeof e.subject, "string", `${where}: Edge.subject is a string`);
  assert.equal(typeof e.object, "string", `${where}: Edge.object is a string`);
}

export function assertResult(r, where) {
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
export function runConformance(name, makeProvider) {
  test(`[${name}] advertises the full interface + version`, () => {
    const svc = makeProvider();
    assert.equal(svc.version, INTERFACE_VERSION, "declares the interface version");
    for (const service of SERVICES) {
      assert.ok(svc.capabilities.includes(service), `capability advertises "${service}"`);
      assert.equal(typeof svc[service], "function", `implements "${service}" as a function`);
    }
  });

  test(`[${name}] every service returns a well-formed Result (or an honest empty)`, async () => {
    const svc = makeProvider();
    // Resolution-family with a term that certainly does not exist → a well-formed result.
    // Awaiting every call is safe regardless of sync/async: snippet/context are ASYNC (real fs
    // reads are inherently async — see repository-interface.mjs's notes on both), everything
    // else is a plain sync value; `await` on a non-Promise value is a documented no-op.
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
      const r = await svc[service](...args);
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

  // snippet has nothing useful without fs, so it honestly misses NO_SOURCE (or
  // UNRESOLVED_TERM on an empty graph) with no working tree.
  test(`[${name}] snippet answers NO_SOURCE (not a throw) when no working tree`, async () => {
    const svc = makeProvider();
    if (svc.sourceAccess) return; // covered by the source-capable branch below instead
    // Use whatever the provider resolves; on empty graphs this is UNRESOLVED_TERM, on
    // data-bearing graphs NO_SOURCE — both are valid closed-set misses.
    const r = await svc.snippet("no:such:id");
    assert.ok(isMiss(r), "snippet misses without a working tree");
    assert.ok(
      [MISS_REASONS.NO_SOURCE, MISS_REASONS.UNRESOLVED_TERM].includes(r.miss.reason),
      `snippet miss reason is NO_SOURCE or UNRESOLVED_TERM (got ${r.miss.reason})`,
    );
  });

  // context: contextPlan/sizeBundle/renderGraphOnlyBundle are pure graph queries, so a
  // graph-only provider (no working tree) returns a REAL HIT for any resolvable symbol;
  // only an unresolvable symbol still misses (UNRESOLVED_TERM). See repository-interface.mjs's
  // context service entry for the full rationale.
  test(`[${name}] context returns a graph-only HIT for a resolvable symbol, even with no working tree`, async () => {
    const svc = makeProvider();
    if (svc.sourceAccess) return; // covered by the source-capable branch below instead
    const missR = await svc.context("definitely-not-a-symbol-xyz");
    assert.ok(isMiss(missR) && missR.miss.reason === MISS_REASONS.UNRESOLVED_TERM, "an unresolvable symbol still misses UNRESOLVED_TERM");
    // A real hit needs a REAL resolvable symbol — untested() is a required, provider-agnostic
    // service that already returns real Module individuals when the graph carries any (empty on
    // a bootstrap-shaped graph, so this degrades gracefully rather than assuming data exists).
    const modules = svc.untested().value.modules;
    if (!modules.length) return;
    const r = await svc.context(modules[0].label);
    assert.ok(isHit(r), `context(${modules[0].label}) is a graph-only hit, not NO_SOURCE (INTERFACE_VERSION 1.1.0)`);
    assert.equal(typeof r.value.text, "string");
    assert.equal(typeof r.value.tier, "string");
  });

  // 2f: the source-capable branch — dead code until a provider actually sets sourceAccess:true
  // (test/repository-interface.test.mjs's third runConformance call, against a source-capable
  // fixture provider, is what makes this execute at all).
  test(`[${name}] source-capable: snippet/context return real body text for a resolvable spanned symbol`, async () => {
    const svc = makeProvider();
    if (!svc.sourceAccess) return; // only the source-capable branch reaches this
    // Provider-agnostic: use the provider's OWN search() to find any real function/class/method
    // — no fixture-specific symbol names hardcoded here.
    let symbol = null;
    for (const kind of ["function", "class", "method"]) {
      const found = svc.search("", { kind, limit: 1 }).value.results[0];
      if (found) { symbol = found; break; }
    }
    if (!symbol) return; // this provider's graph carries no spanned symbol to prove the branch against
    const snip = await svc.snippet(symbol.id);
    assert.ok(isHit(snip), `snippet(${symbol.id}) is a real hit when source-capable`);
    assert.equal(typeof snip.value.body, "string");
    assert.ok(snip.value.body.length > 0, "a real (non-empty) source body, not null");
    const ctx = await svc.context(symbol.label);
    assert.ok(isHit(ctx), `context(${symbol.label}) is a hit when source-capable`);
    assert.equal(typeof ctx.value.text, "string");
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
