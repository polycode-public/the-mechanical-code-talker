// concept.mjs — "the concept force": compose a THREE-BAND answer to a vague
// "what is a X" touch, when tmct KNOWS the concept X (a curated definition) AND
// HAS instances of it (individuals in the code graph and/or remembered isa facts).
//
//   1. THE FACT   — the definition of X (lead clause of the corpus/seon entry).
//   2. THE EXAMPLES — real instances of X: code-graph individuals whose class maps
//      to X (capped ~3, stable graph order, each a real node), plus any remembered
//      "A is a X" facts.
//   3. THE GUIDED FOLLOW-UP — 2-3 concrete, RUNNABLE next questions built from the
//      real instances × the query shapes valid for that kind, EACH PRE-CHECKED by
//      actually running it through ask() so a suggestion can never miss.
//
// PURE given (graph, term, {definition, factRows}) — the follow-up validator calls
// ask() (deterministic, no model), so the whole composition is reproducible. The
// caller (chat.mjs) owns the async edges: loading corpus/seon/definitions.jsonl and
// the memory fact rows, and rendering through the response template. This module
// never fabricates: every example is a real individual/fact and every follow-up is
// validated against the same graph before it is offered.

import { ask } from "./ask.mjs";

/** A vague concept term (normalized, singular — normFactTerm's output) → the graph
 *  individual `class` it enumerates. The closed set of code-structure concepts the
 *  seon lexicon + the graph both understand; anything outside it is not a "concept
 *  force" touch (a general-vocabulary term like "cache" has a definition but no
 *  enumerable graph class, so it falls back to the ordinary definition surface). */
export const CONCEPT_CLASS = Object.freeze({
  class: "Class",
  module: "Module",
  function: "Function",
  method: "Method",
  attribute: "Attribute",
  variable: "GlobalVariable",
  constant: "GlobalVariable",
  commit: "Commit",
});

/** class → [singular, plural] noun for the examples band's count ("(3 classes)"). */
const CLASS_NOUN = Object.freeze({
  Class: ["class", "classes"],
  Module: ["module", "modules"],
  Function: ["function", "functions"],
  Method: ["method", "methods"],
  Attribute: ["attribute", "attributes"],
  GlobalVariable: ["variable", "variables"],
  Commit: ["commit", "commits"],
});

/** The isa-family predicates that make a remembered fact an INSTANCE statement
 *  ("A is a X" — rdf:type). A subclass relation (rdfs:subClassOf) is not an
 *  instance, so it never contributes an example. */
const ISA_INSTANCE_PREDICATES = new Set(["rdf:type"]);

/** Per graph-class, the candidate follow-up shapes in priority order. Each builder
 *  takes ONE real instance label and returns a query string; the builder is offered
 *  only after the query VALIDATES against the live graph, so a shape that can't
 *  resolve for any instance is silently dropped. Shapes are curated to be exactly
 *  the ones ask.mjs's grammar answers for that kind. */
const FOLLOWUP_SHAPES = Object.freeze({
  Class: [
    (x) => `which classes inherit from ${x}`,
    (x) => `what does ${x} contain`,
    (x) => `where is ${x} defined`,
  ],
  Module: [
    (x) => `what does ${x} import`,
    (x) => `which modules import ${x}`,
    (x) => `where is ${x} defined`,
  ],
  Function: [
    (x) => `what calls ${x}`,
    (x) => `what does ${x} call`,
    (x) => `where is ${x} defined`,
  ],
  Method: [
    (x) => `which class contains ${x}`,
    (x) => `what calls ${x}`,
    (x) => `where is ${x} defined`,
  ],
  Attribute: [
    (x) => `which class contains ${x}`,
    (x) => `where is ${x} defined`,
  ],
  GlobalVariable: [
    (x) => `where is ${x} defined`,
    (x) => `where is ${x} mentioned`,
  ],
  Commit: [
    (x) => `what did commit ${x} touch`,
    (x) => `when did ${x} change`,
  ],
});

// The examples/instances listing shows up to 32 before truncating (the remainder is
// paginated by the chat shell's "more" mechanism); the GUIDED follow-ups stay small.
const MAX_EXAMPLES = 32;
const MAX_FOLLOWUPS = 3;

/** The lead clause of a curated definition — cut at the first "; " / ": " so the
 *  FACT band is one crisp sentence ("A class is a template that defines the
 *  structure and behaviour of objects."), the rest of the entry left implicit. */
function leadSentence(def) {
  const s = String(def).trim();
  const m = s.match(/^(.*?)[;:]\s/);
  const head = (m ? m[1] : s).replace(/[.;:\s]+$/, "");
  return `${head}.`;
}

function listJoin(a) {
  return a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0];
}

/** Does a candidate follow-up query actually resolve to a real, non-empty answer?
 *  Runs it through ask() (deterministic) and checks the honest-miss flag + matches —
 *  the exact same engine the user would hit, so a validated suggestion is guaranteed
 *  to land. Failure-tolerant: any throw counts as "does not resolve". */
