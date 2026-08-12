#!/usr/bin/env node
// fetch-wikidata-slice-live.mjs — builds wikidata-slice.jsonl straight from
// Wikidata's live entity-data endpoint, the interim route while the full
// dump (scripts/resume-wikidata-dump.sh) redownloads. Fetches the 12
// committed SEED_QIDS entities, derives their object QIDs through the same
// WIKIDATA_PROPERTY_RELATIONS-driven derivation extract-wikidata-slice.mjs
// runs over the dump (objectQidsOf, imported rather than copied), fetches
// those, and writes the same per-entity JSON-lines shape
// build-wikidata-slice.mjs --source consumes. Not part of the product path
// — an operator-run maintainer tool.
//
//   node scripts/corpus-bands/fetch-wikidata-slice-live.mjs [--out ~/tmct-dumps/]
//
// Each entity comes back from `Special:EntityData/<QID>.json` wrapped in
// `{entities: {<QID>: {...}}}`; unwrapping that envelope is the one thing
// this route does that the dump route doesn't need, since a dump line is
// already the bare per-entity object.
//
// Courtesy: every request runs through the shared gate
// (src/adapters/corpus/courtesy.mjs) — the same throttle, timeout and
// 429/maxlag cool-off wikidata-live.mjs's turn-time lookups use, with
// waitForSlot on so a batch run waits out its own pacing instead of
// bailing. A transient failure (network error, timeout, non-2xx) retries
// with a growing backoff before the entity is finally recorded missing.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SEED_QIDS } from "./build-wikidata-slice.mjs";
import { DEFAULT_OUT_DIR, objectQidsOf, SLICE_FILENAME } from "./extract-wikidata-slice.mjs";
import { WIKIDATA_LIVE_ORIGIN, WIKIDATA_USER_AGENT } from "../../src/adapters/corpus/wikidata-live.mjs";
import { createCourtesyGate, DEFAULT_MIN_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "../../src/adapters/corpus/courtesy.mjs";

export const ENTITY_DATA_RETRIES = 4;
export const ENTITY_DATA_RETRY_BASE_MS = 500;
export const PROGRESS_EVERY = 3;

export function entityDataUrl(qid, origin = WIKIDATA_LIVE_ORIGIN) {
  return `${origin}/wiki/Special:EntityData/${qid}.json`;
}

/** One entity's live JSON, unwrapped from the endpoint's envelope to the
 *  same per-entity object shape a dump line carries. Retries a transient
 *  miss with a growing backoff; returns null once every retry is spent. */
async function fetchEntity(gate, qid, { retries, retryBaseMs, origin }) {
  const url = entityDataUrl(qid, origin);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const body = await gate.cachedFetch(`${qid}#${attempt}`, () => gate.fetchJson(url));
    const entities = body?.entities ?? {};
    const entity = entities[qid] ?? Object.values(entities)[0] ?? null;
    if (entity && !entity.missing) return entity;
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, retryBaseMs * 2 ** attempt));
  }
  return null;
}

function defaultProgressLogger({ phase, fetched, total, done }) {
  const suffix = done ? "  (phase done)" : "";
  process.stderr.write(`${new Date().toISOString()}  ${phase}  ${fetched}/${total} fetched${suffix}\n`);
}

/** Sequentially fetches every id in `qids` into `into`, reporting progress
 *  every `progressEvery` entities. Returns the count that came back null
 *  after every retry. */
async function fetchEntitiesInto(gate, qids, into, { phase, onProgress, progressEvery, ...fetchOpts }) {
  let missing = 0;
  let fetched = 0;
  for (const qid of qids) {
    const entity = await fetchEntity(gate, qid, fetchOpts);
    if (entity) into.set(qid, entity);
    else missing += 1;
    fetched += 1;
    if (onProgress && (fetched % progressEvery === 0 || fetched === qids.length)) {
      onProgress({ phase, fetched, total: qids.length, done: fetched === qids.length });
    }
  }
  return missing;
}

/** Builds `<outDir>/wikidata-slice.jsonl` from Wikidata's live entity-data
 *  endpoint. `seedQids` overrides SEED_QIDS, for a fixture; `fetchImpl`
 *  overrides the transport, for a stubbed test. Returns the same summary
 *  shape extractWikidataSlice returns, so a caller can report either route
 *  identically. */
export async function fetchWikidataSliceLive({
  outDir = DEFAULT_OUT_DIR,
  seedQids = SEED_QIDS,
  fetchImpl,
  origin = WIKIDATA_LIVE_ORIGIN,
  userAgent = WIKIDATA_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  retries = ENTITY_DATA_RETRIES,
  retryBaseMs = ENTITY_DATA_RETRY_BASE_MS,
  progressEvery = PROGRESS_EVERY,
  onProgress = defaultProgressLogger,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const gate = createCourtesyGate({ fetchImpl, timeoutMs, minIntervalMs, userAgent, waitForSlot: true });
  const fetchOpts = { retries, retryBaseMs, origin, onProgress, progressEvery };

  const seedIds = [...new Set(seedQids)].sort();
  const seedEntities = new Map();
  const seedsMissing = await fetchEntitiesInto(gate, seedIds, seedEntities, { phase: "seeds", ...fetchOpts });

  const objectIds = new Set();
  for (const entity of seedEntities.values()) {
    for (const id of objectQidsOf(entity)) {
      if (!seedIds.includes(id)) objectIds.add(id);
    }
  }
  const sortedObjectIds = [...objectIds].sort();

  const objectEntities = new Map();
  const objectsMissing = await fetchEntitiesInto(gate, sortedObjectIds, objectEntities, { phase: "objects", ...fetchOpts });

  const outPath = join(outDir, SLICE_FILENAME);
  const tmpOut = `${outPath}.tmp-${process.pid}`;
  const all = [...seedEntities.values(), ...objectEntities.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = all.map((entity) => JSON.stringify(entity));
  await writeFile(tmpOut, lines.length ? `${lines.join("\n")}\n` : "");
  await rename(tmpOut, outPath);

  return {
    outPath,
    seedsRequested: seedIds.length,
    seedsFound: seedEntities.size,
    seedsMissing,
    objectQidsDerived: sortedObjectIds.length,
    objectsFound: objectEntities.size,
    objectsMissing,
    totalLines: all.length,
  };
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const outDir = flagValue(argv, "--out") || DEFAULT_OUT_DIR;

  const result = await fetchWikidataSliceLive({ outDir });
  process.stderr.write(
    `seeds: ${result.seedsFound}/${result.seedsRequested} found (${result.seedsMissing} missing); `
    + `objects: ${result.objectsFound}/${result.objectQidsDerived} derived QIDs found (${result.objectsMissing} missing)\n`
    + `wrote ${result.outPath} (${result.totalLines} entity lines)\n`
    + `build with: node scripts/corpus-bands/build-wikidata-slice.mjs --source ${result.outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
