// corpus/conceptnet.mjs — the ConceptNet slice loader + memory seeder
// (ROADMAP Phase 2, "ConceptNet corpus slice").
//
//   loadSlice(path?)        stream corpus/conceptnet/slice.jsonl → assertions
//   loadMap(path?)          src/corpus/conceptnet-map.toml → Map(rel → row)
//   toFacts(assertions,map) assertions → appendFact-shaped triples
//   seedMemory(dir, opts)   write them into <dir>/.tmct/memory via appendFact
//
// The slice is committed data (one JSON object per line: {start, rel, end,
// surfaceText?, weight}; en→en only; CC-BY-SA 4.0 for ConceptNet-derived rows
// — see corpus/conceptnet/LICENSE-NOTICE). The mapping table decides which
// relations become memory facts and under which predicate URI; rows marked
// ace = "none" are deliberate non-emissions. A slice relation MISSING from
// the table is a drift error — loud, never guessed around.
//
// Seeding goes through src/memory/core.mjs appendFact() ONLY (memory is
// import-only here): fact ids are content-hashed from (s,p,o), so re-seeding
// is idempotent by construction. seedMemory additionally pre-loads the store
// once and skips triples already present, so a re-seed is read-mostly instead
// of N rewrites.

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { appendFact, loadMemory, normFactTerm } from "../memory/core.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SLICE_FILE = join(PKG_ROOT, "corpus", "conceptnet", "slice.jsonl");
export const MAP_FILE = join(PKG_ROOT, "src", "corpus", "conceptnet-map.toml");

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
 *  A relation with NO row in the map throws: that is table drift, not data. */
export function toFacts(assertions, map) {
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
    facts.push({
      subject,
      predicate: row.predicate,
      object,
      provenance: `corpus:conceptnet ${a.rel}`,
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
 *  Idempotent twice over: appendFact's content-hashed ids make a blind
 *  re-append an upsert, and we pre-read the store once to skip triples that
 *  are already there (so re-seeding costs one read, not N rewrites).
 *  Returns { appended, skipped, total }. */
export async function seedMemory(dir, { limit, slicePath = SLICE_FILE, mapPath = MAP_FILE, prefer } = {}) {
  const [assertions, map] = await Promise.all([loadSlice(slicePath), loadMap(mapPath)]);
  let facts = toFacts(assertions, map);
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

  let appended = 0;
  let skipped = 0;
  for (const fact of facts) {
    const key = factKey(fact.subject, fact.predicate, fact.object);
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    await appendFact(dir, fact);
    existing.add(key);
    appended += 1;
  }
  return { appended, skipped, total: facts.length };
}
