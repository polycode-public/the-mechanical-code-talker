// ask-membership-context-pronoun.test.mjs — regression test for HANDOVER.md's
// "Plural/ordinal anaphora unsupported; singular 'that' unresolved as a
// reverse-relation object" finding, 2026-07-12 (fast-loop round 4), item 2
// half of the fix: `that`/`it`/`this`/`here` as the OWNER term of a MEMBERSHIP
// query ("<kind> of/in <owner>" — "methods of X", "functions in X") never
// resolved against the standing focus, because ask.mjs's
// resolveMembershipOwner called bare `resolveObject(graph, term)`, which has
// no contextId/focus notion at all — the raw pronoun string reached
// resolveObjectCore's mechanical tiers and could only ever honestly miss.
//
// (HANDOVER's own worked example, "which classes inherit from that", is the
// REVERSE-relation shape — traverse()'s reverse/forward branch already routed
// through resolveTermOrContext, contextId and all, before this fix; verified
// live, not a regression target here. The genuinely-broken shape was the
// MEMBERSHIP grammar, a sibling code path with its own separate, contextId-
// blind resolver — same root defect the HANDOVER bullet diagnosed
// (`resolveObject` "purely mechanical graph-label matching with no
// contextId/focus notion"), just a different call site than the bullet named.)
//
// Fix: resolveMembershipOwner now takes a `contextId` and resolves the owner
// term via resolveTermOrContext — the SAME contextId-aware resolution
// evalQualCheck and traverse()'s reverse/forward shapes already use for
// pronoun objects — instead of a bare resolveObject call. A non-pronoun term
// resolves byte-identically to before (resolveTermOrContext's own fallthrough
// for anything outside CONTEXT_PRONOUNS is that same bare resolveObject call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { ask } from "../src/ask.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

// Fixture ground truth (test/fixtures/entities.fixture.json): Widget (cls-widget)
// defines methods/attributes Widget.render and Widget.name; app/lib/a.mjs
// (mod-a) defines the function fnAlpha.

test("membership owner pronoun: 'methods of that' with contextId resolves exactly like 'methods of Widget'", () => {
  const widget = graph.byId.get("cls-widget");
  const named = ask(graph, "methods of Widget", {});
  assert.equal(named.tmct_ask.miss, false);
  const pron = ask(graph, "methods of that", { contextId: widget.id });
  assert.equal(pron.tmct_ask.miss, false, `expected a real answer, got a miss: ${pron.content}`);
  assert.equal(pron.content, named.content, "pronoun-object and named-object queries must render identically");
});

test("membership owner pronoun: 'functions of it' with contextId resolves the same as naming the module", () => {
  const modA = graph.byId.get("mod-a");
  const named = ask(graph, "functions of app/lib/a.mjs", {});
  assert.equal(named.tmct_ask.miss, false);
  const pron = ask(graph, "functions of it", { contextId: modA.id });
  assert.equal(pron.tmct_ask.miss, false, `expected a real answer, got a miss: ${pron.content}`);
  assert.match(pron.content, /fnAlpha/);
  assert.equal(pron.content, named.content);
});

test("membership owner pronoun: 'attributes of this' with contextId resolves against the focus", () => {
  const widget = graph.byId.get("cls-widget");
  const pron = ask(graph, "attributes of this", { contextId: widget.id });
  assert.equal(pron.tmct_ask.miss, false, `expected a real answer, got a miss: ${pron.content}`);
  assert.match(pron.content, /Widget\.name/);
});

test("regression guard: a membership owner pronoun with NO standing focus still gets an honest miss, never a guess", () => {
  const r = ask(graph, "methods of that", {});
  assert.equal(r.tmct_ask.miss, true);
  // Never a false-positive substring match off the raw pronoun string (the
  // STACCATO_LEAKED_CONNECTIVES class of bug this fix also forecloses for
  // this call site) — the miss must not name any real entity as a hit.
  assert.equal(r.tmct_ask.matches.length, 0);
});

test("regression guard: a named (non-pronoun) membership owner is completely unaffected by the fix", () => {
  const r = ask(graph, "methods of Widget", {});
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /Widget\.render/);
});

test("regression guard: directory-scope membership ('modules in <dir>', a non-pronoun path term) is unaffected", () => {
  const r = ask(graph, "modules in app/lib", {});
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /app\/lib\/a\.mjs/);
});

// Sibling check for the HANDOVER bullet's OWN worked example — pinned here so any
// future regression in traverse()'s reverse-shape contextId threading (a
// completely different code path from the membership fix above) is caught in
// the same file this fix's docblock discusses it in.
test("reverse-relation object pronoun ('which classes inherit from that') already resolves via contextId — not a regression target, pinned for documentation", () => {
  const base = graph.byId.get("cls-base");
  const named = ask(graph, "which classes inherit from Base", {});
  const pron = ask(graph, "which classes inherit from that", { contextId: base.id });
  assert.equal(pron.tmct_ask.miss, false);
  assert.equal(pron.content, named.content);
});
