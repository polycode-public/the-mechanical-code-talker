// corpus/conceptnet.mjs — the ConceptNet slice loader + memory seeder
// (ROADMAP Phase 2, "ConceptNet corpus slice").
//
//   loadSlice(path?)        stream corpus/conceptnet/slice.jsonl → assertions
//   loadMap(path?)          src/corpus/conceptnet-map.toml → Map(rel → row)
//   toFacts(assertions,map) assertions → appendFact-shaped triples
//   seedMemory(dir, opts)   write them into <dir>/.tmct/memory via appendFacts (one batched write)
//
// The slice is committed data (one JSON object per line: {start, rel, end,
// surfaceText?, weight}; en→en only; CC-BY-SA 4.0 for ConceptNet-derived rows
// — see corpus/conceptnet/LICENSE-NOTICE). The mapping table decides which
// relations become memory facts and under which predicate URI; rows marked
// ace = "none" are deliberate non-emissions. A slice relation MISSING from
// the table is a drift error — loud, never guessed around.
//
// Seeding goes through src/memory/core.mjs appendFacts() (memory is import-only
// here): fact ids are content-hashed from (s,p,o), so re-seeding is idempotent by
// construction. seedMemory pre-loads the store once and skips triples already
// present, then hands the survivors to appendFacts as ONE batched read-modify-
// write — so seeding the whole slice is O(N), not the O(N²) a per-fact appendFact
// loop would incur (the 6 k-fact slice: ~7 min → a couple of seconds).

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { appendFacts, loadMemory, normFactTerm } from "../memory/core.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SLICE_FILE = join(PKG_ROOT, "corpus", "conceptnet", "slice.jsonl");
export const MAP_FILE = join(PKG_ROOT, "src", "corpus", "conceptnet-map.toml");

// The tier-1 curated Software-Engineering ontology (SEON). concepts.jsonl is in
// the SAME slice shape as ConceptNet ({start, rel, end, weight}), so it loads +
// maps through the identical loadSlice/loadMap/toFacts path — just with a
// "corpus:seon" provenance prefix. definitions.jsonl is a separate {term,
// definition, sense} list the chat answer layer prefers for a lexicon term's
// "what is a <term>". tier-2 corpuses (aws/python/java) share the slice shape too.
export const SEON_CONCEPTS_FILE = join(PKG_ROOT, "corpus", "seon", "concepts.jsonl");
export const SEON_DEFINITIONS_FILE = join(PKG_ROOT, "corpus", "seon", "definitions.jsonl");
export const TIER2_DIR = join(PKG_ROOT, "corpus", "tier2");
export const TIER2_MANIFEST_FILE = join(TIER2_DIR, "manifest.json");

// tier-3 (corpus/wordnet/generate.mjs's output): the Open English WordNet ->
// ConceptNet-shape conversion, same slice shape/loader path as tier-1/tier-2.
// "wordnet-xl"/"wordnet-full" are wired as BUILTIN_EXTENSIONS corpus entries
// in src/extensions.mjs, so `tmct import --corpus wordnet-xl` resolves
// directly there rather than through TIER2_MANIFEST_FILE's id lookup — see
// that module's own BUILTIN_EXTENSIONS comment.
export const TIER3_DIR = join(PKG_ROOT, "corpus", "tier3");
export const TIER3_MANIFEST_FILE = join(TIER3_DIR, "manifest.json");

const ACE_PATTERNS = new Set(["subClassOf", "type", "ObjectProperty", "someValuesFrom", "disjointWith", "property", "none"]);

/** Load the slice JSONL as a stream (never the whole file as one string) and
 *  return the parsed assertions. Every line must carry start/rel/end; bad
 *  lines fail loudly with file:line. */
export async function loadSlice(path = SLICE_FILE) {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  const assertions = [];
  let n = 0;
  for await (const raw of rl) {
    n += 1;
    const line = raw.trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      throw new Error(`${path}:${n}: not valid JSON: ${e.message}`);
    }
    for (const field of ["start", "rel", "end"]) {
      if (typeof row[field] !== "string" || !row[field]) {
        throw new Error(`${path}:${n}: assertion missing "${field}"`);
      }
    }
    assertions.push(row);
  }
  return assertions;
}

