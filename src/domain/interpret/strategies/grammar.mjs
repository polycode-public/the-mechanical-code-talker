// interpret/strategies/grammar.mjs — strategy 1: the anchored-template grammar,
// extracted MOVE-only from ask.mjs (item 13). The original P0 grammar: the whole
// (normalized) string must match one of TEMPLATES start-to-end, in fixed
// precedence order; first fit wins, never ambiguous at the template level (a
// question matching two shapes is a design smell we test against). Unweakened.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  META_MEANING_VERBS, WHERE_MARKERS, MENTION_MARKERS,
  readConverse, stripTrailingScopeFiller, stripTrailingDiscourseTag,
  ARTICLE_RELATION_CONTINUATIONS, HAS_FAMILY_VERBS,
} from "../../ask-vocab.mjs";
import { escapeRegex } from "../normalize.mjs";

const VERB_ALT = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
const ENTITY_ALT = Object.keys(ENTITY_TO_TYPE).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
const MODIFIER_ALT = Object.keys(MODIFIER_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
const META_ALT = META_MEANING_VERBS.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");

// See ask-vocab.mjs's own HAS_FAMILY_VERBS for why a bare have-family verb
// never resolves to `defines` in this template's "ask"/"reverse"/"forward"
// shapes below.
const isHasFamilyDefines = (kind, verb) => kind === "defines" && HAS_FAMILY_VERBS.has(verb);

const TEMPLATES = [
  // T1 ASK: "does X import Y" -> Yes/No. A converse verb ("superclass of",
  // "belongs to") states the relation from its object's side, so readConverse
  // (ask-vocab.mjs) swaps subject/object here at parse time.
  {
    name: "ask",
    re: new RegExp(`^(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
    build: (m) => {
      const verb = m[2].toLowerCase();
      const kind = VERB_TO_KIND[verb];
      if (isHasFamilyDefines(kind, verb)) return null;
      return readConverse({
        shape: "ask", entityType: null, modifier: "direct", kind,
        subject: m[1].trim(), object: m[3].trim(),
      }, verb);
    },
  },
  // T2 reverse: "which <entity> [<modifier>] <verb> <object>". A converse verb
  // turns the same sentence into a forward read off the named object, keeping
  // the asked entity filter.
  {
    name: "reverse",
    re: new RegExp(`^which\\s+(${ENTITY_ALT})\\s+(?:(${MODIFIER_ALT})\\s+)?(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
    build: (m) => {
      const verb = m[3].toLowerCase();
      const kind = VERB_TO_KIND[verb];
      if (isHasFamilyDefines(kind, verb)) return null;
      return readConverse({
        shape: "reverse",
        entityType: ENTITY_TO_TYPE[m[1].toLowerCase()],
        modifier: m[2] ? MODIFIER_TO_KIND[m[2].toLowerCase()] : "direct",
        kind,
        object: m[4].trim(),
      }, verb);
    },
  },
  // T3 forward: "what does <object> <verb>" — X is given, list its R-related things.
  // "did" joins does/do for the past-tense commit forms ("what did commit <sha> touch").
  {
    name: "forward",
    re: new RegExp(`^what\\s+(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\??$`, "i"),
    build: (m) => {
      const verb = m[2].toLowerCase();
      const kind = VERB_TO_KIND[verb];
      if (isHasFamilyDefines(kind, verb)) return null;
      return readConverse({ shape: "forward", entityType: null, modifier: "direct", kind, object: m[1].trim() }, verb);
    },
  },
  // T4 meta: "what does <term> mean" — a question about the graph's own vocabulary,
  // not a graph traversal. VERB_ALT and META_ALT are disjoint tables, so this never
  // competes with T3 for the same input.
  {
    name: "meta-mean",
    re: new RegExp(`^what\\s+(?:does|do|is|are)\\s+(.+?)\\s+(?:${META_ALT})\\??$`, "i"),
    build: (m) => ({ shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: m[1].trim() }),
  },
  // T5 meta: "what is a/an <term>" — the bare (no-article) form is restricted to
  // the closed ENTITY_TO_TYPE vocabulary (build() -> null otherwise, falling
  // through); the WITH-article form is unrestricted. A "the"-article form is
  // ALSO accepted, but only for a single-token term ("the Task") — the same
  // schema-then-code-entity lookup a bare "Task" would reach (traverse()'s
  // shape:"meta" handling, via metaFallbackEntityAnswer). Multi-word "the …"
  // phrases stay excluded on purpose: "what is the meaning of this codebase"/
  // "the purpose of X" are existential framings with their own decline
  // elsewhere, never a literal term to look up (see the out-of-grammar test
  // this guards).
  {
    name: "meta-whatis",
    re: new RegExp(`^what\\s+(?:is|are)\\s+(?:(an?|the)\\s+)?(.+?)\\??$`, "i"),
    build: (m) => {
      const article = m[1] ? m[1].toLowerCase() : null;
      const object = stripTrailingDiscourseTag(m[2].trim());
      const isSingleToken = !/\s/.test(object);
      if (article === "the" && !isSingleToken) return null;
      if (!article && !ENTITY_TO_TYPE[object.toLowerCase()]) return null; // bare form: closed-set only
      const objLower = object.toLowerCase();
      // "what is a kind/subclass of X" is an inherits phrasing, not a term to
      // define — ARTICLE_RELATION_CONTINUATIONS only ever derives from the
      // "is a/an <continuation>" verb forms, so it's checked only for those;
      // "the"-definite reverse-inherits forms ("is the superclass of") are a
      // separate, deliberately unfolded set (ask-vocab.mjs's own comment on
      // INHERITS_REVERSE_VERB_LIST) — moot here since those are always
      // multi-word and already excluded by the single-token check above, but
      // named for the same reason ARTICLE_RELATION_CONTINUATIONS is.
      if (article && article !== "the" && ARTICLE_RELATION_CONTINUATIONS.some(
        (c) => objLower === c || objLower.startsWith(`${c} `),
      )) return null;
      return { shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: stripTrailingScopeFiller(object) };
    },
  },
  // T6 mention: "where is <term> mentioned/referenced" — the prose/mentions surface.
  // Tried BEFORE T7: T7's trailing marker is optional,
  // so without this ordering it would swallow the mention question and lose the
  // marker that distinguishes "locate the definition" from "list the prose mentions".
  {
    name: "mention",
    re: new RegExp(`^where\\s+(?:is|are|was|were)\\s+(.+?)\\s+(?:${MENTION_MARKERS.map(escapeRegex).join("|")})\\??$`, "i"),
    build: (m) => ({ shape: "mentions", entityType: null, modifier: "direct", kind: "mentions", object: m[1].trim() }),
  },
  // T7 where: "where is <term> [defined|declared|located|implemented]" — definition
  // location off the site attribute / defining module. "where" starts no other
  // template, so precedence against T1-T5 is structural.
  {
    name: "where",
    re: new RegExp(`^where\\s+(?:is|are|was|were)\\s+(.+?)(?:\\s+(?:${WHERE_MARKERS.map(escapeRegex).join("|")}))?\\??$`, "i"),
    build: (m) => ({ shape: "where", entityType: null, modifier: "direct", kind: "where", object: m[1].trim() }),
  },
  // T8 when: "when did <term> [last] change/touched/updated…" — temporal shape over
  // the touches edges + commit date attributes. The verb slot reuses VERB_ALT, but
  // only the touches family carries dates to answer with, so build() rejects any
  // other kind (returning null falls through — parseAnchored tolerates it) rather
  // than pretending "when did X import Y" has a temporal answer.
  {
    name: "when",
    re: new RegExp(`^when\\s+(?:did|does|do|was|were|is)\\s+(.+?)\\s+(?:last\\s+)?(${VERB_ALT})\\??$`, "i"),
    build: (m) => (VERB_TO_KIND[m[2].toLowerCase()] === "touches"
      ? { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() }
      : null),
  },
  // T9 commit-history NP: "the commit history of X" / "commit history for X" —
  // an NP form of T8's SAME "when did X change" intent; reuses shape="when"
  // verbatim so evaluation/rendering are byte-identical, only the recognizer
  // surface differs.
  {
    name: "commit-history",
    re: /^(?:the\s+)?commit\s+history\s+(?:of|for)\s+(.+?)\??$/i,
    build: (m) => ({ shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() }),
  },
  // T10 cochange-partners NP: "cochange partners of X" — an NP form of the
  // existing "which modules cochange with X" verb-phrase shape (ask-vocab.mjs's
  // cochange verb table); reuses shape="reverse"/kind="cochange" so evaluation
  // is byte-identical.
  {
    name: "cochange-partners",
    re: /^co-?change\s+partners\s+(?:of|for|with)\s+(.+?)\??$/i,
    build: (m) => ({ shape: "reverse", entityType: "Module", modifier: "direct", kind: "cochange", object: m[1].trim() }),
  },
];

/** Strategy 1: the original P0 anchored grammar — the whole (normalized) string
 *  must match one of TEMPLATES start-to-end. A build() may return null to reject
 *  a structural match on curated grounds (T8's non-temporal verbs); the scan then
 *  simply continues, exactly as if the regex had not matched. Pure. */
export function parseAnchored(text) {
  for (const t of TEMPLATES) {
    const m = text.match(t.re);
    if (m) {
      const parsed = t.build(m);
      if (parsed) return parsed;
    }
  }
  return null;
}

/** Pipeline registration (interpret/pipeline.mjs): the anchored grammar as a
 *  strategy. Class "graph-query" — shared with keyword-spot, so the two merge
 *  (agree/disagree) exactly as the legacy two-way merge did. Confidence 0.9:
 *  the highest of the registered strategies (a full-sentence template match is
 *  the engine's most precise evidence), which also makes "graph-query" the
 *  winning class whenever this strategy fires. */
export const grammarStrategy = {
  id: "grammar",
  class: "graph-query",
  run(text) {
    const parsed = parseAnchored(text);
    return parsed
      ? { strategyId: "grammar", class: "graph-query", candidates: [{ parsed, confidence: 0.9 }] }
      : null;
  },
};
