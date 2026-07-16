// interpret/strategies/ace.mjs — the ACE-OWL controlled-fragment grammar
// (src/domain/grammar/ace.mjs) wired into the pipeline as an additive strategy: its
// own class ("ace-fact"), so a clean parse surfaces as an alternate, never
// displacing a graph-query winner.

import { parseAce } from "../../grammar/ace.mjs";

/** A clean ACE parse -> one candidate; a residue-only fit or a miss -> null. */
export function runAce(text) {
  let parsed = null;
  try { parsed = parseAce(text); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.triples) || parsed.triples.length === 0) return null;
  return { strategyId: "ace", class: "ace-fact", candidates: [{ parsed, confidence: 0.85, via: "exact", note: `ACE ${parsed.pattern}` }] };
}

/** Registered ASYNC so runStrategiesSync (the sync parseQuery path) skips it,
 *  keeping that path byte-stable. */
export const aceStrategy = {
  id: "ace",
  class: "ace-fact",
  // eslint-disable-next-line require-await
  async run(text) {
    return runAce(text);
  },
};
