// server-http.mjs — `tmct serve`: an Anthropic Messages API-compatible HTTP
// endpoint (POST /v1/messages) over tmct's existing zero-model engine.
//
// This is Phase A of the capability-router plan (PLAN_CAPABILITY_ROUTER.md): the
// COMMON INTERFACE a tool-loop client (Claude Code) already speaks. It is a
// deterministic serialization/HTTP shim — NO model, ever. A request carries
// { model, messages[], tools[], max_tokens, system? }; a response is a message
// with `content` blocks and a `stop_reason`.
//
// STEP 1 (this file): the read-only, cited ANSWERS endpoint — the plan's
// smallest demo. The latest user text is run through runTurn (src/chat.mjs) over
// the configured graph, returning a single { type:"text" } block with the cited
// answer + stop_reason "end_turn". (Step 2 adds tool_use emission.)
//
// bedrock-meter-pluggable: every response's `usage` is { input_tokens: 0,
// output_tokens: 0 } — tmct is the $0 floor, priced as free by the meter.
//
// NOTE: src/server.mjs is the TOOL-DISPATCH layer (dispatchTool), NOT an HTTP
// server; this module is the HTTP surface and imports that layer's exports.

import { createServer } from "node:http";
import { runTurn } from "./chat.mjs";
import { TOOLS } from "./server.mjs";
import { parseEntities } from "./codegraph.mjs";
import { uuidv7 } from "./uuid.mjs";
import * as defaultSource from "./source.mjs";

/** The zero usage every response carries — the meter prices tmct as the $0 floor. */
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0 };

/** Flatten a message's `content` (a string OR a content-block array) into plain
 *  text — concatenating the `text` blocks. Non-text blocks are ignored here. */
function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** The last message with the given role, or null. */
function lastMessageOfRole(messages, role) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === role) return messages[i];
  }
  return null;
}

/** Build the assistant message envelope shared by every branch. */
function assistantMessage(model, content, stopReason) {
  return {
    id: `msg_${uuidv7().replace(/-/g, "")}`,
    type: "message",
    role: "assistant",
    model: model || "tmct",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { ...ZERO_USAGE },
  };
}

/**
 * Produce the Messages-API response for one request body. Pure over its inputs
 * (the loaded graph + config), so it is unit-testable without a socket. Step 1:
 * the latest user text → a single cited text block with stop_reason "end_turn".
 */
export async function respondToMessages(body, { config, graph, source = defaultSource } = {}) {
  const { model, messages } = body || {};
  const lastUser = lastMessageOfRole(messages, "user");
  const userText = textOfContent(lastUser && lastUser.content);

  // The cited, read-only answer the chat surface gives. memoryDir is null so the
  // endpoint is PURE — no session artifacts, no writes, deterministic.
  const { answer } = await runTurn(userText, { config, graph, source, memoryDir: null });
  return assistantMessage(model, [{ type: "text", text: answer }], "end_turn");
}

/** Self-description payload (GET /) — lets a routing target discover the endpoint
 *  and the tools tmct can back with just an HTTP GET. */
function describe(config) {
  return {
    service: "tmct",
    description: "Anthropic Messages API-compatible, deterministic, no-LLM graph router (the $0 floor).",
    endpoint: { method: "POST", path: "/v1/messages" },
    graph: config && config.graphFile,
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
    usage_pricing: ZERO_USAGE,
  };
}

async function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** An Anthropic-style error envelope. */
function sendError(res, status, type, message) {
  sendJson(res, status, { type: "error", error: { type, message } });
}

/**
 * Start the HTTP server. Loads the graph once (tolerant: a missing artifact is
 * the empty bootstrap graph, never an error). Returns { server, url, host, port,
 * config, close } — `close()` shuts the socket cleanly (no hanging handles).
 *
 *   config — { graphFile } (build via configFor(repoPath) in bin/tmct.mjs)
 *   host   — bind address (default 127.0.0.1)
 *   port   — TCP port; 0 picks an ephemeral port (tests)
 */
export async function startServer({ config, host = "127.0.0.1", port = 0, source = defaultSource } = {}) {
  if (!config || !config.graphFile) throw new Error("startServer requires config.graphFile");
  // Load the graph once, up front. A missing artifact loads as the empty
  // bootstrap graph — runTurn tolerates it (an honest empty/orienting answer).
  const graph = parseEntities(await source.fetchEntities(config));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/v1/models")) {
        sendJson(res, 200, describe(config));
        return;
      }
      if (url.pathname !== "/v1/messages") {
        sendError(res, 404, "not_found_error", `no route ${req.method} ${url.pathname}`);
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "invalid_request_error", "POST /v1/messages");
        return;
      }
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        sendError(res, 400, "invalid_request_error", "request body is not valid JSON");
        return;
      }
      if (!body || !Array.isArray(body.messages)) {
        sendError(res, 400, "invalid_request_error", "`messages` array is required");
        return;
      }
      const out = await respondToMessages(body, { config, graph, source });
      sendJson(res, 200, out);
    } catch (e) {
      sendError(res, 500, "api_error", e && e.message ? e.message : String(e));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.removeListener("error", reject); resolve(); });
  });

  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://${host}:${boundPort}`;

  return {
    server,
    host,
    port: boundPort,
    url,
    config,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
