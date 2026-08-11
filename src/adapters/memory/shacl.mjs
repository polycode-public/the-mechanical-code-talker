// memory/shacl.mjs — SHACL-style ingest gate for tmct's own memory graph.
// Hand-rolled validator mirroring ontology/memory-shapes.ttl (kept in sync by
// hand) against memory/core.mjs's {id, label, class, attributes} shape — not
// wired to a real SHACL/RDF-JS engine (disproportionate deps for three closed
// shapes). Permissive beyond core.mjs's own structural floor: a violation
// only fires on genuine malformation, never a sparse-but-valid write.

const MEMORY_CLASSES = new Set(["Utterance", "Fact", "Session", "Source", "Rule"]);

// The closed vocabulary of structural findings an assertion record may carry —
// what the extractor observed about how it read the sentence, never a score.
// Only the findings that are KEPT live here: a decline reason names a candidate
// that was never stored, so it has no record to ride. A consumer declines by
// name, which is only testable on both sides of the seam if the names are a
// closed set, so an unlisted one is a violation rather than a pass-through.
export const EXTRACTION_FINDINGS = Object.freeze([
  "identifier-token",   // an endpoint's raw surface was an identifier, not a word
  "clause-fallback",    // the row grounded from a clause fragment after the whole sentence declined
  "pronoun-carry",      // the subject was substituted from the paragraph's pronoun carry
  "definitional-frame", // the row came from a definitional copula frame ("X is the name for Y")
]);
const EXTRACTION_FINDING_SET = new Set(EXTRACTION_FINDINGS);
const RULE_KINDS = new Set([
  "compose2", "filter", "recursive",
  "action-signature", "action-precond", "action-effect", "action-constraint",
]);

// Mirrors the REQUIRED subset of core.mjs's own (unexported) RULE_SLOT_SPEC —
// kept in sync by hand. Two kinds there also carry optional slots
// (RULE_SLOT_OPTIONAL: action-precond's value/negate, action-effect's
// objectRole/value) that deliberately do NOT appear here: this gate only
// checks genuine malformation (the comment above), and "at least one of
// objectRole/value" is a joint constraint core.mjs's own appendRule already
// enforces at write time, not a per-slot presence check this shape can express.
const RULE_SLOT_PROPS = {
  compose2: ["mgx:ruleBase1", "mgx:ruleBase2"],
  filter: ["mgx:ruleBase1", "mgx:ruleFilterProperty"],
  recursive: ["mgx:ruleBaseCase", "mgx:ruleRecStep"],
  "action-signature": ["mgx:ruleActionSubjectClass", "mgx:ruleActionTargetClass"],
  "action-precond": [
    "mgx:ruleActionPrecondShape", "mgx:ruleActionPrecondPredicate",
    "mgx:ruleActionPrecondRole", "mgx:ruleActionPrecondScope",
  ],
  "action-effect": ["mgx:ruleActionEffectPredicate", "mgx:ruleActionEffectSubject"],
  "action-constraint": [
    "mgx:ruleActionConstraintLeft", "mgx:ruleActionConstraintRight", "mgx:ruleActionConstraintGuard",
  ],
};

// A term that runs past a sentence terminator into the next sentence
// ("disk-2. disk-2 rests on disk-3") is a whole un-split line captured as one
// term, not a term. Requires the word character after the terminator, so an
// abbreviation or a version ("v1.2", "core.mjs") stays a legal term.
const SPANS_A_SENTENCE_BOUNDARY_RE = /[.!?]\s+\w/;

