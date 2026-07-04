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

let cache = null; // { file, payload } — one artifact per process; cheap re-reads.
let provider = null; // registered custom loader (config) => entities payload | Promise

export function clearCache() {
  cache = null;
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

/** Fetch the entities payload through the provider seam. With a registered
 *  provider, its result is returned as-is (uncached — a live provider owns its
 *  own caching/refresh policy); a non-object result is a clean ToolError.
 *  Default: read + parse the local graph artifact, cached per file for the
 *  process. A MISSING artifact (ENOENT) is not an error: the chat surface
 *  starts from an empty graph and the first session fold-in creates the file —
 *  so we return the bootstrap payload (uncached, so the freshly written file is
 *  picked up next fetch). Every other failure still throws a clean ToolError. */
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
