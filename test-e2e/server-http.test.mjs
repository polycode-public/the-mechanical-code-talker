// server-http.mjs tests — the Anthropic Messages API-compatible `tmct serve`
// shim. Spins the real node:http server on an EPHEMERAL port (port 0), drives a
// full request → tool_use → tool_result → end_turn loop with fetch, asserts the
// block shapes + stop_reason + $0 usage, and closes the server (no hanging
// handles). Also exercises the pure respondToMessages/selectTool seams and the
// bin/tmct.mjs `serve --help` usage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer, respondToMessages, respondToPlan, selectTool } from "../src/surfaces/http/server-http.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { dispatchTool } from "../src/tools/server.mjs";
import { declaredCapabilityNames } from "../src/domain/router/drive.mjs";
import * as source from "../src/adapters/source.mjs";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

const ANTHROPIC_TOOLS = [
  { name: "tmct_ask", description: "ask a structural question", input_schema: { type: "object" } },
  { name: "tmct_describe", description: "describe a symbol", input_schema: { type: "object" } },
];

/** POST a Messages request to a running server; resolve the parsed JSON + status. */
async function post(base, body) {
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** POST a plan request to a running server; resolve the parsed JSON + status. */
async function postPlan(base, body) {
  const res = await fetch(`${base}/v1/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** A well-formed assistant message envelope with $0 usage. */
function assertEnvelope(msg, model = "tmct") {
  assert.equal(msg.type, "message");
  assert.equal(msg.role, "assistant");
  assert.equal(msg.model, model);
  assert.match(msg.id, /^msg_[0-9a-f]+$/);
  assert.ok(Array.isArray(msg.content) && msg.content.length >= 1);
  // bedrock-meter-pluggable: tmct is the $0 floor.
  assert.deepEqual(msg.usage, { input_tokens: 0, output_tokens: 0 });
}

// ---- the full HTTP loop (ephemeral port, real fetch) ----

test("serve: full request → tool_use → tool_result → end_turn loop over HTTP", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(srv.port > 0);

    // 1. tool_use emission: a structural question + declared tools → a tool_use
    //    block backed by tmct_ask, stop_reason "tool_use", $0 usage.
    const q = "what calls fnAlpha";
    const r1 = await post(srv.url, { model: "tmct", messages: [{ role: "user", content: q }], tools: ANTHROPIC_TOOLS, max_tokens: 256 });
    assert.equal(r1.status, 200);
    assertEnvelope(r1.json);
    assert.equal(r1.json.stop_reason, "tool_use");
    const tu = r1.json.content[0];
    assert.equal(tu.type, "tool_use");
    assert.match(tu.id, /^toolu_[0-9a-f]+$/);
    assert.equal(tu.name, "tmct_ask");
    assert.deepEqual(tu.input, { query: q });

    // 2. the CALLER executes the tool (via dispatchTool, the same layer that backs
    //    the emission) and returns a tool_result block in the next request.
    const toolOutput = await dispatchTool(tu.name, tu.input, { config: CONFIG });
    const r2 = await post(srv.url, {
      model: "tmct",
      tools: ANTHROPIC_TOOLS,
      max_tokens: 256,
      messages: [
        { role: "user", content: q },
        { role: "assistant", content: [tu] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, content: toolOutput }] },
      ],
    });
    // 3. the loop closes: end_turn, a text block relaying the tool's output, $0 usage.
    assert.equal(r2.status, 200);
    assertEnvelope(r2.json);
    assert.equal(r2.json.stop_reason, "end_turn");
    assert.equal(r2.json.content[0].type, "text");
    assert.equal(r2.json.content[0].text, toolOutput);
  } finally {
    await srv.close();
  }
});

test("serve: text-only endpoint (no tools) returns a cited end_turn answer", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const r = await post(srv.url, { model: "haiku", messages: [{ role: "user", content: "what calls fnAlpha" }], max_tokens: 128 });
    assert.equal(r.status, 200);
    assertEnvelope(r.json, "haiku"); // model is echoed back
    assert.equal(r.json.stop_reason, "end_turn");
    assert.equal(r.json.content[0].type, "text");
    assert.ok(r.json.content[0].text.length > 0);
  } finally {
    await srv.close();
  }
});

test("serve: a bare command form binds a specific declared tool", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const r = await post(srv.url, {
      model: "tmct",
      tools: [{ name: "tmct_describe" }, { name: "tmct_ask" }],
      messages: [{ role: "user", content: "describe fnAlpha" }],
    });
    assert.equal(r.json.stop_reason, "tool_use");
    assert.equal(r.json.content[0].name, "tmct_describe");
    assert.deepEqual(r.json.content[0].input, { symbol: "fnAlpha" });
  } finally {
    await srv.close();
  }
});

test("serve: small-talk with tools declared never emits a call (text, end_turn)", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const r = await post(srv.url, { model: "tmct", tools: ANTHROPIC_TOOLS, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.json.stop_reason, "end_turn");
    assert.equal(r.json.content[0].type, "text");
  } finally {
    await srv.close();
  }
});

test("serve: GET / self-describes the endpoint, tools and $0 pricing", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const d = await (await fetch(`${srv.url}/`)).json();
    assert.equal(d.service, "tmct");
    assert.equal(d.endpoint.path, "/v1/messages");
    assert.deepEqual(d.plan_endpoint, { method: "POST", path: "/v1/plan" });
    assert.ok(Array.isArray(d.tools) && d.tools.length >= 1);
    assert.deepEqual(d.usage_pricing, { input_tokens: 0, output_tokens: 0 });
  } finally {
    await srv.close();
  }
});

test("serve: bad JSON and missing messages array are clean 400s, unknown route a 404", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const bad = await fetch(`${srv.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).type, "error");

    const noMsgs = await post(srv.url, { model: "tmct" });
    assert.equal(noMsgs.status, 400);

    const nf = await fetch(`${srv.url}/nope`);
    assert.equal(nf.status, 404);
  } finally {
    await srv.close();
  }
});

