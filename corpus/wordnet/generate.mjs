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
// The dump reader this file uses (imported, not duplicated) is
// scripts/lib/wordnet-source.mjs, the same one the persona-tier tooling reads
// this source with. Like that tooling, this converter is a maintainer tool: it
// needs a local WordNet clone, so it is not part of the published package —
// only the corpus/wordnet/*.jsonl it generates is.
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
import { readWordnetYaml } from "../../scripts/lib/wordnet-source.mjs";

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
// the part/member — mero_part's inverse is holo_part, so "A mero_part
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
// Exact inverse of src/adapters/corpus/conceptnet.mjs's termText() decode
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
// A synset's `members` list are synonyms of each other. Chained N-1 off the
// CHOSEN name `A` (which is members[0] whenever the naming ladder resolves at
// rung 1/2/5, but can be a later member or a synthesized gloss otherwise) —
// paired with every OTHER member, i.e. every member except members[0] itself
// and A itself, rather than the full N*(N-1)/2 cross product (members average
// 1.72/synset, and the chain already connects every member into one
// component, so the cross product would roughly double the fact count for no
// new information the chain doesn't already encode transitively). members[0]
// is deliberately excluded here even when A !== members[0]: that specific
// edge is the lemma bridge (buildFullFacts/buildXlFacts add it separately, at
// weak-trust RelatedTo, never Synonym — a Synonym edge back to the discarded
// headword would re-merge the very senses this naming ladder exists to keep
// apart).
export function synonymPairs(A, members) {
  if (!A || !Array.isArray(members) || members.length < 2) return [];
  return members.filter((m, i) => i !== 0 && m !== A).map((m) => [A, m]);
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
  const lexOf = new Map(); // synsetId -> source filename minus ".yaml" (e.g. "noun.communication")
  for (const f of files) {
    const parsed = await readWordnetYaml(join(yamlDir, f));
    const fileStem = f.replace(/\.yaml$/, "");
    for (const [id, rec] of Object.entries(parsed || {})) {
      bySynset.set(id, rec);
      lexOf.set(id, fileStem);
    }
  }
  return { bySynset, lexOf, files };
}

// ---- sense-preserving naming ladder (pure, unit-tested) --------------------
// Names a synset from its OWN members, never a sense-suffixed id: the read
// side (src/adapters/corpus/conceptnet.mjs termText, chat.mjs factPhrase)
// prints stored terms verbatim, so the stored string IS the sense identity.
// One rung wins per synset, tried in order; each candidate that would
// normalise away under src/domain/hash.mjs normFactTerm's leading-article
// strip is rejected and the ladder moves on.

export const POS_RANK = Object.freeze({ n: 0, v: 1, a: 2, s: 2, r: 3 });
export const LEXNAME_NOT_A_GLOSS = Object.freeze(["all", "Tops", "pert", "ppl"]);

const ENTRIES_FILE_RE = /^entries-[0-9a-z]\.yaml$/;
const SYNSET_ID_POS_RE = /-(\w)$/;

const posOfSynsetId = (id) => {
  const m = SYNSET_ID_POS_RE.exec(String(id ?? ""));
  return m ? m[1] : null;
};

/** True iff `name`, stored verbatim, would lose its leading word to
 *  normFactTerm's `/^(?:the|an?)\s+/i` strip at write time — a candidate that
 *  reads unsafe is rejected, never stored, so "a (communication)" never
 *  silently becomes "(communication)". */
export function isArticleUnsafe(name) {
  return /^(?:the|an?)\s+/i.test(String(name ?? "").trim());
}

/** Every distinct member string across every synset, mapped to the set of
 *  synset ids that carry it anywhere in their `members` list (any position,
 *  not just members[0]) — the population a lemma is contesting against,
 *  whichever position it sits at. Order-independent: callers only ever ask
 *  for `.size` or run a full min-scan over the Set, never rely on its
 *  iteration order. */
