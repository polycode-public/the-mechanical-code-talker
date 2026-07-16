// tmct_ask — a plain-English structural question answered from the graph in one
// mechanical, zero-model-call round-trip. See src/domain/ask.mjs.

import { ToolError } from "../../adapters/config.mjs";
import { ask } from "../../domain/ask.mjs";
import { requiredArg } from "./kit.mjs";

export function tmct_ask(args, { graph }) {
  const { content, tmct_ask: envelope } = ask(graph, requiredArg(args, "query"));
  // Every dispatchTool caller (the chat surface, the CLI fallback) expects a plain string —
  // append the structured envelope as a delimited, machine-parseable block rather than
  // changing that shared contract for one tool.
  return `${content}\n\n---tmct_ask---\n${JSON.stringify(envelope, null, 2)}`;
}
