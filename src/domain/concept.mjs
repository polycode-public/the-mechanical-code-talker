// concept.mjs — "the concept force": compose a three-band answer (fact,
// examples, guided follow-up) to a vague "what is a X" touch when X is a
// known, instantiated concept. Pure given (graph, term, {definition,
// factRows}); never fabricates — every example is a real individual/fact and
// every follow-up is pre-validated by actually running it through ask().

import { ask } from "./ask.mjs";
import { relationKind } from "./codegraph.mjs";

/** A vague concept term (normalized, singular) → the graph individual `class`
 *  it enumerates. Outside this closed set (e.g. "cache"), the term falls back
 *  to the ordinary definition surface instead. */
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

/** Per graph-class, the candidate follow-up shapes in priority order — each
 *  offered only once its query validates against the live graph. */
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

/** Up to MAX_FOLLOWUPS validated follow-ups: first-fit over shapes in
 *  priority order, preferring an instance not already used. */
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

/** Compose the three bands for a concept term, or null when it's not a known
 *  enumerable concept, has no curated definition, or has no instances anywhere. */
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
    // EVERY instance id (uncapped), for discourse-count anaphora ("count them" /
    // "how many of those") over a truncated listing: `instances` is capped at
    // MAX_EXAMPLES and the rest lives in `remainder` as prose labels, invisible to
    // the counter — so a follow-up count would undercount without the full id set.
    allInstanceIds: graphInstances.map((i) => i.id),
    // the un-shown instance labels + their plural noun, for the shell's "more"
    // pagination — empty when nothing was truncated.
    remainder: remainderLabels,
    noun: plur,
  };
}

// ---- THE RELATION CONCEPT FORCE — same three bands, but for a vague touch on
// a RELATION/edge kind ("what about imports"): composeConcept enumerates
// INDIVIDUALS, composeRelation enumerates EDGES. ----

/** A vague relation term (lower-cased) → the internal concept key it
 *  enumerates. Nouns, gerunds and synonyms all collapse to one key. */
export const RELATION_TERM = Object.freeze({
  import: "imports", imports: "imports", importing: "imports", imported: "imports",
  call: "calls", calls: "calls", calling: "calls", called: "calls", invoke: "calls", invokes: "calls", invoking: "calls",
  contain: "contains", contains: "contains", containing: "contains", containment: "contains", member: "contains", members: "contains",
  inherit: "inherits", inherits: "inherits", inheriting: "inherits", inheritance: "inherits",
  extend: "inherits", extends: "inherits", extending: "inherits", subclass: "inherits", subclasses: "inherits", subclassing: "inherits",
  test: "tests", tests: "tests", testing: "tests", tested: "tests", coverage: "tests",
  define: "defines", defines: "defines", defining: "defines", defined: "defines", definition: "defines", definitions: "defines", declaration: "defines",
  touch: "touches", touches: "touches", touching: "touches", touched: "touches",
  cochange: "cochange", "co-change": "cochange", "change-coupling": "cochange", coupled: "cochange",
  // "export"/"exports" is also a curated seon lexicon noun, but that meta reading
  // only owns "what does export mean" — no conflict with this vague-touch table.
  export: "reexports", exports: "reexports", exporting: "reexports", exported: "reexports",
  reexport: "reexports", reexports: "reexports", reexporting: "reexports",
  "re-export": "reexports", "re-exports": "reexports", "re-exporting": "reexports",
  // provider-declared kinds: tmct's own indexer emits neither, so a graph it
  // built degrades to the honest two-band "no edges" answer rather than a miss.
  serve: "serves", serves: "serves", serving: "serves", served: "serves",
  denote: "denotes", denotes: "denotes", denoting: "denotes", denoted: "denotes",
});

/** concept key → the relationKind()s whose edges it enumerates. A concept can span
 *  several graph kinds (calls is both module-coarse and symbol-granular; touches is
 *  file- and symbol-level) — the force gathers edges across the whole set. */
