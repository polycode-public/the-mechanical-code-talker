// What every per-tool handler module shares: the argument contract, the resolve-or-miss
// contract, and the one shape most cold tools have (take a symbol, resolve it, render it).

import { ToolError } from "../../adapters/config.mjs";
import { resolveSymbol } from "../../domain/codegraph.mjs";

export const SNIPPET_MAX_LINES = 200;

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

/** The shape most cold tools share: one required `symbol`, resolved, then rendered. */
export const symbolHandler = (render) => (args, { graph, svc }) => {
  const { match } = resolveOrThrow(svc, requiredArg(args, "symbol"), "symbol");
  return render(graph, match);
};
