// Local graph source — the offline replacement for marginalia's HTTP/A2A `api`
// layer. The tool layer takes this as an injectable dependency (so tests can
// stub it); in production it reads the JSON artifact the deterministic indexer
// wrote to config.graphFile. No network, no model calls.
//
// This module is the PROVIDER SEAM (ROADMAP item 14, docs/adapter-contract.md):
// any graph producer can feed tmct either by writing the entities-payload JSON
// where config.graphFile points, or by registering a custom loader with
// registerProvider() — no indexer is ever imported here. tmct only READS
// through this seam; its own writes go to .tmct/memory/ (src/memory/), never
// back into a provider's artifact.

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

/** Read + parse ONE graph artifact file — the same per-file tolerance the
 *  single-graph path below has always had: a MISSING file (ENOENT) is not an
 *  error, it's the bootstrap payload; any other read/parse failure is a clean
 *  ToolError naming the file. Shared by the single- and multi-graph paths. */
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

/** The multi-graph path (src/graph-merge.mjs): config.graphFiles names MORE
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

/** Fetch the entities payload through the provider seam. With a registered
 *  provider, its result is returned as-is (uncached — a live provider owns its
 *  own caching/refresh policy); a non-object result is a clean ToolError.
 *  Default: read + parse the local graph artifact, cached per file for the
 *  process. A MISSING artifact (ENOENT) is not an error: the chat surface
 *  starts from an empty graph and the first session fold-in creates the file —
 *  so we return the bootstrap payload (uncached, so the freshly written file is
 *  picked up next fetch). Every other failure still throws a clean ToolError.
 *
 *  MULTI-GRAPH: when `config.graphFiles` names more than one file, this
 *  delegates to fetchMergedEntities (src/graph-merge.mjs) instead — a
 *  SEPARATE code path from the block below. The single-graph case (one
 *  `config.graphFile`, or a one-element `config.graphFiles`) always falls
 *  through to the unchanged block below — byte-identical to before multi-graph
 *  support existed. */
export async function fetchEntities(config) {
  if (provider) {
    let payload;
    try {
      payload = await provider(config);
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(`graph provider failed (${e?.message || e})`);
    }
    if (!payload || typeof payload !== "object") {
      throw new ToolError("graph provider returned no entities payload");
    }
    return payload;
  }
  if (Array.isArray(config.graphFiles) && config.graphFiles.length > 1) {
    return fetchMergedEntities(config);
  }
  if (cache && cache.file === config.graphFile) return cache.payload;
  let text;
  try {
    text = await readFile(config.graphFile, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyEntities();
    throw new ToolError(
      `cannot read graph artifact at ${config.graphFile} (${e?.code || e?.message || e})`,
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ToolError(`graph artifact ${config.graphFile} is not valid JSON`);
  }
  cache = { file: config.graphFile, payload };
  return payload;
}
