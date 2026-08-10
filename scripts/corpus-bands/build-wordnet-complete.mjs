#!/usr/bin/env node
// build-wordnet-complete.mjs — builds the `corpus:wordnet-complete` band's
// wire-row jsonl. Not part of the product path — an operator-run maintainer
// tool; its output feeds `tmct corpus load wordnet-complete --source <out>`.
//
//   node scripts/corpus-bands/build-wordnet-complete.mjs [--source <path>] [--out <path>]
//
// The source is a ConceptNet-shape assertions dump — the same
// `{start, rel, end, weight, surfaceText}` jsonl corpus/wordnet/generate.mjs
// already produces from a raw Open English WordNet YAML checkout (that
// conversion is its own maintainer tool; this pipeline reads its OUTPUT, not
// the raw YAML, so it needs no second YAML parser). Default source:
// corpus/wordnet/wordnet-full.jsonl, the complete committed conversion.
//
// This band is a superset of the wordnet-xl band the turn Lambda bundles —
// the whole point of moving WordNet's depth out of the seed and into
// per-query retrieval (§3.18) — so the default source is deliberately
// wordnet-full.jsonl, not wordnet-xl.jsonl.
//
// Deterministic: toFacts is a pure map over the source file's own rows, and
// this pipeline sorts by (predicate, subject, object) before assigning each
// row its `ord`, so the same source produces byte-identical output
// regardless of the source file's own line order.
//
// Licence: Open English WordNet content is CC-BY-4.0 — see
// corpus/wordnet/LICENSE-NOTICE, which already carries the full attribution
// this band's content needs; corpus-bands.mjs's BAND_LICENSES points the
// loader at that same file, so this pipeline emits no NOTICE of its own.

import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadSlice, loadMap, toFacts, WORDNET_DIR } from "../../src/adapters/corpus/conceptnet.mjs";
import { bandFactRow, bandLicenseInfo } from "../../src/adapters/memory/corpus-bands.mjs";
import { join } from "node:path";

export const WORDNET_COMPLETE_BAND = "wordnet-complete";
export const DEFAULT_SOURCE = join(WORDNET_DIR, "wordnet-full.jsonl");
export const DEFAULT_OUT = "wordnet-complete.band.jsonl";

const byPredicateThenTriple = (a, b) => (
  a.predicate !== b.predicate ? (a.predicate < b.predicate ? -1 : 1)
    : a.subject !== b.subject ? (a.subject < b.subject ? -1 : 1)
      : a.object < b.object ? -1 : a.object > b.object ? 1 : 0
);

/** The band's wire rows, built from a ConceptNet-shape assertions dump at
 *  `sourcePath` (default: the committed wordnet-full.jsonl). Sorted by
 *  (predicate, subject, object) before `ord` is assigned, so two runs over
 *  differently-ordered copies of the same facts still produce identical
 *  output. `mapPath` overrides the relation map for a fixture whose dump
 *  needs no relation this repo's own conceptnet-map.toml lacks. */
export async function buildWordnetCompleteRows(sourcePath = DEFAULT_SOURCE, { mapPath } = {}) {
  const [assertions, map] = await Promise.all([loadSlice(sourcePath), loadMap(mapPath)]);
  const facts = toFacts(assertions, map, `corpus:${WORDNET_COMPLETE_BAND}`);
  const sorted = facts.slice().sort(byPredicateThenTriple);
  return sorted.map((fact, ord) => bandFactRow({ ...fact, band: WORDNET_COMPLETE_BAND, ord }));
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const sourcePath = flagValue(argv, "--source") || DEFAULT_SOURCE;
  const outPath = flagValue(argv, "--out") || DEFAULT_OUT;

  const rows = await buildWordnetCompleteRows(sourcePath);
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(outPath, text);
  const digest = createHash("sha256").update(text).digest("hex");
  const { license, notice } = bandLicenseInfo(WORDNET_COMPLETE_BAND);
  process.stderr.write(
    `wrote ${rows.length} rows (${text.length} bytes, sha256 ${digest}) to ${outPath}\n`
    + `licence: ${license} (${notice})\n`
    + `load with: tmct corpus load ${WORDNET_COMPLETE_BAND} --source ${outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
