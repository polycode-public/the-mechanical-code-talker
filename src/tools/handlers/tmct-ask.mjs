// tmct_ask — a plain-English structural question answered from the graph in one
// mechanical, zero-model-call round-trip. See src/domain/ask.mjs.
//
// SYNCHRONOUS, and callers rely on it: the browser's code explorer imports this
// function directly and reads the envelope off the return, twice per relation
// kind, to build its sidebar. Anything that has to await — the memory fallback a
// cold surface supplies — composes AROUND this at dispatch, never inside it.
// See askWithMemoryFallback in ../server.mjs.

import { ask } from "../../domain/ask.mjs";
import { requiredArg, toolResult } from "./kit.mjs";

/** The flat string a dispatchTool caller gets carries the envelope in-band, behind this
 *  delimiter, because a string is all that entry can hand back. Exported so the surfaces
 *  that still read that string split it on the one constant rather than their own copy. */
export const ASK_ENVELOPE_DELIM = "\n\n---tmct_ask---\n";

/** One answer + envelope as a tool result. Shared with the memory fallback, so
 *  both spellings of an answered ask carry the envelope in the same three
 *  places (prose, structured data, and the in-band string). */
export function askToolResult(content, envelope) {
  return toolResult({
    content,
    data: envelope,
    text: `${content}${ASK_ENVELOPE_DELIM}${JSON.stringify(envelope, null, 2)}`,
  });
}

export function tmct_ask(args, { graph }) {
  const { content, tmct_ask: envelope } = ask(graph, requiredArg(args, "query"));
  return askToolResult(content, envelope);
}
