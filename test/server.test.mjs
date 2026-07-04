// MCP wiring tests — the real Server + a real SDK Client over an in-memory
// transport pair, with the graph source stubbed. No fs, no child process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildServer, TOOLS, resolveServedTools } from "../src/server.mjs";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url)), "utf8"),
);
const config = { graphFile: "/stub/.seonix/graph.json" };
const stubSource = { fetchEntities: async () => fixture };

async function connect({ source = stubSource } = {}) {
  const server = buildServer({ config, source });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}

// C4 tiered surface: only the hot tools are registered as MCP tools; every cold tool
// is still dispatchable by name (exercised below + via the CLI route). seonix_ask joined
// the hot tier (PLAN_MECHANICAL_CHAT.md §6.1) — its whole value is collapsing a multi-call
// exploration loop, which only pays off if the agent sees it directly, not one hop deeper.
const EXPECTED_TOOLS = ["seonix_context", "seonix_snippet", "seonix_ask"];

// The cold tools dispatchTool must still serve by name even though they are not listed.
const COLD_TOOLS = [
  "seonix_describe", "seonix_signature", "seonix_impact", "seonix_search", "seonix_members",
  "seonix_subclasses", "seonix_architecture", "seonix_exports", "seonix_tests_for", "seonix_untested",
  "seonix_history", "seonix_callers", "seonix_callees", "seonix_cochanges", "seonix_calls",
  "seonix_file_history", "seonix_method_history", "seonix_class_history", "seonix_context_more",
];

test("lists exactly the two hot tools with JSON schemas", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), EXPECTED_TOOLS);
  for (const t of tools) {
    assert.ok(t.description.length > 40);
    // lean resident schema (re-billed every turn): keep the steer, cut the bloat.
    assert.ok(t.description.length < 200, `${t.name} description should stay lean: ${t.description.length}`);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.inputSchema.required.length, 1); // both require `symbol`
  }
  assert.equal(TOOLS.length, EXPECTED_TOOLS.length);
  // seonix_context exposes the depth enum
  const ctx = tools.find((t) => t.name === "seonix_context");
  assert.deepEqual(ctx.inputSchema.properties.depth.enum, ["min", "auto", "full"]);
  assert.equal(ctx.inputSchema.properties.depth.default, "auto");
});

test("cold tools stay dispatchable by name though unlisted", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const listed = new Set(tools.map((t) => t.name));
  for (const name of COLD_TOOLS) assert.ok(!listed.has(name), `${name} should be unlisted`);
  // a representative cold tool still answers through the server's call handler
  const desc = await client.callTool({ name: "seonix_describe", arguments: { symbol: "a.mjs" } });
  assert.ok(!desc.isError);
  assert.match(desc.content[0].text, /app\/lib\/a\.mjs — Module/);
  const hist = await client.callTool({ name: "seonix_history", arguments: { symbol: "a.mjs" } });
  assert.ok(!hist.isError);
});

test("seonix_describe round-trips against the fixture", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "seonix_describe", arguments: { symbol: "a.mjs" } });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /app\/lib\/a\.mjs — Module/);
  assert.match(res.content[0].text, /← imports \[mgx:importsNamespace\] \(3\) by/);
});

