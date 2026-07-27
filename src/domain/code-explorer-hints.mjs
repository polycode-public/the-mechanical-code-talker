// code-explorer-hints.mjs — suggested next queries drawn from what a loaded
// CODE graph actually holds. Pure over the entities payload (individuals +
// objectProperties), so the desktop shell and any future plain page share one
// tested generator and neither hand-writes prompt strings.
//
// The shapes are exactly the ones ask.mjs already answers, phrased from its own
// closed vocabulary (ask-vocab.mjs's RELATIONS/EDGE_NOUN_TO_METRIC): a relation
// only appears in a hint when the graph carries an edge of that kind, and a
// focus symbol only fills a slot when it actually sits at that end of an edge —
// so every suggestion resolves to a real answer, never a guess.

import { RELATIONS, EDGE_NOUN_TO_METRIC } from "./ask-vocab.mjs";

// Node classes this explorer reads as code, with the singular/plural nouns
// ask.mjs's own list and count lanes accept (ENTITY_TO_TYPE's inverse). Schema
// documentation individuals (SchemaClass/SchemaPredicate) and anything else are
// left out — they are not what a reader explores.
const CODE_CLASS_NOUN = Object.freeze({
  Module: ["module", "modules"],
  Class: ["class", "classes"],
  Function: ["function", "functions"],
  Method: ["method", "methods"],
  Attribute: ["attribute", "attributes"],
  GlobalVariable: ["variable", "variables"],
  Commit: ["commit", "commits"],
});

// The classes a focus symbol is drawn from — the things a reader centres on.
const FOCUSABLE_CLASSES = new Set(["Module", "Class", "Function", "Method"]);

// Fine, symbol-grain predicates fold onto their coarse sibling for phrasing:
// "what does X call" covers callsSymbol too, exactly as ask.mjs's
// SYMBOL_GRAIN_SIBLING pairs them.
const GRAIN_BASE = Object.freeze({ callsSymbol: "calls", touchesSymbol: "touches" });
const baseKind = (predicate) => GRAIN_BASE[predicate] || predicate;

// Forward reading (focus is the subject): "what does <focus> <bare>". The bare
// verb form is ask-vocab's own, so the phrasing tracks the vocabulary.
const FORWARD_TEMPLATE = Object.freeze({
  imports: (f) => `what does ${f} import`,
  calls: (f) => `what does ${f} call`,
  contains: (f) => `what is in ${f}`,
  defines: (f) => `what does ${f} define`,
  inherits: (f) => `what does ${f} inherit from`,
  serves: (f) => `what does ${f} serve`,
  denotes: (f) => `what does ${f} denote`,
});

// Reverse reading (focus is the object): "what <kind> <focus>".
const REVERSE_TEMPLATE = Object.freeze({
  imports: (f) => `what imports ${f}`,
  calls: (f) => `what calls ${f}`,
  tests: (f) => `what tests ${f}`,
  inherits: (f) => `what inherits from ${f}`,
  contains: (f) => `what contains ${f}`,
  serves: (f) => `what serves ${f}`,
  denotes: (f) => `what denotes ${f}`,
});

/** Index a payload into the counts and adjacency the hints read: class →
 *  count, base relation kind → { count, subjects, objects }, and a label →
 *  { class, degree } term table over every example edge. */
function indexGraph(payload) {
  const individuals = Array.isArray(payload?.individuals) ? payload.individuals : [];
  const classOfLabel = new Map();
  const classCounts = new Map();
  for (const ind of individuals) {
    if (!ind || !ind.label) continue;
    if (CODE_CLASS_NOUN[ind.class]) classCounts.set(ind.class, (classCounts.get(ind.class) || 0) + 1);
    if (!classOfLabel.has(ind.label)) classOfLabel.set(ind.label, ind.class);
  }

  const groups = Array.isArray(payload?.objectProperties) ? payload.objectProperties : [];
  const kinds = new Map(); // base kind -> { count, subjects:Set, objects:Set }
  const degree = new Map(); // label -> degree over example edges
  const bumpKind = (k) => kinds.get(k) || kinds.set(k, { count: 0, subjects: new Set(), objects: new Set() }).get(k);
  for (const g of groups) {
    if (!g || !g.predicate) continue;
    const k = baseKind(String(g.predicate));
    const entry = bumpKind(k);
    entry.count += Number(g.count) || (Array.isArray(g.examples) ? g.examples.length : 0);
    for (const e of Array.isArray(g.examples) ? g.examples : []) {
      const s = e?.subjectLabel || e?.subject;
      const o = e?.objectLabel || e?.object;
      if (s) { entry.subjects.add(s); degree.set(s, (degree.get(s) || 0) + 1); }
      if (o) { entry.objects.add(o); degree.set(o, (degree.get(o) || 0) + 1); }
    }
  }
  return { classCounts, classOfLabel, kinds, degree };
}

