#!/usr/bin/env node
// build-conceptnet.mjs — builds the `corpus:conceptnet` band's wire-row jsonl.
// Not part of the product path — an operator-run maintainer tool; its output
// feeds `tmct corpus load conceptnet --source <out>`.
//
//   node scripts/corpus-bands/build-conceptnet.mjs [--source <path>] [--out <path>]
//
// The source is the committed ConceptNet slice (corpus/conceptnet/slice.jsonl),
// the same `{start, rel, end}` assertions the `conceptnet` corpus entry seeds a
// store from, mapped through the same conceptnet-map.toml. The band ships the
// slice WHOLE: the browser seed takes a capped share of it, and the band exists
// so a reader with the table can reach the rest.
//
// Deterministic: toFacts is a pure map over the source file's own rows, and
// bandRowsFromFacts sorts before numbering, so the same source produces
// byte-identical output regardless of the source file's own line order.
//
// Licence: the slice is ConceptNet content — CC-BY-SA-4.0, attribution and
// share-alike, see corpus/conceptnet/LICENSE-NOTICE. corpus-bands.mjs's
// BAND_LICENSES points the loader at that same file, so this pipeline emits no
// NOTICE of its own.

import { loadSlice, loadMap, toFacts, SLICE_FILE } from "../../src/adapters/corpus/conceptnet.mjs";
import { bandLicenseInfo } from "../../src/adapters/memory/corpus-bands.mjs";
import { bandRowsFromFacts } from "./band-rows-from-facts.mjs";
import { writeRowsStreaming } from "./stream-band-rows.mjs";

export const CONCEPTNET_BAND = "conceptnet";
export const DEFAULT_SOURCE = SLICE_FILE;
export const DEFAULT_OUT = "conceptnet.band.jsonl";

/** The band's wire rows, built from the ConceptNet slice at `sourcePath`.
 *  `mapPath` overrides the relation map for a fixture whose dump needs no
 *  relation this repo's own conceptnet-map.toml lacks. */
export async function buildConceptnetRows(sourcePath = DEFAULT_SOURCE, { mapPath } = {}) {
  const [assertions, map] = await Promise.all([loadSlice(sourcePath), loadMap(mapPath)]);
  return bandRowsFromFacts(toFacts(assertions, map, `corpus:${CONCEPTNET_BAND}`), CONCEPTNET_BAND);
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const sourcePath = flagValue(argv, "--source") || DEFAULT_SOURCE;
  const outPath = flagValue(argv, "--out") || DEFAULT_OUT;

  const rows = await buildConceptnetRows(sourcePath);
  const { bytes, digest } = await writeRowsStreaming(outPath, rows);
  const { license, notice } = bandLicenseInfo(CONCEPTNET_BAND);
  process.stderr.write(
    `wrote ${rows.length} rows (${bytes} bytes, sha256 ${digest}) to ${outPath}\n`
    + `licence: ${license} (${notice})\n`
    + `load with: tmct corpus load ${CONCEPTNET_BAND} --source ${outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
