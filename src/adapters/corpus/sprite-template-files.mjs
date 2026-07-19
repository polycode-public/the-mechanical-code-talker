// sprite-template-files.mjs — the filesystem side of the sprite template
// library: read data/sprites/*.toml and hand the raw parsed tables to
// src/domain/sprite-templates.mjs's pure resolver, mirroring
// construction-banks.mjs's own readConstructionFiles idiom exactly (same
// directory-of-toml-files shape, same per-file-defensive load).
//
// This module is Node-only (readdirSync/readFileSync) and is never imported
// by src/surfaces/web/*-browser-entry.mjs — the browser pages get their
// template set as embedded page JSON instead (adventure-viz.mjs's/
// spider-fly-viz.mjs's own renderAdventureHtml/renderSpiderFlyHtml already
// embed the world/grid payload the same way; scripts/build-demo-site.mjs
// calls this loader once, in Node, and hands the result to those render
// functions), the same reason Ashcombe Hall's own JSONL world source is read
// once at build time rather than bundled into the browser.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The sprite-template directory (data, not code) — every *.toml file inside
 *  is loaded, in filename order, so a new sprite is a new committed file,
 *  never an edit to this loader. */
export const SPRITE_TEMPLATES_DIR = join(HERE, "..", "..", "..", "data", "sprites");

/** Read every *.toml file in `dir` (sorted, deterministic) and return the raw
 *  parsed template objects as a flat array. A missing directory or an
 *  unparseable file is DEFENSIVE (per-file: a broken file is skipped, not
 *  fatal to the others, the same posture readConstructionFiles takes for its
 *  own bank) — a production page load can never go blank because one hand-
 *  authored sprite has a typo. `test/adapters/sprite-templates.test.mjs`
 *  parses the real files directly (not through this lenient loader) so a
 *  broken file still fails a test loudly. */
export function readSpriteTemplateFiles(dir = SPRITE_TEMPLATES_DIR) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".toml")).sort();
  } catch {
    return [];
  }
  const templates = [];
  for (const file of files) {
    try {
      const parsed = parseToml(readFileSync(join(dir, file), "utf8"));
      templates.push(parsed);
    } catch {
      continue; // one malformed file never takes the others down
    }
  }
  return templates;
}
