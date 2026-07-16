// Tool-layer tests — dispatchTool (the single internal tool switch) driven
// directly, with the graph source stubbed. No fs, no child process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchTool, TOOLS } from "../src/server.mjs";
import { ToolError } from "../src/adapters/config.mjs";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url)), "utf8"),
);
const config = { graphFile: "/stub/.tmct/graph.json" };
const stubSource = { fetchEntities: async () => fixture };

const call = (name, args, source = stubSource) => dispatchTool(name, args, { config, source });

// The hot-tool catalog survives the MCP drop as plain data: lean descriptions +
// JSON schemas the chat surface and any future front-end can render.
const EXPECTED_TOOLS = ["tmct_context", "tmct_snippet", "tmct_ask"];

// The cold tools dispatchTool must still serve by name even though they are not
// in the hot catalog.
const COLD_TOOLS = [
  "tmct_describe", "tmct_signature", "tmct_impact", "tmct_search", "tmct_members",
  "tmct_subclasses", "tmct_architecture", "tmct_exports", "tmct_tests_for", "tmct_untested",
  "tmct_history", "tmct_callers", "tmct_callees", "tmct_cochanges", "tmct_calls",
  "tmct_file_history", "tmct_method_history", "tmct_class_history", "tmct_context_more",
];

test("TOOLS catalog: exactly the hot tools, lean descriptions, JSON schemas", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), EXPECTED_TOOLS);
  for (const t of TOOLS) {
    assert.ok(t.description.length > 40);
    // lean resident schema (re-billed every turn by any agent front-end): keep the steer, cut the bloat.
    assert.ok(t.description.length < 200, `${t.name} description should stay lean: ${t.description.length}`);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.inputSchema.required.length, 1); // each requires one arg (symbol/query)
  }
  // tmct_context exposes the depth enum
  const ctx = TOOLS.find((t) => t.name === "tmct_context");
  assert.deepEqual(ctx.inputSchema.properties.depth.enum, ["min", "auto", "full"]);
  assert.equal(ctx.inputSchema.properties.depth.default, "auto");
});

test("cold tools stay dispatchable by name though outside the hot catalog", async () => {
  const listed = new Set(TOOLS.map((t) => t.name));
  for (const name of COLD_TOOLS) assert.ok(!listed.has(name), `${name} should be unlisted`);
  // a representative cold tool still answers through the dispatcher
  const desc = await call("tmct_describe", { symbol: "a.mjs" });
  assert.match(desc, /app\/lib\/a\.mjs — Module/);
  await call("tmct_history", { symbol: "a.mjs" }); // resolves without throwing
});

test("tmct_describe round-trips against the fixture", async () => {
  const text = await call("tmct_describe", { symbol: "a.mjs" });
  assert.match(text, /app\/lib\/a\.mjs — Module/);
  assert.match(text, /← imports \[mgx:importsNamespace\] \(3\) by/);
});

test("the §9 read-replacing tools round-trip against the fixture", async () => {
  const members = await call("tmct_members", { class: "Widget" });
  assert.match(members, /methods \(1\): render .* @property/);

  const subs = await call("tmct_subclasses", { class: "Base" });
  assert.match(subs, /subclasses: 2 total/);

  const arch = await call("tmct_architecture", {});
  assert.match(arch, /hub modules \(most imported\):/);

  const untested = await call("tmct_untested", {});
  assert.match(untested, /no covering test module/);

  const search = await call("tmct_search", { query: "", kind: "class" });
  assert.match(search, /class\(s\) match/);

  // tmct_context bundles siblings + registration + tests in one call (stub graph → no file read).
  // depth:"full" forces every section — the tuned default now keeps a long-exemplar MODULE digest
  // lean (TINY, tuning #1), so we ask for the full bundle to exercise the sibling/tests sections.
  const ctx = await call("tmct_context", { symbol: "app/lib/b.mjs", depth: "full" });
  assert.match(ctx, /Edit context for app\/lib\/b\.mjs/);
  assert.match(ctx, /register = Library\(\)/);
  assert.match(ctx, /Class Widget/);
  assert.match(ctx, /covering tests: app\/unit-tests\/b\.test\.mjs/);
  assert.match(ctx, /do NOT Read app\/lib\/b\.mjs/);

  // B012 reverted tuning #1: the SAME module's default (auto) bundle now escalates to MID because
  // its exemplar is long — the sibling list returns to the default bundle (untuned is now a no-op).
  const auto = await call("tmct_context", { symbol: "app/lib/b.mjs" });
  assert.match(auto, /Edit context for app\/lib\/b\.mjs \[MID\]/);
  assert.match(auto, /Class Widget/);
});

