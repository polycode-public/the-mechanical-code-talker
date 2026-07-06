// server-http.mjs tests — the Anthropic Messages API-compatible `tmct serve`
// shim. Spins the real node:http server on an EPHEMERAL port (port 0), drives
// requests with fetch, asserts the block shapes + stop_reason + $0 usage, and
// closes the server (no hanging handles). Step 1: the read-only cited answers
// endpoint + self-description + error handling + the CLI usage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer, respondToMessages } from "../src/server-http.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

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

test("serve: text-only endpoint returns a cited end_turn answer over HTTP", async () => {
  const srv = await startServer({ config: CONFIG, port: 0 });
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(srv.port > 0);
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

test("respondToMessages: pure seam returns a text block + end_turn + $0 usage", async () => {
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const out = await respondToMessages(
    { model: "tmct", messages: [{ role: "user", content: "what calls fnAlpha" }] },
    { config: CONFIG, graph },
  );
  assert.equal(out.stop_reason, "end_turn");
  assert.equal(out.content[0].type, "text");
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

test("bin/tmct.mjs: `serve --help` prints usage and exits 0", () => {
  const r = spawnSync(process.execPath, [BIN, "serve", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /POST \/v1\/messages/);
  assert.match(r.stdout, /input_tokens: 0/);
});
