// paraphrase-ing8.mjs — the deterministic ING-8 equivalence checker: the harder
// whole-document paraphrase shapes ING-7's own checker (verifySubClassParaphrase,
// ./paraphrase.mjs) doesn't cover — non-isa relations (has/creates/capableOf),
// multi-sentence documents, and synonym substitution over that closed relation
// vocabulary.
//
// Strategy, mirroring verifySubClassParaphrase's own pattern: wherever the
// predicate space allows exact re-derivation (a single isa fact on both sides),
// reuse ING-7's own closure re-derivation directly. Everywhere else — every
// non-isa relation, and every multi-sentence document — there is no entailment
// closure to re-derive over, so the fallback is normalization + a closed
// synonym-template table per relation, recognized and compared as an exact set.
// A document holding a sentence outside the closed template set is reported
// unverified, never guessed — the same "verified, never instead of the
// original" discipline paraphrase.mjs itself states for the isa case.

import { recoverSubClassTriple, verifySubClassParaphrase } from "./paraphrase.mjs";
import { normFactTerm, fnv1aHex } from "./hash.mjs";

const articleFor = (word) => (/^[aeiou]/i.test(String(word || "")) ? "an" : "a");

// Every template reads "SUBJECT verb OBJECT" left to right, same discipline as
// paraphrase.mjs's SUBCLASS_TEMPLATES — no passive/reordered form, since that's
// the shape most likely to invert subject/object under a naive recognizer.
const HAS_TEMPLATES = [
  (s, o) => `${s} has ${articleFor(o)} ${o}`,
  (s, o) => `${s} possesses ${articleFor(o)} ${o}`,
  (s, o) => `${s} owns ${articleFor(o)} ${o}`,
  (s, o) => `${s} carries ${articleFor(o)} ${o}`,
];
const HAS_RECOGNIZERS = [
  /^(.+?)\s+has\s+an?\s+(.+)$/i,
  /^(.+?)\s+possesses\s+an?\s+(.+)$/i,
  /^(.+?)\s+owns\s+an?\s+(.+)$/i,
  /^(.+?)\s+carries\s+an?\s+(.+)$/i,
];

const CREATES_TEMPLATES = [
  (s, o) => `${s} creates ${o}`,
  (s, o) => `${s} produces ${o}`,
  (s, o) => `${s} generates ${o}`,
  (s, o) => `${s} causes ${o}`,
];
const CREATES_RECOGNIZERS = [
  /^(.+?)\s+creates\s+(.+)$/i,
  /^(.+?)\s+produces\s+(.+)$/i,
  /^(.+?)\s+generates\s+(.+)$/i,
  /^(.+?)\s+causes\s+(.+)$/i,
];

const CAPABLEOF_TEMPLATES = [
  (s, o) => `${s} can ${o}`,
  (s, o) => `${s} is able to ${o}`,
  (s, o) => `${s} knows how to ${o}`,
];
const CAPABLEOF_RECOGNIZERS = [
  /^(.+?)\s+can\s+(.+)$/i,
  /^(.+?)\s+is\s+able\s+to\s+(.+)$/i,
  /^(.+?)\s+knows\s+how\s+to\s+(.+)$/i,
];

// The closed non-isa relation vocabulary this checker recognizes. Each family
// pairs its templates and recognizers by index, same convention as isa.
const RELATION_FAMILIES = {
  has: { templates: HAS_TEMPLATES, recognizers: HAS_RECOGNIZERS },
  creates: { templates: CREATES_TEMPLATES, recognizers: CREATES_RECOGNIZERS },
  capableOf: { templates: CAPABLEOF_TEMPLATES, recognizers: CAPABLEOF_RECOGNIZERS },
};
export const RELATION_FAMILY_IDS = Object.keys(RELATION_FAMILIES);

/** Deterministic template pick — same (subject, object) always picks the same
 *  template, spread across the table by a pure hash (paraphrase.mjs's own
 *  pickTemplateIndex pattern). `variantIndex`, when given, overrides the hash
 *  pick (a corpus generator wanting two DIFFERENT closed phrasings for the same
 *  fact passes distinct indices explicitly rather than relying on the hash). */
function pickTemplateIndex(subject, object, templateCount, variantIndex) {
  if (variantIndex !== null && variantIndex !== undefined) {
    return ((variantIndex % templateCount) + templateCount) % templateCount;
  }
  const h = fnv1aHex(`${subject}\0${object}`);
  return parseInt(h.slice(0, 8), 16) % templateCount;
}

/** Generate a closed-template phrasing of `subject <family> object` — never
 *  null, always one of RELATION_FAMILIES[family]'s templates. Rule/template-
 *  based only, no LLM, matching paraphrase.mjs's paraphraseSubClass. */
