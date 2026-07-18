#!/usr/bin/env node
// scripts/measure-child-corpus.mjs — the acceptance test for the child triples
// pack, by script (PLAN step 5/7). The plan's baseline was hand-counted and
// drifted once ("1 kind of bird, 0 capabilities" while the corpus held two
// birds and one capability), so the numbers that matter — kinds of bird,
// capabilities among them, things that can fly — are MEASURED here, never by
// hand. Run over the built child pack, and over the shipped tech slice for
// contrast:
//
//   node scripts/measure-child-corpus.mjs
//
// Maintainer-only: never imported by src/ or bin/. The metric helpers are
// exported so scripts/fetch-child-corpus.mjs stamps the same numbers into the
// pack README from the same code.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normFactTerm } from "../src/domain/hash.mjs";
import { isChildFactsRow } from "../src/domain/child-pack.mjs";
import { loadSlice, loadMap, toFacts, SLICE_FILE } from "../src/adapters/corpus/conceptnet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
export const CHILD_PACK_DIR = join(REPO_ROOT, "corpus", "child");

const SUBCLASS = "rdfs:subClassOf";
const CAPABLE = "mgx:capableOf";
const NEG_CAPABLE = "mgxneg:capableOf";

/** Every fact in a built child pack, flattened and deduped across shards (a
 *  fact is double-keyed under both endpoints, so it appears in two rows). */
export function allFactsFromChildPack(dir) {
  const shardsDir = join(dir, "shards");
  if (!existsSync(shardsDir)) return [];
  const seen = new Set();
  const facts = [];
  for (const file of readdirSync(shardsDir).sort()) {
    if (!file.endsWith(".jsonl.gz")) continue;
    const body = gunzipSync(readFileSync(join(shardsDir, file))).toString("utf8");
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!isChildFactsRow(row)) continue;
      for (const f of row.facts) {
        const key = `${normFactTerm(f.subject)}\0${f.predicate}\0${normFactTerm(f.object)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push(f);
      }
    }
  }
  return facts;
}

/** The tech slice as the same {subject, predicate, object} facts, for contrast. */
export async function techSliceFacts() {
  const [assertions, map] = await Promise.all([loadSlice(SLICE_FILE), loadMap()]);
  return toFacts(assertions, map);
}

const isSubclassOf = (f, klass) => f.predicate === SUBCLASS && normFactTerm(f.object) === klass;
const subjectsWhere = (facts, pred) => [
  ...new Set(facts.filter((f) => f.predicate === pred).map((f) => normFactTerm(f.subject))),
].sort();

/**
 * The plan's acceptance numbers over a flat fact list. kinds of bird, the
 * capabilities recorded among {bird} + those kinds, and everything the store
 * says can (or cannot) fly.
 */
export function childCorpusMetrics(facts) {
  const kindsOfBird = [...new Set(facts.filter((f) => isSubclassOf(f, "bird")).map((f) => normFactTerm(f.subject)))].sort();
  const birdSet = new Set(["bird", ...kindsOfBird]);

  const birdCapabilities = facts.filter(
    (f) => (f.predicate === CAPABLE || f.predicate === NEG_CAPABLE) && birdSet.has(normFactTerm(f.subject)),
  );
  const flyPositive = subjectsWhere(facts.filter((f) => normFactTerm(f.object) === "fly"), CAPABLE);
  const flyNegative = subjectsWhere(facts.filter((f) => normFactTerm(f.object) === "fly"), NEG_CAPABLE);
  const birdsThatFly = kindsOfBird.filter((b) => flyPositive.includes(b));
  const birdsThatCannotFly = kindsOfBird.filter((b) => flyNegative.includes(b));

  return {
    totalFacts: facts.length,
    kindsOfBird: { count: kindsOfBird.length, sample: kindsOfBird.slice(0, 20) },
    capabilitiesOnBirds: {
      count: birdCapabilities.length,
      sample: birdCapabilities.slice(0, 20).map((f) => `${normFactTerm(f.subject)} ${f.predicate === NEG_CAPABLE ? "cannot" : "can"} ${normFactTerm(f.object)}`),
    },
    thingsThatCanFly: { count: flyPositive.length, sample: flyPositive.slice(0, 20) },
    thingsThatCannotFly: { count: flyNegative.length, sample: flyNegative.slice(0, 20) },
    birdsThatFly: { count: birdsThatFly.length, sample: birdsThatFly },
    birdsThatCannotFly: { count: birdsThatCannotFly.length, sample: birdsThatCannotFly },
  };
}

/** A compact human report of one metrics object. */
export function formatMetrics(label, m) {
  const line = (k, v) => `  ${k.padEnd(24)} ${v}`;
  const list = (a) => (a.length ? a.join(", ") : "(none)");
  return [
    `${label}: ${m.totalFacts} facts`,
    line("kinds of bird", `${m.kindsOfBird.count}  [${list(m.kindsOfBird.sample)}]`),
    line("capabilities on birds", `${m.capabilitiesOnBirds.count}  [${list(m.capabilitiesOnBirds.sample)}]`),
    line("things that can fly", `${m.thingsThatCanFly.count}  [${list(m.thingsThatCanFly.sample)}]`),
    line("things that cannot fly", `${m.thingsThatCannotFly.count}  [${list(m.thingsThatCannotFly.sample)}]`),
    line("bird-kinds that fly", `${m.birdsThatFly.count}  [${list(m.birdsThatFly.sample)}]`),
    line("bird-kinds that cannot fly", `${m.birdsThatCannotFly.count}  [${list(m.birdsThatCannotFly.sample)}]`),
  ].join("\n");
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  if (!existsSync(join(CHILD_PACK_DIR, "manifest.json"))) {
    console.error(`no child pack at ${CHILD_PACK_DIR} — build it with \`npm run gen:child-corpus\` first.`);
    process.exit(2);
  }
  const child = childCorpusMetrics(allFactsFromChildPack(CHILD_PACK_DIR));
  console.log(formatMetrics("child pack (corpus/child)", child));
  console.log("");
  try {
    const tech = childCorpusMetrics(await techSliceFacts());
    console.log(formatMetrics("tech slice (corpus/conceptnet/slice.jsonl), for contrast", tech));
  } catch (e) {
    console.error(`tech-slice contrast skipped: ${e.message}`);
  }
}
