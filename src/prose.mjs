// prose.mjs — the second-pass prose extraction + cross-reference index (PLAN_PROSE_INDEX.md).
//
// Deterministic, zero-model-calls, zero dependencies: pure string transforms + a plain-object
// inverted index over data extract.mjs's typed pass has already produced (identifier names,
// captured doc text). Two token sources, one combined set per individual:
//   1. identifier decomposition — names are often literal sentence fragments
//      ("calculateTotalPriceIncludingTax" -> calculate/total/price/including/tax); splitting
//      them turns every symbol/module name into free-text search surface for zero extra cost.
//   2. prose literals — docstrings/doc-comments already captured as the `doc` attribute.
//      Python (extract_ast.py) and JS/TS (jsts_tsc.mjs's firstDocLine) already populate this;
//      C#/Java's PRIMARY extractors (cs_roslyn.mjs, java_javaparser.mjs) shell out to compiled
//      Roslyn/JavaParser binaries — adding doc capture there means modifying and rebuilding
//      external .NET/JVM tooling, not a JS-side change. Deliberately deferred (PLAN_PROSE_INDEX.md
//      backlog); this pass consumes whatever `doc` is already present, regardless of source
//      language, so C#/Java modules still get identifier-decomposition tokens today.
//
// Tokenizer pattern (stopwords, length bounds, per-doc token cap) mirrors marginalia's
// app/lib/text-index.mjs — a proven lexical-inverted-index tokenizer for the same "search by
// keyword, no embeddings, no stemmer dependency" problem, adapted for code identifiers.
//
// Storage: (a) a `prose_tokens` attribute (space-joined, deduped, sorted) on each individual —
// the graph stays self-describing, works if a consumer only has one individual in hand; AND
// (b) a real inverted index (word -> [individual ids]) built from those same tokens and
// attached as `entities.proseIndex` — an O(1) word lookup for consumers (resolveObject-style
// fuzzy object-term resolution, scoreModules-style lexical boosting) instead of scanning every
// individual's attributes. Both are derived from the identical token set, so they can never
// disagree; (b) is just (a) inverted once, cheaply, at build time.

const STOPWORDS = new Set(
  ("a an and or but the of to in on at for with from by as is are was were be been being " +
    "it its this that these those i you he she they we me my your our do does did not no " +
    "yes if then else than so such can will would should could may might about into over " +
    "under out up down off again more most some any all what which who whom whose when " +
    "where why how").split(/\s+/),
);

const MAX_TOKEN_LEN = 40;    // drops hash-like/garbage tokens (marginalia text-index.mjs)
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

/** Second pass (PLAN_PROSE_INDEX.md): attach a `prose_tokens` attribute to every
 *  individual in `individuals`, deriving tokens from its name and captured prose text.
 *  Class-aware source selection: Module/Function/Method/Class/Attribute/GlobalVariable use
 *  `label` (a real identifier/path — decomposable, e.g. "calculateTotalPrice") + a `doc`
 *  attribute if present (docstring/doc-comment). Commit is different: its `label` is a
 *  truncated SHA (hex noise if decomposed, e.g. "e6a9419567f7" -> "9419567" garbage) — skip
 *  decomposing it and tokenize its `message` attribute instead, which is the real prose
 *  (commit messages are often the richest free text in the whole graph). Mutates and
 *  returns the same array — safe to call once after the typed individuals are built.
 *  `enabled=false` is a no-op (the disable path `SEONIX_PROSE_INDEX=0` in extract.mjs), so
 *  the core typed graph is never affected by turning this pass off. */
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
 *  boost source) — see PLAN_PROSE_INDEX.md for the exact call-site recommendation; not
 *  wired into either file here to avoid colliding with concurrent work on them.
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

/** OPT-IN read accessor for codegraph.mjs's `proseLayers` locate signal (this file's index
 *  build is unchanged — this only READS the layers the pre-pass already wrote). Given a query
 *  `token`, return the individual ids reachable through the NORMALISED prose layers
 *  (spell-corrected / canonical-schema-term / stem / lemma) stored under
 *  `proseIndex["seonix:layers"]` — the same normalised layers ask.mjs's resolveObject consults,
 *  here surfaced for the locate SCORER so a task-text word that only overlaps a module via a
 *  normalised form still resolves.
 *
 *  Layer shape consumed (an inverted index keyed by the NORMALISED token, mirroring the verbatim
 *  top level, just normalised):
 *    proseIndex["seonix:layers"] = { <layerName>: { <normalisedToken>: [id, …] }, … }
 *  A posting may be a plain id array or `{ ids: [...] }` — both are tolerated. The raw query
 *  token is looked up directly against every layer's keys, so a token whose surface form is
 *  already a canonical/stem/lemma/spell-corrected key hits; the accessor never itself normalises
 *  the query (it owns no normaliser — those live in the concurrent ask/prose-nlp surface), so it
 *  can never disagree with the build's normalisation, only under-fire safely.
 *
 *  Returns { ids, via }: `ids` a deduped, sorted (stable/deterministic) id list; `via` the
 *  sorted layer names that produced them, joined with "+", for a scorer's provenance — or null
 *  when nothing hit. Absent / malformed / pre-layers `proseIndex` → { ids: [], via: null }: a
 *  safe no-op, so the opt-in flag degrades to nothing on a graph indexed before layers existed.
 *  Accepts either a `proseIndex` object or a parsed graph (reads its `.proseIndex`). */
export function proseLayerHits(proseIndex, token) {
  const src = proseIndex && (proseIndex["seonix:layers"] ? proseIndex : proseIndex.proseIndex);
  const layers = src && src["seonix:layers"];
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
