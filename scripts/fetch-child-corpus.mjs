#!/usr/bin/env node
// scripts/fetch-child-corpus.mjs — build corpus/child/, the lazy CHILD triples
// pack the clean-miss cascade learns everyday concepts from: gzipped JSONL
// shards of ConceptNet triples plus a gzipped term index, cut from the pinned
// full ConceptNet 5.7.0 assertions dump against a hand-authored child-concept
// seed. Maintainer-only: never imported by src/ or bin/, never run by
// `npm test`. Dependency-free (node builtins + the repo's own filter helpers).
//
//   node scripts/fetch-child-corpus.mjs [--cache <dir>] [--out <dir>]
//
// The dump is pinned by URL + sha256 in the manifest, so a rebuild from the
// same dump is byte-identical (sorted emit, gzip mtime 0) and a re-download is
// verifiable. The cached dump (~/.cache/tmct-conceptnet/) is used as-is when its
// sha256 matches; only a missing/wrong file triggers a download.
//
// The pipeline, in order:
//   1. stream the gzipped dump, keep en→en edges whose relation is admitted
//      (the 34 canonical relations + /r/NotCapableOf, the one negative the
//      defeasible-negation reader needs) and one endpoint is in the child seed
//      (corpus/conceptnet/child-seed.mjs) — scanAssertions in filter-dump.mjs;
//   2. quality-filter (corpus/conceptnet/quality-filter.mjs cutReason): strip
//      numeric/one-char endpoints, sentence fragments, definitional phrases and
//      the opinion band. Matters more at child scope, where crowd noise scales
//      with generality;
//   3. map each edge through conceptnet-map.toml into tmct's predicate
//      vocabulary (drift-guarded: an unmapped relation throws), DROPPING
//      ace="none" rows and the one weak relation (mgx:relatedTo / RelatedTo) so
//      the whole pack sits at one trust tier — corpus, 0.7 (see the child
//      provenance decision in src/domain/child-pack.mjs);
//   4. key each edge under BOTH endpoints' normalised terms and emit one shard
//      row per term ({term, facts}), so a miss on a hyponym ("penguin") and a
//      miss on its class ("bird") each return the edges they need.
//
// Licensing: the SHIPPED DATA (corpus/child/*) is CC-BY-SA-4.0 (ConceptNet-
// derived), exactly like corpus/conceptnet/slice.jsonl — see
// corpus/child/LICENSE-NOTICE and corpus/LICENSES.json. The child SEED
// (corpus/conceptnet/child-seed.mjs) is maintainer-owned MPL-2.0 and copies no
// external word list; the full licence decision lives in that file's header.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip, gzipSync } from "node:zlib";
import { scanAssertions } from "../corpus/conceptnet/filter-dump.mjs";
import { CANONICAL_RELS, FILTERED_RELS } from "../corpus/conceptnet/fetch-slice.mjs";
import { cutReason } from "../corpus/conceptnet/quality-filter.mjs";
import { CHILD_SEED_TERMS, CHILD_AOA_TARGET_YEARS } from "../corpus/conceptnet/child-seed.mjs";
import { loadMap, termText } from "../src/adapters/corpus/conceptnet.mjs";
import { normFactTerm } from "../src/domain/hash.mjs";
import {
  shardNameFor, isChildFactsRow, CHILD_PACK_NAME, CHILD_SHARD_COUNT,
} from "../src/domain/child-pack.mjs";
import { childCorpusMetrics, formatMetrics } from "./measure-child-corpus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "corpus", "child");
const CACHE_DEFAULT = join(homedir(), ".cache", "tmct-conceptnet");

export const DUMP_URL = "https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz";
// Mirror note: the same 5.7.0 dump is linked from the ConceptNet download wiki
// (https://github.com/commonsense/conceptnet5/wiki/Downloads); the S3 path above
// is the canonical one the committed slice was also cut from.
export const DUMP_MIRROR = "https://github.com/commonsense/conceptnet5/wiki/Downloads";
export const DUMP_SHA256 = "accd65fe94038584295574ddc26e1500c1919c8c4532bf771811cafd0948af7e";
const DUMP_FILE = "conceptnet-assertions-5.7.0.csv.gz";

// Budgets — hard asserts, an over-budget pack fails the build loudly and writes
// no manifest (content is never trimmed silently). Sized just above the built
// pack so drift is caught but a normal rebuild passes.
export const BUDGET_SHARDS_GZ_BYTES = 3 * 1024 * 1024;
export const BUDGET_INDEX_GZ_BYTES = 700 * 1024;
export const BUDGET_FACTS = 120000;

