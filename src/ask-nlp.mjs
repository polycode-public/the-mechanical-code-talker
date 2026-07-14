// ask-nlp.mjs — the optional wink-nlp adapter behind ask.mjs's lemma/POS tier.
// Loaded lazily via src/wink-model.mjs; failure is cached as null, never a throw.

import { winkInstance } from "./wink-model.mjs";

let cached; // undefined = not tried yet; null = unavailable

/** Lazily build the {lemma, posTags} adapter, or null when wink isn't loadable. */
export function nlpAdapter() {
  if (cached !== undefined) return cached;
  try {
    const nlp = winkInstance();
    if (!nlp) { cached = null; return cached; }
    const its = nlp.its;
    cached = {
      /** Lowercase lemma of a single token ("imported" -> "import"). */
      lemma(word) {
        const w = String(word || "");
        try {
          const out = nlp.readDoc(w).tokens().out(its.lemma);
          return String(out[0] || w).toLowerCase();
        } catch {
          return w.toLowerCase();
        }
      },
      /** True when wink's lexicon flags the word as an English stop word. */
      isStopWord(word) {
        try {
          const out = nlp.readDoc(String(word || "")).tokens().out(its.stopWordFlag);
          return out[0] === true;
        } catch {
          return false;
        }
      },
      /** UPOS tags aligned to the caller's word array. wink re-tokenizes, so
       *  each input word is greedily matched to the run of wink tokens that
       *  spell it and takes its first sub-token's tag. */
      posTags(words) {
        try {
          const toks = nlp.readDoc(words.join(" ")).tokens();
          const texts = toks.out();
          const tags = toks.out(its.pos);
          const out = [];
          let k = 0;
          for (const w of words) {
            if (k >= texts.length) { out.push(null); continue; }
            out.push(tags[k]);
            let acc = texts[k];
            k += 1;
            while (acc.length < w.length && k < texts.length) { acc += texts[k]; k += 1; }
          }
          return out;
        } catch {
          return words.map(() => null);
        }
      },
    };
  } catch {
    cached = null;
  }
  return cached;
}
