// corpus/unknown-ingest.mjs — context-preserving ingestion for unknown terms
// (PLAN_AGENTS.md §4 Phase 1, the "still not built at all" bullet).
//
// The problem this closes: `toFacts()` (conceptnet.mjs) only emits a Fact for
// a relation the ACE-OWL map marks axiom-worthy (`ace != "none"`) — a row
// whose relation is RelatedTo/Synonym/FormOf/SimilarTo/HasContext/etc is
// SILENTLY skipped (`if (row.ace === "none") continue;`), on purpose, because
// the relation itself doesn't fit a clean OWL axiom. That is the right call
// for the AXIOM graph, but it means a term that ONLY ever shows up in one of
// those dropped rows — never as the endpoint of a relation tmct actually
// reifies — has NO anchor in memory at all. A wider seed set (a broader
// ConceptNet slice, a tier-2 bundle, Phase 4's scraped web content) makes
// this common: real terms, genuinely mentioned, quietly vanishing.
//
// This module does NOT change what counts as an axiom. It adds a SEPARATE,
// honestly-labelled kind of individual for exactly the terms that would
// otherwise vanish: a term is "unknown" here if it has never been the
// subject/object of any reified Fact — not in memory already, and not in the
// mapped facts this same seeding batch is about to write. For each dropped
// (ace="none") row that touches an unknown term, the term becomes a Fact
// tagged with the PASSAGE it was found in (ConceptNet's own `surfaceText`
// when present, else the map's own `surface` template filled with the row's
// two endpoints — both are committed, closed-vocabulary text; nothing here
// ever generates free text), via a dedicated `mgx:contextPassage` predicate.
// The row's OTHER endpoint (always) plus any already-known term recognizable
// by exact word/bigram match in the passage (bounded to a handful) are linked
// to the unknown term via one plain, closed-vocabulary co-occurrence
// predicate, `mgx:coOccursWith` — deliberately NOT distributional/embedding
// meaning induction (PLAN_AGENTS.md's own scoping): this buys traceable
// context, never automatic sense disambiguation.
//
// Reuses src/memory/core.mjs's existing appendFacts/loadMemory/normFactTerm
// machinery unmodified — a captured term is a completely ordinary Fact
// individual (same trust/provenance/Source pipeline every other fact gets),
// just carrying two new-but-closed predicates instead of an ACE-OWL one.
//
// Wiring: `seedMemory` (conceptnet.mjs) accepts an opt-in
// `captureUnknownContext: true` (default false — every existing seed call
// stays byte-identical) that calls `ingestUnknownFromAssertions` after the
// mapped facts are computed, dynamically imported (the same "avoid a static
// import cycle" discipline extensions.mjs's seedActiveCorpusEntries already
// uses for conceptnet.mjs itself).
//
// NOT covered here (out of scope for this module, see the caller's report):
// the LIVE chat teach/miss path (src/chat.mjs) has its own, separate
// unknown-word moment — a visitor's utterance mentioning a term the grammar
// can't classify — which has no "assertion batch" or ConceptNet-shaped
// surfaceText to draw a passage from at all. That needs its own hook (the
// raw utterance text IS the passage there); this module only ever consumes
// {start, rel, end, surfaceText?} shaped rows, so it cannot be reused as-is
// for that path without a chat.mjs-side adapter. See the report for the
// exact shape that hook would need — deliberately not built here.

import { appendFacts, loadMemory, normFactTerm, FACT_CLASS } from "../memory/core.mjs";
import { termText } from "./conceptnet.mjs";

/** unknown term -> the passage it was captured from (object = the passage
 *  text itself, capped by normFactTerm's own TEXT_CAP like any fact term). */
export const CONTEXT_PASSAGE_PREDICATE = "mgx:contextPassage";
/** plain, undirected-in-spirit co-occurrence edge: term -> another term seen
 *  in the SAME passage. Deliberately the ONE relation this module ever
 *  emits for "these two showed up together" — no relation-type inference. */
export const CO_OCCURS_PREDICATE = "mgx:coOccursWith";

// Function words filtered out of passage word/bigram scanning — never
// candidates for a co-occurrence link (a "the"<->term edge would be noise,
// not context). Closed, small, hand-curated — not a general stopword list.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "being", "been",
  "to", "of", "for", "in", "on", "at", "with", "by", "as", "and", "or",
  "that", "this", "it", "its", "you", "your", "related", "kind", "used",
]);

const MAX_EXTRA_LINKS_PER_PASSAGE = 3; // bounded — not an open-ended sweep

/** The set of terms tmct already "recognizes": every subject/object across
 *  every reified Fact currently in memory, union every term the mapped facts
 *  THIS batch is about to write introduce. A term with a real Fact anywhere
 *  already has structured knowledge — only a term that never gets one is a
 *  candidate for context-only capture. Pure; does not mutate `memory`. */
export function knownTermsFrom(memory, mappedFacts) {
  const known = new Set();
  for (const ind of memory?.individuals || []) {
    if (ind?.class !== FACT_CLASS) continue;
    const get = (k) => (ind.attributes || []).find((a) => a?.key === k)?.value;
    const s = get("subject");
    const o = get("object");
    if (s) known.add(normFactTerm(s));
    if (o) known.add(normFactTerm(o));
  }
  for (const f of mappedFacts || []) {
    if (f?.subject) known.add(normFactTerm(f.subject));
    if (f?.object) known.add(normFactTerm(f.object));
  }
  return known;
}

