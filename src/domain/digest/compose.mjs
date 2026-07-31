// digest/compose.mjs — stage 3 of the digest layer: order the selected facts
// into sentences and group them into paragraphs. Pure and deterministic; the
// prose quality lives here — the lead sentence names the term, every sentence
// after it refers back with a pronoun, and a paragraph never runs past its
// sentence cap. Each sentence keeps the fact rows behind it, so provenance
// survives composition into the article stage.

import { renderStructure } from "./structures.mjs";
import { FAMILY_PRIORITY } from "./select.mjs";
import { articleFor, capitalizeFirst } from "./words.mjs";
import DEFAULT_CONFIG from "./config.json" with { type: "json" };

const DESCRIPTION_FAMILIES = FAMILY_PRIORITY.filter((f) => f !== "isa" && f !== "other");

/** Group the selector's `selected` items by family, preserving each item's
 *  ranked order, and return `{ family -> rows[] }` over the fact rows. */
function rowsByFamily(selected) {
  const by = new Map();
  for (const item of selected || []) {
    if (!by.has(item.family)) by.set(item.family, []);
    by.get(item.family).push(item.row);
  }
  return by;
}

/** Split `rows` into runs of at most `size`, keeping order. Never returns an
 *  empty run; a size below 1 is treated as 1. */
