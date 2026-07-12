#!/usr/bin/env node
// corpus/namenet/generate.mjs — converts THREE reviewed CSVs from a LOCAL
// Open English Namenet checkout into ConceptNet-shape fact rows. Mirrors
// corpus/wordnet/generate.mjs's structure/conventions exactly (same
// maintainer-tool framing, same deterministic sorted JSONL + manifest.json
// output shape) — smaller scope, OPTIONAL top-up, not load-bearing.
//
//   node corpus/namenet/generate.mjs [namenetDir]
//   TMCT_NAMENET_DIR=/path/to/english-namenet node corpus/namenet/generate.mjs
//
// Input: `~/projects/globalwordnet/english-namenet/` by default (a LOCAL
// clone, never vendored/committed) — three reviewed CSVs, each a
// human/algorithm-curated LINKING TABLE between a name/label and an Open
// English WordNet (OEWN) synset or lemma set:
//   - species_reviewed.csv        (5,101 rows) — Scientific Name -> SSID
//   - taxon2common_reviewed.csv   (2,368 rows) — SSID 1/Lemmas 1 -> SSID 2/Lemmas 2
//   - linked_occupations_reviewed.csv (2,193 rows) — Wikidata Labels -> SSID/Lemma
// Every one of the three, once you read real rows (not just the header),
// turns out to be the SAME shape underneath: two name-lists that denote the
// SAME real-world thing (a species, a folk-taxonomic category, an
// occupation), reviewed/accepted by a human as a correct link — never a
// hierarchy (broader/narrower) or capability claim. That is why every fact
// this converter emits uses ONE relation, /r/Synonym ("X means the same as
// Y") — confirmed against conceptnet-map.toml (ace != "none", Phase 1's
// 2026-07-12 widening) rather than invented here (this task's own scope
// boundary: conversion only, reuse what Phase 1 already mapped, never add a
// new relation row).
//
// Why NOT /r/IsA or /r/CapableOf (the task brief's own initial guesses,
// before real rows were read):
//   - species_reviewed.csv: real rows show the "Scientific Name" is almost
//     always ALREADY one of the target SSID's own WordNet members (4,885 of
//     4,897 accepted rows resolve to a real synset; of those, 4,881 have the
//     scientific name as a literal member string) — this is a same-referent
//     alias table (which of several ambiguous WordNet senses a Wikidata
//     taxon QID actually means), not a species/kind subclass relation.
//   - linked_occupations_reviewed.csv: despite the CSV's name, each row
//     links a WIKIDATA OCCUPATION ENTITY's labels to a WORDNET OCCUPATION
//     SYNSET's lemmas (e.g. "politician, political leader" <-> "pol,
//     political leader, politician, politico") — it is NOT a person linked
//     to their job (no person names anywhere in this file), so /r/CapableOf
//     ("a person can politician") would be nonsensical. It is the same
//     alias-table shape as the other two.
//
// species_reviewed.csv needs a SECOND local checkout to resolve: its SSID
// column has no lemma text of its own (unlike the other two, which carry
// "Lemmas N" columns directly), so this converter reuses
// corpus/wordnet/generate.mjs's already-proven `loadAllSynsets`/
// `DEFAULT_YAML_DIR`/`encodeTerm`/`humanize` (imported, never duplicated —
// same discipline that file's own header comment describes for its
// hand-rolled YAML reader) to resolve SSID -> representative lemma.
// corpus/wordnet/generate.mjs itself is never modified (task scope
// boundary) — only its exported pure functions are called.
//
// NOT part of the product path — a maintainer tool, run by hand, offline,
// $0; its OUTPUT (corpus/namenet/namenet.jsonl + manifest.json) is what gets
// committed, never the source CSVs themselves.
//
// Licence: see LICENSE-NOTICE in this directory — the source repository
// (globalwordnet/english-namenet) declares NO explicit license of its own
// (confirmed via GitHub repo metadata, 2026-07-12: `license: null`, no
// LICENSE file, no license statement in README.md); this bundle is
// distributed under CC-BY-4.0 as a conservative match to the Open English
// WordNet data it is built from and links against, pending clarification
// from the GlobalWordNet team. The code in this file is tmct code under the
// repository's MPL-2.0; only the generated data
// (corpus/namenet/namenet.jsonl) carries that CC-BY-4.0 label.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadAllSynsets, DEFAULT_YAML_DIR, resolveYamlDir, encodeTerm, humanize } from "../wordnet/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const NAMENET_OUT_DIR = HERE;

export const DEFAULT_NAMENET_DIR = join(homedir(), "projects", "globalwordnet", "english-namenet");

/** Resolve the input namenet directory: CLI positional arg > env var >
 *  default. Pure (argv/env injectable), mirrors wordnet's resolveYamlDir. */
