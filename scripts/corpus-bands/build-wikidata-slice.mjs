#!/usr/bin/env node
// build-wikidata-slice.mjs — builds the `corpus:wikidata-slice` band's
// wire-row jsonl from a Wikidata JSON-lines entity dump (one JSON object per
// line, the shape Wikidata's own `wikidata-*-all.json.bz2` dump uses once
// decompressed and split to one entity per line — e.g. via
// `wikidata-toolkit`, `jq -c '.[]'` over the array form, or an operator's own
// pre-filtered slice). Not part of the product path — an operator-run
// maintainer tool over a real dump the operator downloads by hand; its
// output feeds `tmct corpus load wikidata-slice --source <out>`.
//
//   node scripts/corpus-bands/build-wikidata-slice.mjs --source <dump.jsonl> [--out <path>]
//
// Selection rule, committed here rather than left to the operator's own
// filtering: SEED_QIDS names the entities this slice is built around — a
// small set of common, well-known items. Every claim on a seed entity whose
// property is in WIKIDATA_PROPERTY_RELATIONS (the same property->predicate
// map the live Wikidata research source uses, src/adapters/corpus/
// wikidata-live.mjs — one alignment table for both the live and the batch
// path) becomes a fact, provided the claim's object entity ALSO appears in
// the source file with an English label (an object this file never defines
// has no term to store, and is skipped rather than guessed at). Growing the
// slice is adding SEED_QIDS entries and re-running against a dump that
// carries them.
//
// Deterministic: two passes over the same file (label index, then claims)
// with no randomness; rows are sorted by (predicate, subject, object) before
// `ord` is assigned.
//
// Licence: CC0 1.0 — Wikidata's own statements carry no attribution burden,
// so this pipeline emits no NOTICE.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { WIKIDATA_PROPERTY_RELATIONS } from "../../src/adapters/corpus/wikidata-live.mjs";
import { bandFactRow, bandLicenseInfo } from "../../src/adapters/memory/corpus-bands.mjs";

export const WIKIDATA_SLICE_BAND = "wikidata-slice";
export const DEFAULT_OUT = "wikidata-slice.band.jsonl";

/** The slice's own seed entities — common, well-known Wikidata items rather
 *  than a domain-specific list, since this band's job is broad everyday
 *  coverage beside WordNet/ConceptNet's own strengths. */
export const SEED_QIDS = Object.freeze([
  "Q5",       // human
  "Q144",     // dog
  "Q146",     // cat
  "Q515",     // city
  "Q6256",    // country
  "Q8502",    // mountain
  "Q4022",    // river
  "Q23442",   // island
  "Q11424",   // film
  "Q7397",    // software
  "Q1860",    // English (language)
  "Q3947",    // house
]);

/** Every (property, objectId) pair a mapped claim on `entity` carries — the
 *  same claim shape wikidata-live.mjs's own mappedClaims reads
 *  (`claims[property][].mainsnak.datavalue.value.id`, item-valued only). */
function mappedClaimTargets(entity) {
  const out = [];
  for (const [property, predicate] of Object.entries(WIKIDATA_PROPERTY_RELATIONS)) {
    const statements = entity?.claims?.[property];
    if (!Array.isArray(statements)) continue;
    for (const statement of statements) {
      const snak = statement?.mainsnak;
      if (snak?.snaktype !== "value") continue;
      const id = snak?.datavalue?.value?.id;
      if (typeof id === "string" && id) out.push({ predicate, objectId: id });
    }
  }
  return out;
}

const englishLabel = (entity) => entity?.labels?.en?.value || null;

const byPredicateThenTriple = (a, b) => (
  a.predicate !== b.predicate ? (a.predicate < b.predicate ? -1 : 1)
    : a.subject !== b.subject ? (a.subject < b.subject ? -1 : 1)
      : a.object < b.object ? -1 : a.object > b.object ? 1 : 0
);

/** The band's wire rows, built from a Wikidata JSON-lines entity dump at
 *  `sourcePath`. `seedQids` overrides SEED_QIDS, for a fixture. Returns
 *  `{rows, scanned}` — `scanned` is the entity line count. */
export async function buildWikidataSliceRows(sourcePath, { seedQids = SEED_QIDS } = {}) {
  const seeds = new Set(seedQids);
  const labelById = new Map();
  let scanned = 0;
  {
    const rl = createInterface({ input: createReadStream(sourcePath, "utf8"), crlfDelay: Infinity });
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line) continue;
      scanned += 1;
      const entity = JSON.parse(line);
      const label = englishLabel(entity);
      if (entity?.id && label) labelById.set(entity.id, label);
    }
  }

  const facts = [];
  {
    const rl = createInterface({ input: createReadStream(sourcePath, "utf8"), crlfDelay: Infinity });
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line) continue;
      const entity = JSON.parse(line);
      if (!seeds.has(entity?.id)) continue;
      const subject = labelById.get(entity.id);
      if (!subject) continue;
      for (const { predicate, objectId } of mappedClaimTargets(entity)) {
        const object = labelById.get(objectId);
        if (!object || object === subject) continue;
        facts.push({ subject, predicate, object, provenance: `corpus:${WIKIDATA_SLICE_BAND}` });
      }
    }
  }

  const deduped = [...new Map(facts.map((f) => [`${f.predicate} ${f.subject} ${f.object}`, f])).values()];
  const sorted = deduped.sort(byPredicateThenTriple);
  const rows = sorted.map((fact, ord) => bandFactRow({ ...fact, band: WIKIDATA_SLICE_BAND, ord }));
  return { rows, scanned };
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const sourcePath = flagValue(argv, "--source");
  if (!sourcePath) {
    process.stderr.write("build-wikidata-slice.mjs needs --source <dump.jsonl> (a Wikidata JSON-lines entity dump)\n");
    process.exitCode = 1;
    return;
  }
  const outPath = flagValue(argv, "--out") || DEFAULT_OUT;

  const { rows, scanned } = await buildWikidataSliceRows(sourcePath);
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(outPath, text);
  const digest = createHash("sha256").update(text).digest("hex");
  const { license } = bandLicenseInfo(WIKIDATA_SLICE_BAND);
  process.stderr.write(
    `scanned ${scanned} entity line(s), built ${rows.length} row(s) from ${SEED_QIDS.length} seed entities `
    + `(${text.length} bytes, sha256 ${digest})\n`
    + `wrote ${outPath} (${license}, no attribution notice needed)\n`
    + `load with: tmct corpus load ${WIKIDATA_SLICE_BAND} --source ${outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
