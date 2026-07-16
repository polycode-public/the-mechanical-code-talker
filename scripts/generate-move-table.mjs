// Derives scripts/move-table.json from test/estate/layer-map.mjs, so the two can
// never disagree: the layer map stays the single source of truth for which layer
// a module belongs to, and this script only turns that classification into
// from/to paths. A file already sitting under its own layer's directory maps to
// itself (no move).

import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { layerOf } from "../test/estate/layer-map.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
export const TABLE_FILE = join(HERE, "move-table.json");

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

export function buildMoveTable() {
  const moves = [];
  const unmapped = [];
  for (const file of walkFiles(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    const layer = layerOf(rel);
    if (!layer) {
      unmapped.push(rel);
      continue;
    }
    const to = rel.startsWith(`${layer}/`) ? rel : `${layer}/${rel}`;
    moves.push({ from: rel, to, layer, moved: to !== rel });
  }
  if (unmapped.length) throw new Error(`layer map claims nothing for:\n${unmapped.join("\n")}`);
  return moves;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const moves = buildMoveTable();
  writeFileSync(TABLE_FILE, `${JSON.stringify(moves, null, 2)}\n`);
  const movedCount = moves.filter((m) => m.moved).length;
  console.log(`wrote ${TABLE_FILE}: ${moves.length} src files, ${movedCount} to move`);
  for (const layer of ["adapters", "domain", "services", "tools", "surfaces"]) {
    console.log(`  ${layer}: ${moves.filter((m) => m.layer === layer && m.moved).length}`);
  }
}