export function resolveNamenetDir(argv = process.argv.slice(2), env = process.env) {
  return argv[0] || env.TMCT_NAMENET_DIR || DEFAULT_NAMENET_DIR;
}

// ---- CSV parsing (pure, unit-tested) ---------------------------------------
// A small hand-rolled RFC4180-ish reader — no dependency added, same house
// style as corpus/wordnet/generate.mjs reusing a hand-rolled YAML reader
// rather than pulling in a general parsing library. Handles quoted fields
// (commas/newlines inside quotes, "" as an escaped literal quote) and both
// CRLF and LF line endings — all three source CSVs use quoted fields for any
// value containing a comma (e.g. `"species, by Garsault, 1764..."`), so a
// naive `.split(",")` silently misaligns columns on those rows.

/** Parse CSV text into an array of records (arrays of string fields). */
export function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); records.push(row); row = []; };
  const src = String(text ?? "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { pushField(); continue; }
    if (c === "\r") continue; // CRLF -> swallow, \n below ends the row
    if (c === "\n") { pushRow(); continue; }
    field += c;
  }
  // final field/row, if the text didn't end with a newline
  if (field !== "" || row.length) pushRow();
  // drop a single trailing wholly-empty record (trailing newline artifact)
  if (records.length && records[records.length - 1].every((f) => f === "")) records.pop();
  return records;
}

/** Parse CSV text into an array of row objects keyed by the header row. */
export function parseCsv(text) {
  const records = parseCsvRecords(text);
  if (!records.length) return [];
  const header = records[0].map((h) => h.trim());
  return records.slice(1).map((rec) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = rec[i] ?? "";
    return obj;
  });
}

/** "Plantae, kingdom Plantae, plant kingdom" -> "Plantae" — the first
 *  candidate in a comma-separated lemma/label list, the same "first member is
 *  representative" convention corpus/wordnet/generate.mjs's repTerm() uses. */
export function firstOf(commaList) {
  const s = String(commaList ?? "").trim();
  if (!s) return null;
  const first = s.split(",")[0].trim();
  return first || null;
}

// ---- shared row builder (pure) ---------------------------------------------
// Same dedupe-by-key + self-loop-skip discipline as corpus/wordnet/
// generate.mjs's makeRowBuilder — re-declared locally (not imported; that
// function isn't exported, and this is a small enough shape to keep local
// rather than widen wordnet/generate.mjs's exports for a five-line helper).

function makeRowBuilder() {
  const rows = new Map();
  const add = (rawSubject, rel, rawObject) => {
    const start = encodeTerm(rawSubject);
    const end = encodeTerm(rawObject);
    if (!start || !end || start === end) return; // self-loop / empty term — noise, not a fact
    const key = `${rel} ${start} ${end}`;
    if (rows.has(key)) return;
    rows.set(key, {
      start,
      rel,
      end,
      weight: 1,
      surfaceText: `[[${humanize(rawSubject)}]] ${rel.replace("/r/", "")} [[${humanize(rawObject)}]]`,
    });
  };
  return { rows, add };
}

const sortRows = (rows) => rows.slice().sort((a, b) => (
  a.rel !== b.rel ? (a.rel < b.rel ? -1 : 1)
    : a.start !== b.start ? (a.start < b.start ? -1 : 1)
      : a.end < b.end ? -1 : a.end > b.end ? 1 : 0
));

// ---- per-source mappers (pure, unit-tested) --------------------------------

/** species_reviewed.csv: accepted rows only; the Scientific Name and the
 *  SSID's representative WordNet lemma denote the same species -> /r/Synonym.
 *  `bySynset` is the same `Map<synsetId, {members}>` shape
 *  corpus/wordnet/generate.mjs's loadAllSynsets returns (or a small fixture
 *  Map in tests) — a row whose SSID isn't in the map is skipped, not thrown. */
export function buildSpeciesFacts(rows, bySynset) {
  const { rows: out, add } = makeRowBuilder();
  for (const row of rows) {
    if (row.Accept !== "TRUE") continue;
    const sciName = row["Scientific Name"];
    const ssid = row.SSID;
    if (!sciName || !ssid) continue;
    const synset = bySynset.get(ssid);
    const members = Array.isArray(synset?.members) ? synset.members : [];
    if (!members.length) continue; // unresolved SSID — skip, don't throw
    add(sciName, "/r/Synonym", members[0]);
  }
  return sortRows([...out.values()]);
}

/** taxon2common_reviewed.csv: accepted rows only; the first lemma of each
 *  side's "Lemmas N" list denotes the same taxonomic/folk category ->
 *  /r/Synonym. No cross-reference needed — both lemma lists are already
 *  columns in this CSV. */