export function buildMemberOwners(bySynset) {
  const owners = new Map();
  for (const [id, synset] of bySynset) {
    const members = Array.isArray(synset?.members) ? synset.members : [];
    for (const raw of members) {
      const m = String(raw ?? "").trim();
      if (!m) continue;
      if (!owners.has(m)) owners.set(m, new Set());
      owners.get(m).add(id);
    }
  }
  return owners;
}

/** Load the `word -> { synset -> senseIndex }` frequency order WordNet itself
 *  encodes in `entries-<letter>.yaml`'s per-POS sense list order, flattened
 *  to `"word synsetId" -> index`. Reads all 28 entries files once; a
 *  maintainer-tool-scale cost (~26MB total), not something the per-synset
 *  ladder pays for each call. */
export async function loadSenseIndex(yamlDir) {
  const all = await readdir(yamlDir);
  const files = all.filter((f) => ENTRIES_FILE_RE.test(f)).sort();
  const senseIndex = new Map();
  for (const f of files) {
    const parsed = await readWordnetYaml(join(yamlDir, f));
    for (const [word, byPos] of Object.entries(parsed || {})) {
      for (const [pos, rec] of Object.entries(byPos || {})) {
        if (pos === "form") continue;
        const senses = Array.isArray(rec?.sense) ? rec.sense : [];
        senses.forEach((s, i) => {
          if (s?.synset) senseIndex.set(`${word} ${s.synset}`, i);
        });
      }
    }
  }
  return senseIndex;
}

/** For every member string contested by more than one synset, which single
 *  synset id is WordNet's dominant (most frequent) sense of it — lowest
 *  `(posRank, senseIndex, synsetId)`, a total order down to the id tiebreak
 *  so the winner never depends on Set/Map iteration order. Returns
 *  `member -> dominant synsetId`; uncontested members (owners.size < 2) carry
 *  no entry, since dominance only means something once there is a rival. */
export function buildDominantSense(memberOwners, senseIndex) {
  const dominant = new Map();
  for (const [member, owners] of memberOwners) {
    if (owners.size < 2) continue;
    let winner = null;
    let winnerPosRank = Infinity;
    let winnerSenseIdx = Infinity;
    for (const id of owners) {
      const posRank = POS_RANK[posOfSynsetId(id)] ?? Infinity;
      const senseIdx = senseIndex.get(`${member} ${id}`) ?? Infinity;
      const better = posRank !== winnerPosRank ? posRank < winnerPosRank
        : senseIdx !== winnerSenseIdx ? senseIdx < winnerSenseIdx
          : winner === null || id < winner;
      if (better) { winner = id; winnerPosRank = posRank; winnerSenseIdx = senseIdx; }
    }
    dominant.set(member, winner);
  }
  return dominant;
}

/** The naming ladder's decision, rung included — `senseTermFor` below is the
 *  public one-string-out wrapper; main() also calls this directly to tally
 *  which rung fired across the whole dump for its stderr drift-visibility
 *  line, without recomputing the ladder a second time under a second name.
 *  `ctx = { memberOwners, dominantBySynset, lexOf }` is built once per run
 *  (see main()) and shared across every synset.
 *  1. unique lemma — members[0] owned by only this synset.
 *  2. dominant sense — this synset wins members[0]'s WordNet-frequency contest.
 *  3. distinguishing member — the first later member no other synset owns.
 *  4. lexname gloss — `members[0] (lexname)`, nouns/verbs only, skipped when
 *     another same-lemma synset shares the lexfile (the gloss wouldn't
 *     distinguish them) or the lexfile segment is a non-semantic bucket.
 *  5. residue — bare members[0], unconditionally (today's behavior; the
 *     final fallback has nowhere further to reject to). */
