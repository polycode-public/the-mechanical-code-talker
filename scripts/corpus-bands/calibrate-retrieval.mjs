#!/usr/bin/env node
// calibrate-retrieval.mjs — measures what corpus retrieval actually costs, so
// the budgets it runs under are numbers somebody read off a run rather than
// numbers somebody guessed.
//
// It builds two band partitions out of this repo's own committed WordNet and
// ConceptNet corpora, serves them through a document client that answers the
// same begins_with Query DynamoDB does, and replays a fixed query set twice:
// once with fuzzy variants on, once with them off. What it prints is the
// per-query subgraph size, the Query count, the wall time, and which budget
// each case would have tripped.
//
// Usage:
//   node scripts/corpus-bands/calibrate-retrieval.mjs [--json] [--limit N]
//
// --limit caps the facts read from each corpus, for a quick run. The published
// numbers come from a full run.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  loadSlice, loadMap, toFacts, SLICE_FILE, WORDNET_DIR, SEON_CONCEPTS_FILE, TIER2_DIR,
} from "../../src/adapters/corpus/conceptnet.mjs";
import { normFactTerm, factIdForTriple } from "../../src/domain/hash.mjs";
import { queryTerms, fuzzyVariantsFor } from "../../src/domain/retrieval-plan.mjs";
import { rowsToPayload } from "../../src/adapters/memory/rows.mjs";
import { retrieveSubgraph, termQueryOverDocumentClient, RETRIEVAL_BUDGETS } from "../../src/services/subgraph-retrieval.mjs";

export const WORDNET_BAND = "wordnet-complete";
export const CONCEPTNET_BAND = "conceptnet-slice";

/** The corpora the turn tier bundles: the three human persona tiers and the
 *  code concept pack. A calibration case that claims to test a moved band has
 *  to name a term none of these hold. */
const MID_BUNDLE_FILES = [
  join(TIER2_DIR, "human.jsonl"),
  join(TIER2_DIR, "human-medium.jsonl"),
  join(TIER2_DIR, "human-large.jsonl"),
  SEON_CONCEPTS_FILE,
];

/** A fixed instant, so two runs of the harness build byte-identical rows. */
const FIXTURE_INSTANT = "2026-01-01T00:00:00.000Z";

/** The calibration set. Each case says what it is measuring, and the two
 *  moved-band cases carry the check that matters most: their terms are absent
 *  from everything the turn tier bundles, so an answer can only come back
 *  through retrieval. */
export const CALIBRATION_QUERIES = Object.freeze([
  { name: "common-noun", text: "what is a dog", measures: "a high-fanout everyday term" },
  { name: "is-a", text: "is a dolphin a mammal", measures: "two subjects and the subClassOf chase" },
  { name: "two-word-subject", text: "what is a roman letter", measures: "the adjacent-word pair term" },
  { name: "property", text: "how many legs does a spider have", measures: "a property question's term spread" },
  { name: "capability", text: "what can a bird do", measures: "a capability lane's terms" },
  { name: "code-term", text: "what is a class", measures: "a term the code corpora also hold" },
  { name: "long-turn", text: "i was reading about volcanoes and earthquakes and wondered what a tectonic plate is", measures: "the term count a rambling turn produces" },
  { name: "typo", text: "what is a dolfin", measures: "the fuzzy path, and what it costs when it finds nothing" },
  { name: "miss", text: "what is a zzzzqx", measures: "an ungrounded term: the cost of an honest miss" },
  {
    name: "wordnet-only",
    text: "what is an aalii",
    measures: "a WordNet word the turn tier no longer bundles",
    absentFromMidBundle: "aalii",
  },
  {
    name: "conceptnet-only",
    text: "what is the opposite of always",
    measures: "a ConceptNet relation the turn tier no longer bundles",
    absentFromMidBundle: "always",
  },
]);

/** Budgets wide enough that nothing trips, so a run measures what retrieval
 *  wants rather than what a cap allowed. */
const MEASURING_BUDGETS = Object.freeze({
  ...RETRIEVAL_BUDGETS,
  fuzzyVariantsPerTerm: 8,
  rowsPerQueryPage: 200,
  totalRows: 1_000_000,
  totalQueries: 100_000,
  wallTimeMs: 600_000,
});

