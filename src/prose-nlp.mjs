// prose-nlp.mjs — the OPTIONAL wink-nlp lemma loader behind prose.mjs's LEMMA layer.
//
// Kept SEPARATE from ask-nlp.mjs (its own `proseLemma` export shape) rather than an
// import of that ask-engine surface — but both now share the neutral leaf loader
// src/wink-model.mjs, so the wink model is resolved in ONE place. The former ~20
// duplicated createRequire lines are gone; the coupling this file avoids is to
// ask-nlp.mjs's export shape, not to a leaf model loader.
//
// BOUNDARY (same as ask-nlp.mjs, hard): Node-only path, never inlined into the
// viewer bundle. prose.mjs is itself never inlined by viz.mjs's askSource(), so
// nothing browser-side can reach this module. The wink pair is loaded lazily (Node
// createRequire fallback, or the browser registration seam), failure cached as null:
// a checkout without the optional deps simply builds no lemma layer (honestly
// absent), it never throws.
//
// Determinism: wink's lemmatiser is a fixed trained model with no sampling — the
// same token always yields the same lemma across runs and processes, which is what
// lets the lemma layer meet the "byte-identical proseIndex across builds" contract.

import { winkInstance } from "./wink-model.mjs";

let cached; // undefined = not tried yet; null = unavailable (tried once, honestly off)

/** Lazily build a `lemma(word) -> string` function, or null when wink isn't loadable.
 *  Results are memoized per token: the layer build lemmatises each unique vocabulary
 *  token once, not once per posting. */
export function proseLemma() {
  if (cached !== undefined) return cached;
  try {
    const nlp = winkInstance();
    if (!nlp) { cached = null; return cached; }
    const its = nlp.its;
    const memo = new Map();
    cached = (word) => {
      const w = String(word || "");
      if (memo.has(w)) return memo.get(w);
      let out;
      try {
        out = String(nlp.readDoc(w).tokens().out(its.lemma)[0] || w).toLowerCase();
      } catch {
        out = w.toLowerCase();
      }
      memo.set(w, out);
      return out;
    };
  } catch {
    cached = null;
  }
  return cached;
}
