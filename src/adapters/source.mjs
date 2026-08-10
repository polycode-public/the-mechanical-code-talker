// Local graph source — the offline replacement for marginalia's HTTP/A2A `api`
// layer. The tool layer takes this as an injectable dependency (so tests can
// stub it); in production it reads the JSON artifact the deterministic indexer
// wrote to config.graphFile. No network, no model calls.
//
// This module is the READ SEAM (docs/adapter-contract.md): any graph producer
// can feed tmct either by writing the entities-payload JSON where
// config.graphFile points, or by registering a custom loader with
// registerProvider(). The PRODUCER lives elsewhere — tmct's own `tmct index`
// (src/index/) is one such producer, and it writes through that same file path,
// not through this module. Keeping the reader and the producer in separate module
// trees is deliberate: this module only READS, and tmct's own writes go to
// .tmct/memory/ (src/memory/), never back into a provider's graph artifact.

import { readFile } from "node:fs/promises";
import { ToolError } from "./config.mjs";
import { mergeEntityPayloads } from "./graph-merge.mjs";

let cache = null; // { file, payload } — one artifact per process; cheap re-reads.
let mergedCache = null; // { key, payload } — the multi-graph path's own cache (config.graphFiles.length > 1)
let provider = null; // registered custom loader (config) => entities payload | Promise

export function clearCache() {
  cache = null;
  mergedCache = null;
}

/** Register a custom graph provider: an async (or sync) `(config) => payload`
 *  returning the entities-payload shape documented in docs/adapter-contract.md.
 *  Pass `null` to restore the default file loader. Returns the PREVIOUS
 *  provider (so a caller can wrap or restore it). The read cache is cleared
 *  either way — a provider swap must never serve the old source's payload. */
export function registerProvider(fn) {
  if (fn != null && typeof fn !== "function") {
    throw new TypeError("registerProvider expects a function (config) => entities payload, or null");
  }
  const prev = provider;
  provider = fn ?? null;
  cache = null;
  return prev;
}

/** The empty-graph bootstrap payload: what a repo with no artifact "contains".
 *  Shaped exactly like a buildEntities payload so parseEntities and the session
 *  upsert treat it as a normal (just empty) graph. `bootstrap: true` marks it. */
export function emptyEntities() {
  return {
    generated_at: "",
    bootstrap: true,
    classes: [],
    vocabulary: [],
    objectProperties: [],
    individuals: [],
    proseIndex: {},
  };
}

/** Read + parse ONE graph artifact file: a MISSING file (ENOENT) is not an error, it's
 *  the bootstrap payload; any other read/parse failure is a clean ToolError naming the
 *  file. Shared by the single- and multi-graph paths. */
async function readOneGraphFile(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyEntities();
    throw new ToolError(`cannot read graph artifact at ${file} (${e?.code || e?.message || e})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError(`graph artifact ${file} is not valid JSON`);
  }
}

/** The multi-graph path (src/adapters/graph-merge.mjs): config.graphFiles names MORE
 *  THAN ONE graph file. Reads each (same per-file ENOENT→bootstrap tolerance
 *  as the single-graph path), merges them via mergeEntityPayloads, and caches
 *  the merge under a composite key (the sorted, joined file list) — so
 *  fetching the identical set of graphs twice in a row, in any order, is a
 *  cheap cache hit. `config.graphNames[i]`, when present, names graph i for
 *  mergeEntityPayloads's collision-prefixing (falls back to the array index). */
async function fetchMergedEntities(config) {
  const files = config.graphFiles;
  const key = [...files].map(String).sort().join("|");
  if (mergedCache && mergedCache.key === key) return mergedCache.payload;
  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const payload = await readOneGraphFile(files[i]);
    entries.push({ file: files[i], payload, name: config.graphNames?.[i] });
  }
  const merged = mergeEntityPayloads(entries);
  mergedCache = { key, payload: merged };
  return merged;
}

/** Fetch the entities payload through the provider seam. With a registered provider, its
 *  result is returned as-is (uncached); a non-object result is a clean ToolError. Default:
 *  read + parse the local graph artifact, cached per file. A missing artifact (ENOENT), or
 *  no config/graphFile at all (a graph-less caller — nothing was ever configured to read),
 *  returns the bootstrap payload, uncached, so a freshly written file is picked up next
 *  fetch. When `config.graphFiles` names more than one file, delegates to
 *  fetchMergedEntities instead. */
export async function fetchEntities(config) {
  const cfg = config || {};
  if (provider) {
    let payload;
    try {
      payload = await provider(cfg);
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(`graph provider failed (${e?.message || e})`);
    }
    if (!payload || typeof payload !== "object") {
      throw new ToolError("graph provider returned no entities payload");
    }
    return payload;
  }
  if (Array.isArray(cfg.graphFiles) && cfg.graphFiles.length > 1) {
    return fetchMergedEntities(cfg);
  }
  if (!cfg.graphFile) return emptyEntities();
  if (cache && cache.file === cfg.graphFile) return cache.payload;
  let text;
  try {
    text = await readFile(cfg.graphFile, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyEntities();
    throw new ToolError(
      `cannot read graph artifact at ${cfg.graphFile} (${e?.code || e?.message || e})`,
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ToolError(`graph artifact ${cfg.graphFile} is not valid JSON`);
  }
  cache = { file: cfg.graphFile, payload };
  return payload;
}
