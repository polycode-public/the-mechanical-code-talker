// tmct_ask — a plain-English structural question answered from the graph in one
// mechanical, zero-model-call round-trip. See src/domain/ask.mjs.

import { ask } from "../../domain/ask.mjs";
import { requiredArg, toolResult } from "./kit.mjs";

/** The flat string a dispatchTool caller gets carries the envelope in-band, behind this
 *  delimiter, because a string is all that entry can hand back. Exported so the surfaces
 *  that still read that string split it on the one constant rather than their own copy. */
export const ASK_ENVELOPE_DELIM = "\n\n---tmct_ask---\n";

export function tmct_ask(args, { graph }) {
  const { content, tmct_ask: envelope } = ask(graph, requiredArg(args, "query"));
  return toolResult({
    content,
    data: envelope,
    text: `${content}${ASK_ENVELOPE_DELIM}${JSON.stringify(envelope, null, 2)}`,
  });
}
