// paraphrase.mjs — a surface-realization variant of an isa-family
// (`rdfs:subClassOf`) teach confirmation, shown alongside the original, never
// replacing it, and only when verified against tmct's own inference engine
// (src/syllogise.mjs). Scoped to isa-family facts only — the one predicate
// family deriveSubClassClosure reasons over.
//
// Verification: re-derive the rdfs:subClassOf closure once from the original
// triple and once from the triple recovered by parsing the paraphrase back —
// over the same existing taught edges, the two closures must be identical.
// This catches a generator bug that silently swapped subject/object, since a
// swap changes the closure's roles as soon as any other edge touches either
// term.

import { deriveSubClassClosure } from "./syllogise.mjs";
import { normFactTerm } from "./memory/core.mjs";
import { fnv1aHex } from "./hash.mjs";

// Every template reads "SUBJECT ⊑ OBJECT" left to right — no passive/reordered
// form, since that's the shape most likely to invert subject/object under a
// naive regex recognizer.
const articleFor = (word) => (/^[aeiou]/i.test(String(word || "")) ? "an" : "a");
const SUBCLASS_TEMPLATES = [
  (s, o) => `${s} is a kind of ${o}`,
  (s, o) => `${s} is a type of ${o}`,
  (s, o) => `every ${s} is ${articleFor(o)} ${o}`,
  (s, o) => `${s} counts as ${articleFor(o)} ${o}`,
];

// One regex per template above, in the SAME order (paired by index, not
// derived from the generator).
const SUBCLASS_RECOGNIZERS = [
  /^(.+?)\s+is\s+a\s+kind\s+of\s+(.+)$/i,
  /^(.+?)\s+is\s+a\s+type\s+of\s+(.+)$/i,
  /^every\s+(.+?)\s+is\s+an?\s+(.+)$/i,
  /^(.+?)\s+counts\s+as\s+an?\s+(.+)$/i,
];

/** Deterministic template pick — same (subject, object) always picks the same
 *  template (pinnable in tests), spread across the table by a pure hash, never
 *  Math.random/Date.now (same discipline as answer-variants.mjs's pickPhrase). */
function pickTemplateIndex(subject, object) {
  const h = fnv1aHex(`${subject}\0${object}`);
  return parseInt(h.slice(0, 8), 16) % SUBCLASS_TEMPLATES.length;
}

/** Generate a paraphrase of the `rdfs:subClassOf` confirmation "SUBJECT is a
 *  kind of OBJECT" for the given (already-normalized-or-not) subject/object —
 *  never null, always one of the closed templates. Rule/template-based only,
 *  no LLM, matching every other generator in this product. */
export function paraphraseSubClass(subject, object) {
  const idx = pickTemplateIndex(subject, object);
  return SUBCLASS_TEMPLATES[idx](subject, object);
}

/** Recover {subject, object} from a paraphrase this module itself generated
 *  (or any text matching one of the closed templates) — null if it matches
 *  none of them. Never a fuzzy/NLP parse; a plain closed-set regex match, the
 *  exact inverse of paraphraseSubClass by construction. */
export function recoverSubClassTriple(text) {
  const s = String(text || "").trim();
  for (const re of SUBCLASS_RECOGNIZERS) {
    const m = s.match(re);
    if (m) return { subject: m[1].trim(), object: m[2].trim() };
  }
  return null;
}

/** Verify: re-derive the rdfs:subClassOf closure from the original triple and
 *  from the paraphrase's recovered triple, over the same existing taught
 *  edges. Returns `{verified, closure}` — `verified` is false if the
 *  paraphrase doesn't reparse, doesn't match the original (subject, object),
 *  or derives a different closure. */
export function verifySubClassParaphrase(subject, object, paraphraseText, existingEdges = []) {
  const origSubj = normFactTerm(subject);
  const origObj = normFactTerm(object);
  const recovered = recoverSubClassTriple(paraphraseText);
  const closureOf = (a, b) => deriveSubClassClosure([...existingEdges, [a, b]]);
  const keyOf = (edges) => edges.map((e) => `${e.subject}\0${e.object}`).sort().join("|");
  const closure = closureOf(origSubj, origObj);
  if (!recovered) return { verified: false, closure };
  const recSubj = normFactTerm(recovered.subject);
  const recObj = normFactTerm(recovered.object);
  if (recSubj !== origSubj || recObj !== origObj) return { verified: false, closure };
  const paraphraseClosure = closureOf(recSubj, recObj);
  const verified = keyOf(closure) === keyOf(paraphraseClosure);
  return { verified, closure };
}

/** Top-level convenience: generate + verify in one call. Returns the
 *  paraphrase text ONLY when verified (never an unverified paraphrase);
 *  `null` otherwise — the caller shows nothing extra rather than something
 *  unchecked, keeping "verified, never instead of the original" strict even
 *  on a genuine (unexpected) verification failure. */
export function paraphraseVerifiedSubClass(subject, object, existingEdges = []) {
  const text = paraphraseSubClass(subject, object);
  const { verified } = verifySubClassParaphrase(subject, object, text, existingEdges);
  return verified ? text : null;
}
