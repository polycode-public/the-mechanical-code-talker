#!/usr/bin/env node
// build-child.mjs — builds the `corpus:child` band's wire-row jsonl. Not part
// of the product path — an operator-run maintainer tool; its output feeds
// `tmct corpus load child --source <out>`.
//
//   node scripts/corpus-bands/build-child.mjs [--source <pack dir>] [--out <path>]
//
// The source is the shipped CHILD triples pack (corpus/child/), a directory of
// gzipped shards plus a term index rather than one slice file, so `--source`
// names the pack DIRECTORY. The shards already carry tmct-vocabulary triples,
// so there is no conceptnet-map.toml step: child-seed.mjs's loadChildPackFacts
// walks every shard through the pack's own naming contract (no directory
// listing, so the same reader runs in a browser bundle) and hands back the
// distinct triples. The band ships the pack WHOLE: the browser seed takes a
// capped share of it, and the band exists so a reader with the table can reach
// the rest.
//
// Deterministic: the shard walk is a fixed sequence, its first-spelling-wins
// dedupe therefore settles the same way every run, and bandRowsFromFacts sorts
// before numbering.
//
// Licence: the pack is ConceptNet-derived content — CC-BY-SA-4.0, attribution
// and share-alike, see corpus/child/LICENSE-NOTICE. corpus-bands.mjs's
// BAND_LICENSES points the loader at that same file, so this pipeline emits no
// NOTICE of its own.

import { loadChildPackFacts } from "../../src/adapters/corpus/child-seed.mjs";
import { childPackDir } from "../../src/adapters/corpus/child-pack.mjs";
import { bandLicenseInfo } from "../../src/adapters/memory/corpus-bands.mjs";
import { bandRowsFromFacts } from "./band-rows-from-facts.mjs";
import { writeRowsStreaming } from "./stream-band-rows.mjs";

export const CHILD_BAND = "child";
export const DEFAULT_OUT = "child.band.jsonl";

/** The band's wire rows, built from the CHILD triples pack at `packDir`
 *  (default: the package's own corpus/child/). */
export function buildChildRows(packDir = childPackDir()) {
  return bandRowsFromFacts(loadChildPackFacts(packDir, `corpus:${CHILD_BAND}`), CHILD_BAND);
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const packDir = flagValue(argv, "--source") || childPackDir();
  const outPath = flagValue(argv, "--out") || DEFAULT_OUT;

  const rows = buildChildRows(packDir);
  if (!rows.length) throw new Error(`no shards read under ${packDir} — name the pack directory with --source`);
  const { bytes, digest } = await writeRowsStreaming(outPath, rows);
  const { license, notice } = bandLicenseInfo(CHILD_BAND);
  process.stderr.write(
    `wrote ${rows.length} rows (${bytes} bytes, sha256 ${digest}) to ${outPath}\n`
    + `licence: ${license} (${notice})\n`
    + `load with: tmct corpus load ${CHILD_BAND} --source ${outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
