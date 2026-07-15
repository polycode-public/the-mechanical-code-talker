// memory/shacl.mjs — SHACL-style ingest gate for tmct's own memory graph.
// Hand-rolled validator mirroring ontology/memory-shapes.ttl (kept in sync by
// hand) against memory/core.mjs's {id, label, class, attributes} shape — not
// wired to a real SHACL/RDF-JS engine (disproportionate deps for three closed
// shapes). Permissive beyond core.mjs's own structural floor: a violation
// only fires on genuine malformation, never a sparse-but-valid write.

const MEMORY_CLASSES = new Set(["Utterance", "Fact", "Session", "Source", "Rule"]);
const RULE_KINDS = new Set([
  "compose2", "filter", "recursive",
  "action-signature", "action-precond", "action-effect",
]);

// Mirrors core.mjs's own (unexported) RULE_SLOT_SPEC exactly — the single
// source of truth for the closed rule-kind shapes; kept in sync by hand
// (both describe the same kinds' slots).
const RULE_SLOT_PROPS = {
  compose2: ["mgx:ruleBase1", "mgx:ruleBase2"],
  filter: ["mgx:ruleBase1", "mgx:ruleFilterProperty"],
  recursive: ["mgx:ruleBaseCase", "mgx:ruleRecStep"],
  "action-signature": ["mgx:ruleActionSubjectClass", "mgx:ruleActionTargetClass"],
  "action-precond": [
    "mgx:ruleActionPrecondShape", "mgx:ruleActionPrecondPredicate",
    "mgx:ruleActionPrecondRole", "mgx:ruleActionPrecondScope",
  ],
  "action-effect": [
    "mgx:ruleActionEffectPredicate", "mgx:ruleActionEffectSubject", "mgx:ruleActionEffectObject",
  ],
};

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
  const prov = attrValue(ind, "mgx:factProvenance");
  if (prov !== undefined && !nonEmpty(prov)) violations.push("mgx:factProvenance, when present, must be non-empty");
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
