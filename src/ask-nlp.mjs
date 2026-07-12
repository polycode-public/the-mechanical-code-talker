// ask-nlp.mjs — the OPTIONAL wink-nlp adapter behind ask.mjs's lemma/POS tier.
//
// wink-nlp and wink-eng-lite-web-model are loaded through the shared leaf loader
// src/wink-model.mjs (Node `createRequire` fallback + a browser registration seam),
// so this file no longer carries its own Node-only load block. The load happens
// lazily on first use and failure is cached as null: a checkout without the optional
// deps installed answers exactly like the browser bundle, it never throws.

import { winkInstance } from "./wink-model.mjs";

let cached; // undefined = not tried yet; null = unavailable (tried once, honestly off)

/** Lazily build the {lemma, posTags} adapter, or null when wink isn't loadable.
 *  Deterministic: wink-nlp's tagger/lemmatiser is a fixed model with no sampling,
 *  so the same input always yields the same tags/lemmas across processes. */
export function nlpAdapter() {
  if (cached !== undefined) return cached;
  try {
    const nlp = winkInstance();
    if (!nlp) { cached = null; return cached; }
    const its = nlp.its;
    cached = {
      /** Lowercase lemma of a single token ("imported" -> "import"); the word
       *  itself when wink has nothing better (unknown words come back as-is). */
      lemma(word) {
        const w = String(word || "");
        try {
          const out = nlp.readDoc(w).tokens().out(its.lemma);
          return String(out[0] || w).toLowerCase();
        } catch {
          return w.toLowerCase();
        }
      },
      /** True when wink's lexicon flags the word as an English stop word
       *  ("anyway", "well", "also", …). Consulted by the noise-strip strategy
       *  (interpret/strategies/noise-strip.mjs) as its wink tier — the strategy's
       *  own KEEP set screens out the grammar's load-bearing words (which/what/
       *  does/…) BEFORE this is asked, so wink flagging a question word is
       *  harmless by construction. False on any surprise, never a throw. */
      isStopWord(word) {
        try {
          const out = nlp.readDoc(String(word || "")).tokens().out(its.stopWordFlag);
          return out[0] === true;
        } catch {
          return false;
        }
      },
      /** UPOS tags aligned to the CALLER's word array. wink re-tokenizes (it
       *  splits "walk.mjs" into three tokens), so each input word is greedily
       *  matched to the run of wink tokens that spell it and takes its FIRST
       *  sub-token's tag; null per word on any surprise, never a throw. */
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