// A Fact record's id: the content-addressed group key, then the Source key this
// one assertion is filed under, then — only on a record its own source has since
// superseded — the version that demoted it. Checked only for the two SUFFIXES,
// never for the group part: a hand-built individual with a short opaque id is a
// legitimate sparse write, and rejecting it is exactly the false positive this
// gate must never produce. The source suffix is matched loosely on purpose — a
// Source id legitimately carries colons and spaces of its own
// ("src:corpus:mud:amber fox").
const FACT_RECORD_ID_RE = /^[^@]+@(.+?)(#v[1-9][0-9]*)?$/;
const looksLikeFactRecordId = (id) => id.includes("@") || /#v\d/.test(id);

// mgx:supersedes / mgx:supersededBy hold a space-joined id LIST, not a single
// value: one logical source can have two live replicas that each supersede the
// same prior record before they ever sync, so a fork is real data, not a bug.
const SUPERSESSION_LINK_PROPS = ["mgx:supersedes", "mgx:supersededBy"];

function attrValue(ind, prop) {
  const a = (ind?.attributes || []).find((x) => x?.prop === prop);
  return a ? String(a.value ?? "") : undefined;
}

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

/** IndividualShape (ontology/memory-shapes.ttl's mgx:IndividualShape): every
 *  memory node must carry a class from the closed memory-class vocabulary. */
function checkIndividual(ind, violations) {
  if (!ind?.class || !MEMORY_CLASSES.has(ind.class)) {
    violations.push(`must have a class from the closed vocabulary Utterance | Fact | Session | Source | Rule (got ${JSON.stringify(ind?.class)})`);
  }
}

/** FactShape (mgx:FactShape): the reified subject/predicate/object, each
 *  present and non-empty; mgx:factProvenance, WHEN PRESENT, must be
 *  non-empty (optional at this gate — appendFact's own API allows an
 *  empty/omitted provenance). */
function checkFact(ind, violations) {
  for (const prop of ["rdf:subject", "rdf:predicate", "rdf:object"]) {
    if (!nonEmpty(attrValue(ind, prop))) violations.push(`a Fact needs a non-empty ${prop}`);
  }
  for (const prop of ["rdf:subject", "rdf:object"]) {
    const term = attrValue(ind, prop);
    if (term !== undefined && SPANS_A_SENTENCE_BOUNDARY_RE.test(term)) {
      violations.push(`a Fact's ${prop} must be a single term, not text spanning a sentence boundary (got ${JSON.stringify(term)})`);
    }
  }
  const prov = attrValue(ind, "mgx:factProvenance");
  if (prov !== undefined && !nonEmpty(prov)) violations.push("mgx:factProvenance, when present, must be non-empty");

  const id = typeof ind?.id === "string" ? ind.id : "";
  if (looksLikeFactRecordId(id) && !FACT_RECORD_ID_RE.test(id)) {
    violations.push(`a Fact record id must read <groupId>@<sourceId>, optionally suffixed #v<n> once superseded (got ${JSON.stringify(id)})`);
  }
  const sourceId = attrValue(ind, "mgx:sourceId");
  if (sourceId !== undefined && !nonEmpty(sourceId)) {
    violations.push("mgx:sourceId, when present, must be non-empty (every assertion record has a key, src:none included)");
  }
  const observedAt = attrValue(ind, "mgx:observedAt");
  if (observedAt !== undefined && !Number.isFinite(Date.parse(observedAt))) {
    violations.push(`mgx:observedAt, when present, must be a parseable instant (got ${JSON.stringify(observedAt)})`);
  }
  const extraction = attrValue(ind, "mgx:extractionFinding");
  if (extraction !== undefined) {
    const found = extraction.split(" ").filter(Boolean);
    if (!found.length) violations.push("mgx:extractionFinding, when present, must name at least one finding");
    for (const finding of found) {
      if (!EXTRACTION_FINDING_SET.has(finding)) {
        violations.push(`mgx:extractionFinding must name findings from the closed vocabulary ${EXTRACTION_FINDINGS.join(" | ")} (got ${JSON.stringify(finding)})`);
      }
    }
  }
  for (const prop of SUPERSESSION_LINK_PROPS) {
    const links = attrValue(ind, prop);
    if (links === undefined) continue; // absent, never empty, until a chain's first supersession
    const ids = links.split(" ").filter(Boolean);
    if (!ids.length) violations.push(`${prop}, when present, must name at least one record id`);
    for (const linked of ids) {
      if (!FACT_RECORD_ID_RE.test(linked)) violations.push(`${prop} must name Fact record ids (got ${JSON.stringify(linked)})`);
    }
  }
}

/** RuleShape (mgx:RuleShape): a non-empty name; a kind from the closed
 *  vocabulary; and the matching slots for that declared kind, each present
 *  and non-empty (RULE_SLOT_PROPS above). */
function checkRule(ind, violations) {
  if (!nonEmpty(attrValue(ind, "mgx:ruleName"))) violations.push("a Rule needs a non-empty mgx:ruleName");
  const kind = attrValue(ind, "mgx:ruleKind");
  if (!kind || !RULE_KINDS.has(kind)) {
    violations.push(`a Rule's mgx:ruleKind must be one of ${[...RULE_KINDS].join(" | ")} (got ${JSON.stringify(kind)})`);
    return; // no declared kind to check slots against
  }
  for (const prop of RULE_SLOT_PROPS[kind]) {
    if (!nonEmpty(attrValue(ind, prop))) violations.push(`a ${kind} Rule needs a non-empty ${prop}`);
  }
}

/** Validate one memory individual ({id, label, class, attributes}) against
 *  the shapes ontology/memory-shapes.ttl documents. Pure, synchronous, no
 *  I/O. Returns { ok, violations: string[] }. */
export function validateIndividual(ind) {
  const violations = [];
  checkIndividual(ind, violations);
  if (ind?.class === "Fact") checkFact(ind, violations);
  if (ind?.class === "Rule") checkRule(ind, violations);
  return { ok: violations.length === 0, violations };
}

/** The ingest gate: throw a clear, aggregated error if `ind` violates the
 *  shape contract, so a malformed Fact/Rule never reaches mutateMemory's
 *  write. Synchronous, but safe to `await` — a sync throw inside an async
 *  caller still rejects its promise correctly. */
export function assertIndividualValid(ind) {
  const r = validateIndividual(ind);
  if (!r.ok) {
    const e = new Error(`SHACL validation failed for ${ind?.class} "${ind?.id}": ${r.violations.join(" | ")}`);
    e.violations = r.violations;
    throw e;
  }
}
