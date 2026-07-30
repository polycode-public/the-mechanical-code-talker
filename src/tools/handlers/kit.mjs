// What every per-tool handler module shares: the argument contract, the result contract,
// the resolve-or-miss contract, and the one shape most cold tools have (take a symbol,
// resolve it, render it).

import { ToolError } from "../../adapters/config.mjs";
import { resolveSymbol } from "../../domain/codegraph.mjs";

export const SNIPPET_MAX_LINES = 200;

/** A handler's answer when it already holds the structured form of what its prose says.
 *  `content` is the prose. `data` is that structure, handed to dispatchToolStructured
 *  callers as-is so a page renders it instead of parsing the sentence back apart.
 *  `text` is what the string-only callers (dispatchTool, the CLI `cli <tool>` route)
 *  receive; it defaults to `content`, and a tool sets it only where its flat string
 *  already carried the structure in-band. A handler with nothing structured to add
 *  keeps returning a bare string, and `data` is absent for it. */
export function toolResult({ content, data, text = null }) {
  return { content, data, text: text ?? content };
}

/** A handler may return either shape, so both dispatch paths have to tell them apart. */
export const isToolResult = (value) =>
  !!value && typeof value === "object"
  && typeof value.content === "string" && typeof value.text === "string";

/** A required string argument, trimmed. Missing or blank raises "<key> is required". */
export function requiredArg(args, key) {
  const value = String(args?.[key] || "").trim();
  if (!value) throw new ToolError(`${key} is required`);
  return value;
}

/** A clean miss on the interface becomes the instructive ToolError the CLI/chat expect —
 *  message-only, never a stack, no fabricated entity names. */
export function resolveOrThrow(svc, symbol, what) {
  const { match, candidates } = resolveSymbol(svc.graph, symbol);
  if (!match) {
    throw new ToolError(
      `no entity matching ${what} "${symbol}" in the code-map graph. ` +
        "Try a repo-relative path (e.g. path/to/module), a basename, or tmct_search for a fuzzy lookup.",
    );
  }
  return { match, candidates };
}

/** The shape most cold tools share: one required `symbol`, resolved, then rendered.
 *  `config.toolNamePrefix` (default "tmct_", set by e.g. seonix's own tool naming)
 *  threads through so a render's own follow-up hints stay accurate outside tmct. */
export const symbolHandler = (render) => (args, { graph, svc, config }) => {
  const { match } = resolveOrThrow(svc, requiredArg(args, "symbol"), "symbol");
  return render(graph, match, { toolNamePrefix: config?.toolNamePrefix });
};
