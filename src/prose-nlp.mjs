// prose-nlp.mjs — the OPTIONAL wink-nlp lemma loader behind prose.mjs's LEMMA layer.
// Node-only, never inlined into the viewer bundle; loaded lazily and cached, so a
// checkout without the optional deps builds no lemma layer (honestly absent),
// never throws. Wink's lemmatiser is deterministic (no sampling), which is what
// keeps the built proseIndex byte-identical across builds.

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
