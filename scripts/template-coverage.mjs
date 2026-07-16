#!/usr/bin/env node
// scripts/template-coverage.mjs — PLAN_BREADTH_FIRST_NLU.md §6b's coverage
// harness. Maintainer-only tooling: never imported by src/ or bin/, never run
// by `npm test`. Offline, $0 — no network, no LLM.
//
// Measures how much of a real, human-written prose corpus (corpus/prose/, the
// frozen external corpus — see scripts/lib/text-corpus.mjs for why) tmct's ACE-OWL grammar
// (src/domain/grammar/ace.mjs's parseAce) already parses. Three buckets per sentence:
//   hit     — parseAce returned a pattern with at least one triple (a genuine,
//             emittable axiom — every word resolved against the lexicon)
//   residue — parseAce recognized the SHAPE of a pattern but one or more words
//             were undeclared (triples empty, residue names them)
//   miss    — parseAce returned null: the sentence doesn't fit any of the 8
//             patterns at all
//
//   node scripts/template-coverage.mjs                        # baseline
//   node scripts/template-coverage.mjs --rescue <rescue.json>  # + rescue pass
//   node scripts/template-coverage.mjs --json <out.json>       # machine-readable report
//
// `--rescue` names the generated corpus JSONL (corpus/generated/
// ace-surface-variants.jsonl, produced by scripts/generate-template-variants.mjs
// — see that file's header) — for every MISS/RESIDUE sentence matching a
// `kind:"rescue"` row's `sentence` field, the harness re-runs parseAce on
// that row's `rescued` (one-word, WordNet-synonym-substituted) text and, if
// that now hits, counts it separately as "rescued" — never silently folded
// into the baseline "hit" count. This is how §6a's generated synonym data
// demonstrably moves the coverage number without touching
// src/domain/grammar/lexicon-core.json or any other product file.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAce } from "../src/domain/grammar/ace.mjs";
import { loadLexicon } from "../src/domain/grammar/lexicon.mjs";
import { loadProseCorpus, proseCorpusFiles } from "./lib/text-corpus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const PROSE_DIR = join(REPO_ROOT, "corpus", "prose");

function classify(sentence, lexicon) {
  const r = parseAce(sentence, lexicon);
  if (!r) return "miss";
  return r.triples.length ? "hit" : "residue";
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Split a classified corpus by its top-level family directory (the
 *  corpus/prose/ subdirectory a sentence came from), so the sources can be
 *  compared against each other rather than only in aggregate. */
function perFamily(rows, lexicon) {
  const families = new Map();
  for (const row of rows) {
    const family = row.file.split("/")[0];
    if (!families.has(family)) families.set(family, { hit: 0, residue: 0, miss: 0, total: 0 });
    const counts = families.get(family);
    counts[classify(row.sentence, lexicon)]++;
    counts.total++;
  }
  return families;
}

async function main() {
  const lexicon = loadLexicon();
  const files = await proseCorpusFiles(PROSE_DIR);
  const corpus = await loadProseCorpus(PROSE_DIR, { files });

  const buckets = { hit: [], residue: [], miss: [] };
  for (const row of corpus) buckets[classify(row.sentence, lexicon)].push(row);

  const total = corpus.length;
  const families = perFamily(corpus, lexicon);
  const report = {
    corpus: `corpus/prose/ — ${files.length} frozen text files`,
    total,
    hit: buckets.hit.length,
    residue: buckets.residue.length,
    miss: buckets.miss.length,
    hitRate: total ? buckets.hit.length / total : 0,
    byFamily: Object.fromEntries(families),
  };

  console.log(`template-coverage: ${files.length} frozen prose files (corpus/prose/), ${total} sentences`);
  console.log(`  hit:     ${buckets.hit.length} (${(report.hitRate * 100).toFixed(1)}%) — full ACE axiom emitted`);
  console.log(`  residue: ${buckets.residue.length} (${((buckets.residue.length / total) * 100).toFixed(1)}%) — pattern shape matched, undeclared word(s)`);
  console.log(`  miss:    ${buckets.miss.length} (${((buckets.miss.length / total) * 100).toFixed(1)}%) — no pattern fit at all`);
  for (const [family, c] of [...families].sort()) {
    console.log(
      `    ${family.padEnd(10)} ${String(c.total).padStart(5)} sentences — ` +
        `hit ${c.hit} (${((c.hit / c.total) * 100).toFixed(1)}%), ` +
        `residue ${c.residue} (${((c.residue / c.total) * 100).toFixed(1)}%), ` +
        `miss ${c.miss} (${((c.miss / c.total) * 100).toFixed(1)}%)`,
    );
  }

  const rescuePath = arg("--rescue");
  if (rescuePath) {
    const rows = (await readFile(rescuePath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((r) => r.kind === "rescue");
    const rescueMap = new Map(rows.map((r) => [r.sentence, r.rescued]));
    const rescued = [];
    for (const row of [...buckets.residue, ...buckets.miss]) {
      const candidate = rescueMap.get(row.sentence);
      if (!candidate) continue;
      if (classify(candidate, lexicon) === "hit") rescued.push({ ...row, rescued: candidate });
    }
    report.rescued = rescued.length;
    report.afterHit = buckets.hit.length + rescued.length;
    report.afterHitRate = total ? report.afterHit / total : 0;
    console.log(`  rescued: ${rescued.length} (via --rescue ${rescuePath}, one-word WordNet-synonym substitution)`);
    console.log(`  after:   ${report.afterHit}/${total} (${(report.afterHitRate * 100).toFixed(1)}%) hit-or-rescued`);
    report.rescuedSentences = rescued;
  }

  const jsonOut = arg("--json");
  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify({ ...report, missSample: buckets.miss.slice(0, 20).map((r) => r.sentence) }, null, 2) + "\n");
    console.log(`  wrote ${jsonOut}`);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

export { classify };
