#!/usr/bin/env node
// filter-dump.mjs — regenerate corpus/conceptnet/slice.jsonl from a ConceptNet
// ASSERTIONS DUMP instead of the API (the route actually used for the
// committed slice: api.conceptnet.io was hard-down, 502, on 2026-07-04).
// NOT part of the product path — a maintainer tool.
//
//   curl -s https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz \
//     | gunzip -c \
//     | node corpus/conceptnet/filter-dump.mjs > corpus/conceptnet/slice.jsonl
//
// Input: the tab-separated 5.7.0 dump on stdin —
//   assertionURI \t rel \t start \t end \t {json: weight, surfaceText, …}
//
// Filter rules (shared with fetch-slice.mjs; also in README.md):
//   - start AND end are English concepts (/c/en/…), sense tags stripped
//     (/c/en/dog/n → /c/en/dog);
//   - rel is one of the 34 canonical relations, minus the policy-filtered
//     etymology/ExternalURL ones;
//   - at least ONE endpoint's bare term is in the ~90-term tech seed list
//     (fetch-slice.mjs SEED_TERMS);
//   - dedupe by (start, rel, end), keeping the higher weight;
//   - budget (~1.4 MB of JSONL), TWO-TIER: assertions whose relation MAPS to
//     an ACE-OWL pattern (conceptnet-map.toml, ace != "none") are kept first
//     (weight-descending); ace="none" relations (RelatedTo, Synonym, …) fill
//     whatever budget remains — they never crowd out seedable facts;
//   - final order (rel, start, end) for deterministic diffs.
// Stats land on stderr; the JSONL lands on stdout.
//
// The streaming seed/relation/dedupe pass is exported as scanAssertions so the
// child-corpus build (scripts/fetch-child-corpus.mjs) can reuse ONE filter over
// its own seed and its own admitted-relation set, instead of a second copy.

import { createInterface } from "node:readline";
import { SEED_TERMS, CANONICAL_RELS, FILTERED_RELS, bareEnTerm } from "./fetch-slice.mjs";
import { loadMap } from "../../src/adapters/corpus/conceptnet.mjs";

const MAX_BYTES = 4_500_000; // committed-slice budget (hard cap 5 MB), grown for the ~40k tier-1 target

// Tier-1 growth seeds (2026-07-05): the original SEED_TERMS in fetch-slice.mjs
// stay the canonical ~90-term base; this list WIDENS the tech domain toward the
// ~40k-fact target without leaving the software/tech world — languages,
// frameworks, data structures, cloud/infra, protocols, tools, ML. Kept here (an
// owned maintainer file) rather than in fetch-slice.mjs so the API route's seed
// contract is untouched. Union with SEED_TERMS below.
const EXTRA_SEEDS = [
  // programming languages & ecosystems
  "python", "java", "javascript", "typescript", "ruby", "perl", "php", "golang",
  "rust", "kotlin", "swift", "scala", "haskell", "lisp", "clojure", "erlang",
  "fortran", "cobol", "pascal", "assembly", "sql", "html", "css", "json", "xml",
  "yaml", "markdown", "bash", "powershell",
  // paradigms & concepts
  "programming", "coding", "recursion", "iteration", "inheritance",
  "polymorphism", "abstraction", "encapsulation", "concurrency", "parallelism",
  "multithreading", "asynchronous", "synchronization", "serialization",
  "optimization", "refactoring", "debugging", "compilation", "runtime",
  "object_oriented", "functional_programming", "computer_science",
  "software_engineering", "computer_programming",
  // data structures & algorithms
  "hash", "hashtable", "tree", "graph", "list", "tuple", "dictionary", "heap",
  "matrix", "vector", "node", "recursion", "sorting", "searching", "linked_list",
  "binary_tree", "hash_table", "data_type", "datatype",
  // frameworks, tools & platforms
  "git", "github", "docker", "kubernetes", "jenkins", "react", "angular",
  "nodejs", "django", "flask", "spring", "rails", "tensorflow", "pytorch",
  "hadoop", "kafka", "redis", "mongodb", "mysql", "postgresql", "sqlite",
  "elasticsearch", "apache", "nginx", "wordpress", "eclipse", "vim", "emacs",
  // hardware & systems
  "kernel", "driver", "register", "transistor", "semiconductor", "motherboard",
  "microprocessor", "microcontroller", "gpu", "ram", "rom", "ssd", "firmware",
  "bootloader", "filesystem", "partition", "peripheral", "microchip",
  "circuit_board", "integrated_circuit", "hard_drive", "graphics_card",
  // networking & protocols
  "packet", "bandwidth", "latency", "router", "firewall", "gateway", "proxy",
  "dns", "tcp", "ftp", "smtp", "ssh", "ssl", "vpn", "ethernet", "wifi",
  "bluetooth", "socket", "port", "packet_switching", "ip_address",
  // web & the net
  "url", "cookie", "session", "webpage", "hyperlink", "frontend", "backend",
  "webserver", "webservice", "hosting", "domain", "html5", "ajax",
  // cloud, infra & devops
  "cloud_computing", "container", "virtualization", "serverless",
  "microservice", "deployment", "devops", "pipeline", "infrastructure",
  "datacenter", "cluster", "scalability", "availability", "redundancy",
  // security
  "authentication", "authorization", "cryptography", "hashing", "firewall",
  "malware", "virus", "vulnerability", "cybersecurity", "cipher",
  // data & ml
  "dataset", "database", "datastore", "query", "index", "schema", "transaction",
  "neural_network", "deep_learning", "classification", "regression",
  "clustering", "training", "inference", "algorithm", "computation",
  "big_data", "data_mining", "data_science", "analytics",
  // concurrency & os primitives
  "semaphore", "mutex", "deadlock", "scheduler", "interrupt", "syscall",
  "daemon", "multitasking", "buffer", "pipe",
];
const SEEDS = new Set([...SEED_TERMS, ...EXTRA_SEEDS]);
const termOf = (uri) => uri.slice("/c/en/".length);

