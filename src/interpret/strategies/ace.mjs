// interpret/strategies/ace.mjs — the ACE-OWL controlled-fragment grammar wired
// into the interpretation pipeline as an ADDITIVE strategy (Stage 2, "ACE reach").
//
// The ACE engine (src/grammar/ace.mjs) has existed since Phase 2, but its pipeline
// ADAPTER was the "real and empty" seam the pipeline header names (interpret/
// pipeline.mjs). This file fills it. The contract is strictly ADD-ONLY:
//
//   · Its own class, "ace-fact" — DISJOINT from the graph-query strategies, so a
//     clean ACE parse is a distinct-class ALTERNATE ("if you mean X then …"), never
//     a same-class competitor that could displace a graph-query winner.
//   · It emits a candidate ONLY on a CLEAN parse (parseAce returns triples). A
//     structural-fit-with-residue (empty triples) or a total miss returns null, so
//     a query sentence that merely LOOKS relation-shaped ("which modules import X",
//     whose ACE residue is the "which") contributes nothing — fitting the grammar
//     is a strong signal; missing it is a FEATURE and the tolerant strategies win.
//
// WHY ASYNC — the byte-stability guarantee. ask.mjs's parseQuery (the CHATBENCH
// chat-facing path) runs strategies through runStrategiesSync, which — by the
// pipeline's documented contract — SKIPS any Promise-returning strategy ("an async
// strategy can only participate via interpret()"). Registering ACE async therefore
// makes the sync parseQuery path PROVABLY untouched (CHATBENCH neutral, byte-for-
// byte) while interpret() — the async pipeline — gains the declarative-fragment
// reach. The work parseAce does is synchronous; the async wrapper is deliberate,
// the mechanical seam that keeps the chat spine frozen. (grammar/ace.mjs itself is
// imported UNCHANGED — no chat-facing edit.)

import { parseAce } from "../../grammar/ace.mjs";

/** Adapter: a clean ACE parse -> one candidate in its own class; anything else
 *  (residue-only structural fit, or a hard miss) -> null. `via:"exact"` — a
 *  controlled-grammar fit is exact evidence, never an approximate rewrite. */
export function runAce(text) {
  let parsed = null;
  try { parsed = parseAce(text); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.triples) || parsed.triples.length === 0) return null;
  return { strategyId: "ace", class: "ace-fact", candidates: [{ parsed, confidence: 0.85, via: "exact", note: `ACE ${parsed.pattern}` }] };
}

/** Pipeline registration (interpret/pipeline.mjs). ASYNC on purpose (see file
 *  header): it participates in interpret() but is SKIPPED by runStrategiesSync,
 *  so parseQuery — and the CHATBENCH spine it feeds — is byte-stable. */
export const aceStrategy = {
  id: "ace",
  class: "ace-fact",
  // eslint-disable-next-line require-await
  async run(text) {
    return runAce(text);
  },
};