// Inline graph carrying the fine-grained callsSymbol / touchesSymbol edges + commit
// attributes (the shared fixture doesn't, and another agent owns it).
const fineFixture = {
  generated_at: "2026-06-28T00:00:00.000Z",
  objectProperties: [
    { predicate: "defines", prop: "seon:declaresMethod", count: 2, examples: [
      { subject: "mod:cg.py", object: "fn:cg.py#alpha", subjectLabel: "cg.py", objectLabel: "alpha" },
      { subject: "mod:cg.py", object: "fn:cg.py#beta", subjectLabel: "cg.py", objectLabel: "beta" },
    ] },
    { predicate: "callsSymbol", prop: "mgx:callsSymbol", count: 1, examples: [
      { subject: "fn:cg.py#alpha", object: "fn:cg.py#beta", subjectLabel: "alpha", objectLabel: "beta" },
    ] },
    { predicate: "touches", prop: "mgx:touchedByCommit", count: 1, examples: [
      { subject: "commit:c1", object: "mod:cg.py", subjectLabel: "c1abc", objectLabel: "cg.py" },
    ] },
    { predicate: "touchesSymbol", prop: "mgx:touchesSymbol", count: 1, examples: [
      { subject: "commit:c1", object: "fn:cg.py#alpha", subjectLabel: "c1abc", objectLabel: "alpha" },
    ] },
  ],
  individuals: [
    { id: "mod:cg.py", label: "cg.py", class: "Module", derived_from: [], mentions: [] },
    { id: "fn:cg.py#alpha", label: "alpha", class: "Function", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "cg.py:1-3" }] },
    { id: "fn:cg.py#beta", label: "beta", class: "Function", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "cg.py:5-7" }] },
    { id: "commit:c1", label: "c1abc", class: "Commit", derived_from: [], mentions: [], attributes: [
      { prop: "mgx:commitAuthor", key: "commitAuthor", value: "Ada" },
      { prop: "mgx:commitDate", key: "commitDate", value: "2026-06-01" },
      { prop: "mgx:commitMessage", key: "commitMessage", value: "tweak alpha" },
    ] },
  ],
};
const fineSource = { fetchEntities: async () => fineFixture };

test("tmct_calls lists fn→fn in-repo calls with file:line", async () => {
  const res = await call("tmct_calls", { symbol: "alpha" }, fineSource);
  assert.match(res, /alpha .* calls 1 in-repo symbol/);
  assert.match(res, /beta \[cg\.py:5\]/);
  const none = await call("tmct_calls", { symbol: "beta" }, fineSource);
  assert.match(none, /no in-repo calls recorded/);
});

test("tmct_file_history / method_history read touches + touchesSymbol with commit attrs", async () => {
  const file = await call("tmct_file_history", { symbol: "cg.py" }, fineSource);
  assert.match(file, /touched by 1 recent commit/);
  assert.match(file, /c1abc 2026-06-01 Ada — tweak alpha/);
  const method = await call("tmct_method_history", { symbol: "alpha" }, fineSource);
  assert.match(method, /touched by 1 commit/);
  assert.match(method, /c1abc 2026-06-01 Ada — tweak alpha/);
  const noHist = await call("tmct_class_history", { symbol: "beta" }, fineSource);
  assert.match(noHist, /no symbol-level commit history/);
});

test("tmct_context_more returns omitted sections; depth=min vs full differ", async () => {
  const more = await call("tmct_context_more", { symbol: "app/lib/b.mjs" });
  assert.match(more, /Additional context for app\/lib\/b\.mjs/);
  assert.match(more, /covering tests: app\/unit-tests\/b\.test\.mjs/);
  // depth=min is leaner than depth=full for the same symbol
  const min = await call("tmct_context", { symbol: "app/lib/b.mjs", depth: "min" });
  const full = await call("tmct_context", { symbol: "app/lib/b.mjs", depth: "full" });
  assert.match(min, /\[TINY\]/);
  assert.match(full, /\[FULL\]/);
  assert.doesNotMatch(min, /covering tests:/); // tests omitted in TINY
  assert.match(full, /covering tests:/);        // present in FULL
});