// A term is loaded ONE row at a time on a miss, so the row is the unit that
// matters: cap how many edges any one term keys, keeping the strongest. This
// bounds the worst case (a polysemous everyday word — "line", "star", "class" —
// pulls hundreds of ConceptNet edges) and improves quality (weakest crowd edges
// fall off first). Taxonomy and capability predicates are protected in a first
// tier so the acceptance features (kinds of bird, capabilities, flight) are
// never crowded out by trivia.
export const CHILD_PER_TERM_CAP = 48;
const PROTECTED_PREDICATES = new Set(["rdfs:subClassOf", "mgx:capableOf", "mgxneg:capableOf"]);

// The one weak relation, dropped so the whole pack sits at the corpus tier.
const WEAK_PREDICATE = "mgx:relatedTo";

/** The relations the child build admits: the canonical 34 (minus the
 *  policy-filtered ones) plus /r/NotCapableOf, the single ConceptNet negative
 *  mapped into the closed set (conceptnet-map.toml). */
export const CHILD_ADMITTED_RELS = new Set([...CANONICAL_RELS, "/r/NotCapableOf"]);

/** Map quality-passed dump rows → flat {subject, predicate, object, weight?}
 *  facts. Drift-guarded (an unmapped relation throws, exactly like toFacts);
 *  ace="none" rows and the one weak relation are dropped so every shipped fact
 *  carries a precise, corpus-tier predicate. */
export function mapChildFacts(rows, map) {
  const facts = [];
  for (const a of rows) {
    const mrow = map.get(a.rel);
    if (!mrow) throw new Error(`slice/map drift: relation ${a.rel} has no row in conceptnet-map.toml`);
    if (mrow.ace === "none" || mrow.predicate === WEAK_PREDICATE) continue;
    const subject = termText(a.start);
    const object = termText(a.end);
    if (!subject || !object) continue;
    const fact = { subject, predicate: mrow.predicate, object };
    const weight = Math.round((Number(a.weight) || 1) * 1000) / 1000;
    if (weight > 0) fact.weight = weight;
    facts.push(fact);
  }
  return facts;
}

const factSortKey = (f) => `${f.predicate}\0${normFactTerm(f.subject)}\0${normFactTerm(f.object)}`;
const factWeight = (f) => (typeof f.weight === "number" ? f.weight : 1);

// Ordering INSIDE a term's cap, term-aware. A miss on T wants T's OWN identity
// and capabilities first ("what is a penguin", "what can it do" — T as
// subject), then a sample of T's kinds ("which birds do I know" — T as object,
// the base rate). Rank: outgoing-protected(0) < outgoing-other(1) <
// incoming-protected(2) < incoming-other(3), each weight-descending, key
// tiebreak. Without this, a hypernym term ("penguin", "bird") fills its whole
// cap with <species>-subClassOf-<term> rows and loses its own facts.
function rankFor(term) {
  const rank = (f) => (normFactTerm(f.subject) === term ? 0 : 2) + (PROTECTED_PREDICATES.has(f.predicate) ? 0 : 1);
  return (a, b) => rank(a) - rank(b) || factWeight(b) - factWeight(a) || factSortKey(a).localeCompare(factSortKey(b));
}

/** Group flat facts into per-term rows, keyed under BOTH endpoints (so a miss on
 *  either the subject or the object of an edge returns it). Deduped within a
 *  term by (predicate, subject, object), capped at CHILD_PER_TERM_CAP by
 *  term-aware importance; the kept facts are then sorted by key for a
 *  byte-deterministic emit. Returns Map(term -> {term, facts}). */
export function buildRowsByTerm(facts, { perTermCap = CHILD_PER_TERM_CAP } = {}) {
  const byTerm = new Map();
  const add = (term, fact) => {
    if (!byTerm.has(term)) byTerm.set(term, { facts: [], seen: new Set() });
    const bucket = byTerm.get(term);
    const key = factSortKey(fact);
    if (bucket.seen.has(key)) return;
    bucket.seen.add(key);
    bucket.facts.push(fact);
  };
  for (const f of facts) {
    const s = normFactTerm(f.subject);
    const o = normFactTerm(f.object);
    if (s) add(s, f);
    if (o && o !== s) add(o, f);
  }
  const rows = new Map();
  for (const term of [...byTerm.keys()].sort()) {
    const kept = byTerm.get(term).facts.sort(rankFor(term)).slice(0, perTermCap);
    kept.sort((a, b) => factSortKey(a).localeCompare(factSortKey(b)));
    rows.set(term, { term, facts: kept });
  }
  return rows;
}