/** Load the relation → ACE-OWL mapping table. Returns Map(rel → row); every
 *  row must have a known `ace` pattern, and a mapped (non-"none") row must
 *  name the predicate URI it emits. */
export async function loadMap(path = MAP_FILE) {
  const table = parseToml(await readFile(path, "utf8"));
  const rows = table.relation || [];
  const map = new Map();
  for (const row of rows) {
    if (!row.rel) throw new Error(`${path}: a [[relation]] row is missing "rel"`);
    if (map.has(row.rel)) throw new Error(`${path}: duplicate mapping for ${row.rel}`);
    if (!ACE_PATTERNS.has(row.ace)) {
      throw new Error(`${path}: ${row.rel} has unknown ace pattern ${JSON.stringify(row.ace)}`);
    }
    if (row.ace !== "none" && !row.predicate) {
      throw new Error(`${path}: ${row.rel} maps to ${row.ace} but names no predicate URI`);
    }
    map.set(row.rel, row);
  }
  return map;
}

/** /c/en/source_code → "source code" — the human term text a memory fact stores. */
export const termText = (uri) => {
  const m = /^\/c\/en\/([^/]+)/.exec(String(uri || ""));
  return m ? m[1].replace(/_/g, " ") : null;
};

/** Map slice assertions → appendFact-shaped triples:
 *    { subject, predicate, object, provenance }
 *  (provenance is a STRING — exactly what src/memory/core.mjs appendFact
 *  takes; it names the corpus and the originating ConceptNet relation).
 *  Rows whose relation maps ace="none" are skipped — deliberate non-emission.
 *  A relation with NO row in the map throws: that is table drift, not data.
 *
 *  `provenancePrefix` names the corpus half of the provenance string; it defaults
 *  to "corpus:conceptnet" so the ConceptNet seed stays BYTE-IDENTICAL to before.
 *  The seon / tier-2 corpuses reuse the same slice shape, tagged "corpus:seon" or
 *  "corpus:tier2:<id>" so a reader can tell a curated SE fact from ConceptNet noise. */
export function toFacts(assertions, map, provenancePrefix = "corpus:conceptnet") {
  const facts = [];
  for (const a of assertions) {
    const row = map.get(a.rel);
    if (!row) {
      throw new Error(`slice/map drift: relation ${a.rel} has no row in conceptnet-map.toml`);
    }
    if (row.ace === "none") continue;
    const subject = termText(a.start);
    const object = termText(a.end);
    if (!subject || !object) continue; // non-en endpoint slipped in — filtered, not fatal
    // mgx:relatedTo is real but low-precision (undirected, ambiguous) — routed
    // through the corpus-weak: prefix so memory/trust.mjs's SOURCE_PRIOR.corpusWeak
    // (below plain corpus, above web) applies, computed from the Source's kind
    // like every other tier, never hand-set on the Fact.
    const prefix = row.predicate === "mgx:relatedTo"
      ? provenancePrefix.replace(/^corpus:/, "corpus-weak:")
      : provenancePrefix;
    facts.push({
      subject,
      predicate: row.predicate,
      object,
      provenance: `${prefix} ${a.rel}`,
    });
  }
  return facts;
}

