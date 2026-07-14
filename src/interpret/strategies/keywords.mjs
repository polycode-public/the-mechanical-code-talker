// interpret/strategies/keywords.mjs — strategy 2: keyword-spotting/decomposition.
// ELIZA's own mechanism: find the keyword(s) anywhere in the text, decompose
// around them, tolerate reordering and casual phrasing. Position-independent
// (no `^...$` anchor), so it tolerates
// "what calls this" / "who invokes this" / "something executes this, where from"
// — real phrasings the anchored grammar's fixed shapes don't cover.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  WHERE_MARKERS, MENTION_MARKERS, PLACEHOLDER_NOUNS, PASSIVE_PARTICIPLE_TO_KIND,
  INHERITS_REVERSE_VERBS,
} from "../../ask-vocab.mjs";
import { STOPWORDS } from "../normalize.mjs";
import { VOCAB_WORDS, eligibleForCanon, fuzzyVocabWord } from "../fuzzy.mjs";

// Passive auxiliaries (with an agent-marking "by") that flip the active reading,
// and the wh-words marking a questioned agent. Bare do/does/did are excluded —
// that shape is a negation, not a passive.
const PASSIVE_AUX = new Set(["is", "are", "was", "were", "be", "been", "being", "get", "gets", "got"]);
const WH_WORDS = new Set(["which", "what", "who", "whom", "whose"]);
const PLACEHOLDER_SET = new Set(PLACEHOLDER_NOUNS.map((w) => w.toLowerCase()));

/** Find the longest phrase from `table`'s keys that appears as a contiguous
 *  run of `words` (case already lowercased by the caller). Longest-match-first
 *  (multi-word phrases before single words) so "co-changes with" isn't
 *  shadowed by a shorter unrelated word. A span overlapping `consumed` indices
 *  is skipped: the verb and entity tables now share a surface form ("change"
 *  is both a touches verb and the Change entity noun), and a word already
 *  claimed by the verb pass must not double as the entity keyword. Returns
 *  {kind, start, end} (end exclusive) or null. */
export function findPhrase(lcWords, table, consumed = null) {
  const phrases = Object.keys(table).sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const p of phrases) {
    const pWords = p.split(" ");
    for (let i = 0; i <= lcWords.length - pWords.length; i += 1) {
      if (consumed && pWords.some((_, j) => consumed.has(i + j))) continue;
      if (pWords.every((w, j) => lcWords[i + j] === w)) return { kind: table[p], start: i, end: i + pWords.length };
    }
  }
  return null;
}

/** Strategy 2: find a verb keyword anywhere in the text, plus optional
 *  entity/modifier keywords, then split what's left into words BEFORE and
 *  AFTER the verb — both sides -> ask, after only -> reverse, before only ->
 *  forward. Keyword matching is tiered (exact, then lemma, then fuzzy edit-
 *  distance), each tier firing only when every tier above found nothing, so
 *  an exact curated match can never be displaced. Canonicalized words drive
 *  phrase finding only; sideText always reads the original words. */
