// router-interface.test.mjs — FREEZE THE INTERFACE.
// The router consumes parseQuery's output shape
// {shape, kind, entityType, object} and resolveObject's {match, candidates, tier,
// ambiguous} contract. Those two are owned by the CHAT surface (src/domain/ask.mjs), not
// the router — so a future parse change could silently break routing. This test
// PINS both contracts against a committed fixture: if parseQuery's shape/kind for
// a canonical request drifts, or resolveObject's return shape changes, the router
// tests won't mysteriously fail — THIS one fails first, naming the broken seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseQuery, resolveObject } from "../../src/domain/ask.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
async function loadGraph() {
  return parseEntities(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8"))));
}

// ---- the FROZEN parseQuery contract the resolver's NL_INTENTS keys off ----------
// Each row: a request -> the {shape, kind} the resolver's NL_INTENTS table maps.
// `object` is the term the resolver hands to resolveObject. A parse change that
// alters any of these is a routing-breaking change and must be a DELIBERATE update
// here (with the matching NL_INTENTS update), never a silent drift.
const PARSE_CONTRACT = [
  { q: "which functions call fnAlpha", shape: "reverse", kind: "calls", object: "fnAlpha" },
  { q: "what does Widget.render call", shape: "forward", kind: "calls", object: "Widget.render" },
  { q: "which tests cover app/lib/b.mjs", shape: "reverse", kind: "tests" },
  { q: "which classes extend Base", shape: "reverse", kind: "inherits", object: "Base" },
  { q: "what does app/lib/b.mjs export", shape: "forward", kind: "reexports", object: "app/lib/b.mjs" },
  { q: "what does Widget contain", shape: "forward", kind: "contains", object: "Widget" },
  { q: "when did app/lib/a.mjs change", shape: "when", kind: "touches", object: "app/lib/a.mjs" },
];

test("interface: parseQuery's {shape,kind[,object]} is frozen for the resolver's NL intents", () => {
  for (const row of PARSE_CONTRACT) {
    const p = parseQuery(row.q);
    assert.ok(p && !p.node, `${JSON.stringify(row.q)} must be a simple clause (got ${JSON.stringify(p)})`);
    assert.equal(p.shape, row.shape, `${JSON.stringify(row.q)} shape`);
    assert.equal(p.kind, row.kind, `${JSON.stringify(row.q)} kind`);
    if (row.object !== undefined) assert.equal(p.object, row.object, `${JSON.stringify(row.q)} object`);
    // every simple clause the resolver reads MUST expose these keys
    for (const k of ["shape", "kind", "entityType", "object"]) assert.ok(k in p, `${JSON.stringify(row.q)} exposes ${k}`);
  }
});

test("interface: terse command forms are NOT simple NL parses (the resolver routes them via the command register)", () => {
  // These return null / a non-simple parse from parseQuery — the resolver MUST get
  // them from the command register, which is exactly why command is tier 1.
  for (const q of ["describe Widget", "members Widget", "untested", "arch", "signature Widget.render"]) {
    const p = parseQuery(q);
    assert.ok(p === null || p.node || !p.shape, `${JSON.stringify(q)} is not a simple relational clause (got ${JSON.stringify(p)})`);
  }
});

// ---- the FROZEN resolveObject contract the resolver DELEGATES binding to --------

test("interface: resolveObject returns the {match,candidates,tier,ambiguous} contract the resolver binds on", async () => {
  const graph = await loadGraph();

  const hit = resolveObject(graph, "fnAlpha");
  for (const k of ["match", "candidates", "tier", "ambiguous"]) assert.ok(k in hit, `resolveObject exposes ${k}`);
  assert.equal(hit.match.label, "fnAlpha");
  assert.equal(hit.tier, 1);
  assert.equal(hit.ambiguous, false);
  assert.ok(Array.isArray(hit.candidates));

  // an exact module path binds at tier 1
  assert.equal(resolveObject(graph, "app/lib/a.mjs").match.label, "app/lib/a.mjs");
  // a class name binds to the Class individual
  assert.equal(resolveObject(graph, "Widget").match.class, "Class");

  // an HONEST MISS is match:null (never a fabricated entity) — the resolver reads
  // this exact signal to REFUSE rather than emit an ungrounded call.
  const miss = resolveObject(graph, "zebra.mjs");
  assert.equal(miss.match, null);

  // resolveObject RESCUES a verb-polluted object term ("cover app/lib/b.mjs" ->
  // app/lib/b.mjs), which is why the resolver delegates binding rather than trust
  // the raw parse object — pin that behavior so a regression is caught here.
  assert.equal(resolveObject(graph, "cover app/lib/b.mjs").match.label, "app/lib/b.mjs");
});
