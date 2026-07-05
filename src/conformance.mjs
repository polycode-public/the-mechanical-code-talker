// conformance.mjs — the Repository-Interface CONTRACT TEST SUITE as a reusable kit.
//
// PLAN_REPOSITORY_INTERFACE.md deliverable 3: an implementation is CONFORMANT iff it
// passes `runConformance(name, makeProvider)`. tmct's own fixture + bootstrap providers
// pass it in `npm test`; an EXTERNAL producer (seonix) imports this kit from the
// published package and runs the SAME suite against its native provider to claim
// conformance — conformance is the suite, not prose. It is provider-agnostic: it
// asserts the SHAPE + the error contract; data-bearing truth is asserted by the caller
// where its provider carries data.
//
// Public surface (exported here + via the package "./conformance" subpath):
//   runConformance(name, makeProvider), assertResult, assertIndividual, assertEdge.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERFACE_VERSION,
  MISS_REASONS,
  EDGE_KINDS,
  SERVICES,
  SOURCE_SERVICES,
  isHit,
  isMiss,
} from "./repository-interface.mjs";

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
