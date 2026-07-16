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

export async function dispatchTool(name, args, { config, source = defaultSource, tel = null } = {}) {
  // Reject an unknown tool BEFORE touching the graph — an unknown name never
  // triggers a load.
  const handle = HANDLERS[name];
  if (!handle) throw new ToolError(`unknown tool: ${name}`);
  if (handle.ownsGraphLoad) return handle(args, { config, source, tel });
  const graph = await loadGraph(config, source);
  // repo root = the dir containing .tmct/ (graphFile = <repo>/.tmct/graph.json). Passed to
  // createGraphService so svc.snippet()/svc.context() are usable directly, and on to the
  // handlers that do their own safe source reads.
  const repoRoot = dirname(dirname(config.graphFile));
  const svc = createGraphService(graph, { sourceAccess: true, repoRoot, readFile, tel, ask });
  return handle(args, { graph, svc, config, repoRoot });
}
