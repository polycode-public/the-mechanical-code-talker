// memory/prose-tokens.mjs — the memory store's own tokenizer. The store sits
// in the adapters layer and may not import the domain layer, while prose.mjs
// (the graph/ask side's canonical tokenizer) is domain and may not import
// adapters — so the store carries its own copy of the four primitives it
// stores tokens with. The two copies must stay byte-identical: the parity
// suite in test/adapters/memory-prose-tokens.test.mjs pins every function
// here to its prose.mjs twin, so a change to either side fails loudly until
// both move together.

const STOPWORDS = new Set(
  ("a an and or but the of to in on at for with from by as is are was were be been being " +
    "it its this that these those i you he she they we me my your our do does did not no " +
    "yes if then else than so such can will would should could may might about into over " +
    "under out up down off again more most some any all what which who whom whose when " +
    "where why how").split(/\s+/),
);

const MAX_TOKEN_LEN = 40;    // drops hash-like/garbage tokens
const MAX_TOKENS_PER_DOC = 120; // bounds cost on a pathologically long docstring/name

/** Split an identifier or a path-like name into lowercase word tokens.
 *  Handles camelCase, PascalCase, snake_case, kebab-case, dotted names, path
 *  separators, and acronym runs ("HTTPSConnection" -> https/connection,
 *  "parseXML" -> parse/xml). Filters single-character tokens (loop-variable noise). */
export function splitIdentifierWords(raw) {
  if (!raw) return [];
  let s = String(raw).replace(/\.[A-Za-z0-9]+$/, ""); // strip a trailing file extension only
  s = s
    .replace(/[/\\]/g, " ")            // path separators
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")     // camelCase / word|Digit boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")  // acronym run -> TitleCase (HTTPSConnection)
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ");
  return s.split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length > 1 && w.length <= MAX_TOKEN_LEN);
}

/** Tokenize free prose (a docstring/doc-comment) — lowercase words, punctuation stripped,
 *  common stopwords and single-/over-length tokens dropped, capped at MAX_TOKENS_PER_DOC. */
export function tokenizeProse(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || raw.length > MAX_TOKEN_LEN || STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= MAX_TOKENS_PER_DOC) break;
  }
  return out;
}

/** The combined, deduped, sorted token set for one individual: its (decomposed) name
 *  plus any captured doc text. Returns [] if there's nothing to index (never null). */
export function proseTokensFor({ name, doc } = {}) {
  const set = new Set([...splitIdentifierWords(name), ...tokenizeProse(doc)]);
  return [...set].sort();
}

/** Build the inverted index (word -> sorted, deduped [individual ids]) from individuals
 *  that already carry a `prose_tokens` attribute. Plain object, JSON-serializable —
 *  this is what lands as the payload's `proseIndex`. */
export function buildProseIndex(individuals) {
  const index = Object.create(null);
  for (const ind of individuals) {
    const tokAttr = (ind.attributes || []).find((a) => a.key === "prose_tokens");
    if (!tokAttr?.value) continue;
    for (const word of tokAttr.value.split(" ")) {
      if (!index[word]) index[word] = [];
      index[word].push(ind.id);
    }
  }
  for (const word of Object.keys(index)) index[word].sort();
  return index;
}