test("the §9 read-replacing tools round-trip against the fixture", async () => {
  const client = await connect();
  const members = await client.callTool({ name: "seonix_members", arguments: { class: "Widget" } });
  assert.ok(!members.isError);
  assert.match(members.content[0].text, /methods \(1\): render .* @property/);

  const subs = await client.callTool({ name: "seonix_subclasses", arguments: { class: "Base" } });
  assert.ok(!subs.isError);
  assert.match(subs.content[0].text, /subclasses: 2 total/);

  const arch = await client.callTool({ name: "seonix_architecture", arguments: {} });
  assert.ok(!arch.isError);
  assert.match(arch.content[0].text, /hub modules \(most imported\):/);

  const untested = await client.callTool({ name: "seonix_untested", arguments: {} });
  assert.ok(!untested.isError);
  assert.match(untested.content[0].text, /no covering test module/);

  const search = await client.callTool({ name: "seonix_search", arguments: { query: "", kind: "class" } });
  assert.ok(!search.isError);
  assert.match(search.content[0].text, /class\(s\) match/);

  // seonix_context bundles siblings + registration + tests in one call (stub graph → no file read).
  // depth:"full" forces every section — the tuned default now keeps a long-exemplar MODULE digest
  // lean (TINY, tuning #1), so we ask for the full bundle to exercise the sibling/tests sections.
  const ctx = await client.callTool({ name: "seonix_context", arguments: { symbol: "app/lib/b.mjs", depth: "full" } });
  assert.ok(!ctx.isError);
  assert.match(ctx.content[0].text, /Edit context for app\/lib\/b\.mjs/);
  assert.match(ctx.content[0].text, /register = Library\(\)/);
  assert.match(ctx.content[0].text, /Class Widget/);
  assert.match(ctx.content[0].text, /covering tests: app\/unit-tests\/b\.test\.mjs/);
  assert.match(ctx.content[0].text, /do NOT Read app\/lib\/b\.mjs/);

  // B012 reverted tuning #1: the SAME module's default (auto) bundle now escalates to MID because
  // its exemplar is long — the sibling list returns to the default bundle (untuned is now a no-op).
  const auto = await client.callTool({ name: "seonix_context", arguments: { symbol: "app/lib/b.mjs" } });
  assert.ok(!auto.isError);
  assert.match(auto.content[0].text, /Edit context for app\/lib\/b\.mjs \[MID\]/);
  assert.match(auto.content[0].text, /Class Widget/);
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

test("seonix_calls lists fn→fn in-repo calls with file:line", async () => {
  const client = await connect({ source: fineSource });
  const res = await client.callTool({ name: "seonix_calls", arguments: { symbol: "alpha" } });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /alpha .* calls 1 in-repo symbol/);
  assert.match(res.content[0].text, /beta \[cg\.py:5\]/);
  const none = await client.callTool({ name: "seonix_calls", arguments: { symbol: "beta" } });
  assert.match(none.content[0].text, /no in-repo calls recorded/);
});

test("seonix_file_history / method_history read touches + touchesSymbol with commit attrs", async () => {
  const client = await connect({ source: fineSource });
  const file = await client.callTool({ name: "seonix_file_history", arguments: { symbol: "cg.py" } });
  assert.ok(!file.isError);
  assert.match(file.content[0].text, /touched by 1 recent commit/);
  assert.match(file.content[0].text, /c1abc 2026-06-01 Ada — tweak alpha/);
  const method = await client.callTool({ name: "seonix_method_history", arguments: { symbol: "alpha" } });
  assert.ok(!method.isError);
  assert.match(method.content[0].text, /touched by 1 commit/);
  assert.match(method.content[0].text, /c1abc 2026-06-01 Ada — tweak alpha/);
  const noHist = await client.callTool({ name: "seonix_class_history", arguments: { symbol: "beta" } });
  assert.match(noHist.content[0].text, /no symbol-level commit history/);
});

test("seonix_context_more returns omitted sections; depth=min vs full differ", async () => {
  const client = await connect();
  const more = await client.callTool({ name: "seonix_context_more", arguments: { symbol: "app/lib/b.mjs" } });
  assert.ok(!more.isError);
  assert.match(more.content[0].text, /Additional context for app\/lib\/b\.mjs/);
  assert.match(more.content[0].text, /covering tests: app\/unit-tests\/b\.test\.mjs/);
  // depth=min is leaner than depth=full for the same symbol
  const min = await client.callTool({ name: "seonix_context", arguments: { symbol: "app/lib/b.mjs", depth: "min" } });
  const full = await client.callTool({ name: "seonix_context", arguments: { symbol: "app/lib/b.mjs", depth: "full" } });
  assert.ok(!min.isError && !full.isError);
  assert.match(min.content[0].text, /\[TINY\]/);
  assert.match(full.content[0].text, /\[FULL\]/);
  assert.doesNotMatch(min.content[0].text, /covering tests:/); // tests omitted in TINY
  assert.match(full.content[0].text, /covering tests:/);        // present in FULL
});

test("seonix_signature returns the compact API surface for a symbol", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "seonix_signature", arguments: { symbol: "Widget.render" } });
  assert.ok(!res.isError);
  const text = res.content[0].text;
  assert.match(text, /signature: Widget\.render\(self, mode='full'\) -> str/);
  assert.match(text, /raises: ValueError/);
  assert.match(text, /self fields: name, size/);
  assert.match(text, /decorators: @property/);
  assert.match(text, /doc: Render the widget\./);
});

test("seonix_impact round-trips against the fixture", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "seonix_impact", arguments: { module: "app/lib/a.mjs" } });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /total: 6 dependent\(s\) across 2 depth level\(s\)/);
});

test("seonix_search runs locally (no LLM) against the fixture", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "seonix_search", arguments: { query: "fnAlpha" } });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /app\/lib\/a\.mjs/);
});

test("unknown symbol → clean miss with a suggestion, no stack", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "seonix_describe", arguments: { symbol: "zz-no-such-thing" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /no entity matching/);
  assert.match(res.content[0].text, /seonix_search/);
  assert.doesNotMatch(res.content[0].text, /\n\s+at /);
});

test("missing artifact → instructive tool error, no stack", async () => {
  const client = await connect({ source: { fetchEntities: async () => { const { ToolError } = await import("../src/config.mjs"); throw new ToolError("no graph artifact at /x — run index_repository"); } } });
  const res = await client.callTool({ name: "seonix_impact", arguments: { module: "a.mjs" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /run index_repository/);
  assert.doesNotMatch(res.content[0].text, /\n\s+at /);
});

test("unexpected internal errors are wrapped message-only", async () => {
  const client = await connect({ source: { fetchEntities: async () => { throw new Error("boom"); } } });
  const res = await client.callTool({ name: "seonix_impact", arguments: { module: "a.mjs" } });
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "unexpected error: boom");
});

// B017 seonix-ask arm: SEONIX_TOOLS narrows registration AND dispatch, so a
// single-tool server config is provably single-tool (nothing visible-but-ungranted
// for a headless permission layer to auto-deny, nothing dispatchable around it).
test("SEONIX_TOOLS=seonix_ask serves exactly that tool and blocks every other dispatch", async () => {
  const server = buildServer({ config, source: stubSource, env: { SEONIX_TOOLS: "seonix_ask" } });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["seonix_ask"]);
  // a hot sibling and a cold tool are both un-dispatchable under the filter
  for (const name of ["seonix_snippet", "seonix_describe"]) {
    const res = await client.callTool({ name, arguments: { symbol: "walk" } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /unknown tool/);
  }
  const ok = await client.callTool({ name: "seonix_ask", arguments: { query: "which modules import walk.mjs" } });
  assert.ok(!ok.isError);
});

test("resolveServedTools: empty env serves the full hot set; a typo throws at startup", async () => {
  assert.deepEqual(resolveServedTools({}).map((t) => t.name), TOOLS.map((t) => t.name));
  assert.deepEqual(resolveServedTools({ SEONIX_TOOLS: " seonix_ask , seonix_snippet " }).map((t) => t.name),
    ["seonix_ask", "seonix_snippet"]);
  assert.throws(() => resolveServedTools({ SEONIX_TOOLS: "seonix_askk" }), /unknown tool/);
});