/** The human-readable context passage for one DROPPED assertion — ConceptNet's
 *  own `surfaceText` (bracket-stripped) when present, else the mapping row's
 *  own `surface` template filled with the two endpoint terms. Both sources
 *  are committed, closed-vocabulary text — this never generates free text.
 *  Returns null when neither source is available (never fatal). */
export function passageFor(assertion, row) {
  const raw = assertion?.surfaceText;
  if (typeof raw === "string" && raw.trim()) {
    return raw.replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\s+/g, " ").trim();
  }
  const s = termText(assertion?.start);
  const o = termText(assertion?.end);
  if (row?.surface && s && o) {
    return row.surface.replace("{start}", s).replace("{end}", o);
  }
  return null;
}

/** Single words + adjacent bigrams in `passage` that are already-known terms
 *  (present in `known`), excluding anything in `exclude` (the row's own two
 *  endpoints — already linked directly). Bounded to
 *  MAX_EXTRA_LINKS_PER_PASSAGE hits; independent of `known`'s size (a Set
 *  lookup per token/bigram, never a substring sweep over every known term). */
function knownMentionsIn(passage, known, exclude) {
  const tokens = String(passage || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const hits = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length && hits.length < MAX_EXTRA_LINKS_PER_PASSAGE; i += 1) {
    const candidates = [tokens[i]];
    if (i + 1 < tokens.length) candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
    for (const c of candidates) {
      if (STOPWORDS.has(c) || seen.has(c) || exclude.has(c)) continue;
      if (known.has(c)) {
        hits.push(c);
        seen.add(c);
        if (hits.length >= MAX_EXTRA_LINKS_PER_PASSAGE) break;
      }
    }
  }
  return hits;
}

/**
 * Capture unknown terms out of the assertions a corpus-seeding batch is
 * about to (or just did) write. Scans only rows whose relation maps to
 * `ace = "none"` (the genuinely-dropped rows) — a mapped (ace != "none") row
 * always gets a real reified Fact via toFacts()/appendFacts() already, so it
 * is never a "silently dropped" case this module needs to rescue.
 *
 * { assertions, map, mappedFacts, memory?, provenancePrefix?, limit? }:
 *   - assertions/map: the SAME loadSlice()/loadMap() results seedMemory has.
 *   - mappedFacts: the toFacts() output for this same batch (feeds
 *     knownTermsFrom so a term this batch itself just defined isn't
 *     re-captured as "unknown").
 *   - memory: a pre-loaded payload (seedMemory already has one) — loaded
 *     fresh via loadMemory(dir) when omitted.
 *   - provenancePrefix: tags the captured facts, default "corpus:unknown".
 *   - limit: caps how many DISTINCT unknown terms get captured in one call
 *     (default 500) — a wide slice's RelatedTo rows alone number in the tens
 *     of thousands; this keeps one run bounded, not a flood.
 *
 * Returns { captured, linked, appended, skipped } — `captured` = distinct
 * unknown terms newly given a contextPassage fact, `linked` = co-occurrence
 * edges written (the direct pair plus any bounded extra known-term hits).
 */
export async function ingestUnknownFromAssertions(dir, {
  assertions, map, mappedFacts = [], memory, provenancePrefix = "corpus:unknown", limit = 500,
} = {}) {
  if (!Array.isArray(assertions) || !map) return { captured: 0, linked: 0, appended: 0, skipped: 0 };
  const mem = memory || await loadMemory(dir);
  const known = knownTermsFrom(mem, mappedFacts);
  const capturedTerms = new Set();
  const toWrite = [];

  for (const a of assertions) {
    if (capturedTerms.size >= limit) break;
    const row = map.get(a.rel);
    if (!row || row.ace !== "none") continue; // only the genuinely-dropped rows
    const subject = termText(a.start);
    const object = termText(a.end);
    if (!subject || !object) continue; // non-en endpoint — nothing to anchor a passage to
    const sKey = normFactTerm(subject);
    const oKey = normFactTerm(object);
    const subjectUnknown = !known.has(sKey);
    const objectUnknown = !known.has(oKey);
    if (!subjectUnknown && !objectUnknown) continue; // both sides already recognized

    const passage = passageFor(a, row);
    if (!passage) continue;

    const pairs = [[subject, object, subjectUnknown], [object, subject, objectUnknown]];
    for (const [term, other, isUnknown] of pairs) {
      if (!isUnknown || capturedTerms.size >= limit) continue;
      const termKey = normFactTerm(term);
      if (capturedTerms.has(termKey)) continue; // one context capture per term per run
      const tag = `${provenancePrefix} ${a.rel}`;
      toWrite.push({ subject: term, predicate: CONTEXT_PASSAGE_PREDICATE, object: passage, provenance: tag });
      toWrite.push({ subject: term, predicate: CO_OCCURS_PREDICATE, object: other, provenance: tag });
      const extra = knownMentionsIn(passage, known, new Set([sKey, oKey]));
      for (const m of extra) {
        toWrite.push({ subject: term, predicate: CO_OCCURS_PREDICATE, object: m, provenance: tag });
      }
      capturedTerms.add(termKey);
      known.add(termKey); // now recognized — a captured term is never re-captured
    }
  }

  if (!toWrite.length) return { captured: 0, linked: 0, appended: 0, skipped: 0 };
  const res = await appendFacts(dir, toWrite);
  const linked = toWrite.filter((f) => f.predicate === CO_OCCURS_PREDICATE).length;
  return { captured: capturedTerms.size, linked, appended: res.appended, skipped: res.skipped };
}
