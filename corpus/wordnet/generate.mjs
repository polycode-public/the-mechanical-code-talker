#!/usr/bin/env node
// corpus/wordnet/generate.mjs — converts a LOCAL Open English WordNet (OEWN)
// checkout into ConceptNet-shape fact rows. Curated + committed, tier-2-shaped
// — NOT "tier-3" (corpus/README.md's tiering policy already uses that name
// for something else, runtime-learned facts that are never committed); this
// bundle is just too large to hand-author like the other tier-2 corpuses.
// NOT part of the product path — a maintainer tool, run by hand, offline, $0;
// its OUTPUT (corpus/wordnet/wordnet-{xl,full}.jsonl + manifest.json) is what
// gets committed, never the source YAML itself.
//
//   node corpus/wordnet/generate.mjs [yamlDir]
//   TMCT_WORDNET_YAML_DIR=/path/to/yaml node corpus/wordnet/generate.mjs
//
// Input: `~/projects/globalwordnet/english-wordnet/src/yaml/` by default (a
// LOCAL clone, never vendored/committed — CC-BY-4.0, see LICENSE-NOTICE in
// this directory) — Princeton WordNet's 107,526 synsets across
// `noun.*.yaml`/`verb.*.yaml`/`adj.*.yaml`/`adv.*.yaml` (45 of the checkout's
// 73 yaml files; the other 28 are `entries-<letter>.yaml` word-form indexes
// this converter doesn't need — synset records alone carry every relation and
// member list this converter reads).
//
// Two passes, same discipline as corpus/conceptnet/fetch-slice.mjs and
// corpus/tier2/generate.mjs (deterministic, sorted, one JSON object per
// line, `{start, rel, end, weight, surfaceText}` — the exact tier-1 slice
// shape):
//   1. load every synset (across ALL 45 files) into one global
//      synsetId -> record map — synset ids ("00034778-n") are globally
//      unique, POS suffix included, so a single flat Map is correct.
//   2. walk every synset's structural relations + its own `members` list,
//      emitting one row per edge (see RELATION_MAP / synonymPairs below).
//
// The hand-rolled `parseYaml` this file reuses (imported, not duplicated) is
// scripts/extract-persona-sources.mjs's own tiny YAML-subset reader — already
// proven against this exact OEWN dump shape by scripts/build-persona-tiers.mjs
// and scripts/build-persona-examples.mjs. Reusing it (rather than adding a
// general YAML dependency, or re-deriving a second hand-rolled parser) keeps
// this converter self-consistent with the rest of the persona-tier tooling
// that already reads this same source.
//
// Licence: Open English WordNet content is CC-BY-4.0 (Princeton WordNet +
// Open English Wordnet team) — see LICENSE-NOTICE in this directory. The
// code in this file is tmct code under the repository's MPL-2.0; only the
// generated data (corpus/wordnet/*.jsonl) carries CC-BY-4.0.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseYaml } from "../../scripts/extract-persona-sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WORDNET_OUT_DIR = HERE;

export const DEFAULT_YAML_DIR = join(homedir(), "projects", "globalwordnet", "english-wordnet", "src", "yaml");

/** Resolve the input yaml directory: CLI positional arg > env var > default.
 *  Exposed as a pure function (argv/env injectable) so it's unit-testable
 *  without touching real process.argv/env. */
export function resolveYamlDir(argv = process.argv.slice(2), env = process.env) {
  return argv[0] || env.TMCT_WORDNET_YAML_DIR || DEFAULT_YAML_DIR;
}

