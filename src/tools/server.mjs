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

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HOT_TOOLS } from "./definitions.mjs";
import { ToolError } from "../adapters/config.mjs";
import * as defaultSource from "../adapters/source.mjs";
import { ask } from "../domain/ask.mjs";
import { createGraphService } from "../adapters/providers/graph-service.mjs";
import { loadGraph } from "./graph-load.mjs";
import { HANDLERS } from "./handlers/index.mjs";
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

/** dispatchTool's structured twin: always `{ content, data }`. A handler that
 *  returns kit.mjs's `toolResult` shape is passed through; a handler that
 *  returns a plain string (all of them, historically) is wrapped with
 *  `data: null`, so the two entry points never disagree about the sentence. */
export async function dispatchToolStructured(name, args, opts = {}) {
  const out = await dispatchHandler(name, args, opts);
  if (out && typeof out === "object" && typeof out.content === "string") {
    return { content: out.content, data: out.data ?? null };
  }
  return { content: String(out ?? ""), data: null };
}

export async function dispatchTool(name, args, opts = {}) {
  return (await dispatchToolStructured(name, args, opts)).content;
}

async function dispatchHandler(name, args, { config, source = defaultSource, tel = null, ingest = null, memoryBackend = null } = {}) {
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
  // and gets today's re-derive-from-config behaviour unchanged.
  if (handle.ownsGraphLoad) return handle(args, { config, source, tel, ingest, memoryBackend });
  const graph = await loadGraph(config, source);
  // repo root = the dir containing .tmct/ (graphFile = <repo>/.tmct/graph.json). Passed to
  // createGraphService so svc.snippet()/svc.context() are usable directly, and on to the
  // handlers that do their own safe source reads.
  const repoRoot = dirname(dirname(config.graphFile));
  const svc = createGraphService(graph, { sourceAccess: true, repoRoot, readFile, tel, ask });
  return handle(args, { graph, svc, config, repoRoot, memoryBackend });
}