/** Pick the focus symbol: the caller's choice when it is a real term, else the
 *  highest-degree focusable-class label, else the highest-degree label at all,
 *  else null. Ties break on label for determinism. */
function pickFocus(index, requested) {
  if (requested && index.degree.has(requested)) return requested;
  const ranked = [...index.degree.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const focusable = ranked.find(([label]) => FOCUSABLE_CLASSES.has(index.classOfLabel.get(label)));
  if (focusable) return focusable[0];
  return ranked.length ? ranked[0][0] : null;
}

/**
 * Suggested queries for a loaded code graph.
 *
 * @param {object} payload  the entities payload (individuals + objectProperties).
 * @param {object} [opts]
 * @param {string} [opts.focus]  centre the neighbourhood on this symbol.
 * @param {number} [opts.limit]  cap the returned hints (default 12).
 * @returns {{ focus: (string|null), hints: Array<{text,group,rationale}> }}
 *          `hints` is ordered neighbourhood → compositional → explore; empty
 *          when the graph holds nothing to explore.
 */
export function generateCodeHints(payload, { focus: requestedFocus = null, limit = 12 } = {}) {
  const index = indexGraph(payload);
  const focus = pickFocus(index, requestedFocus);
  const hints = [];
  const add = (text, group, rationale) => hints.push({ text, group, rationale });
  const kindPresent = (k) => (index.kinds.get(k)?.count || 0) > 0;

  if (focus) {
    for (const [kind, template] of Object.entries(FORWARD_TEMPLATE)) {
      if (index.kinds.get(kind)?.subjects.has(focus)) {
        add(template(focus), "neighbourhood", `${focus} ${verbBare(kind)} other symbols in this graph`);
      }
    }
    for (const [kind, template] of Object.entries(REVERSE_TEMPLATE)) {
      if (index.kinds.get(kind)?.objects.has(focus)) {
        add(template(focus), "neighbourhood", `other symbols ${kind} ${focus}`);
      }
    }
  }

  // Compositional shapes over the graph's own edges and classes.
  const calls = index.kinds.get("calls");
  if (calls && index.classCounts.has("Function") && calls.objects.size) {
    const target = [...calls.objects].sort()[0];
    add(`which functions call ${target}`, "compositional", `${target} is called somewhere in this graph`);
  }
  const contains = index.kinds.get("contains");
  if (contains && index.classCounts.has("Method")) {
    const owner = [...contains.subjects].sort().find((s) => index.classOfLabel.get(s) === "Class");
    if (owner) add(`public methods of ${owner}`, "compositional", `${owner} contains members`);
  }

  // Explore-the-whole-graph shapes. The rankings and the coverage filter come
  // first — they are the more useful whole-graph questions — then a list and a
  // count per present class. EDGE_NOUN_TO_METRIC names the nouns ask.mjs's
  // superlative lane accepts, so a hint only offers a ranking the graph can
  // actually compute.
  const superlatives = [
    { noun: "imports", entity: "module", filter: "Module" },
    { noun: "callers", entity: "function", filter: "Function" },
  ];
  for (const s of superlatives) {
    const metric = EDGE_NOUN_TO_METRIC[s.noun];
    if (metric && kindPresent(metric.kind) && index.classCounts.has(s.filter)) {
      add(`which ${s.entity} has the most ${s.noun}`, "explore", `rank ${s.entity}s by ${s.noun}`);
    }
  }
  if (kindPresent("tests")) {
    add("which of those are tested", "explore", "filter a listing by test coverage");
  }
  const classesByCount = [...index.classCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [cls, count] of classesByCount) {
    const [, plural] = CODE_CLASS_NOUN[cls];
    add(`list ${plural}`, "explore", `${count} ${plural} in this graph`);
    add(`how many ${plural}`, "explore", `count the ${plural}`);
  }

  return { focus, hints: hints.slice(0, limit) };
}

// The infinitive ask-vocab curates for each relation, used in rationales.
function verbBare(kind) {
  return RELATIONS[kind]?.bare || kind;
}

export { CODE_CLASS_NOUN, indexGraph };
