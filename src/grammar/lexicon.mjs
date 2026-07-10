// grammar/lexicon.mjs — thin re-export shim over @polycode-projects/ace-owl
// (PLAN_OSS_ACE_PARSER.md / PLAN_AGENTS.md §3's "ace-owl open-source
// extraction"). The declared lexicon behind tmct's ACE-OWL sub-fragment
// parser now lives in the extracted package (packages/ace-owl/src/
// lexicon.mjs) — this file exists ONLY to bind the package's neutral,
// caller-supplied namespace to tmct's own "tmct:" CURIE prefix, so every
// consumer in this repo (chat.mjs, extensions.mjs, the grammar/ontology
// tests, …) gets BYTE-IDENTICAL behaviour to before the extraction, with a
// single shared implementation instead of two copies drifting apart.
//
// Everything else (morphology, classify(), the committed starter vocabulary)
// is the package's — see packages/ace-owl/README.md for the full API and
// packages/ace-owl/src/lexicon-core.json for the vocabulary itself (also the
// canonical copy now; this repo no longer carries its own lexicon-core.json).
import * as aceOwl from "@polycode-projects/ace-owl";

export const TMCT_NS = "tmct:";

export const {
  DETERMINERS, QUANTIFIERS, numberOf, thirdPerson,
  lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
} = aceOwl;

/** loadLexicon(extra) — bound to tmct's own "tmct:" namespace, so the
 *  no-extra call stays the same cached, byte-identical lexicon it always
 *  was (see ace-owl's loadLexicon(extra, ns) — ns defaults to the package's
 *  own neutral "ex:" when not passed, which tmct never wants). */
export function loadLexicon(extra) {
  return aceOwl.loadLexicon(extra, TMCT_NS);
}

/** predicateOf(verbEntry) — bound to tmct's own "tmct:" namespace, same
 *  reasoning as loadLexicon above. */
export function predicateOf(verbEntry) {
  return aceOwl.predicateOf(verbEntry, TMCT_NS);
}

/** classify(word, lexicon?) — re-exported with `lexicon` re-defaulted to
 *  THIS module's own loadLexicon() (the "tmct:"-namespaced core), not the
 *  package's neutral default; every no-lexicon call site (chat.mjs,
 *  grammar/ace.mjs's own resolveNP, the grammar tests) must keep seeing
 *  "tmct:"-prefixed verb predicates in the classification it returns. */
export function classify(word, lexicon = loadLexicon()) {
  return aceOwl.classify(word, lexicon);
}
