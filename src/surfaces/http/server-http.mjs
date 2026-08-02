// server-http.mjs — `tmct serve`: an Anthropic Messages API-compatible HTTP
// endpoint (POST /v1/messages) over tmct's existing zero-model engine.
//
// A deterministic serialization/HTTP shim — no model, ever. A request carries
// { model, messages[], tools[], max_tokens, system? }; a response is a message with
// `content` blocks and a `stop_reason`: "end_turn" runs the latest user text through
// runTurn (chat.mjs) for a cited read-only answer; "tool_use" emits a
// { type:"tool_use", id, name, input } block backed by dispatchTool (server.mjs) when
// the request maps to a declared graph-query tool.
//
// Every response's `usage` is { input_tokens: 0, output_tokens: 0 } — tmct is the $0
// floor, priced as free by the meter.
//
// src/tools/server.mjs is the tool-dispatch layer, not an HTTP server; this module is the
// HTTP surface.

import { createServer } from "node:http";
import { runTurn, selectTool, capabilityPlanDeps } from "../../services/chat.mjs";
import { TOOLS, dispatchTool } from "../../tools/server.mjs";
import { runCapabilityPlan, buildCapabilityPlanCtx, declaredCapabilityNames } from "../../domain/router/drive.mjs";
import { isCapability } from "../../domain/router/registry.mjs";
import { hallucinationsIn } from "../../domain/router/call-validator.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { ToolError } from "../../adapters/config.mjs";
import { uuidv7 } from "../../adapters/uuid.mjs";
import * as defaultSource from "../../adapters/source.mjs";

// The shim's deterministic tool selection lives with the chat surface's own
// command routing (selectTool in chat.mjs); re-exported here so HTTP-side
// callers keep one import site for the whole shim seam.
export { selectTool } from "../../services/chat.mjs";

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

/** The first tool_use block of a transcript that ENDS on an assistant message —
 *  a caller PROPOSING a call for tmct to validate and (if clean) run. Returns
 *  { name, input, id, rest } (rest = any further tool_use blocks in the same
 *  message, noted in the reply but not executed) or null. A transcript that ends
 *  user-role with a tool_result is the loop-closing shape, not a proposal, so
 *  this returns null for it — its final message is not an assistant message. */
function proposedToolUse(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return null;
  const uses = last.content.filter((b) => b && b.type === "tool_use" && typeof b.name === "string");
  if (!uses.length) return null;
  const [first, ...rest] = uses;
  return {
    name: first.name,
    input: first.input && typeof first.input === "object" ? first.input : {},
    id: first.id,
    rest,
  };
}

/** One human line for a hallucination-taxonomy problem, its reason in parentheses
 *  so a caller can grep the machine reason off the prose. */
function describeProblem(p, name) {
  switch (p.reason) {
    case "unknown-tool": return `"${p.detail}" is not a capability I know (unknown-tool)`;
    case "undeclared": return `"${p.detail}" is a real capability but was not declared in this request (undeclared)`;
    case "unknown-arg": return `${p.detail} is not an argument ${name} accepts (unknown-arg)`;
    case "missing-arg": return `${p.detail} (missing-arg)`;
    default: return `${p.detail} (${p.reason})`;
  }
}

/** The tmct capabilities a request declared — what tmct will actually validate
 *  and execute, as named in a hand-back / refusal so the caller can see the set. */
function declaredCapabilityList(declaredNames) {
  const caps = [...declaredNames].filter(isCapability);
  return caps.length ? caps.join(", ") : "(none)";
}

/** Append the "N further calls not processed" note (when a proposal carried more
 *  than one tool_use block) to a reply text. */
function withRestNote(text, rest) {
  if (!rest.length) return text;
  return `${text}\n(${rest.length} further proposed call(s) in the same message were not processed: ${rest.map((b) => b.name).join(", ")}.)`;
}

/**
 * Produce the Messages-API response for one request body. Pure over its inputs
 * (the loaded graph + config), so it is unit-testable without a socket.
 *   - a caller-PROPOSED tool_use (transcript ends on an assistant tool_use) →
 *     validate with hallucinationsIn, then execute (end_turn) or refuse
 *   - a returned tool_result → end_turn text (relay the tool's output)
 *   - a mapped, declared graph tool → tool_use
 *   - otherwise → end_turn text via runTurn
 */
