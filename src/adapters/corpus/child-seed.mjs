// corpus/child-seed.mjs — the BULK reader for the shipped CHILD triples pack
// (corpus/child/), used when the pack seeds a store as an ordinary corpus band.
// src/adapters/corpus/child-pack.mjs is the other half: one term at a time, on a
// miss, for the clean-miss cascade. This one walks every shard once.
//
// The shards already carry tmct-vocabulary triples ({subject, predicate,
// object}), so there is no conceptnet-map.toml step here — the rows come out of
// the pack build already mapped.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { CHILD_SHARD_COUNT, isChildFactsRow } from "../../domain/child-pack.mjs";
import { appendNewFacts, preferThenLimit } from "./conceptnet.mjs";

/** Every shard basename the pack can hold, in order — the naming contract
 *  shardNameFor writes, walked rather than listed, so this reader needs no
 *  directory listing and runs in a browser bundle. */
function shardBasenames() {
  return Array.from(
    { length: CHILD_SHARD_COUNT },
    (_, i) => `child-${i.toString(16).padStart(2, "0")}`,
  );
}

/** Every distinct triple in `packDir`'s shards, in shard then row order, as
 *  appendFact-shaped facts. A term appears in one shard as a subject and in
 *  another as an object, so the same edge arrives twice — the first spelling
 *  wins and the duplicate is dropped here, before the store ever sees it.
 *  Absent or malformed shards contribute nothing rather than throwing, the same
 *  tolerance the per-term loader gives. */
export function loadChildPackFacts(packDir, provenancePrefix = "corpus:child") {
  const facts = [];
  const seen = new Set();
  for (const shard of shardBasenames()) {
    let body;
    try {
      body = gunzipSync(readFileSync(join(packDir, "shards", `${shard}.jsonl.gz`))).toString("utf8");
    } catch {
      continue;
    }
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isChildFactsRow(row)) continue;
      for (const f of row.facts) {
        const key = `${f.subject} ${f.predicate} ${f.object}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push({
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          provenance: `${provenancePrefix} ${row.term}`,
        });
      }
    }
  }
  return facts;
}

/** Seed `packDir`'s triples into `dir`'s memory through the same idempotent
 *  append every other corpus band uses. `limit`/`prefer` behave exactly as they
 *  do for a slice-shaped band. Returns { appended, skipped, total }. */
export async function seedChildPack(dir, { packDir, provenancePrefix, limit, prefer } = {}) {
  const facts = preferThenLimit(loadChildPackFacts(packDir, provenancePrefix), prefer, limit);
  const { appended, skipped } = await appendNewFacts(dir, facts);
  return { appended, skipped, total: facts.length };
}