async function readSliceRows(path, limit) {
  const rows = [];
  const reader = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const raw of reader) {
    const line = raw.trim();
    if (!line) continue;
    rows.push(JSON.parse(line));
    if (limit && rows.length >= limit) break;
  }
  return rows;
}

/** The term set the turn tier bundles, read straight from the committed files
 *  rather than from a remembered list. */
export async function midBundleTerms() {
  const terms = new Set();
  for (const file of MID_BUNDLE_FILES) {
    for (const row of await readSliceRows(file)) {
      for (const endpoint of [row.start, row.end]) {
        const term = normFactTerm(String(endpoint || ""));
        if (term) terms.add(term);
      }
    }
  }
  return terms;
}

/** One band row in the wire shape, with the same attribute set the row
 *  projection writes, so a measured row size is a real row size. */
export function bandRow({ subject, predicate, object, provenance = "", band, ord = 0 }) {
  const sourceId = `src:corpus:${band}`;
  const id = `${factIdForTriple(subject, predicate, object)}@${sourceId}`;
  const individual = {
    id,
    label: `${subject} ${predicate} ${object}`,
    class: "Fact",
    derived_from: [],
    mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: subject },
      { prop: "rdf:predicate", key: "predicate", value: predicate },
      { prop: "rdf:object", key: "object", value: object },
      { prop: "mgx:createdAt", key: "createdAt", value: FIXTURE_INSTANT },
      { prop: "mgx:sourceId", key: "sourceId", value: sourceId },
      { prop: "mgx:factProvenance", key: "provenance", value: provenance },
      { prop: "mgx:hasProseTokens", key: "prose_tokens", value: [...new Set(`${subject} ${object} ${predicate}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))].sort().join(" ") },
      { prop: "mgx:trustScore", key: "trustScore", value: "0.7" },
      { prop: "mgx:trustInputs", key: "trustInputs", value: JSON.stringify({ sourceType: "corpus", sourceId, createdAt: FIXTURE_INSTANT }) },
      { prop: "mgx:updatedAt", key: "updatedAt", value: FIXTURE_INSTANT },
    ],
  };
  return {
    pk: `corpus:${band}`,
    sk: `fact#${normFactTerm(subject)}#${id}`,
    rowKey: id,
    rowClass: "fact",
    term: normFactTerm(subject),
    json: JSON.stringify({ ord, individual }),
  };
}

/** A document client over in-memory partitions, answering the one Query shape
 *  band reads use: equality on the partition, begins_with on the sort key, a
 *  page limit and a continuation token.
 *
 *  `sorted` says whether the partition array is already in sort-key order, the
 *  way a real table's partition is. Pass false and the client hands its matches
 *  back in whatever order they were stored, which is how a caller proves its
 *  answer does not depend on that order. */
export function createFakeDocumentClient(partitions, { sorted = true } = {}) {
  return {
    queries: 0,
    async query({ ExpressionAttributeValues, Limit, ExclusiveStartKey }) {
      this.queries += 1;
      const items = partitions.get(ExpressionAttributeValues[":pk"]) || [];
      const prefix = ExpressionAttributeValues[":sk"];
      const after = ExclusiveStartKey?.sk ?? null;
      const limit = Limit || items.length;

      if (!sorted) {
        const matches = items.filter((item) => item.sk.startsWith(prefix));
        const start = after === null ? 0 : matches.findIndex((item) => item.sk === after) + 1;
        const page = matches.slice(start, start + limit);
        const last = page.at(-1);
        const more = start + page.length < matches.length;
        return { Items: page, LastEvaluatedKey: more && last ? { pk: last.pk, sk: last.sk } : null };
      }

      const page = [];
      let index = items.findIndex((item) => item.sk >= prefix && (after === null || item.sk > after));
      if (index < 0) return { Items: [], LastEvaluatedKey: null };
      for (; index < items.length && page.length < limit; index += 1) {
        if (!items[index].sk.startsWith(prefix)) break;
        page.push(items[index]);
      }
      const more = index < items.length && items[index].sk.startsWith(prefix);
      const last = page.at(-1);
      return { Items: page, LastEvaluatedKey: more && last ? { pk: last.pk, sk: last.sk } : null };
    },
  };
}

/** Two band partitions, built from the committed corpora and indexed the way
 *  a real band partition is. */
export async function buildFixtureBands({ limit = 0 } = {}) {
  const map = await loadMap();
  const partitions = new Map();
  const sources = [
    { band: WORDNET_BAND, path: join(WORDNET_DIR, "wordnet-xl.jsonl"), provenance: "corpus:wordnet-complete" },
    { band: CONCEPTNET_BAND, path: SLICE_FILE, provenance: "corpus:conceptnet-slice" },
  ];
  let bytes = 0;
  for (const source of sources) {
    const assertions = await (limit ? readSliceRows(source.path, limit) : loadSlice(source.path));
    const rows = [];
    let ord = 0;
    for (const fact of toFacts(assertions, map, source.provenance)) {
      const row = bandRow({ ...fact, band: source.band, ord });
      ord += 1;
      bytes += row.json.length;
      rows.push(row);
    }
    rows.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
    partitions.set(`corpus:${source.band}`, rows);
  }
  const rowCount = [...partitions.values()].reduce((total, rows) => total + rows.length, 0);
  return { partitions, rowCount, bytes, bands: [WORDNET_BAND, CONCEPTNET_BAND] };
}

/** What each budget would have done to this run, had it been in force. */
function budgetPressure(metrics, subgraphBytes) {
  return {
    queries: metrics.queries,
    rows: metrics.rows,
    bytes: subgraphBytes,
    elapsedMs: metrics.elapsedMs,
    wouldTrip: [
      metrics.queries > RETRIEVAL_BUDGETS.totalQueries ? "totalQueries" : null,
      metrics.rows > RETRIEVAL_BUDGETS.totalRows ? "totalRows" : null,
      metrics.elapsedMs > RETRIEVAL_BUDGETS.wallTimeMs ? "wallTimeMs" : null,
    ].filter(Boolean),
  };
}

async function measureCase({ query, fixture, fuzzy, budgets = MEASURING_BUDGETS }) {
  const client = createFakeDocumentClient(fixture.partitions);
  const queryTerm = termQueryOverDocumentClient({ client, tableName: "calibration", pageSize: budgets.rowsPerQueryPage });
  const started = Date.now();
  const { rows, metrics, plan } = await retrieveSubgraph({
    text: query.text, bands: fixture.bands, queryTerm, fuzzy, budgets,
  });
  const subgraphBytes = rows.reduce((total, row) => total + row.json.length, 0);
  return {
    name: query.name,
    text: query.text,
    fuzzy,
    bounded: metrics.bounded,
    tripped: metrics.tripped,
    planTerms: metrics.planTerms,
    exactTerms: metrics.exactTerms,
    fuzzyTerms: metrics.fuzzyTerms,
    termsRead: metrics.termsRead,
    hops: metrics.hops,
    queriesByPhase: metrics.queriesByPhase,
    rowsByPhase: metrics.rowsByPhase,
    pressure: budgetPressure({ ...metrics, elapsedMs: Date.now() - started }, subgraphBytes),
    maxPage: MEASURING_BUDGETS.rowsPerQueryPage,
    fromBand: [...new Set(rows.map((row) => row.rowKey.split("@src:corpus:")[1] || "?"))].sort(),
    planSample: plan.terms.slice(0, 12).map((entry) => `${entry.term}${entry.origin === "fuzzy" ? "*" : ""}`),
  };
}

/** How many rows one term's own read brings back, which is what the page size
 *  and the row budget have to be sized against. */
async function termFanout(fixture) {
  const client = createFakeDocumentClient(fixture.partitions);
  const queryTerm = termQueryOverDocumentClient({ client, tableName: "calibration", pageSize: 100_000 });
  const counts = [];
  for (const query of CALIBRATION_QUERIES) {
    for (const term of queryTerms(query.text)) {
      for (const band of fixture.bands) {
        const { rows } = await queryTerm({ band, term });
        if (rows.length) counts.push({ term, band, rows: rows.length });
      }
    }
  }
  return counts.sort((a, b) => b.rows - a.rows);
}

/** What assembling N retrieved rows into a payload costs, which is the real
 *  constraint behind the total-row budget: rows that cannot be folded inside
 *  the turn are rows the turn should not have read. */
function assemblyCost(fixture) {
  const all = [...fixture.partitions.values()].flat();
  const costs = [];
  for (const size of [100, 250, 500, 1000, 2500, 5000]) {
    if (size > all.length) break;
    const rows = all.slice(0, size);
    const started = process.hrtime.bigint();
    const payload = rowsToPayload(rows);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    costs.push({ rows: size, ms: Number(ms.toFixed(1)), individuals: payload.individuals.length, bytes: rows.reduce((total, row) => total + row.json.length, 0) });
  }
  return costs;
}

/** How many variants each calibration case's terms have inside the distance
 *  bound, so the per-term cap is set from a distribution rather than a hunch.
 *  A cap below the tie count truncates alphabetically, which drops real
 *  candidates, so what matters is how wide the ties actually are. */
function variantWidths() {
  const widths = [];
  for (const query of CALIBRATION_QUERIES) {
    for (const term of queryTerms(query.text)) {
      const found = fuzzyVariantsFor(term, { cap: 1000 }).length;
      if (found) widths.push({ case: query.name, term, variants: found });
    }
  }
  return widths.sort((a, b) => b.variants - a.variants);
}

const pad = (value, width) => String(value).padStart(width);

function printTable(title, records) {
  console.log(`\n### ${title}\n`);
  console.log("| case | plan terms | asked | queries | seed q | ancestry q | expansion q | rows | seed rows | ancestry rows | subgraph KB | ms | would trip |");
  console.log("| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- |");
  for (const record of records) {
    console.log([
      "", record.name, pad(record.planTerms, 4), pad(record.termsRead, 4), pad(record.pressure.queries, 5),
      pad(record.queriesByPhase.seed, 4), pad(record.queriesByPhase.ancestry, 4), pad(record.queriesByPhase.expansion, 5),
      pad(record.pressure.rows, 5), pad(record.rowsByPhase.seed, 5), pad(record.rowsByPhase.ancestry, 5),
      pad((record.pressure.bytes / 1024).toFixed(1), 8),
      pad(record.pressure.elapsedMs, 4), record.pressure.wouldTrip.join(", ") || "-", "",
    ].join(" | ").trim());
  }
}

function summarize(records) {
  const max = (pick) => Math.max(...records.map(pick));
  const p95 = (pick) => {
    const values = records.map(pick).sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
  };
  return {
    maxQueries: max((r) => r.pressure.queries),
    p95Queries: p95((r) => r.pressure.queries),
    maxRows: max((r) => r.pressure.rows),
    p95Rows: p95((r) => r.pressure.rows),
    maxBytes: max((r) => r.pressure.bytes),
    maxElapsedMs: max((r) => r.pressure.elapsedMs),
    maxPlanTerms: max((r) => r.planTerms),
    maxTermsRead: max((r) => r.termsRead),
  };
}

async function main() {
  const asJson = process.argv.includes("--json");
  const limitFlag = process.argv.indexOf("--limit");
  const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : 0;

  const buildStarted = Date.now();
  const fixture = await buildFixtureBands({ limit });
  const buildMs = Date.now() - buildStarted;

  const bundled = await midBundleTerms();
  const movedBandChecks = [];
  for (const query of CALIBRATION_QUERIES.filter((entry) => entry.absentFromMidBundle)) {
    const measured = await measureCase({ query, fixture, fuzzy: true, budgets: RETRIEVAL_BUDGETS });
    movedBandChecks.push({
      name: query.name,
      term: query.absentFromMidBundle,
      absentFromMidBundle: !bundled.has(normFactTerm(query.absentFromMidBundle)),
      rowsBack: measured.pressure.rows,
    });
  }

  const withFuzzy = [];
  const withoutFuzzy = [];
  const budgeted = [];
  for (const query of CALIBRATION_QUERIES) {
    withFuzzy.push(await measureCase({ query, fixture, fuzzy: true }));
    withoutFuzzy.push(await measureCase({ query, fixture, fuzzy: false }));
    budgeted.push(await measureCase({ query, fixture, fuzzy: true, budgets: RETRIEVAL_BUDGETS }));
  }

  const report = {
    fixture: { rowCount: fixture.rowCount, bytes: fixture.bytes, bands: fixture.bands, buildMs, midBundleTerms: bundled.size },
    movedBandChecks,
    variantWidths: variantWidths(),
    termFanout: await termFanout(fixture),
    assemblyCost: assemblyCost(fixture),
    fuzzyOn: { cases: withFuzzy, summary: summarize(withFuzzy) },
    fuzzyOff: { cases: withoutFuzzy, summary: summarize(withoutFuzzy) },
    shippedBudgets: { budgets: RETRIEVAL_BUDGETS, cases: budgeted, summary: summarize(budgeted) },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`## retrieval calibration\n`);
  console.log(`fixture: ${fixture.rowCount.toLocaleString()} rows over ${fixture.bands.join(", ")}, ${(fixture.bytes / 1024 / 1024).toFixed(1)} MB of row json, built in ${buildMs} ms`);
  console.log(`mid bundle: ${bundled.size.toLocaleString()} distinct terms`);
  for (const check of movedBandChecks) {
    const absence = check.absentFromMidBundle
      ? "is absent from the mid bundle, so retrieval is the only path to it"
      : "IS in the mid bundle, so this case proves nothing. Pick another term";
    const round = check.rowsBack > 0
      ? `retrieval brought ${check.rowsBack} rows back under the shipped budgets`
      : "retrieval brought NOTHING back, so the round trip is broken";
    console.log(`moved-band case ${check.name}: "${check.term}" ${absence}; ${round}`);
  }
  console.log(`\n### rows one term's own read brings back\n`);
  console.log("| term | band | rows |");
  console.log("| --- | --- | --: |");
  for (const row of report.termFanout.slice(0, 10)) console.log(`| ${row.term} | ${row.band} | ${row.rows} |`);

  console.log(`\n### folding retrieved rows into a payload\n`);
  console.log("| rows | KB | ms |");
  console.log("| --: | --: | --: |");
  for (const cost of report.assemblyCost) console.log(`| ${cost.rows} | ${(cost.bytes / 1024).toFixed(0)} | ${cost.ms} |`);

  console.log(`\n### fuzzy variants inside the distance bound\n`);
  console.log("| term | case | variants |");
  console.log("| --- | --- | --: |");
  for (const width of report.variantWidths.slice(0, 12)) {
    console.log(`| ${width.term} | ${width.case} | ${width.variants} |`);
  }
  printTable("what an unbounded run wants, fuzzy on", withFuzzy);
  printTable("what an unbounded run wants, fuzzy off", withoutFuzzy);

  console.log(`\n### what a turn gets under the shipped budgets\n`);
  console.log("| case | terms asked | queries | rows | subgraph KB | bounded by |");
  console.log("| --- | --: | --: | --: | --: | --- |");
  for (const record of budgeted) {
    console.log(`| ${record.name} | ${record.termsRead} | ${record.pressure.queries} | ${record.pressure.rows} | ${(record.pressure.bytes / 1024).toFixed(1)} | ${record.tripped ?? "-"} |`);
  }

  console.log(`\n### summary\n`);
  console.log("| arm | max plan terms | max terms asked | max queries | p95 queries | max rows | p95 rows | max subgraph KB | max ms |");
  console.log("| --- | --: | --: | --: | --: | --: | --: | --: | --: |");
  for (const [arm, summary] of [["unbounded, fuzzy on", report.fuzzyOn.summary], ["unbounded, fuzzy off", report.fuzzyOff.summary], ["shipped budgets", report.shippedBudgets.summary]]) {
    console.log(`| ${arm} | ${summary.maxPlanTerms} | ${summary.maxTermsRead} | ${summary.maxQueries} | ${summary.p95Queries} | ${summary.maxRows} | ${summary.p95Rows} | ${(summary.maxBytes / 1024).toFixed(1)} | ${summary.maxElapsedMs} |`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("calibrate-retrieval.mjs")) await main();
