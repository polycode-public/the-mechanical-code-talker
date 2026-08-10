// retrieval-marker.mjs — the trailing line an answer carries when a corpus
// retrieval stood behind it, or when one was supposed to and did not.
//
// A bounded retrieval reads a slice of the corpus, never the whole of it. A
// point answer is unaffected: it either grounds on what came back or misses.
// An answer that reports the extent of a set is different. Reporting the
// slice's contents as the store's would be a completeness claim nothing
// checked, so those answers say what they counted over.
//
// Three states, three fixed lines. The wording is written once here and pinned
// byte for byte, because it lands in prose a reader judges the whole product
// by.

import { SUPPLEMENTED_MODE, SEED_SESSION_MODE } from "./retrieval-modes.mjs";

export { SUPPLEMENTED_MODE, SEED_SESSION_MODE };

/** Retrieval ran and nothing stopped it early. */
export const CORPUS_SCOPE_LINE = "Corpus scope: the rows this query pulled from the corpus.";

/** Retrieval ran and a budget stopped it, or a read failed. Over a dense
 *  corpus this is the ordinary case rather than the exception — the
 *  subClassOf closure branches, so a grounded turn spends its query budget
 *  and comes back with a prefix. The line reads as a routine statement of
 *  scope for that reason. */
export const CORPUS_SCOPE_BOUNDED_LINE = "Corpus scope: the rows this query pulled from the corpus. The corpus may hold more.";

/** No corpus read happened while bands were configured — the breaker is open,
 *  so the turn answered from the bundled seed and the session alone. Under
 *  that floor this line is the reader's only signal that a thin answer came
 *  from the degraded mode, so it rides every answer, not only the ones that
 *  count a set. */
export const CORPUS_SUPPLEMENT_ABSENT_LINE = "Corpus scope: none. Answered without the corpus supplement.";

/** The enumeration-class lanes: the answers that report a set's extent, and so
 *  have to say what they counted over.
 *
 *  Every entry is referenced from the composer that mints it, and the lane
 *  inventory test holds that both ways — a registered lane no composer sets is
 *  dead, and a composer naming a lane that is not registered is a lane nobody
 *  classified. */
export const ENUMERATION_LANES = Object.freeze({
  /** "how many facts do you know" — a tally of a memory-store kind. */
  MEMORY_COUNT: "memory-count",
  /** "list facts" / "how many sessions are there" — the stored individuals. */
  MEMORY_CLASS: "memory-class",
  /** "which words have a p in them" — the store's own vocabulary, filtered. */
  LETTER_WORDS: "letter-words",
  /** "list the letters in the alphabet" — a declared collection's contents. */
  COLLECTION_CONTENTS: "collection-contents",
  /** "how many animals are there" — a taught class's members, tallied. */
  TAUGHT_CLASS_COUNT: "taught-class-count",
  /** "list the animals" — a taught class's members, named. */
  MEMBERSHIP_LIST: "membership-list",
  /** "name an animal" — one member, and a count of the rest. */
  MEMBERSHIP_EXAMPLE: "membership-example",
  /** "another word for dog" — the remembered synonym neighbourhood. */
  SKOS_NEIGHBOURHOOD: "skos-neighbourhood",
  /** "what else about a dog" — everything past the primary definition. */
  WHAT_ELSE: "what-else",
  /** "which animals can fly" and its siblings, read out of the fact store. */
  FACT_SET: "fact-set",
  /** "what did you learn about dogs" — the read-back cascade's listings. */
  FACT_READBACK: "fact-readback",
});

const REGISTERED_LANES = Object.freeze(Object.values(ENUMERATION_LANES));

/** Is this a lane name the registry knows? */
export function isEnumerationLane(lane) {
  return typeof lane === "string" && REGISTERED_LANES.includes(lane);
}

/** Does this answer report the extent of a set?
 *
 *  A truncated listing does by definition — it is holding a remainder. So does
 *  any answer that renders more than one fact line: two lines are a set, and a
 *  reader takes them as everything there was. One line is a point answer and
 *  changes nothing.
 *
 *  The fact-store lanes derive their marker through this rather than tagging
 *  each of their twenty-odd return sites, which means a reader added to those
 *  cascades later is covered the moment it renders a set. */
export function answerAssertsASet(text, { pending = null } = {}) {
  if (pending) return true;
  return String(text ?? "").split("\n").filter((line) => line.trim() !== "").length > 1;
}

/** The retrieval context in the shape the marker reads, or null when the
 *  caller passed none. Accepts `retrieveSubgraph`'s own metrics object
 *  unchanged, and the smaller `{mode, bounded, bands}` literal a handler may
 *  build by hand. Anything without a recognised mode reads as no context, so a
 *  malformed input can never mint a marker. */
export function retrievalContextOf(input) {
  if (!input || typeof input !== "object") return null;
  const mode = input.mode;
  if (mode !== SUPPLEMENTED_MODE && mode !== SEED_SESSION_MODE) return null;
  return {
    mode,
    bounded: Boolean(input.bounded),
    bands: Array.isArray(input.bands) ? input.bands : [],
  };
}

/** The trailing line this turn's answer carries, or null for no line.
 *
 *  No context at all means no line, which is what every caller that never
 *  retrieves gets: the local shell, the browser page, every existing test.
 *
 *  A seed-session turn with no bands configured is not a degraded mode, it is
 *  a deployment without a corpus, so it says nothing either. */
export function retrievalMarkerLine(retrieval, { enumerationLane = null } = {}) {
  const context = retrievalContextOf(retrieval);
  if (!context) return null;
  if (context.mode === SEED_SESSION_MODE) {
    return context.bands.length ? CORPUS_SUPPLEMENT_ABSENT_LINE : null;
  }
  if (!isEnumerationLane(enumerationLane)) return null;
  return context.bounded ? CORPUS_SCOPE_BOUNDED_LINE : CORPUS_SCOPE_LINE;
}
