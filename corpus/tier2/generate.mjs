#!/usr/bin/env node
// corpus/tier2/generate.mjs — the TIER-2 specialised-corpus generator + manifest
// writer. NOT part of the product path — a maintainer tool. Offline, $0.
//
// Tier-2 corpuses are LANGUAGE- or DOMAIN-specific fact sets (aws, python,
// java, …) that tmct fetches/generates into `.tmct/` at init time so it can
// "expand into a concept for an applicable codebase". They are NOT shipped in
// the npm package the way the tier-1 ConceptNet slice is — they are opt-in,
// selected per repo. See ../README.md for the full tier-1/2/3 policy.
//
// Every tier-2 corpus is written in the EXACT tier-1 fact shape
// (corpus/conceptnet/slice.jsonl): one JSON object per line,
//   {"start":"/c/en/<term>","rel":"/r/<Rel>","end":"/c/en/<concept>","weight":N,"surfaceText":"…"}
// with `rel` drawn ONLY from the mapped relations in
// src/corpus/conceptnet-map.toml, so a tier-2 file loads through the very same
// loadSlice()/toFacts() path as the tier-1 slice (this file's --verify proves
// it). The Wave-2 tier-2 SEEDER (see ../README.md) is what stamps the right
// provenance (`corpus:tier2:<id> /r/…`) instead of the conceptnet default.
//
//   node corpus/tier2/generate.mjs            # (re)write every <id>.jsonl + manifest.json
//   node corpus/tier2/generate.mjs --verify   # generate + assert each file loads & seeds cleanly
//
// To ADD a specialised corpus: add an entry to CORPUSES below (a list of
// [subject, relation, concept] triples, optionally [.., surfaceText]) and
// re-run. Curated sets are authored here so they stay reviewable and diffable;
// a corpus too large to curate by hand is a `fetch` manifest entry instead
// (network, opt-in — see fetchCorpus() and ../README.md).

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// A curated triple is [subject, rel, concept] or [subject, rel, concept, weight].
// `rel` MUST be a mapped (ace != "none") relation in conceptnet-map.toml so the
// fact actually seeds. Terms are lowercase snake_case; the loader's termText()
// turns "/c/en/hash_table" into "hash table". Keep terms <= 3 words (the tier-1
// quality-filter rule) — curated data is clean by construction.
export const CORPUSES = {
  aws: {
    kind: "domain",
    description: "Amazon Web Services core services and primitives (S3, Lambda, DynamoDB, EC2, IAM, SQS) mapped to general cloud/CS concepts.",
    facts: [
      ["aws", "/r/IsA", "cloud_platform"],
      ["aws", "/r/IsA", "cloud"],
      ["aws", "/r/CapableOf", "host_applications"],
      // S3
      ["s3", "/r/IsA", "object_storage"],
      ["s3", "/r/IsA", "storage_service"],
      ["s3", "/r/PartOf", "aws"],
      ["s3", "/r/HasA", "bucket"],
      ["s3", "/r/UsedFor", "storing_files"],
      ["s3", "/r/CapableOf", "store_objects"],
      ["bucket", "/r/IsA", "container"],
      ["bucket", "/r/PartOf", "s3"],
      ["bucket", "/r/UsedFor", "storing_objects"],
      // Lambda
      ["lambda", "/r/IsA", "compute_service"],
      ["lambda", "/r/IsA", "function"],
      ["lambda", "/r/PartOf", "aws"],
      ["lambda", "/r/UsedFor", "running_code"],
      ["lambda", "/r/CapableOf", "run_code"],
      ["lambda", "/r/HasProperty", "serverless"],
      // DynamoDB
      ["dynamodb", "/r/IsA", "database"],
      ["dynamodb", "/r/IsA", "nosql_database"],
      ["dynamodb", "/r/PartOf", "aws"],
      ["dynamodb", "/r/HasA", "table"],
      ["dynamodb", "/r/UsedFor", "storing_data"],
      ["dynamodb", "/r/HasProperty", "managed"],
      // EC2
      ["ec2", "/r/IsA", "compute_service"],
      ["ec2", "/r/IsA", "virtual_machine"],
      ["ec2", "/r/PartOf", "aws"],
      ["ec2", "/r/HasA", "instance"],
      ["ec2", "/r/UsedFor", "running_servers"],
      // IAM
      ["iam", "/r/IsA", "access_control"],
      ["iam", "/r/PartOf", "aws"],
      ["iam", "/r/UsedFor", "managing_permissions"],
      ["iam", "/r/HasA", "role"],
      ["iam", "/r/HasA", "policy"],
      // SQS + queue
      ["sqs", "/r/IsA", "message_queue"],
      ["sqs", "/r/IsA", "queue"],
      ["sqs", "/r/PartOf", "aws"],
      ["sqs", "/r/UsedFor", "decoupling_services"],
      ["queue", "/r/IsA", "data_structure"],
    ],
  },

  python: {
    kind: "language",
    description: "Python language constructs and stdlib types mapped to the shared CS concept vocabulary (list->array, dict->hash table, …).",
    facts: [
      ["python", "/r/IsA", "programming_language"],
      ["python", "/r/HasProperty", "interpreted"],
      ["python", "/r/HasProperty", "dynamically_typed"],
      ["python", "/r/UsedFor", "scripting"],
      // built-in types → shared concepts
      ["list", "/r/IsA", "array"],
      ["list", "/r/IsA", "sequence"],
      ["list", "/r/IsA", "data_structure"],
      ["dict", "/r/IsA", "hash_table"],
      ["dict", "/r/IsA", "dictionary"],
      ["dict", "/r/IsA", "mapping"],
      ["tuple", "/r/IsA", "sequence"],
      ["tuple", "/r/HasProperty", "immutable"],
      ["set", "/r/IsA", "collection"],
      ["set", "/r/HasProperty", "unordered"],
      ["str", "/r/IsA", "string"],
      // language constructs
      ["decorator", "/r/IsA", "function"],
      ["decorator", "/r/UsedFor", "modifying_functions"],
      ["generator", "/r/IsA", "iterator"],
      ["generator", "/r/UsedFor", "lazy_evaluation"],
      ["comprehension", "/r/IsA", "expression"],
      ["comprehension", "/r/UsedFor", "building_collections"],
      ["exception", "/r/IsA", "error"],
      ["module", "/r/IsA", "file"],
      ["package", "/r/IsA", "module"],
      ["method", "/r/IsA", "function"],
      // tooling / runtime
      ["pip", "/r/IsA", "package_manager"],
      ["pip", "/r/UsedFor", "installing_packages"],
      ["gil", "/r/IsA", "lock"],
      ["gil", "/r/PartOf", "interpreter"],
      ["cpython", "/r/IsA", "interpreter"],
    ],
  },

  java: {
    kind: "language",
    description: "Java language and JVM constructs mapped to the shared CS concept vocabulary (ArrayList->list, HashMap->hash table, …).",
    facts: [
      ["java", "/r/IsA", "programming_language"],
      ["java", "/r/HasProperty", "compiled"],
      ["java", "/r/HasProperty", "statically_typed"],
      ["java", "/r/UsedFor", "building_applications"],
      // types → shared concepts
      ["arraylist", "/r/IsA", "list"],
      ["arraylist", "/r/IsA", "data_structure"],
      ["hashmap", "/r/IsA", "hash_table"],
      ["hashmap", "/r/IsA", "dictionary"],
      ["hashmap", "/r/IsA", "map"],
      ["interface", "/r/IsA", "type"],
      ["interface", "/r/IsA", "contract"],
      ["class", "/r/IsA", "type"],
      ["object", "/r/IsA", "instance"],
      // JVM / runtime
      ["jvm", "/r/IsA", "virtual_machine"],
      ["jvm", "/r/UsedFor", "running_bytecode"],
      ["jvm", "/r/CapableOf", "execute_bytecode"],
      ["bytecode", "/r/IsA", "code"],
      ["garbage_collector", "/r/PartOf", "jvm"],
      ["garbage_collector", "/r/UsedFor", "freeing_memory"],
      // packaging / tooling
      ["jar", "/r/IsA", "archive"],
      ["jar", "/r/IsA", "file"],
      ["jar", "/r/UsedFor", "packaging_classes"],
      ["maven", "/r/IsA", "build_tool"],
      ["maven", "/r/IsA", "package_manager"],
      ["gradle", "/r/IsA", "build_tool"],
      // language features
      ["thread", "/r/IsA", "process"],
      ["thread", "/r/UsedFor", "concurrency"],
      ["generics", "/r/UsedFor", "type_safety"],
      ["annotation", "/r/IsA", "metadata"],
      ["exception", "/r/IsA", "error"],
      ["method", "/r/IsA", "function"],
    ],
  },

  // PLAN_AGENTS.md Phase 1's "wider general-knowledge seed set" bullet: the
  // three corpuses above are all code-domain-specific (a LANGUAGE or a cloud
  // DOMAIN); this one deliberately is NOT — everyday-knowledge concepts (the
  // natural world, weather, food, common objects) with zero code-domain
  // framing, proving the extension-pack seam generalizes to a seed set that
  // isn't code at all (the operator's own framing: tmct's code specialization
  // was never a special case, just one seed set among possible others).
  general: {
    kind: "domain",
    description: "General-purpose everyday-knowledge concepts (animals, weather, the natural world, common objects) — a non-code-domain seed set, deliberately outside tmct's own code-domain bias.",
    facts: [
      // animals
      ["dog", "/r/IsA", "mammal"],
      ["dog", "/r/HasA", "tail"],
      ["dog", "/r/CapableOf", "bark"],
      ["cat", "/r/IsA", "mammal"],
      ["cat", "/r/CapableOf", "meow"],
      ["mammal", "/r/IsA", "animal"],
      ["mammal", "/r/HasProperty", "warm_blooded"],
      ["bird", "/r/IsA", "animal"],
      ["bird", "/r/CapableOf", "fly"],
      ["bird", "/r/HasA", "feather"],
      ["fish", "/r/IsA", "animal"],
      ["fish", "/r/AtLocation", "water"],
      ["fish", "/r/CapableOf", "swim"],
      // weather / sky
      ["rain", "/r/IsA", "weather"],
      ["rain", "/r/MadeOf", "water"],
      ["snow", "/r/IsA", "weather"],
      ["snow", "/r/HasProperty", "cold"],
      ["cloud", "/r/PartOf", "sky"],
      ["cloud", "/r/CapableOf", "produce_rain"],
      ["sun", "/r/IsA", "star"],
      ["sun", "/r/CapableOf", "produce_light"],
      ["moon", "/r/AtLocation", "sky"],
      ["moon", "/r/PartOf", "solar_system"],
      ["earth", "/r/IsA", "planet"],
      ["earth", "/r/PartOf", "solar_system"],
      ["planet", "/r/CapableOf", "orbit_a_star"],
      // matter / basic science
      ["water", "/r/IsA", "liquid"],
      ["water", "/r/UsedFor", "drinking"],
      ["ice", "/r/IsA", "solid"],
      ["ice", "/r/MadeOf", "water"],
      ["fire", "/r/CapableOf", "produce_heat"],
      ["fire", "/r/CapableOf", "produce_light"],
      // plants
      ["tree", "/r/IsA", "plant"],
      ["tree", "/r/HasA", "root"],
      ["tree", "/r/HasA", "leaf"],
      ["plant", "/r/CapableOf", "photosynthesize"],
      ["forest", "/r/HasA", "tree"],
      // everyday objects / places
      ["kitchen", "/r/PartOf", "house"],
      ["kitchen", "/r/UsedFor", "cooking"],
      ["bread", "/r/IsA", "food"],
      ["bread", "/r/MadeOf", "flour"],
      ["bicycle", "/r/HasA", "wheel"],
      ["bicycle", "/r/UsedFor", "transportation"],
      ["car", "/r/IsA", "vehicle"],
      ["car", "/r/HasA", "engine"],
      ["engine", "/r/CapableOf", "produce_power"],
      ["book", "/r/MadeOf", "paper"],
      ["book", "/r/UsedFor", "reading"],
      ["clock", "/r/UsedFor", "telling_time"],
    ],
  },
};

