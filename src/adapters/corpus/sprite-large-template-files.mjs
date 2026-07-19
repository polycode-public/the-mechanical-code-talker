// sprite-large-template-files.mjs — the filesystem side of the sprite TIER
// meant to be looked at closely (400px target, gradient/highlight shading):
// read data/sprites-large/*.toml and expand each file's by-name material
// references (sprite-materials.mjs's own `expandMaterialReferences`) before
// handing the templates to the SAME pure resolver the icon tier already
// uses (src/domain/sprite-templates.mjs). Mirrors sprite-template-files.mjs's
// own readSpriteTemplateFiles idiom exactly (same directory-of-toml-files
// shape, same per-file-defensive load) — the two loaders stay separate
// files, never merged into one, because they point at different directories
// and this one carries the extra material-expansion step the icon tier has
// no use for.
//
// Node-only (readdirSync/readFileSync), and — per package.json's own
// "!data/sprites-large/" exclusion — never reachable from an npm-installed
// consumer at all: only this git checkout (dev) or the deployed site's own
// fetched pack (scripts/build-demo-site.mjs's sprites-pack build step, which
// calls this loader once, in Node, at build time) can read this tier. The
// browser bundle never imports this module directly, the same reason
// sprite-template-files.mjs's own header gives for the icon tier.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";
import { expandMaterialReferences } from "../../domain/sprite-materials.mjs";
import { expandExpressionReferences } from "../../domain/sprite-expressions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The sprite-tier template directory (data, not code) — every *.toml file
 *  inside is loaded, in filename order, except `_materials.toml` itself
 *  (that file is a shared reference table, not a template — see
 *  sprite-materials.mjs, its palette is a plain JS constant, not read from
 *  here; a stray `_materials.toml` is tolerated defensively if one is ever
 *  added back, simply by never matching a real `classes` list). */
export const SPRITE_LARGE_TEMPLATES_DIR = join(HERE, "..", "..", "..", "data", "sprites-large");

/** Read every *.toml file in `dir` (sorted, deterministic), expand each
 *  file's material references against sprite-materials.mjs's shared
 *  palette, and return the flat array of fully-expanded template objects. A
 *  missing directory or an unparseable file is DEFENSIVE (per-file: a broken
 *  file is skipped, not fatal to the others) — a production page load can
 *  never go blank because one hand-authored sprite has a typo.
 *  test/adapters/sprite-large-template-files.test.mjs parses the real files
 *  directly (not through this lenient loader) so a broken file still fails a
 *  test loudly. Material references expand first, expression references
 *  second — the two indirections are independent (a template can carry
 *  either, both, or neither) so the order between them never matters to the
 *  result, only that both run before a template reaches a caller. */
export function readSpriteLargeTemplateFiles(dir = SPRITE_LARGE_TEMPLATES_DIR) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".toml") && !f.startsWith("_")).sort();
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
  return expandExpressionReferences(expandMaterialReferences(templates));
}
