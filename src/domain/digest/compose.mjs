// digest/compose.mjs — stage 3 of the digest layer: order the selected facts
// into sentences and group them into paragraphs. Pure and deterministic; the
// prose quality lives here — the lead sentence names the term, every sentence
// after it refers back with a pronoun, and a paragraph never runs past its
// sentence cap. Each sentence keeps the fact rows behind it, so provenance
// survives composition into the article stage.

import { renderStructure } from "./structures.mjs";
import { FAMILY_PRIORITY } from "./select.mjs";
import { articleFor, capitalizeFirst } from "./words.mjs";

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
 *     fact can render as a chain ("a mammal, and so an animal") when one exists.
 *   - maxSentencesPerParagraph: the sentence cap (default 3).
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
  const byFamily = rowsByFamily(selection?.selected || []);
  const sentences = [];

  const isaRows = byFamily.get("isa") || [];
  if (isaRows.length) {
    const chain = isaRows.length === 1 ? chains[isaRows[0].object] : null;
    const form = chain && chain.length > 1 ? "chained" : (isaRows.length > 1 ? "several" : "single");
    const s = renderStructure(table, "isa", isaRows, { term, form, chain });
    if (s) sentences.push({ ...s, role: "names-term", paragraph: "definition" });
  }

  for (const family of DESCRIPTION_FAMILIES) {
    const rows = byFamily.get(family);
    if (!rows || !rows.length) continue;
    const s = renderStructure(table, family, rows, { term });
    if (s) sentences.push({ ...s, role: "describes", paragraph: "description" });
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
