// Local graph source — the offline replacement for marginalia's HTTP/A2A `api`
// layer. The tool layer takes this as an injectable dependency (so tests can
// stub it); in production it reads the JSON artifact the deterministic indexer
// wrote to config.graphFile. No network, no model calls.

import { readFile } from "node:fs/promises";
import { ToolError } from "./config.mjs";

let cache = null; // { file, payload } — one artifact per process; cheap re-reads.

export function clearCache() {
  cache = null;
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

/** Read + parse the local graph artifact. Cached per file for the process.
 *  A MISSING artifact (ENOENT) is not an error: the chat surface starts from an
 *  empty graph and the first session fold-in creates the file — so we return the
 *  bootstrap payload (uncached, so the freshly written file is picked up next
 *  fetch). Every other failure still throws a clean ToolError. */
export async function fetchEntities(config) {
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
