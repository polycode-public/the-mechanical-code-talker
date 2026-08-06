// tmct tool layer — query-only tools over the deterministic typed code-graph
// artifact (<repo>/.tmct/graph.json). The graph source is a LOCAL file
// (src/adapters/source.mjs) and tmct_search is a LOCAL lexical lookup (no remote API,
// no LLM, no model calls anywhere). dispatchTool is the single internal entry
// the chat surface and the `cli <tool>` route call into.
//
// This module is the dispatch entry only: it maps a tool name to the handler module
// that owns it (handlers/, one module per tool), loads the graph once, builds the
// typed service object (the Repository Interface) and hands both to the handler.
// Each tool answers one question in ONE compact call so the caller need not
// Read/Grep. Errors reach the caller as clean tool errors — message only, never a stack.
//
// Two entries, one dispatch: dispatchTool hands back the caller-facing string, and
// dispatchToolStructured hands back { content, data } for a caller that wants the
// answer's structure rather than its sentence (a page rendering rows, the router).

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HOT_TOOLS } from "./definitions.mjs";
import { ToolError } from "../adapters/config.mjs";
import * as defaultSource from "../adapters/source.mjs";
import { ask } from "../domain/ask.mjs";
import { createGraphService } from "../adapters/providers/graph-service.mjs";
import { loadGraph } from "./graph-load.mjs";
import { HANDLERS } from "./handlers/index.mjs";
import { askToolResult } from "./handlers/tmct-ask.mjs";
import { isToolResult } from "./handlers/kit.mjs";
import { setDefaultNlpAdapter } from "../domain/interpret/nlp-registry.mjs";
import { setConstructionBanks } from "../domain/interpret/strategies/constructions.mjs";
import { nlpAdapter } from "../adapters/ask-nlp.mjs";
import { readConstructionFiles } from "../adapters/corpus/construction-banks.mjs";

// Composition: the tool layer supplies the domain parser's default lemma/POS
// adapter and the construction-grammar banks (lazy loader), so dispatchTool-
// only consumers get the same NL tiers chat wires.
setDefaultNlpAdapter(nlpAdapter);
setConstructionBanks(readConstructionFiles);

export { loadGraph } from "./graph-load.mjs";
export { buildContextBundle } from "./handlers/tmct-context.mjs";
export { ASK_ENVELOPE_DELIM } from "./handlers/tmct-ask.mjs";

// Tiered tool surface: the hot tools carry full descriptions/schemas in this
// catalog; every COLD tool (describe/members/impact/history/…) is still served
// by dispatchTool below and is reachable via the CLI `cli <tool>` route +
// the <repo>/.tmct/TOOLS.md catalog `tmct init` writes (renderToolsCatalog). Both
// tiers, and the schemas themselves, come from the tool definitions.
export const TOOLS = HOT_TOOLS.map(({ name, agentDescription, inputSchema }) => ({
  name,
  description: agentDescription,
  inputSchema,
}));

