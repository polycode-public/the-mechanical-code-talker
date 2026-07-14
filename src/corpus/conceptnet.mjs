// corpus/conceptnet.mjs — the ConceptNet slice loader + memory seeder.
//
//   loadSlice(path?)        stream corpus/conceptnet/slice.jsonl → assertions
//   loadMap(path?)          src/corpus/conceptnet-map.toml → Map(rel → row)
//   toFacts(assertions,map) assertions → appendFact-shaped triples
//   seedMemory(dir, opts)   write them into <dir>/.tmct/memory via appendFacts
//
// The slice is committed data (en→en only; CC-BY-SA 4.0 — see
// corpus/conceptnet/LICENSE-NOTICE). The mapping table decides which relations become
// memory facts and under which predicate; a slice relation missing from the table is a
// drift error, loud, never guessed around.

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

// The tier-1 curated Software-Engineering ontology (SEON): concepts.jsonl shares
// ConceptNet's slice shape and loads through the same loadSlice/loadMap/toFacts path.
// definitions.jsonl is a separate {term, definition, sense} list for lexicon lookups.
// Tier-2 corpuses (aws/python/java) share the slice shape too.
export const SEON_CONCEPTS_FILE = join(PKG_ROOT, "corpus", "seon", "concepts.jsonl");
export const SEON_DEFINITIONS_FILE = join(PKG_ROOT, "corpus", "seon", "definitions.jsonl");
export const TIER2_DIR = join(PKG_ROOT, "corpus", "tier2");
export const TIER2_MANIFEST_FILE = join(TIER2_DIR, "manifest.json");

// corpus/wordnet/generate.mjs's output: the Open English WordNet -> ConceptNet-shape
// conversion, same slice shape/loader path as tier-1/tier-2. "wordnet-xl"/"wordnet-full"
// are wired as BUILTIN_EXTENSIONS corpus entries in src/extensions.mjs.
export const WORDNET_DIR = join(PKG_ROOT, "corpus", "wordnet");
export const WORDNET_MANIFEST_FILE = join(WORDNET_DIR, "manifest.json");

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

/** Map slice assertions → appendFact-shaped triples { subject, predicate, object,
 *  provenance }. Rows whose relation maps ace="none" are skipped; a relation with no row
 *  in the map throws (table drift, not data). `provenancePrefix` tags the corpus half of
 *  provenance, e.g. "corpus:seon" / "corpus:tier2:<id>" for non-ConceptNet callers. */
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
    // mgx:relatedTo is low-precision (undirected, ambiguous) — routed through the
    // corpus-weak: prefix so memory/trust.mjs's SOURCE_PRIOR.corpusWeak applies.
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

/** Seed a repo's memory graph (<dir>/.tmct/memory/graph.json) from the committed slice.
 *  `limit` caps the facts written; `prefer` stable-partitions facts by predicate (so a
 *  capped seed favors the definitional band over whatever trivia the slice opens with).
 *  Idempotent: pre-reads the store to skip triples already there, then writes survivors
 *  in one batched appendFacts call. Returns { appended, skipped, total }.
 *  `provenancePrefix` tags facts (default "corpus:conceptnet").
 *
 *  `captureUnknownContext` (default false): also runs unknown-ingest.mjs's
 *  ingestUnknownFromAssertions so a term that only appears in an `ace="none"` row (never
 *  reified as a Fact) still lands in memory, tagged with the passage it was found in.
 *  `unknownContextLimit` bounds how many distinct terms one call captures (default 500).
 *  Loaded dynamically to avoid a load-time import cycle with unknown-ingest.mjs. */
export async function seedMemory(dir, {
  limit, slicePath = SLICE_FILE, mapPath = MAP_FILE, prefer, provenancePrefix,
  captureUnknownContext = false, unknownContextLimit,
} = {}) {
  const [assertions, map] = await Promise.all([loadSlice(slicePath), loadMap(mapPath)]);
  let facts = toFacts(assertions, map, provenancePrefix);
  if (Array.isArray(prefer) && prefer.length) {
    const rank = new Map(prefer.map((p, i) => [p, i]));
    facts = facts.slice().sort((a, b) => (rank.get(a.predicate) ?? prefer.length) - (rank.get(b.predicate) ?? prefer.length));
  }
  if (limit !== undefined) facts = facts.slice(0, limit);

  // Keyed with normFactTerm so it matches the store's own normalized read-back.
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