/** The memory store's vocabulary reader over a throwaway copy of `memoryDir` —
 *  the seam a cold tool call gets so `tmct_ask` here answers what chat answers
 *  over the same repo. Null when the server was started without a store. */
async function memoryFactLookup(memoryDir) {
  if (!memoryDir) return null;
  const { readOnlyMemorySnapshot } = await import("../../adapters/memory/core.mjs");
  const snapshot = await readOnlyMemorySnapshot(memoryDir);
  if (!snapshot) return null;
  const { factAnswer } = await import("../../services/chat.mjs");
  return (query, envelope) => factAnswer(snapshot, query, envelope, true);
}

export async function respondToMessages(body, { config, graph, memoryDir = null, source = defaultSource } = {}) {
  const { model, messages, tools } = body || {};
  const declaredNames = new Set(
    (Array.isArray(tools) ? tools : []).map((t) => t && t.name).filter(Boolean),
  );

  // A caller-proposed call: validate it against the registry + the declared set
  // before anything runs, then execute a clean call or refuse a hallucinated one
  // with the taxonomy's reason. Checked FIRST — a proposal ends on an assistant
  // tool_use, so the loop-closing tool_result branch below (final user turn)
  // never fires for it, and this never fires for a loop close.
  const proposal = proposedToolUse(messages);
  if (proposal) {
    const { name, input, rest } = proposal;

    // A tool the caller declared that is NOT a tmct capability is the caller's
    // OWN tool — hand it back honestly rather than burning the taxonomy's
    // unknown-tool (which stays reserved for a genuinely invented name).
    if (declaredNames.has(name) && !isCapability(name)) {
      const text = `"${name}" is your own tool, not a tmct capability — tmct validates and executes only tmct capabilities (${declaredCapabilityList(declaredNames)}). Nothing was executed.`;
      return assistantMessage(model, [{ type: "text", text: withRestNote(text, rest) }], "end_turn");
    }

    const problems = hallucinationsIn({ name, input }, [...declaredNames]);
    if (problems.length) {
      const lines = problems.map((p) => `refusing the proposed call — ${describeProblem(p, name)}.`);
      lines.push(`Nothing was executed; declared capabilities: ${declaredCapabilityList(declaredNames)}.`);
      const msg = assistantMessage(model, [{ type: "text", text: withRestNote(lines.join("\n"), rest) }], "refusal");
      msg.tmct_checked_call = { name, input, problems };
      return msg;
    }

    // Clean. A taught: record is simulated over the taught rules only — never a
    // dispatchable tool — so decline honestly rather than dispatch an "unknown
    // tool" error under a call that actually validated.
    if (name.startsWith("taught:")) {
      const text = `"${name}" is a taught action — simulated over the taught rules, not a dispatchable tool — so nothing was executed. Run it in chat with "next".`;
      const msg = assistantMessage(model, [{ type: "text", text: withRestNote(text, rest) }], "end_turn");
      msg.tmct_checked_call = { name, input, problems: [] };
      return msg;
    }
    try {
      const out = await dispatchTool(name, input, { config, source, factLookup: await memoryFactLookup(memoryDir) });
      const msg = assistantMessage(model, [{ type: "text", text: withRestNote(out, rest) }], "end_turn");
      msg.tmct_checked_call = { name, input, problems: [] };
      return msg;
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      // A well-formed call that grounded nothing is an honest MISS, not a
      // refusal — the taxonomy is clean; the graph simply had no answer.
      const text = `the proposed call was well-formed but grounded nothing: ${e.message}`;
      const msg = assistantMessage(model, [{ type: "text", text: withRestNote(text, rest) }], "end_turn");
      msg.tmct_checked_call = { name, input, problems: [] };
      return msg;
    }
  }

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

  // text answer: the cited, read-only answer the chat surface gives, over the
  // same repo's memory store — without it, a term chat answers came back from
  // this endpoint as a miss. The store is handed over as a throwaway in-memory
  // COPY, so the endpoint stays PURE: reads see the real facts, and anything a
  // turn would write lands in the copy rather than on disk.
  const { readOnlyMemorySnapshot } = await import("../../adapters/memory/core.mjs");
  const snapshot = await readOnlyMemorySnapshot(memoryDir);
  const storedBefore = snapshot?.payload?.individuals?.length ?? 0;
  const { answer } = await runTurn(userText, { config, graph, source, memoryDir: snapshot });
  // A teach turn lands in the copy and confirms itself. Say plainly that the
  // fact went nowhere, rather than leaving "noted — remembered" as the last
  // word on a write this endpoint never makes.
  const wrote = (snapshot?.payload?.individuals?.length ?? 0) > storedBefore;
  const text = wrote
    ? `${answer}\n(nothing was stored — this endpoint reads the memory store and never writes to it. Teach the fact in a chat session to keep it.)`
    : answer;
  return assistantMessage(model, [{ type: "text", text }], "end_turn");
}