export function buildTaxon2CommonFacts(rows) {
  const { rows: out, add } = makeRowBuilder();
  for (const row of rows) {
    if (row.Accept !== "TRUE") continue;
    const a = firstOf(row["Lemmas 1"]);
    const b = firstOf(row["Lemmas 2"]);
    if (!a || !b) continue;
    add(a, "/r/Synonym", b);
  }
  return sortRows([...out.values()]);
}

/** linked_occupations_reviewed.csv: accepted, genuine-occupation rows only
 *  (`Accept === "TRUE"` AND `"Not an occupation" !== "TRUE"`); the first
 *  Wikidata label and the first WordNet lemma denote the same occupation ->
 *  /r/Synonym. */
export function buildOccupationFacts(rows) {
  const { rows: out, add } = makeRowBuilder();
  for (const row of rows) {
    if (row.Accept !== "TRUE") continue;
    if (row["Not an occupation"] === "TRUE") continue;
    const label = firstOf(row.Labels);
    const lemma = firstOf(row.Lemma);
    if (!label || !lemma) continue;
    add(label, "/r/Synonym", lemma);
  }
  return sortRows([...out.values()]);
}

/** Merge the three per-source fact sets into one deduped, sorted set — the
 *  namenet.jsonl content. A pair already emitted by one source (e.g. the
 *  same scientific-name/common-name pair surfacing via both
 *  species_reviewed.csv and taxon2common_reviewed.csv) is kept once. */
export function mergeFacts(...factLists) {
  const { rows, add } = makeRowBuilder();
  for (const list of factLists) {
    for (const f of list) add(humanize(f.start.replace(/^\/c\/en\//, "")), f.rel, humanize(f.end.replace(/^\/c\/en\//, "")));
  }
  return sortRows([...rows.values()]);
}

// ---- output ------------------------------------------------------------

const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function readCsv(dir, name) {
  const text = await readFile(join(dir, name), "utf8");
  return parseCsv(text);
}

async function main() {
  const namenetDir = resolveNamenetDir();
  const yamlDir = resolveYamlDir([], process.env) || DEFAULT_YAML_DIR;
  process.stderr.write(`corpus/namenet/generate.mjs: reading ${namenetDir}\n`);
  process.stderr.write(`  (species_reviewed.csv also needs OEWN synsets from ${yamlDir})\n`);

  const [speciesRows, taxonRows, occupationRows] = await Promise.all([
    readCsv(namenetDir, "species_reviewed.csv"),
    readCsv(namenetDir, "taxon2common_reviewed.csv"),
    readCsv(namenetDir, "linked_occupations_reviewed.csv"),
  ]);
  const { bySynset } = await loadAllSynsets(yamlDir);

  const speciesFacts = buildSpeciesFacts(speciesRows, bySynset);
  const taxonFacts = buildTaxon2CommonFacts(taxonRows);
  const occupationFacts = buildOccupationFacts(occupationRows);
  const merged = mergeFacts(speciesFacts, taxonFacts, occupationFacts);

  process.stderr.write(`  species_reviewed.csv:            ${speciesRows.length} rows -> ${speciesFacts.length} facts\n`);
  process.stderr.write(`  taxon2common_reviewed.csv:        ${taxonRows.length} rows -> ${taxonFacts.length} facts\n`);
  process.stderr.write(`  linked_occupations_reviewed.csv:  ${occupationRows.length} rows -> ${occupationFacts.length} facts\n`);
  process.stderr.write(`  namenet (merged, deduped):        ${merged.length} facts\n`);

  await mkdir(NAMENET_OUT_DIR, { recursive: true });
  const outText = toJsonl(merged);
  await writeFile(join(NAMENET_OUT_DIR, "namenet.jsonl"), outText);

  const manifest = {
    version: 1,
    generated: "by corpus/namenet/generate.mjs",
    corpuses: [
      {
        id: "namenet",
        kind: "language",
        description: "Scientific-name/common-name and Wikidata-label/WordNet-lemma synonym pairs, mechanically derived from three human-reviewed Open English Namenet linking tables (species, taxon-to-common-name, occupations). A small top-up bundle, not a primary corpus.",
        source: { kind: "curated", tool: "corpus/namenet/generate.mjs" },
        file: "namenet.jsonl",
        facts: merged.length,
        bytes: Buffer.byteLength(outText),
        sha256: sha256(outText),
        license: "CC-BY-4.0 (source repo declares no explicit license; see LICENSE-NOTICE)",
      },
    ],
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(NAMENET_OUT_DIR, "manifest.json"), manifestText);
  process.stderr.write(`wrote corpus/namenet/manifest.json (${manifest.corpuses.length} corpuses)\n`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