// ---- pure seams (no socket) ----

test("respondToMessages: tool_result in the latest user turn closes with end_turn", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    {
      model: "tmct",
      tools: ANTHROPIC_TOOLS,
      messages: [
        { role: "user", content: "what calls fnAlpha" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_x", name: "tmct_ask", input: { query: "what calls fnAlpha" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "RESULT-TEXT" }] },
      ],
    },
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "end_turn");
  assert.equal(out.content[0].text, "RESULT-TEXT");
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

test("selectTool: command → specific tool; question → tmct_ask; small-talk / undeclared → null", () => {
  const declared = new Set(["tmct_ask", "tmct_describe", "tmct_callers"]);
  assert.deepEqual(selectTool("describe Widget", declared), { name: "tmct_describe", input: { symbol: "Widget" } });
  assert.deepEqual(selectTool("/callers Widget", declared), { name: "tmct_callers", input: { symbol: "Widget" } });
  assert.deepEqual(selectTool("which functions call Widget", declared), { name: "tmct_ask", input: { query: "which functions call Widget" } });
  assert.equal(selectTool("hi", declared), null);          // small-talk
  assert.equal(selectTool("thanks", declared), null);      // small-talk
  // a declared tool the shim can't ground, and no tmct_ask → no emission
  assert.equal(selectTool("which functions call Widget", new Set(["some_other_tool"])), null);
});

// ---- the external-proposal seam (a caller-proposed tool_use on /v1/messages) ----

/** A transcript that ENDS on an assistant tool_use — a caller proposing `name`
 *  for tmct to validate and (if clean) execute. */
function proposal(name, input, tools) {
  return {
    model: "tmct",
    tools,
    messages: [
      { role: "user", content: "run a tool for me" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_prop", name, input }] },
    ],
  };
}

test("proposal: a clean declared capability is validated and executed (end_turn, no problems)", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const expected = await dispatchTool("tmct_describe", { symbol: "fnAlpha" }, { config: CONFIG });
  const out = await respondToMessages(
    proposal("tmct_describe", { symbol: "fnAlpha" }, [{ name: "tmct_describe" }, { name: "tmct_ask" }]),
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "end_turn");
  assert.equal(out.content[0].text, expected);
  assert.deepEqual(out.tmct_checked_call, { name: "tmct_describe", input: { symbol: "fnAlpha" }, problems: [] });
});

test("proposal: a hallucinated tool name is a refusal naming the unknown-tool reason", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    proposal("tmct_impcat", { symbol: "fnAlpha" }, [{ name: "tmct_describe" }]),
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "refusal");
  assert.match(out.content[0].text, /unknown-tool/);
  assert.match(out.content[0].text, /Nothing was executed/);
  assert.equal(out.tmct_checked_call.problems[0].reason, "unknown-tool");
});

test("proposal: an argument the capability does not accept is an unknown-arg refusal", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    proposal("tmct_describe", { symbol: "fnAlpha", wibble: 1 }, [{ name: "tmct_describe" }]),
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "refusal");
  assert.match(out.content[0].text, /unknown-arg/);
  assert.ok(out.tmct_checked_call.problems.some((p) => p.reason === "unknown-arg" && p.detail === "tmct_describe.wibble"));
});

test("proposal: a required argument missing is a missing-arg refusal", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    proposal("tmct_describe", {}, [{ name: "tmct_describe" }]),
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "refusal");
  assert.match(out.content[0].text, /missing-arg/);
});

test("proposal: a real capability the request did not declare is an undeclared refusal", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    proposal("tmct_callers", { symbol: "fnAlpha" }, [{ name: "tmct_describe" }]),
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "refusal");
  assert.match(out.content[0].text, /undeclared/);
});

test("proposal: a caller's own declared tool is handed back honestly, not refused", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    proposal("get_weather", { city: "Paris" }, [{ name: "get_weather" }, { name: "tmct_describe" }]),
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "end_turn");
  assert.match(out.content[0].text, /your own tool/);
  assert.match(out.content[0].text, /Nothing was executed/);
  assert.equal(out.tmct_checked_call, undefined);
});

