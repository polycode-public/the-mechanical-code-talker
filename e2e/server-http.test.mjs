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
import { startServer, respondToMessages, selectTool } from "../src/server-http.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { dispatchTool } from "../src/server.mjs";
import * as source from "../src/adapters/source.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
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

// ---- CLI wiring ----

test("bin/tmct.mjs: `serve --help` prints usage and exits 0", () => {
  const r = spawnSync(process.execPath, [BIN, "serve", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /POST \/v1\/messages/);
  assert.match(r.stdout, /input_tokens: 0/);
});
