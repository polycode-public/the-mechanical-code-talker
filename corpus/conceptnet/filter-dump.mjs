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

import { createInterface } from "node:readline";
import { SEED_TERMS, CANONICAL_RELS, FILTERED_RELS, bareEnTerm } from "./fetch-slice.mjs";
import { loadMap } from "../../src/corpus/conceptnet.mjs";

const MAX_BYTES = 1_400_000; // committed-slice budget (hard cap 1.5 MB)
const SEEDS = new Set(SEED_TERMS);
const termOf = (uri) => uri.slice("/c/en/".length);

const byKey = new Map(); // "start rel end" -> row
let scanned = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  scanned += 1;
  const cols = line.split("\t");
  if (cols.length < 5) continue;
  const rel = cols[1];
  if (!CANONICAL_RELS.has(rel) || FILTERED_RELS.has(rel)) continue;
  const start = bareEnTerm(cols[2]);
  const end = bareEnTerm(cols[3]);
  if (!start || !end || start === end) continue;
  if (!SEEDS.has(termOf(start)) && !SEEDS.has(termOf(end))) continue;
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

// budget-trim: mappable relations first, then none-rows — each tier
// weight-descending, so the strongest seedable facts always survive
const map = await loadMap();
const byWeight = (a, b) =>
  b.weight - a.weight || a.rel.localeCompare(b.rel) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end);
const all = [...byKey.values()];
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