// ---- text-only + self-description + errors (retained from step 1) ----

test("respondToMessages: no tools declared → a cited text block + end_turn + $0 usage", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    { model: "tmct", messages: [{ role: "user", content: "what calls fnAlpha" }] },
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "end_turn");
  assert.equal(out.content[0].type, "text");
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

test("respondToMessages: a term the memory store holds answers here the way it answers in chat", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { appendFact, openConfiguredMemoryBackend } = await import("../src/adapters/memory/core.mjs");
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const dir = await mkdtemp(join(tmpdir(), "tmct-http-mem-"));
  const { dir: memoryDir, close } = await openConfiguredMemoryBackend(dir);
  try {
    await appendFact(memoryDir, {
      subject: "gizmo", predicate: "rdfs:subClassOf", object: "software", provenance: "corpus:conceptnet /r/IsA",
    });
    const body = { model: "tmct", messages: [{ role: "user", content: "what is a gizmo" }] };

    const graphOnly = await respondToMessages(body, { config: CONFIG, graph });
    assert.doesNotMatch(graphOnly.content[0].text, /software/, "the code graph alone has no answer");

    const withMemory = await respondToMessages(body, { config: CONFIG, graph, memoryDir });
    assert.match(withMemory.content[0].text, /software/, "the store's fact is read");
    assert.match(withMemory.content[0].text, /corpus:conceptnet/, "provenance is cited");
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("respondToMessages: a teach sent to the endpoint says plainly that nothing was stored", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadMemory, readFactRows, openConfiguredMemoryBackend } = await import("../src/adapters/memory/core.mjs");
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const dir = await mkdtemp(join(tmpdir(), "tmct-http-write-"));
  const { dir: memoryDir, close } = await openConfiguredMemoryBackend(dir);
  try {
    const before = readFactRows(await loadMemory(memoryDir)).length;
    const out = await respondToMessages(
      { model: "tmct", messages: [{ role: "user", content: "every raven is a bird" }] },
      { config: CONFIG, graph, memoryDir },
    );
    assert.match(out.content[0].text, /nothing was stored/, "the turn does not leave a write it never made as the last word");
    assert.equal(readFactRows(await loadMemory(memoryDir)).length, before, "the store is byte-for-byte untouched");
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the plan verb (POST /v1/plan) ----

test("plan: a single-shot request grounds to one registry call with $0 usage", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const r = await postPlan(srv.url, { request: "who calls fnAlpha" });
    assert.equal(r.status, 200);
    assert.equal(r.json.refused, false);
    assert.equal(r.json.request, "who calls fnAlpha");
    assert.ok(Array.isArray(r.json.calls) && r.json.calls.length >= 1);
    assert.ok(declaredCapabilityNames().includes(r.json.calls[0].name));
    assert.deepEqual(r.json.usage, { input_tokens: 0, output_tokens: 0 });
  } finally {
    await srv.close();
  }
});

test("plan: a compound request decomposes into an ordered multi-call plan", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const r = await postPlan(srv.url, { request: "of the modules impacted by app/lib/a.mjs, which are untested" });
    assert.equal(r.status, 200);
    assert.equal(r.json.refused, false);
    assert.ok(r.json.calls.length >= 2);
    for (const c of r.json.calls) assert.ok(declaredCapabilityNames().includes(c.name));
  } finally {
    await srv.close();
  }
});

test("plan: a request nothing grounds is an in-band honest refusal, not an error", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const r = await postPlan(srv.url, { request: "xyzzy plugh frobnicate wibble" });
    assert.equal(r.status, 200);
    assert.equal(r.json.refused, true);
    assert.ok(r.json.why && r.json.why.length > 0);
  } finally {
    await srv.close();
  }
});

test("plan: an unknown tools name and a missing request are clean 400s", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    const unknown = await postPlan(srv.url, { request: "who calls fnAlpha", tools: ["tmct_callers", "tmct_not_a_tool"] });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.type, "error");
    assert.match(unknown.json.error.message, /unknown tools name\(s\): tmct_not_a_tool/);

    const missing = await postPlan(srv.url, { tools: ["tmct_callers"] });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.type, "error");

    const empty = await postPlan(srv.url, { request: "   " });
    assert.equal(empty.status, 400);
  } finally {
    await srv.close();
  }
});

test("respondToPlan: grounds a single-shot request over a passed-in graph without a socket", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToPlan({ request: "who calls fnAlpha" }, { config: CONFIG, graph });
  assert.equal(out.refused, false);
  assert.equal(out.request, "who calls fnAlpha");
  assert.ok(declaredCapabilityNames().includes(out.calls[0].name));
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

// ---- CLI wiring ----

test("bin/tmct.mjs: `serve --help` prints usage and exits 0", () => {
  const r = spawnSync(process.execPath, [BIN, "serve", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /POST \/v1\/messages/);
  assert.match(r.stdout, /input_tokens: 0/);
});
