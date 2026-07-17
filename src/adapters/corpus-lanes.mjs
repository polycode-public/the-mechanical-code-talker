// Discover corpus lanes on disk: every .jsonl under `dir` (recursively),
// returned as lane names — the path relative to dir, without the .jsonl suffix
// — sorted. Sharded lane families live one directory down, e.g.
// games/openers.jsonl -> "games/openers".
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

export function corpusLanes(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).slice(0, -".jsonl".length))
    .sort();
}
