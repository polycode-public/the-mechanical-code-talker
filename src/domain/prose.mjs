// prose.mjs — the second-pass prose extraction + cross-reference index.
// Deterministic, no model calls: tokenizes each individual's decomposed name
// plus any captured `doc` text into a combined set, stored both as a
// `prose_tokens` attribute (self-describing) and inverted into
// `entities.proseIndex` (word -> ids) for O(1) lookup.

export const STOPWORDS = new Set(
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

/** A real content word: plain alphanumerics, no stopword. Tokenizers that re-admit
 *  stopwords (splitIdentifierWords, tokenizeBlock) narrow their output through this —
 *  unfiltered, shared stopwords alone would relate or cluster almost any two texts. */
export const isContentToken = (t) => /^[a-z0-9]+$/.test(t) && !STOPWORDS.has(t);

/** Wrap a block tokenizer so it yields only content tokens. */
export function makeContentTokens(tokenizeBlock) {
  return (text) => tokenizeBlock(text).filter(isContentToken);
}

/** Attach a `prose_tokens` attribute to every individual, from its (decomposed)
 *  name and captured doc text — except Commit, whose `label` is a truncated
 *  SHA, not a decomposable identifier: it tokenizes `message` instead. Mutates
 *  and returns the same array; `enabled=false` is a no-op. */
export function attachProseTokens(individuals, { enabled = true } = {}) {
  if (!enabled) return individuals;
  for (const ind of individuals) {
    const attrs = ind.attributes || [];
    const isCommit = ind.class === "Commit";
    const name = isCommit ? null : ind.label;
    const doc = isCommit
      ? attrs.find((a) => a.key === "message")?.value
      : attrs.find((a) => a.key === "doc")?.value;
    const tokens = proseTokensFor({ name, doc });
    if (tokens.length) {
      ind.attributes = [...(ind.attributes || []), { prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }];
    }
  }
  return individuals;
}

/** Build the inverted index (word -> sorted, deduped [individual ids]) from individuals
 *  that already carry a `prose_tokens` attribute (i.e. after attachProseTokens ran).
 *  Plain object, JSON-serializable — this is what lands as `entities.proseIndex`. */
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

/** Consumer-facing lookup: individual ids whose prose tokens overlap `query` (free text,
 *  tokenized the same way as a docstring), ranked by overlap count (most shared words
 *  first). This is the integration point for ask.mjs's resolveObject (fuzzy object-term
 *  resolution beyond exact/substring match) and codegraph.mjs's scoreModules (a lexical
 *  boost source); not wired into either file here.
 *  `proseIndex` is `entities.proseIndex` (buildProseIndex's output). */
export function lookupByProseTokens(proseIndex, query, { limit = 10 } = {}) {
  const queryTokens = [...new Set([...splitIdentifierWords(query), ...tokenizeProse(query)])];
  if (!queryTokens.length) return [];
  const scoreById = new Map();
  for (const word of queryTokens) {
    for (const id of proseIndex?.[word] || []) {
      scoreById.set(id, (scoreById.get(id) || 0) + 1);
    }
  }
  return [...scoreById.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, score]) => ({ id, score }));
}

/** Read accessor for the NORMALISED prose layers (spell-corrected /
 *  canonical-schema-term / stem / lemma) under `proseIndex["tmct:layers"] =
 *  { layerName: { normalisedToken: [id, …] } }`, so a query word that only
 *  overlaps a module via a normalised form still resolves. Returns
 *  { ids, via } (deduped/sorted ids, the layer names that matched); a safe
 *  no-op `{ ids: [], via: null }` on an absent/pre-layers proseIndex. */
export function proseLayerHits(proseIndex, token) {
  const src = proseIndex && (proseIndex["tmct:layers"] ? proseIndex : proseIndex.proseIndex);
  const layers = src && src["tmct:layers"];
  const t = String(token || "").toLowerCase();
  const empty = { ids: [], via: null };
  if (!t || !layers || typeof layers !== "object") return empty;
  const ids = new Set();
  const via = new Set();
  for (const name of Object.keys(layers)) {
    const layer = layers[name];
    if (!layer || typeof layer !== "object") continue;
    const posting = layer[t];
    const list = Array.isArray(posting) ? posting : Array.isArray(posting?.ids) ? posting.ids : null;
    if (!list?.length) continue;
    for (const id of list) ids.add(id);
    via.add(name);
  }
  return ids.size ? { ids: [...ids].sort(), via: [...via].sort().join("+") } : empty;
}
