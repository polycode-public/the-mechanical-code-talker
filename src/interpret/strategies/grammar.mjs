// interpret/strategies/grammar.mjs — strategy 1: the anchored-template grammar,
// extracted MOVE-only from ask.mjs (item 13). The original P0 grammar: the whole
// (normalized) string must match one of TEMPLATES start-to-end, in fixed
// precedence order; first fit wins, never ambiguous at the template level (a
// question matching two shapes is a design smell we test against). Unweakened.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  META_MEANING_VERBS, WHERE_MARKERS, MENTION_MARKERS,
  INHERITS_REVERSE_VERBS, stripTrailingScopeFiller, stripTrailingDiscourseTag,
  ARTICLE_RELATION_CONTINUATIONS,
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
  // REVERSE VERB SWAP (Seonix Batch 2 Fix 2): this template fixes subject/object by regex
  // capture POSITION, not by the verb's semantic direction — fine for every forward verb
  // ("subclass of", "imports", …), but "is X a superclass of Y" MEANS the reverse of "is X
  // a subclass of Y" (Y inherits from X, not X from Y). INHERITS_REVERSE_VERBS (ask-vocab.mjs)
  // is the closed set of such reverse phrasings; when the matched verb is one of them,
  // subject/object are swapped here, once, at parse time — so downstream evaluation (ask.mjs)
  // sees "is Y a subclass of X" and needs zero changes of its own. (In practice this exact
  // regex only ever matches a does/do/did lead, so "is …" phrasings actually reach the "ask"
  // shape via keywords.mjs's decomposition strategy instead — that strategy applies the same
  // swap for the same reason; this branch is kept for any does/do/did-led phrasing that names
  // a reverse verb, and for structural symmetry with that sibling strategy.)
  {
    name: "ask",
    re: new RegExp(`^(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
    build: (m) => {
      const verb = m[2].toLowerCase();
      const kind = VERB_TO_KIND[verb];
      let subject = m[1].trim();
      let object = m[3].trim();
      if (INHERITS_REVERSE_VERBS.includes(verb)) [subject, object] = [object, subject];
      return { shape: "ask", entityType: null, modifier: "direct", kind, subject, object };
    },
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
  // Seonix Batch 2 Fix 1: the indefinite article is now OPTIONAL, but the BARE
  // (no-article) form is restricted to the CLOSED vocabulary ENTITY_TO_TYPE already
  // imported above (function/method/class/module/attribute/variable/change/commit,
  // singular and plural) — build() returns null (same "this template didn't actually
  // match, keep scanning" contract T8/"when" below already relies on — see
  // parseAnchored's own docblock) when the bare form's object isn't one of those
  // closed terms, so the scan falls through exactly as if this template had not
  // matched at all. This keeps "what is a doohickey"/"widget"/"gizmo" (still routed
  // here via the WITH-article, fully unrestricted `(.+?)` path — pinned to resolve as
  // an honest meta miss downstream, ask-combo.test.mjs/chat-readback.test.mjs) working
  // unmodified, while ALSO keeping the two pinned bare-form honest misses intact:
  // "what is the meaning of this codebase" (ask.test.mjs/ask-dual-strategy.test.mjs)
  // and "what is exposed" (ask.test.mjs:840) both have bare objects absent from
  // ENTITY_TO_TYPE, so build() still rejects them and they still fall through to null.
  // Fix 3: stripTrailingScopeFiller (ask-vocab.mjs) trims a curated trailing clause
  // ("what is a Module in this graph" -> "Module") off the object before it's
  // returned, so a scoping tail never corrupts the lookup term either the bare-form
  // check above or downstream resolution/rendering perform. HANDOVER.md 2026-07-10
  // item 8: stripTrailingDiscourseTag trims a bare trailing "then"/"though" the
  // same way ("what is a component then" -> "component") — applied first, since a
  // discourse tag sits outermost when both happen to stack.
  {
    name: "meta-whatis",
    re: new RegExp(`^what\\s+(?:is|are)\\s+(?:(an?)\\s+)?(.+?)\\??$`, "i"),
    build: (m) => {
      const object = stripTrailingDiscourseTag(m[2].trim());
      if (!m[1] && !ENTITY_TO_TYPE[object.toLowerCase()]) return null; // bare form: closed-set only
      // "what is a kind of X" / "what is a subclass of X" (ARTICLE_RELATION_CONTINUATIONS,
      // ask-vocab.mjs): the captured object is itself the tail of a registered inherits
      // verb's own "is a .../are a ..." phrasing, not a term to define — reject so this
      // template yields no candidate at all and only keyword-spot's (unambiguous) reverse-
      // inherits reading survives, instead of a spurious meta/inherits {ambiguousParse} tie.
      const objLower = object.toLowerCase();
      if (m[1] && ARTICLE_RELATION_CONTINUATIONS.some(
        (c) => objLower === c || objLower.startsWith(`${c} `),
      )) return null;
      return { shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: stripTrailingScopeFiller(object) };
    },
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
  // T9 commit-history NP (PLAN_CHAT_FEEL item 6 remainder): "the commit history of
  // X" / "commit history for X" — an NP form of T8's SAME "when did X change"
  // intent; reuses shape="when" verbatim so evaluation/rendering are byte-
  // identical, only the recognizer surface differs.
  {
    name: "commit-history",
    re: /^(?:the\s+)?commit\s+history\s+(?:of|for)\s+(.+?)\??$/i,
    build: (m) => ({ shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() }),
  },
  // T10 cochange-partners NP (PLAN_CHAT_FEEL item 6 remainder): "cochange partners
  // of X" — an NP form of the existing "which modules cochange with X" verb-phrase
  // shape (ask-vocab.mjs's cochange verb table); reuses shape="reverse"/
  // kind="cochange" so evaluation is byte-identical.
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