const RELATION_KINDS = Object.freeze({
  imports: ["imports"],
  calls: ["calls", "callsSymbol"],
  contains: ["contains"],
  inherits: ["inherits"],
  tests: ["tests"],
  defines: ["defines"],
  touches: ["touches", "touchesSymbol"],
  cochange: ["cochange"],
  reexports: ["reexports"],
  serves: ["serves"],
  denotes: ["denotes"],
});

/** concept key → the verb phrase that renders an edge as an English sentence
 *  ("a imports b"), and the singular edge-noun for the count ("(18 import edges)"). */
const RELATION_RENDER = Object.freeze({
  imports: { verb: "imports", edgeNoun: "import" },
  calls: { verb: "calls", edgeNoun: "call" },
  contains: { verb: "contains", edgeNoun: "containment" },
  inherits: { verb: "inherits from", edgeNoun: "inheritance" },
  tests: { verb: "tests", edgeNoun: "test" },
  defines: { verb: "defines", edgeNoun: "definition" },
  touches: { verb: "touches", edgeNoun: "touch" },
  cochange: { verb: "changes together with", edgeNoun: "change-coupling" },
  reexports: { verb: "re-exports", edgeNoun: "re-export" },
  serves: { verb: "serves", edgeNoun: "service" },
  denotes: { verb: "denotes", edgeNoun: "denotation" },
});

/** Per concept key, the candidate follow-up shapes in priority order — each
 *  draws an endpoint from one side of the edges and is offered only once its
 *  query validates against the live graph. */
const RELATION_FOLLOWUP_SHAPES = Object.freeze({
  imports: [
    { side: "obj", make: (x) => `which modules import ${x}` },
    { side: "subj", make: (x) => `what does ${x} import` },
  ],
  calls: [
    { side: "obj", make: (x) => `what calls ${x}` },
    { side: "subj", make: (x) => `what does ${x} call` },
  ],
  contains: [
    { side: "subj", make: (x) => `what does ${x} contain` },
    { side: "obj", make: (x) => `which class contains ${x}` },
  ],
  inherits: [
    { side: "obj", make: (x) => `which classes inherit from ${x}` },
    { side: "subj", make: (x) => `where is ${x} defined` },
  ],
  tests: [
    { side: "obj", make: (x) => `what tests ${x}` },
    { side: "obj", make: (x) => `where is ${x} defined` },
  ],
  defines: [
    { side: "obj", make: (x) => `where is ${x} defined` },
    { side: "subj", make: (x) => `what does ${x} contain` },
  ],
  touches: [
    { side: "obj", make: (x) => `when did ${x} change` },
    { side: "subj", make: (x) => `what did commit ${x} touch` },
  ],
  cochange: [
    { side: "obj", make: (x) => `where is ${x} defined` },
    { side: "subj", make: (x) => `which modules import ${x}` },
  ],
  reexports: [
    { side: "subj", make: (x) => `what does ${x} export` },
    { side: "obj", make: (x) => `where is ${x} defined` },
  ],
  serves: [
    { side: "subj", make: (x) => `what does ${x} serve` },
    { side: "obj", make: (x) => `what serves ${x}` },
  ],
  denotes: [
    { side: "subj", make: (x) => `what does ${x} denote` },
    { side: "obj", make: (x) => `what denotes ${x}` },
  ],
});

/** How many example edges the relation force shows before the remainder is held for
 *  the shell's "more" pagination (edges render as full sentences, so a much smaller
 *  page than the noun force's 32 instances reads better). */
const MAX_EDGE_EXAMPLES = 3;

const edgeSubjectLabel = (e) => String(e.subjectLabel || e.subject);
const edgeObjectLabel = (e) => String(e.objectLabel || e.object);

/** Up to MAX_FOLLOWUPS validated follow-ups for a relation's edges — same
 *  first-fit discipline as buildFollowups. */