export function parseKeywordSpot(text, nlp = null) {
  // Strip a trailing "?" (mirrors the anchored templates' own `\??$`) and turn commas into
  // pauses/spaces — but NEVER strip a mid-word ".": object terms are routinely dotted file/module
  // names ("a.py", "utils.mjs"), and the anchored strategy captures those raw, so keyword-spot
  // must too or the two strategies would "disagree" over a period that was never part of the intent.
  const words = text.replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const lcWords = words.map((w) => w.toLowerCase());
  // where/mentions carry no relation verb, so only routed here when the sentence
  // has no relation verb anywhere (otherwise "where" is merely decorative).
  if (lcWords.includes("where") && !findPhrase(lcWords, VERB_TO_KIND)) {
    const mention = lcWords.some((w) => MENTION_MARKERS.includes(w));
    const markers = new Set([...WHERE_MARKERS, ...MENTION_MARKERS]);
    const objText = words.filter((w, i) => !STOPWORDS.has(lcWords[i]) && !markers.has(lcWords[i])).join(" ").trim();
    if (objText) {
      const kind = mention ? "mentions" : "where";
      return { shape: kind, entityType: null, modifier: "direct", kind, object: objText };
    }
  }
  // has/have/had-changed carve-out ("has X changed"): routed before the general
  // verb scan because has/have/had is ALSO the `defines` verb and would otherwise
  // misread this as a defines query; gated on the sentence's own final word being
  // a genuine touches verb.
  const PERFECT_AUX = new Set(["has", "have", "had"]);
  if (PERFECT_AUX.has(lcWords[0])) {
    let end = lcWords.length;
    while (end > 1 && (lcWords[end - 1] === "ever" || lcWords[end - 1] === "been")) end -= 1;
    const tailVerb = end > 1 ? VERB_TO_KIND[lcWords[end - 1]] : null;
    if (tailVerb === "touches") {
      const objText = words.slice(1, end - 1).filter((_, j) => !STOPWORDS.has(lcWords[1 + j])).join(" ").trim();
      if (objText) return { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText };
    }
  }
  let canonWords = lcWords;
  let verbHit = findPhrase(lcWords, VERB_TO_KIND);
  if (!verbHit && nlp) {
    // tier 2: lemma (see the tier doc above) — replace only when the lemma is
    // itself vocabulary, so unknown words ("myfile") pass through untouched.
    const lemmaWords = lcWords.map((w) => {
      if (!eligibleForCanon(w)) return w;
      const l = nlp.lemma(w);
      return VOCAB_WORDS.has(l) ? l : w;
    });
    verbHit = findPhrase(lemmaWords, VERB_TO_KIND);
    if (verbHit) canonWords = lemmaWords;
  }
  if (!verbHit) {
    // tier 3: bounded-edit-distance rewrite toward verb/modifier keywords only
    // ("impotr" -> "import"); ≥4-char words only — below that the bound covers
    // half of English (and "and" is 1 edit from the "land in" constituent).
    const fuzzyWords = lcWords.map((w) => (w.length >= 4 && eligibleForCanon(w) ? fuzzyVocabWord(w) || w : w));
    verbHit = findPhrase(fuzzyWords, VERB_TO_KIND);
    if (verbHit) canonWords = fuzzyWords;
  }
  if (!verbHit && lcWords.includes("by")) {
    // A participle with no active verb entry still marks a passive when a passive
    // auxiliary and an agent "by" are both present.
    for (let i = 0; i < lcWords.length; i += 1) {
      const k = PASSIVE_PARTICIPLE_TO_KIND[lcWords[i]];
      if (k && lcWords.slice(0, i).some((w) => PASSIVE_AUX.has(w))) { verbHit = { kind: k, start: i, end: i + 1 }; break; }
    }
  }
  if (!verbHit) return null;
  // POS rescue (Node-side only): a relation word used as a NOUN in a "the
  // <imports> of <term>" frame would otherwise misparse; only fires inside this
  // exact det+NOUN+"of" shape, since the same word tags NOUN in genuine verb use too.
  if (nlp && verbHit.end - verbHit.start === 1) {
    const i = verbHit.start;
    const det = lcWords[i - 1];
    if ((det === "the" || det === "these" || det === "those") && lcWords[i + 1] === "of") {
      const tags = nlp.posTags(words);
      if (tags[i] === "NOUN") {
        const objText = words.slice(i + 2).filter((w, j) => !STOPWORDS.has(lcWords[i + 2 + j])).join(" ").trim();
        if (objText) return { shape: "forward", entityType: null, modifier: "direct", kind: verbHit.kind, object: objText };
      }
    }
  }
  const consumed = new Set();
  const mark = (hit) => { if (hit) for (let i = hit.start; i < hit.end; i += 1) consumed.add(i); };
  mark(verbHit);
  // A redundant same-kind verb restating the first ("what TESTS cover X") would
  // otherwise corrupt the object; strip it, anchored right after verbHit.
  for (const [phrase, kind] of Object.entries(VERB_TO_KIND)) {
    if (kind !== verbHit.kind) continue;
    const pWords = phrase.split(" ");
    const start = verbHit.end;
    if (pWords.every((w, j) => canonWords[start + j] === w)) { mark({ start, end: start + pWords.length }); break; }
  }
  const entityHit = findPhrase(canonWords, ENTITY_TO_TYPE, consumed);
  mark(entityHit);
  const modifierHit = findPhrase(canonWords, MODIFIER_TO_KIND, consumed);
  mark(modifierHit);
  const sideText = (from, to) => words
    .slice(from, to)
    .filter((_, j) => !consumed.has(from + j) && !STOPWORDS.has(lcWords[from + j]))
    .join(" ")
    .trim();
  const beforeText = sideText(0, verbHit.start);
  const afterText = sideText(verbHit.end, words.length);
  const kind = verbHit.kind;
  // slices read canonWords, not lcWords: the entity/modifier spans were matched
  // against the canonicalized array, whose word IS the table key.
  const entityType = entityHit ? ENTITY_TO_TYPE[canonWords.slice(entityHit.start, entityHit.end).join(" ")] : null;
  const modifier = modifierHit ? MODIFIER_TO_KIND[canonWords.slice(modifierHit.start, modifierHit.end).join(" ")] : "direct";

  // "when" turns a touches decomposition temporal; other verbs fall through.
  if (kind === "touches" && lcWords.includes("when")) {
    const objText = beforeText || afterText;
    if (objText) return { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText };
  }

  // "who last touched X" would otherwise list every touching commit's author,
  // ignoring "last" — checked directly against lcWords since both words are
  // stopwords and wouldn't survive into beforeText/afterText.
  if (kind === "touches" && lcWords.includes("who") && lcWords.includes("last")) {
    const objText = beforeText || afterText;
    if (objText) return { shape: "whoLast", entityType: null, modifier: "direct", kind: "touches", object: objText };
  }

  // Reversible passive ("PATIENT is VERBed BY AGENT"): a passive auxiliary plus a
  // standalone agent-marking "by" (not already swallowed into a multi-word verb
  // phrase) flips subject/object; whether the agent is named or questioned picks
  // forward vs. reverse.
  const byIdx = lcWords.indexOf("by");
  const hasPassiveAux = lcWords.slice(0, verbHit.start).some((w) => PASSIVE_AUX.has(w));
  if (byIdx >= 0 && !consumed.has(byIdx) && hasPassiveAux) {
    const roleWords = [];
    for (let i = 0; i < words.length; i += 1) {
      const w = lcWords[i];
      if (consumed.has(i) || STOPWORDS.has(w) || w === "by" || PASSIVE_AUX.has(w)
        || WH_WORDS.has(w) || PLACEHOLDER_SET.has(w)) continue;
      roleWords.push(words[i]);
    }
    const object = roleWords.join(" ").trim();
    if (object) {
      // the first meaningful token after "by" (skipping only articles) decides direction:
      // a wh-word or nothing → the agent is questioned (reverse over the named patient);
      // a named token → the agent is given (forward from it).
      let nextAfterBy = null;
      for (let i = byIdx + 1; i < lcWords.length; i += 1) {
        if (lcWords[i] === "the" || lcWords[i] === "a" || lcWords[i] === "an") continue;
        nextAfterBy = lcWords[i]; break;
      }
      const agentNamed = nextAfterBy != null && !WH_WORDS.has(nextAfterBy) && !ENTITY_TO_TYPE[nextAfterBy];
      return { shape: agentNamed ? "forward" : "reverse", entityType, modifier, kind, object };
    }
  }

  if (beforeText && afterText) {
    // A semantically-reverse verb ("superclass of") swaps subject/object, same as
    // grammar.mjs's T1.
    const verbPhrase = canonWords.slice(verbHit.start, verbHit.end).join(" ");
    let subject = beforeText;
    let object = afterText;
    if (INHERITS_REVERSE_VERBS.includes(verbPhrase)) [subject, object] = [object, subject];
    return { shape: "ask", entityType: null, modifier: "direct", kind, subject, object };
  }
  if (afterText) return { shape: "reverse", entityType, modifier, kind, object: afterText };
  // "what is a kind of class": when the object is itself an entity-type noun, the
  // entity match swallows the whole post-verb span as a grain qualifier, leaving
  // afterText empty — re-read that span as the object instead.
  if (kind === "inherits" && !beforeText && entityHit && entityHit.start === verbHit.end) {
    const entityText = canonWords.slice(entityHit.start, entityHit.end).join(" ");
    if (entityText) return { shape: "reverse", entityType: null, modifier, kind, object: entityText };
  }
  // forward keeps the spotted entityType (traverse()'s commit-as-subject grain
  // selection); modifier stays hardcoded since no forward closure traversal exists.
  if (beforeText) return { shape: "forward", entityType, modifier: "direct", kind, object: beforeText };
  return null;
}

/** Pipeline registration (interpret/pipeline.mjs): keyword-spotting as a
 *  strategy. Class "graph-query" — shared with the anchored grammar, so the two
 *  merge (agree/disagree) exactly as the legacy two-way merge did. Confidence
 *  0.7: a decomposition is looser evidence than a full-template match. The
 *  lemma/POS adapter arrives via ctx.nlp (the pipeline's default is the same
 *  Node-only wink adapter ask.mjs picks up). */
export const keywordSpotStrategy = {
  id: "keyword-spot",
  class: "graph-query",
  run(text, ctx = {}) {
    const parsed = parseKeywordSpot(text, ctx.nlp || null);
    return parsed
      ? { strategyId: "keyword-spot", class: "graph-query", candidates: [{ parsed, confidence: 0.7 }] }
      : null;
  },
};