const conceptUri = (term) => `/c/en/${term}`;
const humanize = (term) => term.replace(/_/g, " ");

/** One curated triple → a tier-1-shaped slice row. */
export function toRow([subject, rel, concept, weight = 1]) {
  return {
    start: conceptUri(subject),
    rel,
    end: conceptUri(concept),
    weight,
    surfaceText: `[[${humanize(subject)}]] ${rel.replace("/r/", "")} [[${humanize(concept)}]]`,
  };
}

/** Curated corpus id → its JSONL text (deterministic order = authored order). */
export function corpusJsonl(id) {
  return CORPUSES[id].facts.map((f) => JSON.stringify(toRow(f))).join("\n") + "\n";
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ---- network-fetch path (opt-in, offline-by-default) -----------------------
// A tier-2 corpus too large to curate by hand is declared in the manifest with
// { "source": { "kind": "fetch", "url": "...", "sha256": "..." } } and pulled by
// a Wave-2 fetch step. This helper is the reference implementation — it is NEVER
// called without an explicit --allow-network flag (the product default is $0,
// offline). No sample corpus uses it; the three samples are all `curated`.
export async function fetchCorpus(url, expectedSha) {
  const res = await fetch(url, { headers: { accept: "application/x-ndjson,application/jsonl" } });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  const got = sha256(text);
  if (expectedSha && got !== expectedSha) throw new Error(`checksum mismatch for ${url}: ${got} != ${expectedSha}`);
  return text;
}

async function main() {
  const verify = process.argv.includes("--verify");
  const manifest = { version: 1, generated: "by corpus/tier2/generate.mjs", corpuses: [] };

  for (const [id, spec] of Object.entries(CORPUSES)) {
    const text = corpusJsonl(id);
    await writeFile(join(HERE, `${id}.jsonl`), text);
    manifest.corpuses.push({
      id,
      kind: spec.kind,
      description: spec.description,
      source: { kind: "curated", tool: "corpus/tier2/generate.mjs" },
      file: `${id}.jsonl`,
      facts: spec.facts.length,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
      license: "MPL-2.0",
    });
    console.error(`  ${id}: ${spec.facts.length} facts, ${Buffer.byteLength(text)} bytes`);
  }

  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(HERE, "manifest.json"), manifestText);
  console.error(`wrote manifest.json (${manifest.corpuses.length} corpuses)`);

  if (verify) {
    const { loadSlice, loadMap, toFacts } = await import("../../src/corpus/conceptnet.mjs");
    const map = await loadMap();
    for (const c of manifest.corpuses) {
      const assertions = await loadSlice(join(HERE, c.file));
      const facts = toFacts(assertions, map); // throws on any unmapped rel
      if (assertions.length !== c.facts) throw new Error(`${c.id}: loadSlice count ${assertions.length} != ${c.facts}`);
      if (facts.length !== c.facts) throw new Error(`${c.id}: ${c.facts - facts.length} fact(s) did not seed (ace=none rel?)`);
      console.error(`  verify ${c.id}: ${assertions.length} assertions load, all ${facts.length} seed cleanly`);
    }
    console.error("verify: OK — every tier-2 corpus loads and seeds through the tier-1 path");
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