/** The capability names a /v1/plan request restricts its plan to (its `tools`
 *  array of names or `{name}` objects), and any that are not registered
 *  capabilities — the route rejects an `unknown` list with a 400 before the loop
 *  ever runs. A request with no `tools` plans over every registered capability. */
function planToolNames(body) {
  const declared = declaredCapabilityNames();
  if (!Array.isArray(body?.tools)) return { tools: declared, declared, unknown: [] };
  const tools = body.tools.map((t) => (typeof t === "string" ? t : t && t.name)).filter(Boolean);
  const unknown = tools.filter((t) => !declared.includes(t));
  return { tools, declared, unknown };
}

/**
 * Produce the /v1/plan response for one request body — the capability router
 * (runCapabilityPlan) over HTTP, the same loop result the library export and the
 * `tmct plan --json` CLI already return. Assumes a validated body (the route
 * rejects a missing `request` or an unknown tool name with a 400 first).
 *   - refused  → { request, ...loopResult } — an in-band honest "no plan found",
 *                not a protocol error (still HTTP 200)
 *   - grounded → { request, ...loopResult, usage } with $0 usage
 *
 * Per-request taught-action registrations ride ctx.disposers and are unregistered
 * in the finally, so a second request re-reads the store instead of colliding on
 * an already-registered taught capability name.
 */
export async function respondToPlan(body, { config, graph, memoryDir = null, source = defaultSource } = {}) {
  const request = typeof body?.request === "string" ? body.request.trim() : "";
  const { tools } = planToolNames(body);
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config, source, graph, memoryDir });
  try {
    const result = await runCapabilityPlan(request, tools, ctx);
    if (result.refused) return { request, ...result };
    return { request, ...result, usage: { ...ZERO_USAGE } };
  } finally {
    for (const dispose of ctx.disposers || []) dispose();
  }
}

/** Self-description payload (GET /) — lets a routing target discover the endpoint
 *  and the tools tmct can back with just an HTTP GET. */
function describe(config) {
  return {
    service: "tmct",
    description: "Anthropic Messages API-compatible, deterministic, no-LLM graph router (the $0 floor).",
    endpoint: { method: "POST", path: "/v1/messages" },
    plan_endpoint: { method: "POST", path: "/v1/plan" },
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
export async function startServer({ config, host = "127.0.0.1", port = 0, source = defaultSource, memoryDir = null } = {}) {
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
      if (url.pathname === "/v1/plan") {
        if (req.method !== "POST") {
          sendError(res, 405, "invalid_request_error", "POST /v1/plan");
          return;
        }
        let body;
        try {
          body = JSON.parse((await readBody(req)) || "{}");
        } catch {
          sendError(res, 400, "invalid_request_error", "request body is not valid JSON");
          return;
        }
        const request = typeof body?.request === "string" ? body.request.trim() : "";
        if (!request) {
          sendError(res, 400, "invalid_request_error", "`request` is required and must be a non-empty string");
          return;
        }
        const { unknown, declared } = planToolNames(body);
        if (unknown.length) {
          sendError(res, 400, "invalid_request_error", `unknown tools name(s): ${unknown.join(", ")}; registered capabilities: ${declared.join(", ")}`);
          return;
        }
        const out = await respondToPlan(body, { config, graph, memoryDir, source });
        sendJson(res, 200, out);
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
      const out = await respondToMessages(body, { config, graph, memoryDir, source });
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