// ---- relation mapping table (pure, unit-tested) ----------------------------
// WordNet relation key -> { rel: ConceptNet relation URI, flip }. `flip`
// governs which side of the WordNet edge becomes ConceptNet's `start` vs
// `end` — WordNet's meronymy relations point WHOLE -> part (the synset that
// OWNS a `mero_part`/`mero_member` list is the whole; its listed target is
// the part/member — confirmed via scripts/wordnet.py's own
// inverse_synset_rels table: mero_part's inverse is holo_part, so "A mero_part
// B" reads "B is a part-meronym of A", i.e. A HAS PART B), which is the
// OPPOSITE of ConceptNet's own /r/PartOf convention (start=part, end=whole —
// confirmed against a real corpus/conceptnet/slice.jsonl row: "action PartOf
// keyboard" — action, the PART, is start). mero_part/mero_member both need
// `flip: true` for exactly this reason. mero_substance needs NO flip:
// ConceptNet's /r/MadeOf is start=whole, end=substance (confirmed against
// slice.jsonl's "computer MadeOf hardware" — computer, the WHOLE, is start),
// which already matches WordNet's own A(whole) -> mero_substance -> B
// (substance) direction untouched. hypernym/causes/attribute/similar/also
// are all natural A->B mappings with no direction conflict (the specific
// synset/adjective source relation IS the ConceptNet start side already).
export const RELATION_MAP = Object.freeze({
  hypernym: { rel: "/r/IsA", flip: false },
  mero_part: { rel: "/r/PartOf", flip: true },
  mero_member: { rel: "/r/PartOf", flip: true },
  mero_substance: { rel: "/r/MadeOf", flip: false },
  causes: { rel: "/r/Causes", flip: false },
  attribute: { rel: "/r/HasProperty", flip: false },
  similar: { rel: "/r/SimilarTo", flip: false },
  also: { rel: "/r/RelatedTo", flip: false },
});

// Deliberately excluded — no mapped ConceptNet relation, and task scope is to
// use ONLY the relations Phase 1 already added to conceptnet-map.toml, never
// invent a new map row: `entails` (verb implication — no ConceptNet analog)
// and `exemplifies` (instance-of-category — closest is /r/IsA, but that would
// blur "kind of" and "example of", a real semantic difference ConceptNet
// itself keeps separate via /r/InstanceOf, which conceptnet-map.toml doesn't
// carry). `definition`/`example` are free prose, never structured facts.
export const SKIPPED_RELATIONS = Object.freeze(["entails", "exemplifies"]);

// ---- term encoding (pure, unit-tested) -------------------------------------
// Exact inverse of src/corpus/conceptnet.mjs's termText() decode
// (`/^\/c\/en\/([^/]+)/` then `.replace(/_/g, " ")`): lowercase, spaces ->
// underscores, wrapped as `/c/en/<term>`. Nothing else is touched — any other
// punctuation (apostrophes, hyphens) round-trips through termText() unchanged
// because termText only ever substitutes underscores back to spaces.
export function encodeTerm(raw) {
  const t = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return t ? `/c/en/${t}` : null;
}

/** `/c/en/ice_cream` -> "ice cream" — the human-readable form used in
 *  surfaceText, mirroring corpus/tier2/generate.mjs's own `humanize`. */
export const humanize = (term) => String(term ?? "").replace(/_/g, " ");

// ---- synonym chaining (pure, unit-tested) ----------------------------------
// A synset's `members` list are synonyms of each other. Chained N-1 (member
// [0] paired with each of member[1..N-1]) rather than the full N*(N-1)/2
// cross product — members average 1.72/synset (185,149 member-slots across
// 107,526 synsets), and the chain already connects every member into one
// component (a synonym-chases-synonym graph read), so the cross product would
// roughly double the fact count for no new information the chain doesn't
// already encode transitively.
export function synonymPairs(members) {
  if (!Array.isArray(members) || members.length < 2) return [];
  const [first, ...rest] = members;
  return rest.map((m) => [first, m]);
}

// ---- pass 1: load every synset across every yaml file ----------------------
const SYNSET_FILE_RE = /^(noun|verb|adj|adv)\..+\.yaml$/;

export async function loadAllSynsets(yamlDir) {
  const all = await readdir(yamlDir);
  const files = all.filter((f) => SYNSET_FILE_RE.test(f)).sort();
  if (!files.length) {
    throw new Error(`${yamlDir}: no noun./verb./adj./adv. yaml files found — wrong path?`);
  }
  const bySynset = new Map();
  for (const f of files) {
    const text = await readFile(join(yamlDir, f), "utf8");
    const parsed = parseYaml(text);
    for (const [id, rec] of Object.entries(parsed)) bySynset.set(id, rec);
  }
  return { bySynset, files };
}

