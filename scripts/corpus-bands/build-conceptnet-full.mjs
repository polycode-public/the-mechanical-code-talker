#!/usr/bin/env node
// build-conceptnet-full.mjs — builds the `corpus:conceptnet-full` band's
// wire-row jsonl from a raw ConceptNet assertions dump (the same tab-
// separated shape corpus/conceptnet/filter-dump.mjs reads). Not part of the
// product path — an operator-run maintainer tool over a real dump the
// operator downloads by hand; its output feeds
// `tmct corpus load conceptnet-full --source <out>`.
//
//   curl -s https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz \
//     | gunzip -c > dump.tsv
//   node scripts/corpus-bands/build-conceptnet-full.mjs --source dump.tsv [--out <path>]
//
// Unlike corpus/conceptnet/slice.jsonl (tech-seeded, budget-capped), this
// band admits every en→en edge whose relation is one of the 34 canonical
// ConceptNet relations minus the policy-filtered etymology/ExternalURL ones
// (the same admitted-relation set filter-dump.mjs uses) — no seed-term
// restriction and no size budget, since the whole point of this band is to
// be the superset the capped slice's facts moved out into (§3.18). The
// dedupe-by-(start,rel,end)-keeping-higher-weight streaming pass is
// scanAssertions itself (corpus/conceptnet/filter-dump.mjs), reused rather
// than reimplemented — one filter, one admitted-relation table.
//
// Deterministic: rows are sorted by (predicate, subject, object) before
// `ord` is assigned, so the same dump produces byte-identical output
// regardless of line order or how the OS streams the file.
//
// Licence: CC BY-SA 4.0, share-alike — this pipeline writes its own NOTICE
// beside the output jsonl (the commonsenseqa-sample.NOTICE precedent,
// test-benchmarks/claims/commonsenseqa-sample.NOTICE), since this band's
// content and selection rule differ from the committed slice's own
// corpus/conceptnet/LICENSE-NOTICE.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import { scanAssertions } from "../../corpus/conceptnet/filter-dump.mjs";
import { loadMap, toFacts } from "../../src/adapters/corpus/conceptnet.mjs";
import { bandFactRow, bandLicenseInfo } from "../../src/adapters/memory/corpus-bands.mjs";
import { writeRowsStreaming } from "./stream-band-rows.mjs";

export const CONCEPTNET_FULL_BAND = "conceptnet-full";
export const DEFAULT_OUT = "conceptnet-full.band.jsonl";

// This band has no seed-term restriction — every endpoint admits, so
// scanAssertions' seed check never excludes a row on that ground.
const ADMIT_EVERY_TERM = { has: () => true };

const byPredicateThenTriple = (a, b) => (
  a.predicate !== b.predicate ? (a.predicate < b.predicate ? -1 : 1)
    : a.subject !== b.subject ? (a.subject < b.subject ? -1 : 1)
      : a.object < b.object ? -1 : a.object > b.object ? 1 : 0
);

/** The band's wire rows, streamed from a raw ConceptNet TSV dump at
 *  `sourcePath`. `mapPath` overrides the relation map, for a fixture whose
 *  dump needs no relation this repo's own conceptnet-map.toml lacks.
 *  Returns `{rows, scanned}` — `scanned` is the raw line count, reported by
 *  the CLI so an operator can see the admission rate over a real dump. */
export async function buildConceptnetFullRows(sourcePath, { mapPath } = {}) {
  const rl = createInterface({ input: createReadStream(sourcePath, "utf8"), crlfDelay: Infinity });
  const { rows: assertions, scanned } = await scanAssertions(rl, { seeds: ADMIT_EVERY_TERM });
  const map = await loadMap(mapPath);
  const facts = toFacts(assertions, map, `corpus:${CONCEPTNET_FULL_BAND}`);
  const sorted = facts.slice().sort(byPredicateThenTriple);
  const rows = sorted.map((fact, ord) => bandFactRow({ ...fact, band: CONCEPTNET_FULL_BAND, ord }));
  return { rows, scanned };
}

/** The attribution notice this band's pipeline writes beside its jsonl —
 *  the CC BY-SA 4.0 content and the selection rule actually applied. */
export function conceptnetFullNotice({ rowCount, outPath }) {
  return `LICENSE NOTICE — ${outPath}
=======================================================

This file is a filtered admission of a ConceptNet assertions dump, and is
licensed under the Creative Commons Attribution-ShareAlike 4.0
International License (CC-BY-SA 4.0), NOT under this repository's MPL-2.0.

  https://creativecommons.org/licenses/by-sa/4.0/

Attribution
-----------

This work includes data from ConceptNet 5, which was compiled by the
Commonsense Computing Initiative. ConceptNet 5 is freely available under
the Creative Commons Attribution-ShareAlike license (CC-BY-SA 4.0) from
https://conceptnet.io. The included data was created by contributors to
Commonsense Computing projects, contributors to Wikimedia projects, Games
with a Purpose, Princeton University's WordNet, DBPedia, OpenCyc, and Umbel.

Source
------

- Dataset: a ConceptNet assertions dump (e.g.
  https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz),
  supplied by the operator running this pipeline.
- Project: https://conceptnet.io / https://github.com/commonsense/conceptnet5
- Selection rule: every en→en assertion whose relation is one of
  ConceptNet's 34 canonical relations minus the policy-filtered
  etymology/ExternalURL ones (corpus/conceptnet/fetch-slice.mjs's
  CANONICAL_RELS/FILTERED_RELS) — no seed-term restriction and no size
  budget, unlike the committed corpus/conceptnet/slice.jsonl. Deduped by
  (start, rel, end), higher weight winning
  (corpus/conceptnet/filter-dump.mjs's scanAssertions, reused unchanged).
  ${rowCount} rows in this file.

Share-alike
-----------

If you redistribute this file (modified or not), you must do so under
CC-BY-SA 4.0 with this attribution. The code that produced it
(scripts/corpus-bands/build-conceptnet-full.mjs) is tmct code under the
repository's MPL-2.0; only the data file carries CC-BY-SA 4.0.
`;
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const sourcePath = flagValue(argv, "--source");
  if (!sourcePath) {
    process.stderr.write("build-conceptnet-full.mjs needs --source <dump.tsv> (a raw ConceptNet assertions dump)\n");
    process.exitCode = 1;
    return;
  }
  const outPath = flagValue(argv, "--out") || DEFAULT_OUT;

  const { rows, scanned } = await buildConceptnetFullRows(sourcePath);
  const { bytes, digest } = await writeRowsStreaming(outPath, rows);
  const noticePath = `${outPath}.NOTICE`;
  await writeFile(noticePath, conceptnetFullNotice({ rowCount: rows.length, outPath }));
  const { license } = bandLicenseInfo(CONCEPTNET_FULL_BAND);
  process.stderr.write(
    `scanned ${scanned} dump line(s), admitted ${rows.length} row(s) (${bytes} bytes, sha256 ${digest})\n`
    + `wrote ${outPath} and ${noticePath} (${license})\n`
    + `load with: tmct corpus load ${CONCEPTNET_FULL_BAND} --source ${outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