function buildRelationFollowups(graph, key, subjLabels, objLabels) {
  const shapes = RELATION_FOLLOWUP_SHAPES[key] || [];
  const used = new Set();
  const out = [];
  for (const shape of shapes) {
    if (out.length >= MAX_FOLLOWUPS) break;
    const pool = shape.side === "subj" ? subjLabels : objLabels;
    const valid = pool.filter((x) => resolves(graph, shape.make(x)));
    if (!valid.length) continue;
    const pick = valid.find((x) => !used.has(x)) ?? valid[0];
    used.add(pick);
    out.push(shape.make(pick));
  }
  return out;
}

/** Compose the three bands for a RELATION concept term, or null when it's not
 *  a known enumerable relation or has no curated definition. A known relation
 *  with ZERO edges is NOT null — it degrades to a two-band "no X edges"
 *  answer, since returning null here would fall through to a garbled raw
 *  grammar miss instead of an honest one. */
export function composeRelation(graph, relTerm, { definition = null } = {}) {
  const key = RELATION_TERM[String(relTerm || "").toLowerCase()];
  if (!key || !definition) return null;
  const kinds = RELATION_KINDS[key] || [];
  const groups = (graph && Array.isArray(graph.relations) ? graph.relations : [])
    .filter((g) => kinds.includes(relationKind(g)));
  const edges = groups.flatMap((g) => (Array.isArray(g.edges) ? g.edges : []));
  const { verb, edgeNoun } = RELATION_RENDER[key] || { verb: key, edgeNoun: key };

  // BAND 1 — the fact (the relation defined as a verb/relationship). Stated
  // regardless of whether the graph has any edges of this kind — only the
  // fabricated EXAMPLE is refused when there are none.
  const bandDefinition = leadSentence(definition);

  if (!edges.length) {
    // No fabricated edge, but an honest, ON-TOPIC miss — never the caller's raw,
    // unrelated object-search text.
    return {
      definition: bandDefinition,
      examples: `This codebase has no ${edgeNoun} edges in the index.`,
      followups: "",
      followupQueries: [],
      relation: key,
      remainder: [],
      noun: `${edgeNoun} edges`,
      empty: true,
    };
  }
  const total = groups.reduce((s, g) => s + (Number(g.count) || (g.edges || []).length), 0);

  // BAND 2 — the example edges, rendered as English sentences with a count. The
  // first MAX_EDGE_EXAMPLES are shown; the remainder is held for "more" pagination.
  const rendered = edges.map((e) => `${edgeSubjectLabel(e)} ${verb} ${edgeObjectLabel(e)}`);
  const shown = rendered.slice(0, MAX_EDGE_EXAMPLES);
  const remainder = rendered.slice(MAX_EDGE_EXAMPLES);
  const countNoun = `${edgeNoun} edge${total === 1 ? "" : "s"}`;
  const more = remainder.length ? ` …and ${remainder.length} more — say 'more' to see them.` : "";
  const bandExamples = `In this codebase, for example: ${listJoin(shown)} (${total} ${countNoun}).${more}`;

  // BAND 3 — the guided follow-ups, seeded from DISTINCT real edge endpoints and
  // validated against the live graph, so an offered follow-up can never miss.
  const subjLabels = [...new Set(edges.map(edgeSubjectLabel))];
  const objLabels = [...new Set(edges.map(edgeObjectLabel))];
  const followupQueries = buildRelationFollowups(graph, key, subjLabels, objLabels);
  const bandFollowups = followupQueries.length
    ? `\nWant to go deeper? Try:\n${followupQueries.map((q) => `  • ${q}`).join("\n")}`
    : "";

  return {
    definition: bandDefinition,
    examples: bandExamples,
    followups: bandFollowups,
    followupQueries,
    relation: key,
    remainder,
    noun: countNoun,
  };
}
