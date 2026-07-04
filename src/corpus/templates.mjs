// corpus/templates.mjs — the response-template library + SE phrase book loaders
// (ROADMAP Phase 2, items 4+7). Plain diffable data in, strict renderers out:
//
//   data/templates/responses.jsonl   {id, class, template, register} rows
//   data/phrasebook/software-phrases.txt  one phrase pattern per line
//                                         (`#` comments, `~` synonym families)
//
// loadTemplates() validates the whole file (parse, required fields, unique
// ids) and caches; render(id, slots) is then synchronous and STRICT — an
// unknown id or a missing slot throws, it never emits a half-filled sentence.
// The response surface (Phase 1 pipeline) fills templates from grounded data
// only, so a thrown slot is a programming error, not a user-facing miss.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEMPLATES_FILE = join(PKG_ROOT, "data", "templates", "responses.jsonl");
export const PHRASEBOOK_FILE = join(PKG_ROOT, "data", "phrasebook", "software-phrases.txt");

const REGISTERS = new Set(["terse", "friendly"]);
const SLOT_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** The slot names a template string requires, in first-appearance order. */
export function slotsOf(template) {
  const out = [];
  for (const m of String(template).matchAll(SLOT_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

let cache = null; // Map<id, row> from the last loadTemplates() — render()'s source

/** Load + validate the response templates. Every line must parse as JSON with
 *  a unique `id`, a `class`, a known `register`, and a non-empty `template`
 *  (bad data fails loudly at load, never at render time). Returns Map<id,row>
 *  (each row gains `slots`, its required slot names) and primes render(). */
export async function loadTemplates(path = TEMPLATES_FILE) {
  const text = await readFile(path, "utf8");
  const byId = new Map();
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n].trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      throw new Error(`${path}:${n + 1}: not valid JSON: ${e.message}`);
    }
    for (const field of ["id", "class", "template", "register"]) {
      if (typeof row[field] !== "string" || !row[field]) {
        throw new Error(`${path}:${n + 1}: missing/empty "${field}"`);
      }
    }
    if (!REGISTERS.has(row.register)) {
      throw new Error(`${path}:${n + 1}: register must be terse|friendly, got "${row.register}"`);
    }
    if (byId.has(row.id)) throw new Error(`${path}:${n + 1}: duplicate template id "${row.id}"`);
    byId.set(row.id, { ...row, slots: slotsOf(row.template) });
  }
  cache = byId;
  return byId;
}

/** Fill template `id` with `slots` — strict: unknown id throws; ANY missing
 *  slot throws (named), so a response is complete or not emitted at all.
 *  Extra slots are ignored. Uses the map from loadTemplates() (pass
 *  `templates` explicitly to bypass the module cache, e.g. in tests). */
export function render(id, slots = {}, templates = cache) {
  if (!templates) throw new Error("render() before loadTemplates() — load the template library first");
  const row = templates.get(id);
  if (!row) throw new Error(`unknown template id "${id}"`);
  const missing = row.slots.filter((s) => slots[s] === undefined || slots[s] === null);
  if (missing.length) {
    throw new Error(`template "${id}" missing slot${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }
  return row.template.replace(SLOT_RE, (_, name) => String(slots[name]));
}

/** Load + parse the SE phrase book. Returns:
 *    patterns  [{pattern, slots}]  one per phrase line ("what calls {x}")
 *    synonyms  [[word, …], …]      one per `~` family line (≥2 entries each)
 *  `#`-prefixed lines and blank lines are skipped. */
export async function loadPhrasebook(path = PHRASEBOOK_FILE) {
  const text = await readFile(path, "utf8");
  const patterns = [];
  const synonyms = [];
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("~")) {
      const family = line.slice(1).split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (family.length < 2) throw new Error(`${path}:${n + 1}: a synonym family needs at least 2 entries`);
      synonyms.push(family);
      continue;
    }
    patterns.push({ pattern: line, slots: slotsOf(line) });
  }
  return { patterns, synonyms };
}