const repTerm = (synset) => {
  const m = Array.isArray(synset?.members) ? synset.members : [];
  return m.length ? m[0] : null;
};

// ---- pass 2: synset map -> deduped, sorted ConceptNet-shape rows -----------

function makeRowBuilder() {
  const rows = new Map(); // dedupe key -> row
  const add = (rawSubject, rel, rawObject) => {
    const start = encodeTerm(rawSubject);
    const end = encodeTerm(rawObject);
    if (!start || !end || start === end) return; // self-loop / empty term — noise, not a fact
    const key = `${rel} ${start} ${end}`;
    if (rows.has(key)) return;
    rows.set(key, {
      start,
      rel,
      end,
      weight: 1,
      surfaceText: `[[${humanize(rawSubject)}]] ${rel.replace("/r/", "")} [[${humanize(rawObject)}]]`,
    });
  };
  return { rows, add };
}

const sortRows = (rows) => rows.slice().sort((a, b) => (
  a.rel !== b.rel ? (a.rel < b.rel ? -1 : 1)
    : a.start !== b.start ? (a.start < b.start ? -1 : 1)
      : a.end < b.end ? -1 : a.end > b.end ? 1 : 0
));

/** Every structural + synonym-chain fact, deterministically sorted — the
 *  wordnet-full.jsonl content. */
export function buildFullFacts(bySynset) {
  const { rows, add } = makeRowBuilder();
  for (const synset of bySynset.values()) {
    const A = repTerm(synset);
    if (!A) continue;
    for (const [wnRel, { rel, flip }] of Object.entries(RELATION_MAP)) {
      const targets = Array.isArray(synset[wnRel]) ? synset[wnRel] : [];
      for (const targetId of targets) {
        const B = repTerm(bySynset.get(targetId));
        if (!B) continue;
        if (flip) add(B, rel, A); else add(A, rel, B);
      }
    }
    for (const [m0, mi] of synonymPairs(synset.members)) add(m0, "/r/Synonym", mi);
  }
  return sortRows([...rows.values()]);
}

// ---- XL slice: hypernym backbone + synonym chains for the most commonly-
// referenced synsets, budget-bounded ----------------------------------------

/** How many times each synset appears as a hypernym TARGET — a synset's
 *  "commonly referenced" proxy: a category many other synsets specialize
 *  (e.g. "person", "act", "object") is referenced far more often than a
 *  narrow leaf synset. */
export function hypernymRefCounts(bySynset) {
  const refCount = new Map();
  for (const synset of bySynset.values()) {
    const targets = Array.isArray(synset.hypernym) ? synset.hypernym : [];
    for (const t of targets) refCount.set(t, (refCount.get(t) || 0) + 1);
  }
  return refCount;
}

/** Build the bounded XL slice: the `budget` fact rows are split between the
 *  hypernym backbone and synonym chains in the SAME proportion the full
 *  corpus's real hypernym-edge-count : synonym-chain-fact-count ratio has
 *  (measured from `full`, not a hand-picked constant) — the backbone gets the
 *  hypernym edges whose TARGET is most commonly referenced first; the
 *  synonym budget goes to the full chain of the most commonly-referenced
 *  synsets (same ranking), walked in ranked order until the budget is spent. */
