// interpret/strategies/grammar.mjs — strategy 1: the anchored-template grammar,
// extracted MOVE-only from ask.mjs (item 13). The original P0 grammar: the whole
// (normalized) string must match one of TEMPLATES start-to-end, in fixed
// precedence order; first fit wins, never ambiguous at the template level (a
// question matching two shapes is a design smell we test against). Unweakened.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  META_MEANING_VERBS, WHERE_MARKERS, MENTION_MARKERS,
} from "../../ask-vocab.mjs";
import { escapeRegex } from "../normalize.mjs";

const VERB_ALT = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
const ENTITY_ALT = Object.keys(ENTITY_TO_TYPE).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
const MODIFIER_ALT = Object.keys(MODIFIER_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
const META_ALT = META_MEANING_VERBS.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");

const TEMPLATES = [
  // T1 ASK: "does X import Y" / "is X a subclass of Y" -> Yes/No. Tried FIRST: it starts with
  // does/is/do/did, which the reverse/forward templates below never match (those start with
  // which/what), so precedence between T1 and the rest is structural, not a tie-break guess.
  // "did" joins does/do for the past-tense commit forms ("did commit <sha> touch X").
  {
    name: "ask",
    re: new RegExp(`^(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
    build: (m) => ({
      shape: "ask", entityType: null, modifier: "direct",
      kind: VERB_TO_KIND[m[2].toLowerCase()], subject: m[1].trim(), object: m[3].trim(),
    }),
  },
  // T2 reverse: "which <entity> [<modifier>] <verb> <object>" — the operator's own example shape.
  {
    name: "reverse",
    re: new RegExp(`^which\\s+(${ENTITY_ALT})\\s+(?:(${MODIFIER_ALT})\\s+)?(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
    build: (m) => ({
      shape: "reverse",
      entityType: ENTITY_TO_TYPE[m[1].toLowerCase()],
      modifier: m[2] ? MODIFIER_TO_KIND[m[2].toLowerCase()] : "direct",
      kind: VERB_TO_KIND[m[3].toLowerCase()],
      object: m[4].trim(),
    }),
  },
  // T3 forward: "what does <object> <verb>" — X is given, list its R-related things.
  // "did" joins does/do for the past-tense commit forms ("what did commit <sha> touch").
  {
    name: "forward",
    re: new RegExp(`^what\\s+(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\??$`, "i"),
    build: (m) => ({
      shape: "forward", entityType: null, modifier: "direct",
      kind: VERB_TO_KIND[m[2].toLowerCase()], object: m[1].trim(),
    }),
  },
  // T4 meta: "what does <term> mean" — a question about the GRAPH'S OWN VOCABULARY
  // (a SchemaClass/SchemaPredicate label, e.g. "cochange", or a raw prop token, e.g.
  // "mgx:callsSymbol"), not a graph traversal over code edges. Tried after T3: T3 also
  // starts "what does/do", but T3 only fires when the tail is a relation VERB_ALT
  // phrase ("import"/"calls"/…), which "mean"/"means"/etc never are (disjoint tables —
  // ask-vocab.mjs's file comment explains why they're kept separate), so the two never
  // actually compete for the same input.
  {
    name: "meta-mean",
    re: new RegExp(`^what\\s+(?:does|do|is|are)\\s+(.+?)\\s+(?:${META_ALT})\\??$`, "i"),
    build: (m) => ({ shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: m[1].trim() }),
  },
  // T5 meta: "what is a/an <term>" — the OTHER worked phrasing ("what is a Commit").
  // The indefinite article is REQUIRED (not optional): a bare "what is <anything>"
  // would also swallow "what is the meaning of this codebase" (an existing, deliberately
  // honest grammar-miss regression case — ask.test.mjs/ask-dual-strategy.test.mjs both
  // assert it stays null), which never mentions "a"/"an" before its tail. Requiring the
  // article keeps this template's reach to the one worked shape without reopening that.
  {
    name: "meta-whatis",
    re: new RegExp(`^what\\s+(?:is|are)\\s+(?:an?)\\s+(.+?)\\??$`, "i"),
    build: (m) => ({ shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: m[1].trim() }),
  },
  // T6 mention: "where is <term> mentioned/referenced" — the prose/mentions surface
  // (2026-07-02 query families). Tried BEFORE T7: T7's trailing marker is optional,
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