/** Seed a repo's memory graph (<dir>/.tmct/memory/graph.json) from the
 *  committed slice. Options: limit (cap the facts written — handy for tests
 *  and fast bootstraps), slicePath/mapPath overrides, and `prefer` — an array
 *  of predicate URIs that STABLE-partitions the facts before the limit is
 *  applied (facts whose predicate appears earlier in `prefer` come first;
 *  everything else keeps slice order after them). A capped bootstrap seed
 *  wants the DEFINITIONAL band ("a cache is a kind of buffer") ahead of the
 *  location trivia the slice happens to open with; without `prefer` the
 *  behavior is byte-identical to before.
 *
 *  Idempotent twice over: appendFacts' content-hashed ids make a blind
 *  re-append an upsert, and we pre-read the store once to skip triples that
 *  are already there (so re-seeding costs one read, not N rewrites). The
 *  survivors are written in ONE batched appendFacts call, not a per-fact loop.
 *  Returns { appended, skipped, total }. `provenancePrefix` is threaded through to
 *  toFacts (default "corpus:conceptnet" → byte-identical seed) so a seon/tier-2
 *  corpus can tag its facts "corpus:seon" / "corpus:tier2:<id>".
 *
 *  `captureUnknownContext` (default false — every existing call stays
 *  byte-identical): when true, also runs corpus/unknown-ingest.mjs's
 *  `ingestUnknownFromAssertions` over this same assertions/map pair — the
 *  PLAN_AGENTS.md §4 "context-preserving ingestion for unknown words"
 *  mechanism — so a term that ONLY ever appears in a row `toFacts` silently
 *  drops (an `ace = "none"` relation like RelatedTo/HasContext) still lands
 *  in memory, tagged with the passage it was found in, instead of vanishing.
 *  `unknownContextLimit` bounds how many distinct unknown terms one call
 *  captures (default 500 — see that module's own doc comment for why an
 *  unbounded sweep over a wide slice would not be "bounded, not padding").
 *  The result's `unknown` key is present only when the flag is set. Loaded
 *  dynamically (not a static import) to avoid a load-time import cycle with
 *  unknown-ingest.mjs, which itself statically imports `termText` from here —
 *  the same "avoid the cycle" discipline extensions.mjs's
 *  seedActiveCorpusEntries already uses for this very module. */
export async function seedMemory(dir, {
  limit, slicePath = SLICE_FILE, mapPath = MAP_FILE, prefer, provenancePrefix,
  captureUnknownContext = false, unknownContextLimit,
} = {}) {
  const [assertions, map] = await Promise.all([loadSlice(slicePath), loadMap(mapPath)]);
  let facts = toFacts(assertions, map, provenancePrefix);
  if (Array.isArray(prefer) && prefer.length) {
    const rank = new Map(prefer.map((p, i) => [p, i]));
    // stable partition: Array.prototype.sort is stable in Node, so equal-rank
    // facts keep their slice order — deterministic across runs by construction.
    facts = facts.slice().sort((a, b) => (rank.get(a.predicate) ?? prefer.length) - (rank.get(b.predicate) ?? prefer.length));
  }
  if (limit !== undefined) facts = facts.slice(0, limit);

  // One read up front: what does the store already reify? Keys are built with
  // memory's own normFactTerm so they match the normalized read-back exactly
  // (appendFact converges /c/en/foo_bar, tmct:Foo and "Foo bar" to one term).
  const factKey = (s, p, o) => `${normFactTerm(s)} ${p} ${normFactTerm(o)}`;
  const existing = new Set();
  const memory = await loadMemory(dir);
  for (const ind of memory.individuals || []) {
    if (ind?.class !== "Fact") continue;
    const get = (key) => (ind.attributes || []).find((x) => x.key === key)?.value;
    existing.add(factKey(get("subject"), get("predicate"), get("object")));
  }

  let skipped = 0;
  const toWrite = [];
  for (const fact of facts) {
    const key = factKey(fact.subject, fact.predicate, fact.object);
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    existing.add(key);
    toWrite.push(fact);
  }
  // ONE read-modify-write for the whole seed (was one per fact — O(N²) I/O, ~7 min
  // for the 6 k-fact slice). appendFacts also skips any malformed row rather than
  // throwing, so its skipped count folds into the dedup skips here.
  const res = await appendFacts(dir, toWrite);

  let unknown;
  if (captureUnknownContext) {
    const { ingestUnknownFromAssertions } = await import("./unknown-ingest.mjs");
    unknown = await ingestUnknownFromAssertions(dir, {
      assertions, map, mappedFacts: facts, memory,
      provenancePrefix: provenancePrefix ? `${provenancePrefix}-unknown` : undefined,
      limit: unknownContextLimit,
    });
  }

  return {
    appended: res.appended, skipped: skipped + res.skipped, total: facts.length,
    ...(unknown ? { unknown } : {}),
  };
}
