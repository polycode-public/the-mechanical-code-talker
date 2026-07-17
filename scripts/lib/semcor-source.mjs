// semcor-source.mjs — reads SemCor's YAML dump into the per-sentence records
// the persona example builder wants, and holds the filters that decide which
// sentences are usable at all.
//
// A maintainer tool: outside src/, does not ship, and free to read the dump
// with a real YAML parser rather than a reader written to avoid the dependency.

import YAML from "yaml";

/** Every per-sentence record in one SemCor file, in document order. The file is
 *  a mapping of sentence id -> { lemmas, pos, text }, led by a `_meta` schema
 *  block that is not a sentence. `text` is folded to single spaces so a scalar
 *  wrapped across source lines reads as one sentence.
 *  @returns {Array<{id: string, lemmas: string[]|null, pos: string[]|null, text: string|null}>} */
export function readSemcorRecords(text) {
  const doc = YAML.parse(text);
  if (!doc || typeof doc !== "object") return [];
  const records = [];
  for (const [id, rec] of Object.entries(doc)) {
    if (id === "_meta" || !rec || typeof rec !== "object") continue;
    records.push({
      id,
      lemmas: Array.isArray(rec.lemmas) ? rec.lemmas : null,
      pos: Array.isArray(rec.pos) ? rec.pos : null,
      text: typeof rec.text === "string" ? rec.text.replace(/\s+/g, " ").trim() : null,
    });
  }
  return records;
}

export const NOUN_POS = new Set(["NN", "NNS"]);

/** Simple-grammar filter: short, no semicolons/colons, no embedded quotes
 *  (which signal reported speech), no more than one comma — a rough proxy for
 *  "no complex embedded clauses". */
export function isSimpleSentence(text, wordCount) {
  if (wordCount > 18) return false;
  if (/[;:]/.test(text)) return false;
  if ((text.match(/,/g) || []).length > 1) return false;
  if (/"/.test(text)) return false;
  return true;
}
