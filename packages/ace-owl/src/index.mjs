// index.mjs — ace-owl's public surface. A deterministic, dependency-free
// controlled-English → OWL-triples parser (see README.md for the pattern
// table and full API description).
export {
  parseAce, tokenize,
  PATTERNS,
  PATTERN_SUB_CLASS_OF, PATTERN_TYPE_ASSERTION, PATTERN_RELATION, PATTERN_SOME_VALUES_FROM,
  PATTERN_CARDINALITY, PATTERN_DISJOINT_WITH, PATTERN_POSSESSIVE, PATTERN_ADJECTIVE,
} from "./ace.mjs";

export {
  loadLexicon, classify, predicateOf, numberOf, thirdPerson,
  lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
  DETERMINERS, QUANTIFIERS, DEFAULT_NS,
} from "./lexicon.mjs";
