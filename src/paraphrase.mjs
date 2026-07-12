// paraphrase.mjs — PLAN_BREADTH_FIRST_NLU.md (c) / ROADMAP.md "Ambition":
// "Paraphrase alongside the original, verified, never instead of it." A
// surface-realization variant of an isa-family (`rdfs:subClassOf`) teach
// confirmation, shown NEXT TO the original literal confirmation, never
// replacing it — and never shown at all unless its accuracy is checked by
// running tmct's OWN deterministic inference machinery (`src/syllogise.mjs`)
// against both the original and the paraphrase.
//
// Scope, deliberately narrow: isa-family (`rdfs:subClassOf`) facts only — the
// one predicate family `syllogise.mjs`'s `deriveSubClassClosure` actually
// reasons over. tmct's other taught predicate families (someValuesFrom,
// disjointWith, cardinality) have their own entailment rules in syllogise.mjs
// too, but this pass covers the single most common teach shape ("X is a kind
// of Y") the plan's own worked example (ROADMAP.md's Ambition section, the
// `PLAN_BREADTH_FIRST_NLU.md` §8 canonical example) already anchors on;
// widening to the other predicate families is a natural, separately-scoped
// follow-on once this shape is proven live.
//
// The generator and the recognizer are a MATCHED PAIR by construction — every
// template `paraphraseSubClass` can produce has a corresponding branch in
// `recoverSubClassTriple` that parses it back to exactly the same
// {subject, object} pair. This is a CLOSED set (never open-ended NLP), so
// recognition is exact, not fuzzy. "Verified" means: re-derive the
// `rdfs:subClassOf` transitive closure (the real conclusions this fact would
// license, via `deriveSubClassClosure`) once seeded with the ORIGINAL triple
// and once seeded with the triple RECOVERED FROM the paraphrase, over the
// SAME existing taught edges — the two closures must be identical (both
// derived edge SETS byte-for-byte equal). A generator bug that silently
// swapped subject/object (a real risk for a passive-voice template) would be
// caught here even in a graph with no other taught facts at all, because a
// swapped pair changes the closure's own subject/object roles the moment any
// OTHER edge touches either term — exactly the "must entail the same
// conclusions, neither may contradict the other" check the Ambition asks for,
// not a shallower string-equality stand-in for it.

import { deriveSubClassClosure } from "./syllogise.mjs";
import { normFactTerm } from "./memory/core.mjs";
import { fnv1aHex } from "./hash.mjs";

// Every template reads "SUBJECT ⊑ OBJECT" left to right — no passive/reordered
// form is offered, since a reordered form is exactly the shape most likely to
// invert subject/object under a naive regex recognizer; keeping the pair's
// left-to-right order fixed across every template keeps the recognizer trivial
// AND correct by construction, rather than needing the closure check to catch
// a bug the generator could have avoided entirely.
const articleFor = (word) => (/^[aeiou]/i.test(String(word || "")) ? "an" : "a");
const SUBCLASS_TEMPLATES = [
  (s, o) => `${s} is a kind of ${o}`,
  (s, o) => `${s} is a type of ${o}`,
  (s, o) => `every ${s} is ${articleFor(o)} ${o}`,
  (s, o) => `${s} counts as ${articleFor(o)} ${o}`,
];

// One regex per template above, in the SAME order — deliberately paired by
// index rather than derived/inverted from the generator, so a change to one
// side can never silently desync from the other without a test catching it
// (see paraphrase.test.mjs's own round-trip check over every template).
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

/** The actual verification step: does re-deriving the rdfs:subClassOf closure
 *  from the paraphrase's own recovered triple produce the SAME entailed edge
 *  set as deriving it from the original triple, over the same pre-existing
 *  taught edges? `existingEdges` is `[[a,b], …]` — the SAME already-normalized
 *  pair-list shape `deriveSubClassClosure` itself takes (subClassEdges read
 *  straight off taught Fact rows elsewhere in this codebase). Returns
 *  `{verified, closure}` — `closure` is the original triple's own derived
 *  conclusions (handed back so a caller can show/log them), `verified` is
 *  false when the paraphrase's recovered triple doesn't reparse, doesn't match
 *  the original's normalized (subject, object), or derives a different
 *  closure — any one of those means the paraphrase must NOT be shown. */
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
