// phrase-exports.mjs — the package's `./phrase` export subpath: how tmct
// renders a stored fact and its provenance, reachable without pulling in the
// chat engine the "." entry carries. An embedding host that shows tmct's own
// answers back to its users renders the same rows the same way tmct does,
// rather than re-deriving English from raw CURIEs.
//
// Everything here is pure and synchronous: no graph, no store, no I/O.

// The predicate -> English reader the answer path itself uses, plus the table
// behind it and the verb-surface folds it stands on.
export {
  FACT_PREDICATE_PHRASES,
  predicatePhrase,
  factSentence,
  thirdPersonSingularSurface,
  baseVerbSurface,
  gerundVerbSurface,
} from "./fact-phrase.mjs";

// Provenance: the `reference:<pack>:<Title>@<revid>` tag a reference-grounded
// fact carries, turned back into the revision-pinned article link tmct cites.
export {
  referenceTagToUrl,
  articleUrlFor,
  REFERENCE_PACK_NAME,
  REFERENCE_PACK_ORIGIN,
  LIVE_PACK_NAME,
  LIVE_PACK_ORIGIN,
} from "./reference-pack.mjs";
