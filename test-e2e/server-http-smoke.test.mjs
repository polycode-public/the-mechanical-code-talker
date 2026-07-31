// server-http-smoke.test.mjs — the cross-repo smoke test: a real `tmct serve`
// process, hit over HTTP by bedrock-meter's `httpDispatch`, proving the
// documented response shape holds outside hand-built fixture objects.
//
// WHY THIS TEST DIFFERS FROM e2e/server-http.test.mjs: that file drives
// `startServer()` IN-PROCESS — a real node:http listener, but the same Node
// process, same module instances, never through bin/tmct.mjs's CLI arg
// parsing / env resolution / SIGTERM shutdown path. This test instead spawns
// the ACTUAL `node bin/tmct.mjs serve` CHILD PROCESS (a genuinely separate OS
// process reached only over its TCP socket) and talks to it using bedrock-
// meter's EXACT `httpDispatch` request/response contract
// (packages/runtime/src/optimiser/routing-target.mjs in the sibling
// bedrock-meter repo) — mimicked byte-for-byte below, NOT imported (tmct has
// no cross-repo dependency on bedrock-meter; the two products only share an
// HTTP wire contract). Bedrock-meter's own router-e2e-tmct.test.mjs proves the
// OPTIMISER side against a hand-built fixture response
// (`fakeTmctDispatch`/`fakeTmctToolDispatch`) — explicitly NOT a real server.
// This test is the other half: a real process producing that exact shape.
//
// What's asserted: the real subprocess's /v1/messages responses (a) parse
// under `httpDispatch`'s own success/failure rules (`res.ok` else throw), and
// (b) satisfy every shape bedrock-meter's optimiser + meter actually read off
// them — `type`, `content[]` block shapes (text AND tool_use), `stop_reason`,
// and `usage` run through a mimicked `extractUsage` (src/meter.mjs) — proving
// the $0-floor accounting holds against a real wire response, not a literal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));

const READY_RE = /Anthropic Messages API at (http:\/\/\S+)\/v1\/messages/;
const READY_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 5000;

/** Boot the REAL `tmct serve` CLI as a child process on an ephemeral port
 *  (--port 0), pointed at the fixture graph via TMCT_GRAPH_FILE (an absolute
 *  path, so it resolves regardless of cwd — src/adapters/config.mjs's loadConfig).
 *  Resolves once the startup line (bin/tmct.mjs's own banner) reports the
 *  bound URL; rejects on early exit/timeout with the captured output for
 *  debugging. Returns { proc, baseUrl, stop }. */
