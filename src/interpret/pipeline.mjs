// interpret/pipeline.mjs — the multi-strategy interpretation pipeline: run
// the request through every strategy, merge same-class results, and surround
// distinct-class results with "if you mean X then …" (interpret/merge.mjs).
//
// A STRATEGY is { id, class, run(text, ctx) -> {strategyId, class,
// candidates:[{parsed, confidence?, note?, via?}]} | null }. `via` marks an
// APPROXIMATE reading ("fuzzy"/"lemma"/"spell"), discarded whenever anything
// parsed exactly. `run` may be sync or async; a throwing/rejecting strategy
// is dropped rather than taking the pipeline down. Registered in STRATEGIES
// below, in precedence order.

import { normalizeQuery, applyNegationFrames, applyPhrasingFrames } from "./normalize.mjs";
import { grammarStrategy } from "./strategies/grammar.mjs";
import { keywordSpotStrategy } from "./strategies/keywords.mjs";
import { noiseStripStrategy } from "./strategies/noise-strip.mjs";
// The next three are Node-only (fs/path-reading tooling); an inlining viewer
// bundle strips them, and the `typeof` guards below degrade to a leaner
// registry instead of throwing on an undeclared identifier.
import { aceStrategy } from "./strategies/ace.mjs";
import { constructionsStrategy } from "./strategies/constructions.mjs";
import { mergeStrategyResults } from "./merge.mjs";
import { nlpAdapter } from "../ask-nlp.mjs";

/** Registered strategies, in precedence order: grammar + keyword-spot (shared
 *  "graph-query" class), noise-strip (fires only when the anchored grammar
 *  misses), then the optional ACE and construction-grammar strategies, each
 *  in its own class so it surfaces as an alternate rather than colliding with
 *  a graph-query guess. ACE is async-only, so it participates via interpret()
 *  only, not the sync parseQuery path. */
// eslint-disable-next-line no-undef
const OPTIONAL_STRATEGIES = [
  ...(typeof aceStrategy !== "undefined" ? [aceStrategy] : []),
  // eslint-disable-next-line no-undef
  ...(typeof constructionsStrategy !== "undefined" ? [constructionsStrategy] : []),
];
export const STRATEGIES = [grammarStrategy, keywordSpotStrategy, noiseStripStrategy, ...OPTIONAL_STRATEGIES];

/** Whitespace-collapse + normalization pipeline + rhetorical-frame rewrites,
 *  applied once before any strategy runs. Returns {raw, text, changed}. */
export function normalizeInput(input) {
  const raw = String(input || "").trim().replace(/\s+/g, " ");
  const text = raw ? applyPhrasingFrames(applyNegationFrames(normalizeQuery(raw))) : "";
  return { raw, text, changed: text !== raw };
}

function defaultNlp() {
  return typeof nlpAdapter === "function" ? nlpAdapter() : null;
}

/** Synchronous strategy run (ask.mjs's parseQuery path). Skips a Promise-
 *  returning strategy and drops a throwing one; returns results in precedence order. */
export function runStrategiesSync(text, ctx = {}, strategies = STRATEGIES) {
  const results = [];
  for (const s of strategies) {
    try {
      const r = s.run(text, ctx);
      if (r && typeof r.then !== "function") results.push(r);
    } catch {
      // dropped — one broken strategy never takes the request down
    }
  }
  return results;
}

/** The pipeline entry point: normalize once, run every registered strategy over
 *  the normalized text (Promise.all — strategies are independent), merge, and
 *  return the full interpretation record:
 *    { raw, normalized, normalizationChanged,
 *      results,                    // every strategy's own result, precedence order
 *      parsed, class,              // the merged winner (parsed may be the legacy
 *                                  //   {ambiguousParse, candidates} tie), or null
 *      alternates }                // distinct-class runners-up for the
 *                                  //   "if you mean X then …" surround
 *  `ctx.strategies`/`ctx.nlp` override the registry/lemma adapter. No graph
 *  access here — resolving terms against a graph is ask.mjs's job. */
export async function interpret(text, ctx = {}) {
  const strategies = ctx.strategies || STRATEGIES;
  const { raw, text: normalized, changed } = normalizeInput(text);
  const record = {
    raw, normalized, normalizationChanged: changed,
    results: [], parsed: null, class: null, alternates: [],
  };
  if (!normalized) return record;
  const runCtx = { ...ctx, nlp: ctx.nlp === undefined ? defaultNlp() : ctx.nlp, raw };
  const settled = await Promise.all(strategies.map(async (s) => {
    try {
      return (await s.run(normalized, runCtx)) || null;
    } catch {
      return null; // dropped — a rejecting/throwing strategy never crashes interpret
    }
  }));
  record.results = settled.filter((r) => r && Array.isArray(r.candidates) && r.candidates.length);
  const merged = mergeStrategyResults(record.results);
  if (merged) {
    record.parsed = merged.parsed;
    record.class = merged.class;
    record.alternates = merged.alternates;
  }
  return record;
}
