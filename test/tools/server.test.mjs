// Tool-layer tests — dispatchTool (the single internal tool switch) driven
// directly, with the graph source stubbed. No fs, no child process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchTool, TOOLS } from "../../src/tools/server.mjs";
import { HANDLERS } from "../../src/tools/handlers/index.mjs";
import { renderToolsCatalog } from "../../src/tools/catalog.mjs";
import { TOOL_DEFINITIONS, HOT_TOOLS, COLD_TOOLS, TOOL_NAMES } from "../../src/tools/definitions.mjs";
import { ToolError } from "../../src/adapters/config.mjs";
import { appendFact, openConfiguredMemoryBackend, createInMemoryStore } from "../../src/adapters/memory/core.mjs";
import { ingestText } from "../../src/services/extract-facts.mjs";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url)), "utf8"),
);
const config = { graphFile: "/stub/.tmct/graph.json" };
const stubSource = { fetchEntities: async () => fixture };

const call = (name, args, source = stubSource) => dispatchTool(name, args, { config, source });

// The hot-tool catalog survives the MCP drop as plain data: lean descriptions +
// JSON schemas the chat surface and any future front-end can render.
const EXPECTED_TOOLS = ["tmct_context", "tmct_snippet", "tmct_ask"];

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
  for (const { name } of COLD_TOOLS) assert.ok(!listed.has(name), `${name} should be unlisted`);
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

/** A temp repo whose CONFIGURED memory store (sqlite by default — the same
 *  store chat's taught facts land in, which is what the fall-through reads)
 *  carries two reified isa Facts:
 *   gizmo  rdfs:subClassOf software   (a subclass of "software")
 *   software rdfs:subClassOf product  (a superclass of "software")
 * The code-map graph itself is still the stub fixture (no "software" entity there). */
async function repoWithMemoryFacts() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-"));
  const { dir: mem, close } = await openConfiguredMemoryBackend(dir);
  try {
    await appendFact(mem, { subject: "gizmo", predicate: "rdfs:subClassOf", object: "software", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(mem, { subject: "software", predicate: "rdfs:subClassOf", object: "product", provenance: "corpus:conceptnet /r/IsA" });
  } finally {
    await close();
  }
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

test("tmct_export dumps the memory store's every fact as JSONL, provenance on each line", async () => {
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  try {
    const out = await dispatchTool("tmct_export", {}, { config: memConfig, source: stubSource });
    const records = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(records.length, 2, "both stored facts export, one JSON object per line");
    const gizmo = records.find((r) => r.subject === "gizmo");
    assert.deepEqual(gizmo, { subject: "gizmo", predicate: "rdfs:subClassOf", object: "software", provenance: "corpus:conceptnet /r/IsA" });
    assert.ok(records.every((r) => r.provenance.length > 0), "every exported line carries its provenance");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_export prefers a caller-supplied memoryBackend over re-deriving one from config", async () => {
  // Two distinct backends: the config-derived sqlite store (from repoWithMemoryFacts,
  // holding "gizmo"/"software") and a separate in-memory store the caller opened
  // itself (holding "explicit-fact"). tmct_export must read from the SUPPLIED
  // backend when one is passed, never from the one config.graphFile would derive.
  const { dir, config: memConfig } = await repoWithMemoryFacts();
  const explicitBackend = createInMemoryStore();
  try {
    await appendFact(explicitBackend, { subject: "explicit-fact", predicate: "rdfs:subClassOf", object: "thing", provenance: "test:explicit" });
    const out = await dispatchTool("tmct_export", {}, { config: memConfig, source: stubSource, memoryBackend: explicitBackend });
    const records = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(records.map((r) => r.subject), ["explicit-fact"], "reads the supplied backend's facts, not the config-derived store's");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_export on an empty store says so honestly rather than emitting nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-export-empty-"));
  try {
    const out = await dispatchTool("tmct_export", {}, { config: { graphFile: join(dir, ".tmct", "graph.json") }, source: stubSource });
    assert.match(out, /no facts to export/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_ingest grounds text into the memory store and reports the canonical triples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ingest-tool-"));
  const config = { graphFile: join(dir, ".tmct", "graph.json") };
  try {
    const out = await dispatchTool("tmct_ingest", { text: "Every module is a component." }, { config, source: stubSource, ingest: ingestText });
    assert.match(out, /1 recognized/);
    assert.match(out, /module subClassOf component/);
    // it persisted: a second export sees the grounded fact
    const dump = await dispatchTool("tmct_export", {}, { config, source: stubSource });
    assert.match(dump, /"subject":"module"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_ingest with optimistic reaches a sentence the strict recognizer skips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ingest-opt-tool-"));
  const config = { graphFile: join(dir, ".tmct", "graph.json") };
  try {
    const out = await dispatchTool("tmct_ingest", { text: "In the wild, an otter is a small mammal.", optimistic: true }, { config, source: stubSource, ingest: ingestText });
    assert.match(out, /optimistic candidate/);
    assert.match(out, /otter subClassOf mammal/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_ingest without the injected recognizer says so honestly rather than guessing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ingest-noseam-"));
  const config = { graphFile: join(dir, ".tmct", "graph.json") };
  try {
    const out = await dispatchTool("tmct_ingest", { text: "Every module is a component." }, { config, source: stubSource });
    assert.match(out, /isn't wired into this context/);
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

test("the cold-tool catalog lists every cold tool with its exact CLI invocation", () => {
  const cat = renderToolsCatalog("/abs/bin/cli.mjs");
  assert.match(cat, /# tmct cold-tool catalog/);
  // hot tools are NOT given a cold ## entry
  assert.doesNotMatch(cat, /## tmct_context\n/);
  assert.doesNotMatch(cat, /## tmct_snippet\n/);
  for (const { name, example } of COLD_TOOLS) {
    assert.ok(cat.includes(`## ${name}`), `missing ${name}`);
    assert.ok(
      cat.includes(`node /abs/bin/cli.mjs cli ${name} '${JSON.stringify(example)}'`),
      `missing invocation for ${name}`,
    );
  }
});

test("the catalog names the hot tools without giving them a cold entry", () => {
  const cat = renderToolsCatalog("/abs/bin/cli.mjs");
  for (const { name } of HOT_TOOLS) assert.ok(cat.includes(`\`${name}\``), `missing ${name}`);
});

test("the handler registry holds exactly one handler per declared tool", () => {
  assert.deepEqual(Object.keys(HANDLERS).sort(), [...TOOL_NAMES].sort());
  for (const [name, handle] of Object.entries(HANDLERS)) {
    assert.equal(typeof handle, "function", `${name} should map to a handler function`);
  }
});

test("every tool the definitions declare is dispatchable, and nothing else is", async () => {
  await assert.rejects(call("tmct_not_a_tool", {}), (e) => e instanceof ToolError && /unknown tool/.test(e.message));
  // a name inherited from Object.prototype is unknown too, never something callable
  // found on the registry's prototype chain
  for (const inherited of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
    await assert.rejects(call(inherited, {}), (e) => e instanceof ToolError && /unknown tool/.test(e.message), inherited);
  }
  // an unknown name is rejected before any graph load; a declared name never reports "unknown tool"
  for (const { name } of TOOL_DEFINITIONS) {
    const err = await call(name, {}).then(() => null, (e) => e);
    if (err) assert.doesNotMatch(err.message, /unknown tool/, `${name} reported unknown`);
  }
});