function bootServe() {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, [BIN, "serve", "--host", "127.0.0.1", "--port", "0"], {
      env: { ...process.env, TMCT_GRAPH_FILE: FIXTURE },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`tmct serve did not report ready within ${READY_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, READY_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (settled) return;
      const m = stdout.match(READY_RE);
      if (m) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          proc,
          baseUrl: m[1],
          stop: () => stopServe(proc),
        });
      }
    });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    proc.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`tmct serve exited early (code=${code} signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** SIGTERM the child (bin/tmct.mjs's own handler closes the socket and exits
 *  0); SIGKILL as a backstop if it doesn't exit promptly — no hanging handles
 *  left behind either way. */
function stopServe(proc) {
  return new Promise((resolvePromise) => {
    if (proc.exitCode !== null || proc.signalCode !== null) { resolvePromise(); return; }
    const killer = setTimeout(() => proc.kill("SIGKILL"), SHUTDOWN_TIMEOUT_MS);
    proc.once("exit", () => { clearTimeout(killer); resolvePromise(); });
    proc.kill("SIGTERM");
  });
}

// ---- bedrock-meter's wire contract, MIMICKED (not imported — no cross-repo
// dependency; tmct only owns the HTTP shape it documents). Byte-for-byte the
// same logic as bedrock-meter's packages/runtime/src/optimiser/routing-
// target.mjs `httpDispatch()` and packages/runtime/src/meter.mjs
// `extractUsage()`, at the versions read while building this test. ----

/** bedrock-meter's `httpDispatch(baseUrl)` — POST /v1/messages, throw on a
 *  non-2xx status, else return the parsed JSON body. */
function httpDispatch(baseUrl) {
  const url = baseUrl.replace(/\/$/, "") + "/v1/messages";
  return async function dispatch(request) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`tmct /v1/messages ${res.status}`);
    return res.json();
  };
}

/** bedrock-meter's `extractUsage(out)` (src/meter.mjs) — the SAME best-effort
 *  usage extraction the live metering path runs a routed response through.
 *  tmct's response carries `usage:{input_tokens:0,output_tokens:0}`, so a
 *  real wire response run through this must fold to exactly zero. */
function extractUsage(out) {
  const u = out?.usage || out?.output?.usage || {};
  const input_tokens = Number(u.inputTokens ?? u.input_tokens ?? u.inputTokenCount ?? 0) || 0;
  const output_tokens = Number(u.outputTokens ?? u.output_tokens ?? u.outputTokenCount ?? 0) || 0;
  return { input_tokens, output_tokens };
}

// bedrock-meter's own router-e2e-tmct.test.mjs request shapes (IN_ENVELOPE /
// tool-declared cases), reproduced here as the literal wire payloads a real
// deployment sends — httpDispatch is a thin fetch wrapper, so this IS what a
// live optimiser call looks like on the wire, not an approximation of it.
const TEXT_REQUEST = {
  model: "tmct",
  messages: [{ role: "user", content: "what tools do you have?" }],
  tools: [],
  max_tokens: 256,
};
const TOOL_REQUEST = {
  model: "tmct",
  messages: [{ role: "user", content: "what calls fnAlpha" }],
  tools: [
    { name: "tmct_ask", description: "ask a structural question", input_schema: { type: "object" } },
    { name: "tmct_describe", description: "describe a symbol", input_schema: { type: "object" } },
  ],
  max_tokens: 256,
};

test("cross-repo smoke: a real `tmct serve` child process, hit via bedrock-meter's httpDispatch contract", async (t) => {
  const srv = await bootServe();
  try {
    assert.match(srv.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/, "the CLI reports a real bound ephemeral port");
    const dispatch = httpDispatch(srv.baseUrl);

    await t.test("a text-only request (no declared tools) round-trips end_turn, $0 usage", async () => {
      const out = await dispatch(TEXT_REQUEST);
      // exactly what bedrock-meter's optimiser reads off `response` (router.mjs,
      // router-e2e-tmct.test.mjs's assertions on `response.type`/`response.usage`).
      assert.equal(out.type, "message");
      assert.equal(out.role, "assistant");
      assert.equal(out.model, "tmct");
      assert.equal(out.stop_reason, "end_turn");
      assert.ok(Array.isArray(out.content) && out.content.length >= 1);
      assert.equal(out.content[0].type, "text");
      assert.equal(typeof out.content[0].text, "string");
      assert.ok(out.content[0].text.length > 0);
      // the $0-floor accounting contract: real usage, run through the real
      // extraction logic, folds to zero — not a hand-built fixture literal.
      assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
      assert.deepEqual(extractUsage(out), { input_tokens: 0, output_tokens: 0 });
    });

    let toolUse;
    await t.test("a declared, dispatch-backed tool request emits a real tool_use block", async () => {
      const out = await dispatch(TOOL_REQUEST);
      assert.equal(out.type, "message");
      assert.equal(out.stop_reason, "tool_use");
      assert.ok(Array.isArray(out.content) && out.content.length >= 1);
      toolUse = out.content[0];
      assert.equal(toolUse.type, "tool_use");
      assert.match(toolUse.id, /^toolu_[0-9a-f]+$/);
      assert.equal(toolUse.name, "tmct_ask");
      assert.deepEqual(toolUse.input, { query: "what calls fnAlpha" });
      assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
      assert.deepEqual(extractUsage(out), { input_tokens: 0, output_tokens: 0 });
    });

    await t.test("returning a tool_result closes the loop over HTTP (end_turn, real process)", async () => {
      const followUp = {
        model: "tmct",
        tools: TOOL_REQUEST.tools,
        max_tokens: 256,
        messages: [
          ...TOOL_REQUEST.messages,
          { role: "assistant", content: [toolUse] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "fnAlpha is called by app/lib/a.mjs" }] },
        ],
      };
      const out = await dispatch(followUp);
      assert.equal(out.stop_reason, "end_turn");
      assert.equal(out.content[0].type, "text");
      assert.equal(out.content[0].text, "fnAlpha is called by app/lib/a.mjs");
      assert.deepEqual(extractUsage(out), { input_tokens: 0, output_tokens: 0 });
    });

    await t.test("a malformed request over the real socket surfaces httpDispatch's own throw path", async () => {
      const res = await fetch(srv.baseUrl.replace(/\/$/, "") + "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      assert.equal(res.ok, false);
      await assert.rejects(
        (async () => { if (!res.ok) throw new Error(`tmct /v1/messages ${res.status}`); })(),
        /tmct \/v1\/messages 400/,
      );
    });
  } finally {
    await srv.stop();
  }
});
