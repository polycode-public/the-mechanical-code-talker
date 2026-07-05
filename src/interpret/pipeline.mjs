// interpret/pipeline.mjs — the multi-strategy interpretation pipeline (ROADMAP
// item 8): run the request through ALL the classes of thing it could be, parse it
// with each class's own strategy, then merge same-class results and surround
// distinct-class results with "if you mean X then …" (interpret/merge.mjs).
//
// A STRATEGY is a plain object:
//   { id, class, run(text, ctx) -> {strategyId, class, candidates:[{parsed,
//     confidence?, note?, via?}]} | null }
// `via` marks an APPROXIMATE reading ("fuzzy"/"lemma"/"spell"): the merge
// discards approximate candidates whenever anything parsed exactly (the tier
// discipline — exact curated match always wins — held across strategies).
// `run` may be sync or async (Promise-returning); a strategy that THROWS or
// rejects is dropped for that request — one broken strategy never takes the
// pipeline down. Strategies are registered in the STRATEGIES array below in
// PRECEDENCE order (earlier wins same-class dedupe ties and confidence ties) —
// a new strategy (e.g. the Phase-2 ACE grammar, interpret/strategies/ace.mjs)
// joins by pushing an entry here, not by editing the pipeline.
//
// NORMALIZATION PRE-PASS (ROADMAP item 10): interpret() normalizes the input
// once (normalizeInput below — the same §3.5 pipeline + rhetorical frames
// ask.mjs always ran) and hands every strategy the normalized text; the raw
// text rides along in ctx.raw, and the returned record says whether
// normalization changed the input (`normalizationChanged`), so a repaired
// spelling/contraction is on the record, never silent.

import { normalizeQuery, applyNegationFrames, applyPhrasingFrames } from "./normalize.mjs";
import { grammarStrategy } from "./strategies/grammar.mjs";
import { keywordSpotStrategy } from "./strategies/keywords.mjs";
import { noiseStripStrategy } from "./strategies/noise-strip.mjs";
import { mergeStrategyResults } from "./merge.mjs";
// Optional Node-only wink adapter — same viewer-bundle boundary as ask.mjs: an
// inlining bundle strips this import and the `typeof` read below degrades to
// adapter-less parsing instead of throwing over an undeclared identifier.
import { nlpAdapter } from "../ask-nlp.mjs";

/** The registered strategies, in precedence order. grammar + keyword-spot are
 *  the two legacy parsers (one shared class, "graph-query" — their merge is
 *  byte-identical to the original two-way agree/disagree behavior); noise-strip
 *  is the item-10 tolerant fallback (its own class; it only fires when the
 *  anchored grammar missed the text as-given, so it can never displace an
 *  existing template parse). interpret/strategies/ace.mjs (Phase 2) will
 *  register here the same way. */
export const STRATEGIES = [grammarStrategy, keywordSpotStrategy, noiseStripStrategy];

/** The documented normalization pre-pass: whitespace-collapse + the §3.5
 *  normalization pipeline + the closed rhetorical-frame rewrites, applied ONCE
 *  before any strategy runs. Returns {raw, text, changed}. */
export function normalizeInput(input) {
  const raw = String(input || "").trim().replace(/\s+/g, " ");
  const text = raw ? applyPhrasingFrames(applyNegationFrames(normalizeQuery(raw))) : "";
  return { raw, text, changed: text !== raw };
}

function defaultNlp() {
  return typeof nlpAdapter === "function" ? nlpAdapter() : null;
}

/** Synchronous strategy run — the path ask.mjs's parseQuery routes through (its
 *  callers are synchronous). Skips a strategy that returns a Promise (an async
 *  strategy can only participate via interpret()); a throwing strategy is
 *  dropped, never a crash. Returns the strategy results in precedence order. */
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
 *  `ctx.strategies` overrides the registry (tests, embedders); `ctx.nlp`
 *  overrides the lemma/POS adapter exactly as ask()'s own option does. Pure
 *  given (text, strategies, adapter) — no graph access here: resolving terms
 *  against a graph stays ask.mjs's job downstream. */
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
