#!/usr/bin/env node
// scripts/recompute-reference-isa.mjs — rebuild the shipped reference pack's
// `isa` fields from each row's OWN stored text, with no network fetch.
// isaOf (src/domain/reference-pack.mjs) widens over time — parenthetical
// stripping, sentence-bounded windows, quantifier-of chains — but the pack
// only ever stores the isa a PAST run of scripts/fetch-reference-pack.mjs
// computed. This script re-runs today's isaOf over the committed shards'
// existing text/summary so a widened pattern reaches rows built before it
// existed, without re-downloading the pinned Wikipedia dump. Every other
// field (term, title, text, summary, url, revid, source, licence) is left
// byte-identical; only the `isa` field's presence or value can change.
//
//   node scripts/recompute-reference-isa.mjs [--dir <pack dir>] [--dry-run]
//
// Reuses emitPack (scripts/fetch-reference-pack.mjs) so the rewritten pack
// is the same deterministic, budget-checked, sorted emit the real build
// pipeline produces — only the article rows' `isa` fields differ going in.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { emitPack, isaOf } from "./fetch-reference-pack.mjs";
import { isReferenceArticleRow } from "../src/domain/reference-pack.mjs";
import { loadLexicon } from "../src/domain/grammar/lexicon.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "corpus", "reference");

// A loss is a term that HAD an isa before this recompute and has none after.
// Every entry here was individually reviewed against the row's own opening
// sentence and is a false subClassOf the pack is better off without — an
// unreviewed new loss still stops the run. All of them shared one cause: the
// isa window ran past the head noun and through an "about"/"around" phrase
// onto a noun that was never the class. "Diplomacy is about relations between
// countries" is not a country; "The lips are a body part around the mouth" is
// not a mouth. The head noun each window should have stopped on is either
// outside the lexicon (miniseries, thinking) or a generic classifier the pack
// declines to store (part, term), so the corrected read is no isa at all.
const EXPECTED_RESIDUAL_LOSSES = new Set([
  "diplomacy", "education", "liberal", "lip", "offer", "watershed",
]);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Read every committed shard row, keyed by its own `term` field. */
function readShardRows(dir) {
  const rows = new Map();
  for (const file of readdirSync(join(dir, "shards")).sort()) {
    const body = gunzipSync(readFileSync(join(dir, "shards", file))).toString("utf8");
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      rows.set(row.term, row);
    }
  }
  return rows;
}

/** Recompute one row's isa in place (delete-then-reinsert keeps `isa` last,
 *  matching the build pipeline's own field order) and report the outcome. */
function recomputeRow(row, lexicon) {
  const before = row.isa ?? null;
  delete row.isa;
  const after = isaOf(row.text, lexicon) ?? null;
  if (after) row.isa = after;
  if (before === after) return "unchanged";
  if (!before && after) return "gained";
  if (before && !after) return "lost";
  return "changed";
}

export async function main() {
  const dir = arg("--dir", OUT_DEFAULT);
  const dryRun = process.argv.includes("--dry-run");
  const manifestFile = join(dir, "manifest.json");
  if (!existsSync(manifestFile)) {
    console.error(`recompute-reference-isa: no manifest at ${manifestFile} — nothing to recompute`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const index = JSON.parse(gunzipSync(readFileSync(join(dir, "index.json.gz"))).toString("utf8"));
  const lexicon = loadLexicon();
  const shardRows = readShardRows(dir);

  const gained = [];
  const lost = [];
  const changed = [];
  const articles = new Map();
  const aliases = new Map();

  for (const [term, entry] of Object.entries(index)) {
    if (entry.t !== term) { aliases.set(term, entry.t); continue; }
    const row = shardRows.get(term);
    if (!row) throw new Error(`recompute-reference-isa: index names "${term}" but no shard row holds it`);
    const before = row.isa ?? null;
    const outcome = recomputeRow(row, lexicon);
    if (outcome === "gained") gained.push(term);
    if (outcome === "lost") lost.push({ term, before });
    if (outcome === "changed") changed.push({ term, before, after: row.isa });
    if (!isReferenceArticleRow(row)) throw new Error(`recompute-reference-isa: "${term}" is no longer a valid article row`);
    articles.set(term, row);
  }

  const expectedLosses = lost.filter(({ term }) => EXPECTED_RESIDUAL_LOSSES.has(term));
  const unexpectedLosses = lost.filter(({ term }) => !EXPECTED_RESIDUAL_LOSSES.has(term));

  console.log(`recompute-reference-isa: ${articles.size} rows read, ${gained.length} gained an isa, ${changed.length} changed value, ${lost.length} lost one (${expectedLosses.length} reviewed and expected, ${unexpectedLosses.length} new/unreviewed)`);
  for (const term of gained) console.log(`  gained: ${term} -> "${articles.get(term).isa}"`);
  for (const { term, before, after } of changed) console.log(`  changed: ${term}: "${before}" -> "${after}"`);
  for (const { term, before } of expectedLosses) console.log(`  lost (reviewed, expected): ${term}: was "${before}"`);
  for (const { term, before } of unexpectedLosses) console.log(`  lost (NEW, unreviewed): ${term}: was "${before}"`);

  if (unexpectedLosses.length) {
    console.error("recompute-reference-isa: the widened pattern lost an isa on rows outside the reviewed EXPECTED_RESIDUAL_LOSSES list — stopping without writing.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("recompute-reference-isa: --dry-run, no files written");
    return { gained, lost, changed, manifest: null };
  }

  const newManifest = emitPack({ articles, aliases }, dir, { dump: manifest.dump, built: manifest.built });
  console.log(`recompute-reference-isa: wrote ${newManifest.counts.articles} articles, ${newManifest.counts.aliases} aliases, ${newManifest.counts.shards} shards to ${dir}`);
  return { gained, lost, changed, manifest: newManifest };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
