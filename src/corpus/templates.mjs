// corpus/templates.mjs — the response-template library + SE phrase book loaders.
// Plain diffable data in, strict renderers out:
//
//   data/templates/responses.jsonl   {id, class, template, register} rows
//   data/phrasebook/software-phrases.txt  one phrase pattern per line
//                                         (`#` comments, `~` synonym families)
//
// loadTemplates() validates the whole file (parse, required fields, unique
// ids) and caches; render(id, slots) is then synchronous and STRICT — an
// unknown id or a missing slot throws, it never emits a half-filled sentence.
// The response surface fills templates from grounded data only, so a thrown
// slot is a programming error, not a user-facing miss.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEMPLATES_FILE = join(PKG_ROOT, "data", "templates", "responses.jsonl");
export const PHRASEBOOK_FILE = join(PKG_ROOT, "data", "phrasebook", "software-phrases.txt");

// Registers: `terse|friendly` are the conversational bands; `technical` is the C1
// technical-paper band, rendering mechanical conclusions (count/comparison/superlative
// + provenance) as advanced prose.
const REGISTERS = new Set(["terse", "friendly", "technical"]);
const SLOT_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

// Slot-lint for the technical band: only mechanical values, no free-text slot — and
// every technical row must carry a {provenance} fill.
export const TECHNICAL_SLOTS = Object.freeze(new Set([
  "subject", "count", "noun", "scope", "comparison", "metric", "unit",
  "superlative", "provenance",
]));

/** The slot names a template string requires, in first-appearance order. */
export function slotsOf(template) {
  const out = [];
  for (const m of String(template).matchAll(SLOT_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// --- Segmentation IR ---------------------------------------------------------
// A rendered answer is ALSO a list of typed spans: [{ type, text }, …] with
// type ∈ prose | entity | path | number | code | provenance | receipt, satisfying
// flatten(segments) === render(). Everything except `prose` is PROTECTED — a grammar
// rule may only transform prose spans, never touch a fact. A slot fill is always
// protected; unknown slot names fall back to the conservative `entity`.
const SLOT_KIND = {
  count: "number",
  when: "number",
  location: "path",
  commit: "path",
  provenance: "provenance",
};

/** The protected span type for a template slot name (default: entity). */
export function slotKind(name) {
  return SLOT_KIND[name] || "entity";
}

/** Reconstruct the flat answer from its segments — a pure, total inverse of
 *  segmentation: `segments.map(s => s.text).join("")`. flatten(renderSegments(
 *  id, slots)) === render(id, slots), byte for byte. */
export function flatten(segments) {
  let out = "";
  for (const s of segments) out += s.text;
  return out;
}

/** Render template `id` as a SEGMENTED answer: the literal text between slots
 *  becomes `prose` spans, each slot fill becomes a PROTECTED span typed by
 *  slotKind(). Validation is identical to render() (unknown id / missing slot
 *  throw the same messages), so render() is exactly flatten(renderSegments()). */
export function renderSegments(id, slots = {}, templates = cache) {
  if (!templates) throw new Error("renderSegments() before loadTemplates() — load the template library first");
  const row = templates.get(id);
  if (!row) throw new Error(`unknown template id "${id}"`);
  const missing = row.slots.filter((s) => slots[s] === undefined || slots[s] === null);
  if (missing.length) {
    throw new Error(`template "${id}" missing slot${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }
  const tpl = row.template;
  const re = new RegExp(SLOT_RE.source, "g"); // own lastIndex; never touch the shared regex
  const segments = [];
  let last = 0;
  let m;
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) segments.push({ type: "prose", text: tpl.slice(last, m.index) });
    segments.push({ type: slotKind(m[1]), text: String(slots[m[1]]) });
    last = m.index + m[0].length;
  }
  if (last < tpl.length) segments.push({ type: "prose", text: tpl.slice(last) });
  return segments;
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
      throw new Error(`${path}:${n + 1}: register must be terse|friendly|technical, got "${row.register}"`);
    }
    if (byId.has(row.id)) throw new Error(`${path}:${n + 1}: duplicate template id "${row.id}"`);
    const slots = slotsOf(row.template);
    // Technical-band slot-lint: mechanical-only fills, provenance mandatory.
    if (row.register === "technical") {
      const stray = slots.filter((s) => !TECHNICAL_SLOTS.has(s));
      if (stray.length) {
        throw new Error(`${path}:${n + 1}: technical template "${row.id}" uses non-mechanical slot${stray.length > 1 ? "s" : ""}: ${stray.join(", ")} (allowed: ${[...TECHNICAL_SLOTS].join(", ")})`);
      }
      if (!slots.includes("provenance")) {
        throw new Error(`${path}:${n + 1}: technical template "${row.id}" must carry a {provenance} fill (an advanced claim always shows its source)`);
      }
    }
    byId.set(row.id, { ...row, slots });
  }
  cache = byId;
  return byId;
}

/** Load + merge several EXTENSION-PACK template files into one Map<id,row>. Every
 *  extension-pack template id must be namespaced "<packname>:<id>" (a bare or duplicate
 *  id throws, naming the offending path/id). Restores the module's `cache` to its
 *  pre-call state afterward — the returned map is not installed as the render() default;
 *  a caller passes it explicitly: render(id, slots, mergedMap). */
export async function loadTemplatesMerged(paths = []) {
  const savedCache = cache;
  const merged = new Map();
  try {
    for (const path of paths) {
      const rows = await loadTemplates(path);
      for (const [id, row] of rows) {
        if (!id.includes(":")) {
          throw new Error(`${path}: extension-pack template id "${id}" is not namespaced ("<packname>:<id>")`);
        }
        if (merged.has(id)) {
          throw new Error(`${path}: duplicate template id "${id}" already loaded from an earlier path`);
        }
        merged.set(id, row);
      }
    }
  } finally {
    cache = savedCache;
  }
  return merged;
}

/** Fill template `id` with `slots` — strict: unknown id throws; ANY missing
 *  slot throws (named), so a response is complete or not emitted at all.
 *  Extra slots are ignored. Uses the map from loadTemplates() (pass
 *  `templates` explicitly to bypass the module cache, e.g. in tests). */
export function render(id, slots = {}, templates = cache) {
  if (!templates) throw new Error("render() before loadTemplates() — load the template library first");
  return flatten(renderSegments(id, slots, templates));
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
