// corpus/unknown-ingest.mjs — context-preserving ingestion for unknown terms.
//
// `toFacts()` (conceptnet.mjs) skips a row whose relation isn't axiom-worthy
// (`ace === "none"`, e.g. RelatedTo/Synonym/HasContext), which is right for the axiom
// graph but leaves a term that only ever appears in such a row with no anchor in memory
// at all. This module captures those terms as a separate, honestly-labelled kind of
// individual: a term is "unknown" if it's never been the subject/object of any reified
// Fact (in memory already, or in this same seeding batch). Each captured term gets a
// `mgx:contextPassage` fact (the passage it was found in — ConceptNet's own surfaceText,
// or the map's `surface` template) and `mgx:coOccursWith` links to its row's other
// endpoint plus any already-known terms recognizable in the same passage (bounded) —
// closed-vocabulary co-occurrence.
//
// Wired as an opt-in `captureUnknownContext: true` on seedMemory (conceptnet.mjs),
// dynamically imported to avoid a load-time cycle with conceptnet.mjs.

import { appendFacts, loadMemory, normFactTerm, FACT_CLASS } from "../memory/core.mjs";
import { termText } from "./conceptnet.mjs";

/** unknown term -> the passage it was captured from. */
export const CONTEXT_PASSAGE_PREDICATE = "mgx:contextPassage";
/** term -> another term seen in the SAME passage — no relation-type inference. */
export const CO_OCCURS_PREDICATE = "mgx:coOccursWith";

// Function words filtered out of passage word/bigram scanning (a "the"<->term edge
// would be noise, not context). Closed, small, hand-curated.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "being", "been",
  "to", "of", "for", "in", "on", "at", "with", "by", "as", "and", "or",
  "that", "this", "it", "its", "you", "your", "related", "kind", "used",
]);

const MAX_EXTRA_LINKS_PER_PASSAGE = 3; // bounded — not an open-ended sweep

/** The set of terms tmct already "recognizes": every subject/object across every
 *  reified Fact in memory, union every term this batch's mapped facts introduce. Pure. */
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

/** The human-readable context passage for one dropped assertion — ConceptNet's own
 *  `surfaceText` (bracket-stripped) when present, else the map's `surface` template
 *  filled with the two endpoint terms. Returns null when neither is available. */
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

/** Single words + adjacent bigrams in `passage` that are already-known terms, excluding
 *  `exclude` (the row's own two endpoints). Bounded to MAX_EXTRA_LINKS_PER_PASSAGE hits. */
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
 * Capture unknown terms out of the assertions a corpus-seeding batch is about to (or
 * just did) write. Scans only rows whose relation maps to `ace = "none"`.
 *
 * { assertions, map, mappedFacts, memory?, provenancePrefix?, limit? }: assertions/map are
 * the same loadSlice()/loadMap() results seedMemory has; mappedFacts is this batch's
 * toFacts() output; memory defaults to loadMemory(dir); limit (default 500) caps distinct
 * unknown terms captured per call.
 *
 * Returns { captured, linked, appended, skipped }.
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