function resolves(graph, query) {
  try {
    const r = ask(graph, query);
    return !!(r && r.tmct_ask && r.tmct_ask.miss === false
      && Array.isArray(r.tmct_ask.matches) && r.tmct_ask.matches.length > 0);
  } catch {
    return false;
  }
}

/** Build up to MAX_FOLLOWUPS validated follow-ups for a class's instances. For each
 *  shape in priority order, find the instances whose query resolves and offer it for
 *  the first such instance NOT already used by an earlier follow-up (so the set
 *  showcases DIFFERENT real nodes where possible); a shape no instance satisfies is
 *  dropped entirely. Deterministic (graph order in, first-fit out). */
function buildFollowups(graph, cls, instanceLabels) {
  const shapes = FOLLOWUP_SHAPES[cls] || [];
  const used = new Set();
  const out = [];
  for (const shape of shapes) {
    if (out.length >= MAX_FOLLOWUPS) break;
    const valid = instanceLabels.filter((x) => resolves(graph, shape(x)));
    if (!valid.length) continue;
    const pick = valid.find((x) => !used.has(x)) ?? valid[0];
    used.add(pick);
    out.push(shape(pick));
  }
  return out;
}

/** Compose the three bands for a concept term, or null when it is NOT a concept-force
 *  case — the term is not a known enumerable concept, has no curated definition, or
 *  has NO instances anywhere (code graph and memory both empty). Returns the pieces as
 *  strings so the caller can render them through a data template:
 *    { definition, examples, followups, instances:[{id,label,type,module}] }
 *  `examples` is always non-empty when non-null (we only fire with real instances);
 *  `followups` is "" when no validated next-question exists, else a "\nWant to go
 *  deeper? Try:\n  • …" block. */
export function composeConcept(graph, term, { definition = null, factRows = [] } = {}) {
  const cls = CONCEPT_CLASS[term];
  if (!cls || !definition) return null;

  const individuals = (graph && Array.isArray(graph.individuals)) ? graph.individuals : [];
  const graphInstances = individuals.filter((i) => i && i.class === cls);
  const graphLabels = graphInstances.map((i) => i.label);
  const graphLower = new Set(graphLabels.map((l) => String(l).toLowerCase()));

  // remembered "A is a X" instance facts (rdf:type), objects matching this term —
  // subjects are the instance names, deduped against graph instances by label.
  const memoryLabels = [];
  for (const f of factRows) {
    if (!ISA_INSTANCE_PREDICATES.has(f.predicate)) continue;
    if (String(f.object).toLowerCase() !== term) continue;
    const sub = String(f.subject || "").trim();
    if (sub && !graphLower.has(sub.toLowerCase()) && !memoryLabels.includes(sub)) memoryLabels.push(sub);
  }

  if (!graphInstances.length && !memoryLabels.length) return null; // no instances → honest miss stands

  const [sing, plur] = CLASS_NOUN[cls] || [cls.toLowerCase(), `${cls.toLowerCase()}s`];

  // BAND 1 — the fact.
  const bandDefinition = leadSentence(definition);

  // BAND 2 — the examples. Up to MAX_EXAMPLES individuals are listed; a longer class
  // holds its remainder for the shell's "more" pagination (say 'more' to see them).
  const shownGraph = graphLabels.slice(0, MAX_EXAMPLES);
  const remainderLabels = graphLabels.slice(MAX_EXAMPLES);
  let bandExamples = "";
  if (shownGraph.length) {
    const total = graphInstances.length;
    const more = remainderLabels.length
      ? ` …and ${remainderLabels.length} more — say 'more' to see them.`
      : "";
    bandExamples = `In this codebase, for example: ${listJoin(shownGraph)} (${total} ${total === 1 ? sing : plur}).${more}`;
  }
  const shownMemory = memoryLabels.slice(0, MAX_EXAMPLES);
  if (shownMemory.length) {
    const lead = bandExamples ? " " : "";
    const verb = shownMemory.length === 1 ? "is a" : "are";
    bandExamples += `${lead}You've also told me ${listJoin(shownMemory)} ${verb} ${sing}.`;
  }

  // BAND 3 — the guided follow-ups (validated; only real code-graph instances can
  // seed a runnable graph query, so memory-only concepts simply get no follow-ups).
  const followupQueries = buildFollowups(graph, cls, graphLabels);
  const bandFollowups = followupQueries.length
    ? `\nWant to go deeper? Try:\n${followupQueries.map((q) => `  • ${q}`).join("\n")}`
    : "";

  return {
    definition: bandDefinition,
    examples: bandExamples,
    followups: bandFollowups,
    followupQueries,
    instances: graphInstances.slice(0, MAX_EXAMPLES).map((i) => ({
      id: i.id, label: i.label, type: i.class,
    })),
    // the un-shown instance labels + their plural noun, for the shell's "more"
    // pagination — empty when nothing was truncated.
    remainder: remainderLabels,
    noun: plur,
  };
}
