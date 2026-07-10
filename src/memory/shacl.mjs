// memory/shacl.mjs — the declarative SHACL-STYLE ingest gate for tmct's own
// memory graph (PLAN_AGENTS.md §2.1 "Declarative SHACL ingest gate (c)").
//
// ontology/memory-shapes.ttl is the canonical, standards-based (SHACL/
// Turtle) declarative SPEC for these three shapes — written first, kept as
// the human-readable/auditable contract, modelled on marginalia's own
// app/ontology/shapes.ttl. This file is a small, HAND-ROLLED validator that
// implements exactly what that spec describes, in plain JS, against
// memory/core.mjs's own {id, label, class, attributes} individual shape.
//
// Deliberately NOT wired to a real SHACL/RDF-JS engine. `shacl-engine` +
// `rdf-ext` were tried first (the plan's named tooling, matching
// marginalia's own choice) and rejected on measurement: shacl-engine
// transitively pulls in `@comunica/query-sparql-rdfjs-lite` — a full
// federated SPARQL query engine — across 560+ packages (~7700 added
// package-lock.json lines), wildly disproportionate to tmct's "pure-JS,
// minimal-deps" floor (5 runtime deps before this) and to what three closed,
// bounded shapes actually need. `src/conformance.mjs` already proves this
// project is comfortable with imperative shape assertions instead of a
// general engine (a Repository-Interface contract-test suite, not a memory
// gate — a DIFFERENT thing from this file, see its own header); this module
// is the same discipline applied to memory-write validation. Keep
// ontology/memory-shapes.ttl and this file in sync BY HAND when either shape
// changes — the .ttl is documentation here, not machine-read.
//
// Every shape below is PERMISSIVE beyond memory/core.mjs's own existing
// structural floor (appendFact/appendRule already throw before ever reaching
// mutateMemory if subject/predicate/object or name/kind/slots are missing —
// this gate mirrors, not tightens, that floor) and treats every OPTIONAL
// attribute (provenance chief among them — appendFact's own signature
// defaults `provenance` to `""`, and real call sites/tests legitimately omit
// it, e.g. re-writing createdAt without re-asserting provenance) as OPTIONAL
// here too: a violation only fires on genuine structural malformation, never
// on a legitimately sparse-but-valid write or upsert of existing data.

const MEMORY_CLASSES = new Set(["Utterance", "Fact", "Session", "Source", "Rule"]);
const RULE_KINDS = new Set(["compose2", "filter", "recursive"]);

// Mirrors core.mjs's own (unexported) RULE_SLOT_SPEC exactly — the single
// source of truth for the closed compose2/filter/recursive shapes; kept in
// sync by hand (both describe the SAME three rule kinds' slot pairs).
const RULE_SLOT_PROPS = {
  compose2: ["mgx:ruleBase1", "mgx:ruleBase2"],
  filter: ["mgx:ruleBase1", "mgx:ruleFilterProperty"],
  recursive: ["mgx:ruleBaseCase", "mgx:ruleRecStep"],
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
 *  non-empty (optional at this gate — see file header on why: appendFact's
 *  own API allows an empty/omitted provenance). */
function checkFact(ind, violations) {
  for (const prop of ["rdf:subject", "rdf:predicate", "rdf:object"]) {
    if (!nonEmpty(attrValue(ind, prop))) violations.push(`a Fact needs a non-empty ${prop}`);
  }
  const prov = attrValue(ind, "mgx:factProvenance");
  if (prov !== undefined && !nonEmpty(prov)) violations.push("mgx:factProvenance, when present, must be non-empty");
}

/** RuleShape (mgx:RuleShape): a non-empty name; a kind from the closed
 *  compose2 | filter | recursive vocabulary; and the matching pair of slots
 *  for that declared kind, each present and non-empty (RULE_SLOT_PROPS
 *  above). */
function checkRule(ind, violations) {
  if (!nonEmpty(attrValue(ind, "mgx:ruleName"))) violations.push("a Rule needs a non-empty mgx:ruleName");
  const kind = attrValue(ind, "mgx:ruleKind");
  if (!kind || !RULE_KINDS.has(kind)) {
    violations.push(`a Rule's mgx:ruleKind must be one of compose2 | filter | recursive (got ${JSON.stringify(kind)})`);
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
 *  write. Synchronous (no engine/file I/O) — safe to `await` regardless (a
 *  synchronous throw inside an async caller's body still rejects that
 *  caller's promise correctly; a non-throwing sync return awaits to itself). */
export function assertIndividualValid(ind) {
  const r = validateIndividual(ind);
  if (!r.ok) {
    const e = new Error(`SHACL validation failed for ${ind?.class} "${ind?.id}": ${r.violations.join(" | ")}`);
    e.violations = r.violations;
    throw e;
  }
}