function ladderDecision(id, synset, ctx) {
  const members = Array.isArray(synset?.members) ? synset.members : [];
  const A = String(members[0] ?? "").trim();
  if (!A) return { rung: null, name: null };
  const ownersA = ctx.memberOwners.get(A);

  if ((ownersA?.size ?? 0) <= 1 && !isArticleUnsafe(A)) return { rung: 1, name: A };
  if (ctx.dominantBySynset.get(A) === id && !isArticleUnsafe(A)) return { rung: 2, name: A };

  for (const raw of members.slice(1)) {
    const m = String(raw ?? "").trim();
    if (!m) continue;
    const owners = ctx.memberOwners.get(m);
    if ((owners?.size ?? 0) === 1 && !isArticleUnsafe(m)) return { rung: 3, name: m };
  }

  const pos = posOfSynsetId(id);
  if (pos === "n" || pos === "v") {
    const lexfile = ctx.lexOf.get(id);
    const segment = lexfile ? lexfile.split(".")[1] : null;
    if (segment && !LEXNAME_NOT_A_GLOSS.includes(segment)) {
      const sameLexfileElsewhere = ownersA
        ? [...ownersA].some((otherId) => otherId !== id && ctx.lexOf.get(otherId) === lexfile)
        : false;
      if (!sameLexfileElsewhere) {
        const candidate = `${A} (${segment})`;
        if (!isArticleUnsafe(candidate)) return { rung: 4, name: candidate };
      }
    }
  }

  return { rung: 5, name: A };
}

export function senseTermFor(id, synset, ctx) {
  return ladderDecision(id, synset, ctx).name;
}

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
 *  wordnet-full.jsonl content. `ctx` is the naming ladder's context (see
 *  senseTermFor); built once by main() and threaded through unchanged. */
export function buildFullFacts(bySynset, ctx) {
  const { rows, add } = makeRowBuilder();
  for (const [id, synset] of bySynset) {
    const A = senseTermFor(id, synset, ctx);
    if (!A) continue;
    for (const [wnRel, { rel, flip }] of Object.entries(RELATION_MAP)) {
      const targets = Array.isArray(synset[wnRel]) ? synset[wnRel] : [];
      for (const targetId of targets) {
        const targetSynset = bySynset.get(targetId);
        if (!targetSynset) continue;
        const B = senseTermFor(targetId, targetSynset, ctx);
        if (!B) continue;
        if (flip) add(B, rel, A); else add(A, rel, B);
      }
    }
    for (const [m0, mi] of synonymPairs(A, synset.members)) add(m0, "/r/Synonym", mi);
    if (Array.isArray(synset.members) && synset.members.length && A !== synset.members[0]) {
      // the lemma bridge: weak-trust RelatedTo, never Synonym — see
      // synonymPairs' own header comment for why the two relations can't mix.
      add(A, "/r/RelatedTo", synset.members[0]);
    }
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
export function buildXlFacts(bySynset, full, ctx, budget = 24000) {
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
    const sourceSynset = bySynset.get(source);
    const targetSynset = bySynset.get(target);
    if (!sourceSynset || !targetSynset) continue;
    const A = senseTermFor(source, sourceSynset, ctx);
    const B = senseTermFor(target, targetSynset, ctx);
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
  for (const [id, synset] of rankedSynsets) {
    if (synonymCount >= synonymBudget) break;
    const A = senseTermFor(id, synset, ctx);
    if (!A) continue;
    const pairs = synonymPairs(A, synset.members);
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
  const { bySynset, lexOf, files } = await loadAllSynsets(yamlDir);
  process.stderr.write(`  loaded ${bySynset.size} synsets across ${files.length} files\n`);

  const senseIndex = await loadSenseIndex(yamlDir);
  const memberOwners = buildMemberOwners(bySynset);
  const dominantBySynset = buildDominantSense(memberOwners, senseIndex);
  const ctx = { memberOwners, dominantBySynset, lexOf };

  const rungCounts = [0, 0, 0, 0, 0];
  for (const [id, synset] of bySynset) {
    const { rung } = ladderDecision(id, synset, ctx);
    if (rung) rungCounts[rung - 1] += 1;
  }
  process.stderr.write(
    `  naming ladder: unique=${rungCounts[0]} dominant=${rungCounts[1]} `
    + `distinguishing=${rungCounts[2]} lexname=${rungCounts[3]} residue=${rungCounts[4]}\n`,
  );

  const full = buildFullFacts(bySynset, ctx);
  const xl = buildXlFacts(bySynset, full, ctx);
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