export function paraphraseRelation(family, subject, object, variantIndex = null) {
  const def = RELATION_FAMILIES[family];
  if (!def) throw new Error(`paraphrase-ing8: unknown relation family "${family}"`);
  const idx = pickTemplateIndex(subject, object, def.templates.length, variantIndex);
  return def.templates[idx](subject, object);
}

/** Recover {subject, object} from text matching one of `family`'s closed
 *  recognizers — null if it matches none of them. A plain closed-set regex
 *  match, never a fuzzy/NLP parse, the exact inverse of paraphraseRelation. */
export function recoverRelationTriple(family, text) {
  const def = RELATION_FAMILIES[family];
  if (!def) return null;
  const s = String(text || "").trim();
  for (const re of def.recognizers) {
    const m = s.match(re);
    if (m) return { subject: m[1].trim(), object: m[2].trim() };
  }
  return null;
}

/** Verify one relation-family paraphrase (mirrors verifySubClassParaphrase's
 *  single-fact contract, but for a non-isa relation): the paraphrase text must
 *  recover to the SAME (subject, object) under `family`'s closed recognizers.
 *  No closure to re-derive over for a non-isa relation, so this is a direct
 *  normalized compare, never a fuzzy one. */
export function verifyRelationParaphrase(family, subject, object, paraphraseText) {
  const recovered = recoverRelationTriple(family, paraphraseText);
  if (!recovered) return { verified: false };
  const verified = normFactTerm(recovered.subject) === normFactTerm(subject)
    && normFactTerm(recovered.object) === normFactTerm(object);
  return { verified };
}

// ---- whole-document recognition: isa + every relation family above ----

/** Recover a single (family, subject, object) triple from one sentence: isa
 *  first (paraphrase.mjs's closed subclass templates), then every relation
 *  family in RELATION_FAMILY_IDS order — null if the sentence matches none of
 *  the closed templates. Family keywords ("is a kind of" vs "has" vs "creates"
 *  vs "can" …) don't overlap, so recognition order never resolves a genuine
 *  ambiguity, only which closed family a sentence belongs to. */
export function recoverAnyTriple(sentence) {
  const isaHit = recoverSubClassTriple(sentence);
  if (isaHit) return { family: "isa", subject: isaHit.subject, object: isaHit.object };
  for (const family of RELATION_FAMILY_IDS) {
    const hit = recoverRelationTriple(family, sentence);
    if (hit) return { family, subject: hit.subject, object: hit.object };
  }
  return null;
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const tripleKey = (t) => `${t.family}\0${normFactTerm(t.subject)}\0${normFactTerm(t.object)}`;

/** Recover EVERY sentence of a document as a closed-template triple — null (the
 *  whole document unrecognized) the moment any sentence fails to match, never a
 *  partial list standing in for the whole. */
export function recoverDocumentTriples(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) return null;
  const triples = [];
  for (const sentence of sentences) {
    const t = recoverAnyTriple(sentence.replace(/\.+$/, ""));
    if (!t) return null;
    triples.push(t);
  }
  return triples;
}

/** Verify a whole-document ING-8 paraphrase pair: does `restatementText` say
 *  exactly what `inputText` says, no more and no less? A single isa fact on
 *  both sides re-derives the subclass closure directly through
 *  verifySubClassParaphrase (ING-7's own exact-re-derivation strategy).
 *  Everything else — a non-isa relation, or more than one sentence on either
 *  side — recovers every sentence of both texts against the closed template
 *  set above and requires the exact same (family, subject, object) SET, order
 *  irrelevant. Never verified when either side holds a sentence outside the
 *  closed templates, or when the two recovered sets differ in size or content
 *  (a dropped fact and an invented fact both fail this the same way — the
 *  checker declines rather than guesses which). */
export function verifyIng8Paraphrase(inputText, restatementText) {
  const inputTriples = recoverDocumentTriples(inputText);
  const restatementTriples = recoverDocumentTriples(restatementText);
  if (!inputTriples || !restatementTriples) {
    return { verified: false, reason: "unrecognized", inputTriples, restatementTriples };
  }
  const bothSingleIsa = inputTriples.length === 1 && restatementTriples.length === 1
    && inputTriples[0].family === "isa" && restatementTriples[0].family === "isa";
  if (bothSingleIsa) {
    const { subject, object } = inputTriples[0];
    const restatementSentence = splitSentences(restatementText)[0].replace(/\.+$/, "");
    const { verified } = verifySubClassParaphrase(subject, object, restatementSentence);
    return { verified, method: "isa-closure", inputTriples, restatementTriples };
  }
  if (inputTriples.length !== restatementTriples.length) {
    return { verified: false, reason: "fact count mismatch", inputTriples, restatementTriples };
  }
  const inputKeys = inputTriples.map(tripleKey).sort();
  const restatementKeys = restatementTriples.map(tripleKey).sort();
  const verified = inputKeys.every((k, i) => k === restatementKeys[i]);
  return { verified, method: "closed-template-set", inputTriples, restatementTriples };
}
