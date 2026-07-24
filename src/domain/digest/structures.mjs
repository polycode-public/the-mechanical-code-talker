// digest/structures.mjs — stage 2 of the digest layer: validate the
// hand-authored sentence-structure bank and render one clause from a set of
// facts of a single relation family. Pure and deterministic; the raw parsed
// TOML rides in from a composition point exactly the way the construction banks
// do (the strategy never reads the filesystem), so this module imports only its
// sibling word helpers.

import { articleFor, pluralOf, capitalizeFirst, series } from "./words.mjs";

const VALID_FAMILIES = new Set(["isa", "location", "partOf", "capableOf", "usedFor"]);
const VALID_FORMS = new Set(["single", "several", "chained"]);

const keyFor = (family, form) => `${family}:${form}`;

/**
 * Validate and index the raw [[structure]] rows into a Map keyed by
 * `family:form`. Closed-vocabulary discipline, same as the construction banks:
 * an unknown family or form, or a missing template, drops the row rather than
 * coercing it. First occurrence of a (family, form) wins; a later duplicate is
 * ignored.
 */
export function buildStructureTable(structures) {
  const table = new Map();
  for (const s of structures || []) {
    if (!s || typeof s.family !== "string" || !VALID_FAMILIES.has(s.family)) continue;
    if (typeof s.form !== "string" || !VALID_FORMS.has(s.form)) continue;
    if (typeof s.template !== "string" || !s.template.trim()) continue;
    const key = keyFor(s.family, s.form);
    if (table.has(key)) continue;
    table.set(key, { family: s.family, form: s.form, template: s.template });
  }
  return table;
}

const withArticle = (word) => `${articleFor(word)} ${word}`;

/** Render "a mammal, and so an animal" from an ancestry chain [mammal, animal, …]. */
function renderChain(chain) {
  const parts = (chain || []).map((c) => String(c || "").trim()).filter(Boolean);
  if (!parts.length) return "";
  const head = withArticle(parts[0]);
  const rest = parts.slice(1);
  if (!rest.length) return head;
  return `${head}, and so ${series(rest.map(withArticle))}`;
}

/** The slot values for one render, derived from the term, its objects and an
 *  optional ancestry chain. A placeholder with no derived value renders empty. */
function slotsFor(term, objects, chain) {
  const t = String(term || "").trim();
  const objs = (objects || []).map((o) => String(o || "").trim()).filter(Boolean);
  const first = objs[0] || "";
  return {
    TERM: t,
    TERM_CAP: capitalizeFirst(t),
    A_TERM: withArticle(t),
    A_TERM_CAP: capitalizeFirst(withArticle(t)),
    TERMS: pluralOf(t),
    TERMS_CAP: capitalizeFirst(pluralOf(t)),
    PRONOUN: "it",
    PRONOUN_CAP: "It",
    OBJECT: first,
    A_OBJECT: first ? withArticle(first) : "",
    OBJECTS_A: series(objs.map(withArticle)),
    OBJECTS_PLURAL: series(objs.map(pluralOf)),
    OBJECTS_RAW: series(objs),
    CHAIN: renderChain(chain && chain.length ? chain : objs.slice(0, 1)),
  };
}

/** Substitute every `{SLOT}` in `template` with its value (empty when absent),
 *  then collapse any doubled spaces the empty slots left. */
function fill(template, slots) {
  return String(template)
    .replace(/\{([A-Z_]+)\}/g, (_, name) => (name in slots ? slots[name] : ""))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

/**
 * Render one clause for `facts` (all of one family) using the structure the
 * table holds for (family, form). `form` defaults by fact count — one fact is
 * "single", more is "several" — unless the caller names a form (e.g. "chained"
 * with an ancestry chain). Returns { text, rows, family, form } so the sentence
 * traces to the exact fact rows behind it, or null when no structure matches or
 * there are no facts.
 */
export function renderStructure(table, family, facts, opts = {}) {
  const rows = (facts || []).filter(Boolean);
  if (!rows.length) return null;
  const term = opts.term ?? rows[0].subject ?? "";
  const form = opts.form || (rows.length > 1 ? "several" : "single");
  const entry = table instanceof Map ? table.get(keyFor(family, form)) : null;
  if (!entry) return null;
  const objects = rows.map((r) => r.object);
  const text = fill(entry.template, slotsFor(term, objects, opts.chain));
  if (!text) return null;
  return { text, rows, family, form };
}
