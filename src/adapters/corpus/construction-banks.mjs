// corpus/construction-banks.mjs — the filesystem side of the construction-
// grammar template banks: read data/templates/constructions/*.toml and hand
// the raw parsed tables to the domain strategy
// (interpret/strategies/constructions.mjs), which receives them via
// setConstructionBanks — the strategy itself never touches the filesystem.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The construction-bank directory (data, not code) — every *.toml file inside
 *  is loaded, in filename order, so a future bank is a new committed file, not
 *  an edit to this loader. */
export const CONSTRUCTIONS_DIR = join(HERE, "..", "..", "..", "data", "templates", "constructions");

/** Read every *.toml file in `dir` (sorted, deterministic) and return the raw
 *  parsed tables concatenated: {relations:[...], constructions:[...]}. A
 *  missing directory or an unparseable file is DEFENSIVE (per-file: a broken
 *  file is skipped, not fatal to the others) — callers get whatever validly
 *  parsed, never a thrown error from a data-authoring mistake. */
export function readConstructionFiles(dir = CONSTRUCTIONS_DIR) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".toml")).sort();
  } catch {
    return { relations: [], constructions: [] };
  }
  const relations = [];
  const constructions = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = parseToml(readFileSync(join(dir, file), "utf8"));
    } catch {
      continue; // one malformed file never takes the others down
    }
    if (Array.isArray(parsed.relation)) relations.push(...parsed.relation);
    if (Array.isArray(parsed.construction)) constructions.push(...parsed.construction);
  }
  return { relations, constructions };
}
