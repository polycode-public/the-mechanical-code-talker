// server-http.mjs — `tmct serve`: an Anthropic Messages API-compatible HTTP
// endpoint (POST /v1/messages) over tmct's existing zero-model engine.
//
// This is Phase A of the capability-router plan (PLAN_CAPABILITY_ROUTER.md): the
// COMMON INTERFACE a tool-loop client (Claude Code) already speaks. It is a
// deterministic serialization/HTTP shim — NO model, ever. A request carries
// { model, messages[], tools[], max_tokens, system? }; a response is a message
// with `content` blocks (text and/or tool_use) and a `stop_reason`:
//
//   - TEXT ANSWER (stop_reason "end_turn"): the latest user text is run through
//     runTurn (src/chat.mjs) over the configured graph — the same cited,
//     read-only answer the chat surface gives. Emitted when no tools are
//     declared, or when nothing maps to a declared graph-query tool.
//   - TOOL_USE (stop_reason "tool_use"): when tools[] are declared and the
//     request maps to a declared graph-query tool, a { type:"tool_use", id,
//     name, input } block is emitted — `name`+`input` are backed by dispatchTool
//     (src/server.mjs). The caller executes it and returns a tool_result block;
//     the next request closes the loop with an end_turn text answer.
//
// bedrock-meter-pluggable: every response's `usage` is { input_tokens: 0,
// output_tokens: 0 } — tmct is the $0 floor, priced as free by the meter.
//
// NOTE: src/server.mjs is the TOOL-DISPATCH layer (dispatchTool), NOT an HTTP
// server; this module is the HTTP surface and imports that layer's exports.

import { createServer } from "node:http";
import { runTurn, COMMANDS, asBareCommand, isConversational } from "./chat.mjs";
import { TOOLS } from "./server.mjs";
import { parseEntities } from "./codegraph.mjs";
import { uuidv7 } from "./uuid.mjs";
import * as defaultSource from "./source.mjs";

/** The zero usage every response carries — the meter prices tmct as the $0 floor. */
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0 };

/** The tmct tools dispatchTool can back (the set the shim will emit a tool_use for).
 *  A declared tool outside this set is ignored for emission (the request falls
 *  through to a text answer) — the shim never emits a call it cannot ground. The
 *  COMMANDS map (chat.mjs) names the richer graph tools; TOOLS names the hot
 *  catalog. Their union is what dispatchTool serves. */
const BACKED_TOOLS = new Set([
  ...TOOLS.map((t) => t.name),
  ...Object.values(COMMANDS).map((s) => s.tool),
]);

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

/** The first tool_result block in a message's content array, or null. The caller
 *  returns one of these after executing a tool_use — its presence means the loop
 *  is closing and we answer with end_turn. */
function firstToolResult(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return null;
  return content.find((b) => b && b.type === "tool_result") || null;
}

/** Render a tool_result block's `content` (string OR block array OR arbitrary
 *  value) back to text — what the caller reported when it executed the tool. */
function toolResultText(block) {
  const c = block && block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return textOfContent(c);
  if (c == null) return "";
  try { return JSON.stringify(c); } catch { return String(c); }
}

/**
 * Decide whether a user turn maps to a DECLARED, dispatch-backed graph-query
 * tool, and bind its arguments. Deterministic, in-ethos (no NL guessing beyond
 * the chat surface's own command routing):
 *
 *   1. A slash/bare command that names a tmct tool ("describe X", "/callers X",
 *      "untested") → that tool with its argument bound from the exact arg key the
 *      dispatchTool switch reads (COMMANDS in chat.mjs). Only when the tool is
 *      declared by the caller.
 *   2. Otherwise, a non-conversational structural question → tmct_ask{query:…},
 *      when tmct_ask is declared. Small-talk (isConversational) never emits a
 *      call — it falls through to a text answer.
 *
 * Returns { name, input } or null (→ answer as text).
 */
export function selectTool(text, declaredNames) {
  const t = String(text || "").trim();
  if (!t) return null;

  // 1. explicit command form → a specific tool, argument bound
  const cmdLine = t.startsWith("/") ? t : asBareCommand(t);
  if (cmdLine) {
    const [first, ...restTok] = cmdLine.replace(/^\//, "").split(/\s+/);
    const spec = COMMANDS[String(first).toLowerCase()];
    if (spec && declaredNames.has(spec.tool) && BACKED_TOOLS.has(spec.tool)) {
      const input = {};
      if (spec.arg) {
        const val = restTok.join(" ").trim();
        if (val) input[spec.arg] = val;
        // an entity command with no argument can't bind a call — fall through
        else if (!spec.optional) return askFallback(t, declaredNames);
      }
      return { name: spec.tool, input };
    }
  }

  // 2. structural question → tmct_ask, unless it's small-talk
  return askFallback(t, declaredNames);
}

/** The tmct_ask fallback: emit tmct_ask{query} for a non-conversational line when
 *  the caller declared tmct_ask; otherwise null (→ text answer). */
function askFallback(text, declaredNames) {
  if (declaredNames.has("tmct_ask") && BACKED_TOOLS.has("tmct_ask") && !isConversational(text)) {
    return { name: "tmct_ask", input: { query: text } };
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
 * (the loaded graph + config), so it is unit-testable without a socket.
 *   - a returned tool_result → end_turn text (relay the tool's output)
 *   - a mapped, declared graph tool → tool_use
 *   - otherwise → end_turn text via runTurn
 */
export async function respondToMessages(body, { config, graph, source = defaultSource } = {}) {
  const { model, messages, tools } = body || {};
  const declaredNames = new Set(
    (Array.isArray(tools) ? tools : []).map((t) => t && t.name).filter(Boolean),
  );

  // Closing the loop: the caller executed our tool_use and returned a
  // tool_result. Relay it as the final, cited answer with end_turn.
  const lastUser = lastMessageOfRole(messages, "user");
  const tr = firstToolResult(lastUser);
  if (tr) {
    const text = toolResultText(tr) || "(the tool returned no output)";
    return assistantMessage(model, [{ type: "text", text }], "end_turn");
  }

  const userText = textOfContent(lastUser && lastUser.content);

  // tool_use emission: a declared, dispatch-backed graph tool the request maps to.
  if (declaredNames.size) {
    const sel = selectTool(userText, declaredNames);
    if (sel) {
      const block = {
        type: "tool_use",
        id: `toolu_${uuidv7().replace(/-/g, "")}`,
        name: sel.name,
        input: sel.input,
      };
      return assistantMessage(model, [block], "tool_use");
    }
  }

  // text answer: the cited, read-only answer the chat surface gives. memoryDir is
  // null so the endpoint is PURE — no session artifacts, no writes, deterministic.
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
