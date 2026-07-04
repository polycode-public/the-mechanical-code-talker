// prose-nlp.mjs — the OPTIONAL wink-nlp lemma loader behind prose.mjs's LEMMA layer.
//
// Deliberately a SEPARATE loader from ask-nlp.mjs (same createRequire pattern, same
// deps) rather than an import of it: ask-nlp.mjs belongs to the ask-engine surface
// and is under active concurrent work — the prose pre-pass must not couple its
// index-build path to that file's export shape. The ~20 duplicated lines are the
// decoupling fee; the wink model itself is loaded lazily and at most once per
// process either way.
//
// BOUNDARY (same as ask-nlp.mjs, hard): Node-only, never inlined into the viewer
// bundle. prose.mjs is itself never inlined by viz.mjs's askSource(), so nothing
// browser-side can reach this module. wink-nlp + wink-eng-lite-web-model are CJS —
// loaded via createRequire, lazily, with failure cached as null: a checkout without
// the optional deps simply builds no lemma layer (honestly absent), it never throws.
//
// Determinism: wink's lemmatiser is a fixed trained model with no sampling — the
// same token always yields the same lemma across runs and processes, which is what
// lets the lemma layer meet the "byte-identical proseIndex across builds" contract.

import { createRequire } from "node:module";

let cached; // undefined = not tried yet; null = unavailable (tried once, honestly off)

/** Lazily build a `lemma(word) -> string` function, or null when wink isn't loadable.
 *  Results are memoized per token: the layer build lemmatises each unique vocabulary
 *  token once, not once per posting. */
export function proseLemma() {
  if (cached !== undefined) return cached;
  try {
    const require = createRequire(import.meta.url);
    const winkNLP = require("wink-nlp");
    const model = require("wink-eng-lite-web-model");
    const nlp = winkNLP(model);
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
