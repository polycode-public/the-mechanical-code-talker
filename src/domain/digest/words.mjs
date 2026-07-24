// digest/words.mjs — the small, self-contained English surface helpers the
// digest layer needs to turn a bare class label into a readable noun phrase:
// the indefinite article, a regular plural, and first-letter casing. Kept
// local (not imported from inflect.mjs) so the whole digest layer ships as one
// self-contained unit — inflect.mjs is excluded from the published package.

const VOWEL_START = /^[aeiou]/i;

/** "a" or "an" for the following word, by its leading letter. A blank word
 *  yields "a" (the caller never renders a phrase around an empty label). */
export function articleFor(word) {
  return VOWEL_START.test(String(word || "").trim()) ? "an" : "a";
}

/** The regular English plural of a lemma — the same -s/-es/-ies rules the rest
 *  of the codebase uses, no irregular table. */
export function pluralOf(word) {
  const w = String(word || "").trim();
  if (!w) return w;
  if (/(?:s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** Upper-case the first character only, leaving the rest of the phrase as-is
 *  (so "aardvark" -> "Aardvark", but "DNA sequence" keeps its inner caps). */
export function capitalizeFirst(text) {
  const t = String(text || "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Join a list of phrases as an English series: "a", "a and b",
 *  "a, b, and c" (Oxford comma, deterministic). */
export function series(items) {
  const parts = (items || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
