// Dedicated tests for the SOURCE-CAPABLE axis of graph-service.mjs (Item 2e/2d): real body
// text over an injected fs capability, the path-traversal guard exercised end-to-end through
// createGraphService (not just source-slice.mjs's own lower-level unit tests), and context()
// including anchor/exemplar body sections when source-capable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { createGraphService } from "../src/adapters/providers/graph-service.mjs";
import { fixtureProvider, fixtureGraph } from "../src/adapters/providers/fixture.mjs";
import { isHit, isMiss, MISS_REASONS } from "../src/adapters/repository-interface.mjs";
import { ToolError } from "../src/adapters/config.mjs";

const SOURCE_PROVIDER_ROOT = fileURLToPath(new URL("./fixtures/source-provider", import.meta.url));

test("createGraphService({ sourceAccess: true }) requires repoRoot + readFile — a programmer error, not a runtime miss", () => {
  const graph = fixtureGraph();
  assert.throws(() => createGraphService(graph, { sourceAccess: true }), TypeError);
  assert.throws(() => createGraphService(graph, { sourceAccess: true, repoRoot: "/x" }), TypeError);
  assert.throws(() => createGraphService(graph, { sourceAccess: true, readFile: async () => "" }), TypeError);
  // sourceAccess:false (the default) never requires them.
  assert.doesNotThrow(() => createGraphService(graph));
});

test("snippet(): real body text over the injected readFile when source-capable", async () => {
  const svc = fixtureProvider({ sourceAccess: true, repoRoot: SOURCE_PROVIDER_ROOT, readFile });
  const r = await svc.snippet("fn:parseNode");
  assert.ok(isHit(r), "a real hit, not NO_SOURCE");
  assert.equal(r.value.path, "pkg/core/graph.mjs");
  assert.deepEqual(r.value.span, { start: 10, end: 24 });
  assert.match(r.value.body, /function parseNode\(node, depth = 0\)/);
  assert.match(r.value.body, /^10\t/m, "line-numbered, starting at the real start line");
});

test("snippet(): still NO_SOURCE for a symbol with no site span, even when source-capable", async () => {
  const svc = fixtureProvider({ sourceAccess: true, repoRoot: SOURCE_PROVIDER_ROOT, readFile });
  const r = await svc.snippet("mod:graph.mjs"); // a Module — no `site` attribute
  assert.ok(isMiss(r) && r.miss.reason === MISS_REASONS.NO_SOURCE);
});

test("context(): includes real anchor/exemplar body sections when source-capable (absent when graph-only)", async () => {
  const graphOnly = fixtureProvider();
  const graphOnlyText = (await graphOnly.context("Widget")).value.text;
  assert.doesNotMatch(graphOnlyText, /## anchor:|## closest example/);

  const sourceCapable = fixtureProvider({ sourceAccess: true, repoRoot: SOURCE_PROVIDER_ROOT, readFile });
  const r = await sourceCapable.context("Widget");
  assert.ok(isHit(r));
  // Widget is a Class anchor — its own body is the "anchor" section (siteOf(Widget) = 1-40).
  assert.match(r.value.text, /## anchor: Widget \(Class\) @ pkg\/ui\/widget\.mjs:1-40/);
  assert.match(r.value.text, /class Widget extends Base/);
  // The graph-only sections are STILL present (siblings/registration/etc — layered, not replaced).
  assert.match(r.value.text, /registration \/ module globals|register = Library\(\)/);
});

test("context(): a resolvable symbol with NO site (a bare module) still hits — graph-only, no body section, no crash", async () => {
  const sourceCapable = fixtureProvider({ sourceAccess: true, repoRoot: SOURCE_PROVIDER_ROOT, readFile });
  const r = await sourceCapable.context("pkg/core/graph.mjs");
  assert.ok(isHit(r));
  assert.equal(typeof r.value.text, "string");
});

// ---- path-traversal guard, exercised end-to-end THROUGH graph-service.mjs (not just the
// lower-level source-slice.mjs unit tests in test/source-slice.test.mjs) ----------------------

/** A minimal real graph with one Function individual whose `site.path` escapes repoRoot, plus a
 *  real sibling secret file OUTSIDE repoRoot the traversal path targets — so an unguarded read
 *  would genuinely leak it. */
async function traversalGraphAndRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-gs-traversal-"));
  const secretMarker = `TOP-SECRET-${Date.now()}`;
  const secretPath = join(dir, "..", "tmct-gs-secret-sibling.txt");
  await writeFile(secretPath, secretMarker);
  const graph = parseEntities({
    individuals: [
      {
        id: "fn:evil#pwn", label: "pwn", class: "Function", derived_from: [], mentions: [],
        attributes: [{ prop: "seon:startsAt", key: "site", value: "../tmct-gs-secret-sibling.txt:1-3" }],
      },
    ],
    objectProperties: [],
  });
  return { dir, secretPath, secretMarker, graph };
}

test("security: snippet() rejects a path-traversal site.path end-to-end through graph-service.mjs", async () => {
  const { dir, secretPath, graph } = await traversalGraphAndRepo();
  try {
    const svc = createGraphService(graph, { sourceAccess: true, repoRoot: dir, readFile });
    const r = await svc.snippet("fn:evil#pwn");
    // The interface's error contract: a clean miss is a VALUE, never a throw — even a security
    // rejection surfaces as miss(NO_SOURCE), not an uncaught exception.
    assert.ok(isMiss(r) && r.miss.reason === MISS_REASONS.NO_SOURCE);
    assert.match(r.miss.detail, /refusing to read outside the repository root/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(secretPath, { force: true });
  }
});

test("security: context() never leaks a path-traversal site.path's content through graph-service.mjs", async () => {
  const { dir, secretPath, secretMarker, graph } = await traversalGraphAndRepo();
  try {
    const svc = createGraphService(graph, { sourceAccess: true, repoRoot: dir, readFile });
    const r = await svc.context("pwn");
    // renderSourceBodies degrades gracefully (matching buildContextBundle's own behavior) — a
    // hit, just without the leaked body.
    assert.ok(isHit(r));
    assert.doesNotMatch(r.value.text, new RegExp(secretMarker), "secret sibling content must never leak into the bundle");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(secretPath, { force: true });
  }
});