/**
 * Stream one dump (an async iterable of TSV lines) and keep every en→en
 * assertion whose relation is admitted and at least one endpoint's bare term is
 * in `seeds`. Deduped by (start, rel, end), higher weight winning. Pure of any
 * budget or ordering — the caller trims and sorts. Returns { rows, scanned }.
 *
 * `admittedRels` defaults to the 34 canonical relations minus the policy-filtered
 * ones; the child build passes its own set (canonical + /r/NotCapableOf) so the
 * defeasible-negation data survives the filter.
 */
export async function scanAssertions(lines, { seeds, admittedRels = CANONICAL_RELS, filteredRels = FILTERED_RELS } = {}) {
  const byKey = new Map(); // "start rel end" -> row
  let scanned = 0;
  for await (const line of lines) {
    scanned += 1;
    const cols = line.split("\t");
    if (cols.length < 5) continue;
    const rel = cols[1];
    if (!admittedRels.has(rel) || filteredRels.has(rel)) continue;
    const start = bareEnTerm(cols[2]);
    const end = bareEnTerm(cols[3]);
    if (!start || !end || start === end) continue;
    if (!seeds.has(termOf(start)) && !seeds.has(termOf(end))) continue;
    let info = {};
    try {
      info = JSON.parse(cols[4]);
    } catch {
      /* a malformed info column loses us weight/surfaceText, not the edge */
    }
    const row = { start, rel, end, weight: Number(info.weight) || 1 };
    if (info.surfaceText) row.surfaceText = String(info.surfaceText);
    const key = `${start} ${rel} ${end}`;
    const prev = byKey.get(key);
    if (!prev || row.weight > prev.weight) byKey.set(key, row);
  }
  return { rows: [...byKey.values()], scanned };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const { rows: all, scanned } = await scanAssertions(rl, { seeds: SEEDS });

  // budget-trim: mappable relations first, then none-rows — each tier
  // weight-descending, so the strongest seedable facts always survive
  const map = await loadMap();
  const byWeight = (a, b) =>
    b.weight - a.weight || a.rel.localeCompare(b.rel) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end);
  const mappable = all.filter((r) => map.get(r.rel)?.ace !== "none").sort(byWeight);
  const unmappable = all.filter((r) => map.get(r.rel)?.ace === "none").sort(byWeight);
  const kept = [];
  let bytes = 0;
  for (const row of [...mappable, ...unmappable]) {
    const line = JSON.stringify(row) + "\n";
    if (bytes + line.length > MAX_BYTES) continue;
    bytes += line.length;
    kept.push(row);
  }
  kept.sort((a, b) => a.rel.localeCompare(b.rel) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  for (const row of kept) process.stdout.write(JSON.stringify(row) + "\n");

  const perRel = new Map();
  for (const r of kept) perRel.set(r.rel, (perRel.get(r.rel) || 0) + 1);
  const keptMappable = kept.filter((r) => map.get(r.rel)?.ace !== "none").length;
  console.error(`scanned ${scanned} dump lines; matched ${all.length} unique en→en seed assertions `
    + `(${mappable.length} mappable + ${unmappable.length} ace=none); `
    + `kept ${kept.length} (${keptMappable} mappable + ${kept.length - keptMappable} none) in ${bytes} bytes`);
  for (const [rel, n] of [...perRel.entries()].sort((a, b) => b[1] - a[1])) console.error(`  ${rel}: ${n}`);
}