test("tmct_signature returns the compact API surface for a symbol", async () => {
  const text = await call("tmct_signature", { symbol: "Widget.render" });
  assert.match(text, /signature: Widget\.render\(self, mode='full'\) -> str/);
  assert.match(text, /raises: ValueError/);
  assert.match(text, /self fields: name, size/);
  assert.match(text, /decorators: @property/);
  assert.match(text, /doc: Render the widget\./);
});

test("tmct_impact round-trips against the fixture", async () => {
  const text = await call("tmct_impact", { module: "app/lib/a.mjs" });
  assert.match(text, /total: 6 dependent\(s\) across 2 depth level\(s\)/);
});

test("tmct_search runs locally (no LLM) against the fixture", async () => {
  const text = await call("tmct_search", { query: "fnAlpha" });
  assert.match(text, /app\/lib\/a\.mjs/);
});

test("tmct_ask answers a structural query and appends the machine envelope", async () => {
  const text = await call("tmct_ask", { query: "which modules import a.mjs" });
  assert.match(text, /---tmct_ask---/);
});

test("unknown symbol → clean ToolError with a suggestion, no stack in the message", async () => {
  await assert.rejects(
    call("tmct_describe", { symbol: "zz-no-such-thing" }),
    (e) => {
      assert.ok(e instanceof ToolError, "a ToolError, not a raw Error");
      assert.match(e.message, /no entity matching/);
      assert.match(e.message, /tmct_search/);
      assert.doesNotMatch(e.message, /\n\s+at /);
      return true;
    },
  );
});

test("unknown tool name → clean ToolError", async () => {
  await assert.rejects(call("tmct_nope", {}), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /unknown tool/);
    return true;
  });
});

test("missing artifact → instructive ToolError propagates message-only", async () => {
  const failing = { fetchEntities: async () => { throw new ToolError("no graph artifact at /x — nothing indexed here"); } };
  await assert.rejects(call("tmct_impact", { module: "a.mjs" }, failing), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /no graph artifact/);
    assert.doesNotMatch(e.message, /\n\s+at /);
    return true;
  });
});

test("unexpected internal errors propagate as plain errors (callers wrap message-only)", async () => {
  const boom = { fetchEntities: async () => { throw new Error("boom"); } };
  await assert.rejects(call("tmct_impact", { module: "a.mjs" }, boom), (e) => {
    assert.ok(!(e instanceof ToolError), "not disguised as a tool error");
    assert.equal(e.message, "boom");
    return true;
  });
});

// ---- FIX 3 (cycle W2P): the two-graph bridge — when the CODE-MAP graph resolves nothing
// for a concept query (/subclasses /describe /members /find), fall through to the reified
// isa-family facts in the MEMORY graph (with provenance), instead of a flat "no entity". ----

/** A temp repo whose .tmct/memory/graph.json carries two reified isa Facts:
 *   gizmo  rdfs:subClassOf software   (a subclass of "software")
 *   software rdfs:subClassOf product  (a superclass of "software")
 * The code-map graph itself is still the stub fixture (no "software" entity there). */
async function repoWithMemoryFacts() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-"));
  const mem = {
    individuals: [
      { id: "fact:1", class: "Fact", attributes: [
        { prop: "rdf:subject", key: "subject", value: "gizmo" },
        { prop: "rdf:predicate", key: "predicate", value: "rdfs:subClassOf" },
        { prop: "rdf:object", key: "object", value: "software" },
        { prop: "mgx:factProvenance", key: "provenance", value: "corpus:conceptnet /r/IsA" },
      ] },
      { id: "fact:2", class: "Fact", attributes: [
        { prop: "rdf:subject", key: "subject", value: "software" },
        { prop: "rdf:predicate", key: "predicate", value: "rdfs:subClassOf" },
        { prop: "rdf:object", key: "object", value: "product" },
        { prop: "mgx:factProvenance", key: "provenance", value: "corpus:conceptnet /r/IsA" },
      ] },
    ],
    objectProperties: [],
  };
  await mkdir(join(dir, ".tmct", "memory"), { recursive: true });
  await writeFile(join(dir, ".tmct", "memory", "graph.json"), JSON.stringify(mem));
  return { dir, config: { graphFile: join(dir, ".tmct", "graph.json") } };
}

