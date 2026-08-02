// tmct_ask — a plain-English structural question answered from the graph in one
// mechanical, zero-model-call round-trip. See src/domain/ask.mjs.
//
// A question the graph misses is offered to `factLookup` (the caller-injected
// memory reader — see runHandler's docblock) before the miss stands, so a term
// the same repo's memory store already holds answers here the way it answers in
// chat. With no reader supplied, nothing changes: the graph miss is the answer.

import { ask } from "../../domain/ask.mjs";
import { requiredArg, toolResult } from "./kit.mjs";

/** The flat string a dispatchTool caller gets carries the envelope in-band, behind this
 *  delimiter, because a string is all that entry can hand back. Exported so the surfaces
 *  that still read that string split it on the one constant rather than their own copy. */
export const ASK_ENVELOPE_DELIM = "\n\n---tmct_ask---\n";

export async function tmct_ask(args, { graph, factLookup = null }) {
  const query = requiredArg(args, "query");
  const { content, tmct_ask: envelope } = ask(graph, query);
  let text = content;
  let answered = envelope;
  if (envelope?.miss && typeof factLookup === "function") {
    let fromMemory = null;
    try { fromMemory = await factLookup(query, envelope); } catch { fromMemory = null; }
    // A reader hit flagged `miss` is the same refusal in better words, so the
    // envelope keeps its miss and only the prose improves.
    if (fromMemory?.text) {
      text = fromMemory.replace ? fromMemory.text : `${content}\n${fromMemory.text}`;
      answered = {
        ...envelope,
        miss: Boolean(fromMemory.miss),
        matchedVia: fromMemory.miss ? envelope.matchedVia : "memory",
      };
    }
  }
  return toolResult({
    content: text,
    data: answered,
    text: `${text}${ASK_ENVELOPE_DELIM}${JSON.stringify(answered, null, 2)}`,
  });
}