async function runHandler(name, args, { config, source = defaultSource, tel = null, ingest = null, memoryBackend = null, factLookup = null, graph: suppliedGraph = null, codeDomainActive = null } = {}) {
  // Reject an unknown tool BEFORE touching the graph — an unknown name never
  // triggers a load. hasOwn, so an inherited name ("constructor", "toString")
  // is unknown rather than a callable found on the prototype chain.
  if (!Object.hasOwn(HANDLERS, name)) throw new ToolError(`unknown tool: ${name}`);
  const handle = HANDLERS[name];
  // `ingest` is the recognizer seam a caller in the service layer injects (the
  // tool layer sits UNDER services and must not import one, so a tool that needs
  // the chat recognizer receives it here rather than importing it). `memoryBackend`
  // is the same kind of seam for a caller that already holds an open memory-store
  // handle (e.g. a session's own `memoryDir`) — a handler that reads the
  // conversational memory store (tmct_export) prefers it over re-deriving a
  // backend from config when one is supplied; every other caller leaves it null
  // and gets today's re-derive-from-config behaviour unchanged. `codeDomainActive`
  // is the same kind of seam again — the service layer's own session-level
  // predicate, threaded down only so a handler whose empty-graph wording is
  // code-domain-flavored (tmct_untested) can decline that wording on a bare
  // install; a caller that omits it (a cold `cli <tool>` invocation, most
  // dispatchTool tests) gets the handler's own graph-derived fallback.
  if (handle.ownsGraphLoad) return handle(args, { config, source, tel, ingest, memoryBackend, graph: suppliedGraph, codeDomainActive });
  // `graph` is the third seam of the same kind: a caller that ALREADY holds a
  // parsed graph hands it over instead of making the tool layer load one. A
  // browser session is the case that needs it — its graph is built in memory
  // (a seed payload, or a live board projected through worldRelationGraphPayload)
  // and there is no config or file behind it to load from.
  const graph = suppliedGraph || await loadGraph(config, source);
  // repo root = the dir containing .tmct/ (graphFile = <repo>/.tmct/graph.json). Passed to
  // createGraphService so svc.snippet()/svc.context() are usable directly, and on to the
  // handlers that do their own safe source reads. A supplied graph has no repo on
  // disk behind it, so those reads are off rather than pointed at a path that
  // isn't there.
  const repoRoot = config?.graphFile ? dirname(dirname(config.graphFile)) : null;
  const svc = createGraphService(graph, { sourceAccess: Boolean(repoRoot), repoRoot, readFile, tel, ask });
  const out = handle(args, { graph, svc, config, repoRoot, memoryBackend, codeDomainActive });
  return name === "tmct_ask" ? askWithMemoryFallback(out, args, factLookup) : out;
}

/** Offer a graph miss to the caller's own memory reader before the miss stands.
 *  `factLookup` is a seam of the same kind as `ingest`: the conversational
 *  store's vocabulary reader lives in the SERVICE layer, which this layer sits
 *  under and must not import, so a cold caller holding a repo's memory hands it
 *  in. A caller that supplies none keeps the graph-only answer, byte for byte.
 *
 *  Composed HERE rather than inside the handler because the handler is a
 *  synchronous entry the browser's code explorer calls directly — an `async`
 *  handler hands that caller a promise whose `.data` is undefined, and its
 *  sidebar silently draws nothing. Dispatch already awaits, so the awaiting
 *  belongs here. */
async function askWithMemoryFallback(out, args, factLookup) {
  const envelope = out?.data;
  if (!envelope?.miss || typeof factLookup !== "function") return out;
  let fromMemory = null;
  try { fromMemory = await factLookup(String(args?.query ?? ""), envelope); } catch { fromMemory = null; }
  if (!fromMemory?.text) return out;
  // A reader hit flagged `miss` is the same refusal in better words, so the
  // envelope keeps its miss and only the prose improves.
  const content = fromMemory.replace ? fromMemory.text : `${out.content}\n${fromMemory.text}`;
  return askToolResult(content, {
    ...envelope,
    miss: Boolean(fromMemory.miss),
    matchedVia: fromMemory.miss ? envelope.matchedVia : "memory",
  });
}

/** The caller-facing string for one tool call. A handler that returns a structured
 *  result is flattened to its `text` here, so every existing string caller (the chat
 *  surface, the CLI `cli <tool>` route, the HTTP shim) is unaffected by a handler
 *  gaining structure. */
export async function dispatchTool(name, args, ctx = {}) {
  const out = await runHandler(name, args, ctx);
  return isToolResult(out) ? out.text : out;
}

/** The same call, answered as `{ content, data }`: `content` is the prose, `data` the
 *  render-ready structure the handler already computed on its way to it. `data` is
 *  undefined for a tool whose answer is prose and nothing else, which is most of the
 *  cold set — an absent `data` is a real answer, not a failure. */
export async function dispatchToolStructured(name, args, ctx = {}) {
  const out = await runHandler(name, args, ctx);
  return isToolResult(out) ? { content: out.content, data: out.data } : { content: out, data: undefined };
}