test("bridge: /subclasses on a code-map miss falls through to memory facts (with provenance)", async () => {
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  try {
    const out = await dispatchTool("tmct_subclasses", { class: "software" }, { config: memConfig, source: stubSource });
    assert.match(out, /not a code-map entity/, "states it answered from memory");
    assert.match(out, /1 known subclass/);
    assert.match(out, /gizmo/, "the isa-family subject is listed");
    assert.match(out, /provenance: corpus:conceptnet/, "provenance is cited");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("bridge: /describe on a code-map miss reports the concept's superclasses + subclasses from memory", async () => {
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  try {
    const out = await dispatchTool("tmct_describe", { symbol: "software" }, { config: memConfig, source: stubSource });
    assert.match(out, /is a: product/, "superclass (software subClassOf product)");
    assert.match(out, /known subclasses \(1\): gizmo/);
    assert.match(out, /provenance:/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("bridge: /members on a code-map miss lists the concept's subclasses from memory", async () => {
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  try {
    const out = await dispatchTool("tmct_members", { class: "software" }, { config: memConfig, source: stubSource });
    assert.match(out, /gizmo/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("bridge: the CODE-MAP still wins when it resolves — /subclasses Base is the code-map answer, not memory", async () => {
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  try {
    const out = await dispatchTool("tmct_subclasses", { class: "Base" }, { config: memConfig, source: stubSource });
    assert.doesNotMatch(out, /not a code-map entity/, "code-map resolution takes precedence");
    assert.match(out, /Base — Class/, "the fixture's code-map subclasses answer");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("bridge: a term unknown to BOTH graphs keeps the honest code-map ToolError", async () => {
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  try {
    await assert.rejects(
      dispatchTool("tmct_subclasses", { class: "zz-nowhere" }, { config: memConfig, source: stubSource }),
      (e) => { assert.ok(e instanceof ToolError); assert.match(e.message, /no entity matching/); return true; },
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- security fix regression: a crafted/corrupted graph.json carrying a `site.path` that
// escapes the repo root (e.g. "../secret.txt") must never reach fs. Real repoRoot + a real
// sibling "secret" file OUTSIDE it, so an unguarded readFile would genuinely read it. ----

/** A temp repo whose graph.json has a Function individual with NO backing Module individual —
 *  contextPlan/siteOf then fall back to the function's own (attacker-controlled) site.path as
 *  moduleLabel — plus a real sibling file one level above repoRoot the traversal path targets. */
async function repoWithTraversalGraph() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-traversal-"));
  const secretMarker = `TOP-SECRET-${Date.now()}`;
  // A real sibling file OUTSIDE repoRoot (dir) — an unguarded readFile would genuinely read it.
  const secretPath = join(dir, "..", "tmct-secret-sibling.txt");
  await writeFile(secretPath, secretMarker);
  const evilRelPath = "../tmct-secret-sibling.txt";
  const graph = {
    generated_at: "2026-07-10T00:00:00.000Z",
    objectProperties: [],
    individuals: [
      {
        id: "fn:evil#pwn", label: "pwn", class: "Function", derived_from: [], mentions: [],
        attributes: [{ prop: "seon:startsAt", key: "site", value: `${evilRelPath}:1-3` }],
      },
    ],
  };
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const graphFile = join(dir, ".tmct", "graph.json");
  await writeFile(graphFile, JSON.stringify(graph));
  return { dir, secretPath, secretMarker, config: { graphFile }, source: { fetchEntities: async () => graph } };
}

test("security: tmct_snippet refuses a path-traversal site.path end-to-end", async () => {
  const { dir, secretPath, config: repoConfig, source } = await repoWithTraversalGraph();
  try {
    await assert.rejects(
      dispatchTool("tmct_snippet", { symbol: "pwn" }, { config: repoConfig, source }),
      (e) => {
        assert.ok(e instanceof ToolError, "a ToolError, not a raw fs error or leaked content");
        assert.match(e.message, /refusing to read outside the repository root/);
        assert.match(e.message, /tmct-secret-sibling\.txt/, "names the offending path");
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(secretPath, { force: true });
  }
});

test("security: tmct_context never leaks a path-traversal site.path's content end-to-end", async () => {
  const { dir, secretPath, secretMarker, config: repoConfig, source } = await repoWithTraversalGraph();
  try {
    // buildContextBundle swallows fs errors gracefully (degraded bundle, no anchor body) —
    // it must NOT throw a raw fs error and, critically, must never include the secret content.
    const text = await dispatchTool("tmct_context", { symbol: "pwn", depth: "full" }, { config: repoConfig, source });
    assert.doesNotMatch(text, new RegExp(secretMarker), "secret sibling content must never leak into the bundle");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(secretPath, { force: true });
  }
});