/** Write the pack: sorted shards, sorted index, LICENSE-NOTICE, README,
 *  manifest. Hard budget asserts. Returns the manifest. */
export function emitChildPack(rowsByTerm, outDir, { dump, metrics, built = new Date().toISOString().slice(0, 10) } = {}) {
  const terms = [...rowsByTerm.keys()].sort();
  let factCount = 0;
  for (const term of terms) {
    const row = rowsByTerm.get(term);
    if (!isChildFactsRow(row)) throw new Error(`emitChildPack: malformed row for "${term}"`);
    factCount += row.facts.length;
  }
  if (factCount > BUDGET_FACTS) {
    throw new Error(`emitChildPack: ${factCount} keyed facts exceeds the ${BUDGET_FACTS} budget`);
  }

  mkdirSync(join(outDir, "shards"), { recursive: true });
  const files = [];
  const record = (rel, body) => {
    writeFileSync(join(outDir, rel), body);
    files.push({ file: rel, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
    return body.length;
  };

  const byShard = new Map();
  for (const term of terms) {
    const s = shardNameFor(term);
    if (!byShard.has(s)) byShard.set(s, []);
    byShard.get(s).push(rowsByTerm.get(term));
  }
  let shardGzBytes = 0;
  for (const s of [...byShard.keys()].sort()) {
    const body = gzipSync(Buffer.from(byShard.get(s).map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8"), { level: 9 });
    shardGzBytes += record(join("shards", `${s}.jsonl.gz`), body);
  }
  if (shardGzBytes > BUDGET_SHARDS_GZ_BYTES) {
    throw new Error(`emitChildPack: shards total ${shardGzBytes} gz bytes exceeds the ${BUDGET_SHARDS_GZ_BYTES}-byte budget`);
  }

  const index = {};
  for (const term of terms) index[term] = { s: shardNameFor(term), t: term, n: rowsByTerm.get(term).facts.length };
  const sortedIndex = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  const indexGzBytes = record("index.json.gz", gzipSync(Buffer.from(JSON.stringify(sortedIndex), "utf8"), { level: 9 }));
  if (indexGzBytes > BUDGET_INDEX_GZ_BYTES) {
    throw new Error(`emitChildPack: index ${indexGzBytes} gz bytes exceeds the ${BUDGET_INDEX_GZ_BYTES}-byte budget`);
  }

  record("LICENSE-NOTICE", Buffer.from(CHILD_LICENSE_NOTICE, "utf8"));
  record("README.md", Buffer.from(childReadme({ terms: terms.length, factCount, metrics, built }), "utf8"));

  const manifest = {
    version: 1,
    generated: "by scripts/fetch-child-corpus.mjs",
    seed: {
      file: "corpus/conceptnet/child-seed.mjs",
      terms: CHILD_SEED_TERMS.length,
      aoaTargetYears: CHILD_AOA_TARGET_YEARS,
      license: "MPL-2.0 (maintainer-owned; copies no external word list)",
    },
    dump,
    built,
    pack: CHILD_PACK_NAME,
    shardCount: CHILD_SHARD_COUNT,
    counts: { terms: terms.length, facts: factCount, shards: byShard.size },
    budgets: {
      facts: { used: factCount, max: BUDGET_FACTS },
      shardsGzBytes: { used: shardGzBytes, max: BUDGET_SHARDS_GZ_BYTES },
      indexGzBytes: { used: indexGzBytes, max: BUDGET_INDEX_GZ_BYTES },
    },
    acceptance: metrics,
    files: files.sort((a, b) => a.file.localeCompare(b.file)),
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

// ---- licence + readme text --------------------------------------------------

export const CHILD_LICENSE_NOTICE = `LICENSE NOTICE — corpus/child/
==============================

The shard and index files in this directory are a filtered, relation-mapped
excerpt of ConceptNet 5.7.0, and are licensed under the Creative Commons
Attribution-ShareAlike 4.0 International License (CC-BY-SA 4.0), NOT under this
repository's MPL-2.0 — exactly like corpus/conceptnet/slice.jsonl.

  https://creativecommons.org/licenses/by-sa/4.0/

Attribution
-----------

This work includes data from ConceptNet 5, compiled by the Commonsense
Computing Initiative and freely available under CC-BY-SA 4.0 from
https://conceptnet.io. The included data was created by contributors to
Commonsense Computing projects, contributors to Wikimedia projects, Games with
a Purpose, Princeton University's WordNet, DBPedia, OpenCyc, and Umbel.

Source and reproduction
-----------------------

Built by scripts/fetch-child-corpus.mjs from the pinned ConceptNet 5.7.0
assertions dump recorded in manifest.json (URL, mirror and sha256). The filter
(child-concept seed match + canonical relations + /r/NotCapableOf + quality
pass + size budget) is described in that script and is reproducible: same dump
in, same bytes out.

The child SEED that selects these rows
(corpus/conceptnet/child-seed.mjs) is a maintainer-owned, hand-authored word
list under this repository's MPL-2.0. It copies no external word list — see its
header for the licence decision that ruled out the published age-of-acquisition
lists. A seed only SELECTS which ConceptNet edges ship; the edges themselves are
ConceptNet's, so this directory carries ConceptNet's CC-BY-SA 4.0.

Share-alike — READ THIS BEFORE REUSING
--------------------------------------

CC-BY-SA 4.0's share-alike condition is viral. If you redistribute these files
(modified or not), you must do so under CC-BY-SA 4.0 with this attribution. The
build code (scripts/fetch-child-corpus.mjs) and the seed
(corpus/conceptnet/child-seed.mjs) are tmct code under this repository's
MPL-2.0; only the data files in this directory carry CC-BY-SA 4.0.
`;

function childReadme({ terms, factCount, metrics, built }) {
  const m = metrics
    ? formatMetrics("Measured over this pack", metrics)
    : "(metrics not computed at build time)";
  return `# corpus/child/

The lazy CHILD triples pack: everyday ConceptNet concepts a young child knows,
keyed on \`normFactTerm\` and loaded ONE shard at a time on a clean miss
(src/adapters/corpus/child-pack.mjs). Unlike the tech slice
(corpus/conceptnet/slice.jsonl, a bulk import), this pack is consulted lazily —
the chat miss-cascade calls the provider for a missed term, appends the term's
triples, and answers from the store.

Layout (mirrors corpus/reference/):

- \`index.json.gz\` — \`{ term: { s, t, n } }\`: shard name, canonical term key
  (a normFactTerm fixed point), fact count.
- \`shards/child-00.jsonl.gz\` … — one JSON row per term:
  \`{ term, facts: [{ subject, predicate, object, weight? }, …] }\`, sharded by
  the term's FNV-1a first byte mod ${CHILD_SHARD_COUNT}
  (src/domain/child-pack.mjs). Each edge is keyed under BOTH endpoints, so a
  miss on a hyponym and a miss on its class each return what they need.
- \`manifest.json\` — the pinned dump (URL, mirror, sha256), the seed, counts,
  budgets, the acceptance metrics, and a sha256 for every emitted file.
- \`LICENSE-NOTICE\` — CC-BY-SA 4.0; read it before reusing these files.

${terms} terms, ${factCount} keyed facts. Built ${built}.

Predicates are already mapped into tmct's vocabulary
(conceptnet-map.toml): \`rdfs:subClassOf\`, \`mgx:capableOf\`,
\`mgxneg:capableOf\` (from /r/NotCapableOf — the defeasible-negation data), and
the other object properties. The weak relation (\`mgx:relatedTo\`) and the
ace="none" relations are dropped, so every fact sits at the corpus trust tier
(0.7); a fact learned from this pack carries a \`child:conceptnet:<term>\`
provenance tag (src/domain/child-pack.mjs), parsed back to a corpus Source by
memory/trust.mjs.

## The read contract (for the chat miss-cascade wave)

On a clean miss for term T:

1. compute the lookup key the SAME way the reference-pack lookup does — the
   lexicon lemma of T (\`cleanMissReferenceTerm\`), so one lemma fold serves both
   packs and a plural miss ("penguins") folds to its singular. The loader
   additionally normFactTerm-folds case and a leading article, so passing the
   raw term also works for those; it does NOT singularise (that is the caller's
   lemma fold, exactly as for the reference pack);
2. call the provider: \`getChildPackProvider(env).lookup(k)\` → \`{ term, facts }\`
   or \`null\` (a null is the ordinary honest miss — the pack never throws at a
   caller);
3. for each fact \`{ subject, predicate, object, weight? }\`, \`appendFacts\` it
   with provenance \`childProvenanceTag(T)\` = \`child:conceptnet:<lemma>\` —
   corpus tier, 0.7 (memory/trust.mjs parses it to { kind:"corpus",
   name:"conceptnet" }, the shared ConceptNet Source);
4. answer from the store (the appended edges make the base rate real: kinds of
   bird, and \`bird can fly\` from data rather than one hand-written row).

The pack does NOT produce the penguin's exception on its own; that still comes
from a taught fact or from a /r/NotCapableOf edge where ConceptNet happens to
carry one. A wider seed makes the base rate real and the positive default
findable; the specific exception remains what tmct is taught.

## Acceptance metrics

Measured by \`node scripts/measure-child-corpus.mjs\` (the script IS the
acceptance test — the plan's hand-counted baseline drifted once). Numbers below
are for this committed pack:

\`\`\`
${m}
\`\`\`

## Rebuild

\`npm run gen:child-corpus\` (reads the pinned dump from
~/.cache/tmct-conceptnet/ when its sha256 matches, else downloads it). Same
dump in, same bytes out.
`;
}

// ---- download (verify-cached, like fetch-reference-pack) --------------------

async function sha256OfFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** The pinned dump in the cache: used as-is when its sha256 matches, downloaded
 *  (and re-verified) otherwise. Returns { file, url, mirror, sha256 }. */
export async function ensureDump(cacheDir) {
  const file = join(cacheDir, DUMP_FILE);
  mkdirSync(cacheDir, { recursive: true });
  if (existsSync(file)) {
    const have = await sha256OfFile(file);
    if (have === DUMP_SHA256) {
      console.log(`fetch-child-corpus: dump cached at ${file} (sha256 ok) — skipping download`);
      return { file, url: DUMP_URL, mirror: DUMP_MIRROR, sha256: DUMP_SHA256 };
    }
    console.log(`fetch-child-corpus: cached dump sha256 ${have} != pinned — re-downloading`);
  }
  console.log(`fetch-child-corpus: downloading ${DUMP_URL} ...`);
  const response = await fetch(DUMP_URL);
  if (!response.ok) throw new Error(`${DUMP_URL} -> HTTP ${response.status}`);
  const partial = `${file}.partial`;
  const out = createWriteStream(partial);
  for await (const chunk of response.body) {
    if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  await rename(partial, file);
  const sha256 = await sha256OfFile(file);
  if (sha256 !== DUMP_SHA256) throw new Error(`downloaded dump sha256 ${sha256} != pinned ${DUMP_SHA256}`);
  return { file, url: DUMP_URL, mirror: DUMP_MIRROR, sha256 };
}

// ---- the thin main ----------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const outDir = arg("--out", OUT_DEFAULT);
  const cacheDir = arg("--cache", CACHE_DEFAULT);

  const dump = await ensureDump(cacheDir);
  const seeds = new Set(CHILD_SEED_TERMS);

  console.log(`fetch-child-corpus: streaming the dump against ${seeds.size} child seed terms ...`);
  const lines = createInterface({ input: createReadStream(dump.file).pipe(createGunzip()), crlfDelay: Infinity });
  const { rows, scanned } = await scanAssertions(lines, { seeds, admittedRels: CHILD_ADMITTED_RELS, filteredRels: FILTERED_RELS });
  console.log(`fetch-child-corpus: scanned ${scanned} dump lines; ${rows.length} unique seed edges`);

  const byReason = new Map();
  const clean = [];
  for (const row of rows) {
    const reason = cutReason(row);
    if (reason) { byReason.set(reason, (byReason.get(reason) || 0) + 1); continue; }
    clean.push(row);
  }
  const cut = rows.length - clean.length;
  console.log(`fetch-child-corpus: quality pass kept ${clean.length}, cut ${cut}`);
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${reason}: ${n}`);

  const map = await loadMap();
  const facts = mapChildFacts(clean, map);
  console.log(`fetch-child-corpus: ${facts.length} facts after mapping (ace=none + mgx:relatedTo dropped)`);

  const rowsByTerm = buildRowsByTerm(facts);
  // metrics reflect the EMITTED (per-term-capped) pack, so the README numbers
  // and `node scripts/measure-child-corpus.mjs` over the committed pack agree
  const emitted = new Map();
  for (const row of rowsByTerm.values()) {
    for (const f of row.facts) emitted.set(factSortKey(f), f);
  }
  const metrics = childCorpusMetrics([...emitted.values()]);

  await rm(join(outDir, "shards"), { recursive: true, force: true });
  const manifest = emitChildPack(rowsByTerm, outDir, {
    dump: { url: dump.url, mirror: dump.mirror, date: "2019-07-03", version: "5.7.0", sha256: dump.sha256 },
    metrics,
  });
  console.log(`fetch-child-corpus: wrote ${manifest.counts.terms} terms, ${manifest.counts.facts} keyed facts, `
    + `${manifest.counts.shards} shards to ${outDir}`);
  console.log(`  budgets: ${JSON.stringify(manifest.budgets)}`);
  console.log("");
  console.log(formatMetrics("child pack", metrics));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