export function buildXlFacts(bySynset, full, budget = 24000) {
  const refCount = hypernymRefCounts(bySynset);

  const hypernymTotal = full.filter((r) => r.rel === "/r/IsA").length;
  const synonymTotal = full.filter((r) => r.rel === "/r/Synonym").length;
  const denom = hypernymTotal + synonymTotal || 1;
  const hypernymBudget = Math.round(budget * (hypernymTotal / denom));
  const synonymBudget = budget - hypernymBudget;

  // Backbone: every hypernym EDGE (not yet a fact row), ranked by how
  // commonly-referenced its TARGET synset is, ties broken deterministically.
  const edges = [];
  for (const [id, synset] of bySynset) {
    const targets = Array.isArray(synset.hypernym) ? synset.hypernym : [];
    for (const t of targets) edges.push({ source: id, target: t });
  }
  edges.sort((a, b) => {
    const byRef = (refCount.get(b.target) || 0) - (refCount.get(a.target) || 0);
    if (byRef) return byRef;
    if (a.target !== b.target) return a.target < b.target ? -1 : 1;
    return a.source < b.source ? -1 : 1;
  });

  const { rows, add } = makeRowBuilder();
  for (const { source, target } of edges) {
    if (rows.size >= hypernymBudget) break;
    const A = repTerm(bySynset.get(source));
    const B = repTerm(bySynset.get(target));
    if (!A || !B) continue;
    add(A, "/r/IsA", B);
  }

  // Synonym chains: rank EVERY synset by the same "commonly referenced"
  // proxy (0 for a synset that never appears as a hypernym target), then walk
  // down taking each synset's FULL N-1 chain until the synonym budget is met
  // (a synset's chain is never split — "~budget", not an exact cap).
  const rankedSynsets = [...bySynset.entries()].sort((a, b) => {
    const byRef = (refCount.get(b[0]) || 0) - (refCount.get(a[0]) || 0);
    if (byRef) return byRef;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  let synonymCount = 0;
  for (const [, synset] of rankedSynsets) {
    if (synonymCount >= synonymBudget) break;
    const pairs = synonymPairs(synset.members);
    if (!pairs.length) continue;
    for (const [m0, mi] of pairs) add(m0, "/r/Synonym", mi);
    synonymCount += pairs.length;
  }

  return sortRows([...rows.values()]);
}

// ---- output ------------------------------------------------------------

const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function main() {
  const yamlDir = resolveYamlDir();
  process.stderr.write(`corpus/wordnet/generate.mjs: reading ${yamlDir}\n`);
  const { bySynset, files } = await loadAllSynsets(yamlDir);
  process.stderr.write(`  loaded ${bySynset.size} synsets across ${files.length} files\n`);

  const full = buildFullFacts(bySynset);
  const xl = buildXlFacts(bySynset, full);
  process.stderr.write(`  wordnet-full: ${full.length} facts\n`);
  process.stderr.write(`  wordnet-xl:   ${xl.length} facts\n`);

  await mkdir(WORDNET_OUT_DIR, { recursive: true });
  const fullText = toJsonl(full);
  const xlText = toJsonl(xl);
  await writeFile(join(WORDNET_OUT_DIR, "wordnet-full.jsonl"), fullText);
  await writeFile(join(WORDNET_OUT_DIR, "wordnet-xl.jsonl"), xlText);

  const manifest = {
    version: 1,
    generated: "by corpus/wordnet/generate.mjs",
    corpuses: [
      {
        id: "wordnet-xl",
        kind: "language",
        description: "A bounded ~24,000-fact slice of Princeton WordNet / Open English WordNet, prioritizing the hypernym (IsA) backbone and synonym chains for the most commonly-referenced synsets. Mechanically derived from Open English WordNet (CC-BY-4.0).",
        source: { kind: "curated", tool: "corpus/wordnet/generate.mjs" },
        file: "wordnet-xl.jsonl",
        facts: xl.length,
        bytes: Buffer.byteLength(xlText),
        sha256: sha256(xlText),
        license: "CC-BY-4.0",
      },
      {
        id: "wordnet-full",
        kind: "language",
        description: "The complete ConceptNet-shape conversion of Princeton WordNet / Open English WordNet's structural relations (hypernym, meronymy, causes, attribute, similar, also) plus member-synonym chains. Derived from Open English WordNet (CC-BY-4.0).",
        source: { kind: "curated", tool: "corpus/wordnet/generate.mjs" },
        file: "wordnet-full.jsonl",
        facts: full.length,
        bytes: Buffer.byteLength(fullText),
        sha256: sha256(fullText),
        license: "CC-BY-4.0",
      },
    ],
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(WORDNET_OUT_DIR, "manifest.json"), manifestText);
  process.stderr.write(`wrote corpus/wordnet/manifest.json (${manifest.corpuses.length} corpuses)\n`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