export function chunk(rows, size) {
  const n = Math.max(1, Math.trunc(size) || 1);
  const out = [];
  for (let i = 0; i < (rows || []).length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

/** Bucket isa rows by their object's immediate ancestor (`chains[object][1]`),
 *  so facts that share a parent class can be named in one coherent sentence.
 *  A parent with two or more rows is a real group; a parent with only one row,
 *  and any row whose object has no recorded ancestry, fold into one shared
 *  leftover pool. Groups come first in the order their earliest member ranked;
 *  the leftover pool, in rank order, comes last. Returns
 *  `[{ parent, rows }, …]` where `parent` is null for the leftover pool. */
export function groupIsaByParent(rows, chains) {
  const parentOf = (row) => (chains?.[row.object] || [])[1] || null;
  const counts = new Map();
  for (const row of rows || []) {
    const p = parentOf(row);
    if (p) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const groupRows = new Map();
  const order = [];
  const leftover = [];
  for (const row of rows || []) {
    const p = parentOf(row);
    if (p && counts.get(p) >= 2) {
      if (!groupRows.has(p)) { groupRows.set(p, []); order.push(p); }
      groupRows.get(p).push(row);
    } else {
      leftover.push(row);
    }
  }
  const groups = order.map((parent) => ({ parent, rows: groupRows.get(parent) }));
  if (leftover.length) groups.push({ parent: null, rows: leftover });
  return groups;
}

/** The highest-level ontology roots the spoken isa objects reach: for each row,
 *  the last (most general) node its ancestry chain walked. Roots rank by how
 *  many chains reach them (ties broken alphabetically for determinism); the top
 *  `count` are kept. Returns `{ roots, rows }` — `roots` names the concepts a
 *  closer sentence renders, `rows` are the real backing isa facts so the closer
 *  keeps its provenance without ever synthesising a row. */
export function closerRootsFor(chains, usedRows, count) {
  const rootCount = new Map();
  const rootRows = new Map();
  for (const row of usedRows || []) {
    const chain = chains?.[row.object];
    if (!Array.isArray(chain) || chain.length < 2) continue;
    const root = chain[chain.length - 1];
    if (!root || root === row.object) continue;
    rootCount.set(root, (rootCount.get(root) || 0) + 1);
    if (!rootRows.has(root)) rootRows.set(root, []);
    rootRows.get(root).push(row);
  }
  const roots = [...rootCount.keys()]
    .sort((a, b) => (rootCount.get(b) - rootCount.get(a)) || a.localeCompare(b))
    .slice(0, Math.max(0, count));
  const rows = [];
  const seen = new Set();
  for (const root of roots) for (const r of rootRows.get(root) || []) {
    if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  }
  return { roots, rows };
}

/** Compose the isa (definition) sentences. Gated purely on how many isa facts
 *  survived selection: none says nothing; one renders the single or chained
 *  form; a handful (up to the split threshold) merges into one clause. Past the
 *  threshold the run-on breaks apart — an opener names the top concepts, body
 *  sentences group the rest by shared parent, and a closer names the roots they
 *  all sit under. Returns tagged sentence objects, or an empty list. */
function composeIsaSection(isaRows, chains, term, table, config) {
  const out = [];
  if (!isaRows.length) return out;

  if (isaRows.length === 1) {
    const chain = chains[isaRows[0].object];
    const form = chain && chain.length > 1 ? "chained" : "single";
    const s = renderStructure(table, "isa", isaRows, { term, form, chain });
    if (s) out.push({ ...s, role: "names-term", paragraph: "definition" });
    return out;
  }

  if (isaRows.length <= config.groupSplitThreshold) {
    const s = renderStructure(table, "isa", isaRows, { term, form: "several" });
    if (s) out.push({ ...s, role: "names-term", paragraph: "definition" });
    return out;
  }

  const openerRows = isaRows.slice(0, config.openerConceptCount);
  const restRows = isaRows.slice(config.openerConceptCount);
  const opener = renderStructure(table, "isa", openerRows, {
    term, form: openerRows.length > 1 ? "several" : "single", variantSeed: term,
  });
  if (opener) out.push({ ...opener, role: "names-term", paragraph: "definition" });

  let units = [];
  for (const g of groupIsaByParent(restRows, chains)) {
    for (const c of chunk(g.rows, config.maxObjectsPerBodySentence)) units.push({ parent: g.parent, rows: c });
  }
  // Cap the sentence count. Overflow folds into the last sentence rather than
  // drop a selected fact — the merged sentence loses its single-parent coherence,
  // so it renders as a plain "several" clause.
  if (units.length > config.maxBodySentences) {
    const kept = units.slice(0, config.maxBodySentences);
    const last = kept[kept.length - 1];
    for (const o of units.slice(config.maxBodySentences)) last.rows = last.rows.concat(o.rows);
    last.parent = null;
    units = kept;
  }
  for (const u of units) {
    const s = u.parent
      ? renderStructure(table, "isa", u.rows, { term, form: "group", parent: u.parent, variantSeed: u.parent })
      : renderStructure(table, "isa", u.rows, { term, form: "several", variantSeed: term });
    if (s) out.push({ ...s, role: "describes-isa", paragraph: "definition" });
  }

  const { roots, rows: closerRows } = closerRootsFor(chains, isaRows, config.closerRootCount);
  if (roots.length) {
    const s = renderStructure(table, "isa", closerRows.length ? closerRows : isaRows, {
      term, form: "closer", objectsOverride: roots, variantSeed: term,
    });
    if (s) out.push({ ...s, role: "closes-isa", paragraph: "definition" });
  }
  return out;
}

/** The first sentence must introduce the term. When no isa fact led (so the
 *  first sentence opens with a bare "It"), rewrite that pronoun into the term's
 *  own noun phrase so the pronoun has an antecedent. */
function ensureFirstNamesTerm(sentences, term) {
  if (!sentences.length) return;
  const first = sentences[0];
  if (/\bnames-term\b/.test(first.role)) return;
  const phrase = capitalizeFirst(`${articleFor(term)} ${term}`);
  first.text = first.text.replace(/^It\b/, phrase);
  first.role = "names-term";
}

/** Split a flat sentence list into paragraphs of at most `cap` sentences,
 *  respecting the caller's paragraph boundaries (a sentence's `paragraph` tag). */
function paragraphsFrom(sentences, cap) {
  const groups = [];
  let current = null;
  let currentTag = null;
  for (const s of sentences) {
    if (!current || s.paragraph !== currentTag || current.length >= cap) {
      current = [];
      currentTag = s.paragraph;
      groups.push(current);
    }
    current.push(s);
  }
  return groups.map((sentences) => ({
    sentences,
    text: sentences.map((s) => s.text).join(" "),
  }));
}

/**
 * Compose the term digest from a selector result and a structure table.
 *
 * opts:
 *   - chains: { object -> [object, parent, …] } ancestry chains, so a lone isa
 *     fact can render as a chain ("a mammal, and so an animal") when one exists,
 *     and a many-fact term can split into opener, grouped body and closer.
 *   - maxSentencesPerParagraph: the sentence cap (default 3).
 *   - config: digest tuning overrides (the group split threshold and the
 *     per-sentence / per-digest caps), defaulting to config.json.
 *
 * Returns { term, sentences, paragraphs, provenanceRows }. Every sentence in
 * `sentences` carries { text, rows, family, role, paragraph }; `paragraphs`
 * joins them for rendering; `provenanceRows` is every fact row the digest used,
 * deduped by id.
 */
export function composeTermDigest(selection, table, opts = {}) {
  const term = selection?.term || "";
  const cap = Number.isInteger(opts.maxSentencesPerParagraph) ? opts.maxSentencesPerParagraph : 3;
  const chains = opts.chains || {};
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const byFamily = rowsByFamily(selection?.selected || []);
  const sentences = [];

  for (const s of composeIsaSection(byFamily.get("isa") || [], chains, term, table, config)) sentences.push(s);

  for (const family of DESCRIPTION_FAMILIES) {
    const rows = byFamily.get(family);
    if (!rows || !rows.length) continue;
    for (const c of chunk(rows, config.maxObjectsPerBodySentence)) {
      const s = renderStructure(table, family, c, { term });
      if (s) sentences.push({ ...s, role: "describes", paragraph: "description" });
    }
  }

  ensureFirstNamesTerm(sentences, term);

  const provenanceById = new Map();
  for (const s of sentences) for (const r of s.rows) if (!provenanceById.has(r.id)) provenanceById.set(r.id, r);

  return {
    term,
    sentences,
    paragraphs: paragraphsFrom(sentences, cap),
    provenanceRows: [...provenanceById.values()],
  };
}
