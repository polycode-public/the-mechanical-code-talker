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

/** Read + parse the local graph artifact. Cached per file for the process. */
export async function fetchEntities(config) {
  if (cache && cache.file === config.graphFile) return cache.payload;
  let text;
  try {
    text = await readFile(config.graphFile, "utf8");
  } catch (e) {
    throw new ToolError(
      `no graph artifact at ${config.graphFile} — run \`seonix cli index_repository '{"repo_path":"<abs>"}'\` ` +
        `for this repo first (the indexer writes <repo>/.seonix/graph.json). (${e?.code || e?.message || e})`,
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
