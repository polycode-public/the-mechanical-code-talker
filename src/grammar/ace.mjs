// grammar/ace.mjs — thin re-export shim over @polycode-projects/ace-owl
// (PLAN_OSS_ACE_PARSER.md / PLAN_AGENTS.md §3's "ace-owl open-source
// extraction"). tmct's ACE-OWL sub-fragment parser — the 8 controlled-
// English sentence patterns of docs/references/schemas/ace-owl-fragment.md
// — is now the extracted package's ace.mjs (packages/ace-owl/src/ace.mjs);
// this file exists ONLY to default `lexicon` to tmct's own namespace-bound
// loadLexicon() (see ./lexicon.mjs), so every existing call site in this
// repo (chat.mjs, grammar/assert.mjs, the grammar tests, …) that calls
// `parseAce(sentence)` with no lexicon argument keeps getting "tmct:"-
// prefixed triples, byte-identical to before the extraction.
//
// tokenize() has no lexicon/namespace dependency at all, so it re-exports
// unchanged. See packages/ace-owl/README.md for the parser's full contract
// (pattern table, triple shape, the null-is-a-feature miss discipline).
import { parseAce as parseAceLib, tokenize } from "@polycode-projects/ace-owl";
import { loadLexicon } from "./lexicon.mjs";

export { tokenize };

/** parseAce(sentence, lexicon?) — `lexicon` defaults to this module's own
 *  loadLexicon() (the "tmct:"-namespaced core), not the package's neutral
 *  default. Every other call site (grammar/assert.mjs, chat.mjs, tests) is
 *  free to pass its own already-namespaced lexicon (e.g. from
 *  extensions.mjs's mergedLexiconExtra) exactly as before. */
export function parseAce(sentence, lexicon = loadLexicon()) {
  return parseAceLib(sentence, lexicon);
}
