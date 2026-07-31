// graph-delta.mjs — the planning STATE for code changes and the closed
// vocabulary of effects that move between states. Pure, no I/O.
//
// A code-graph snapshot is the typed entity/edge payload the repo already
// queries (codegraph.mjs / repository-interface.mjs), reduced to the two things
// a planner moves over: entities (id + class + title) and edges
// (subject/predicate/object). An action's declared EFFECT is a graph delta — a
// short list of add/del-entity, add/del-edge, retitle-entity tokens over the
// ontology's closed classes and predicates. Plan search projects snapshots
// without touching any base state, the way domain.mjs projects board@step
// snapshots.
//
// The state KEY canonicalizes the resulting graph, not the path taken to it, so
// two orderings of independent steps that reach the same graph are one state —
// which is what lets findActionPath's cycle detection merge them, and what keeps
// the representation e-class-friendly (PLAN_CODE.md §3.3).

/** The entity classes an effect may add — the ontology's code-entity classes
 *  (ontology/tmct-core.ttl; the same set codegraph.mjs's graph carries). Closed:
 *  an effect naming a class outside this set is a programming error, not a
 *  guess. */
export const ENTITY_CLASSES = Object.freeze([
  "Module", "Class", "Function", "Method", "Attribute", "GlobalVariable", "Commit", "Session",
]);

/** The edge predicates an effect may add or remove — repository-interface.mjs's
 *  EDGE_KINDS, restated here because a domain module imports nothing outside its
 *  own layer (test/estate/import-layers). Kept in step by
 *  test/domain/codeplan-graph-delta: a drift between the two lists fails it. */
export const EDGE_PREDICATES = Object.freeze([
  "imports", "calls", "callsSymbol", "defines", "tests",
  "touches", "touchesSymbol", "contains", "inherits", "cochange", "reexports",
  "serves", "denotes",
]);

/** The closed effect vocabulary — every way an operator's declared delta can
 *  change a graph state. retitle-entity is the rename primitive: an entity keeps
 *  its id (its stable graph identity) while its human title changes. */
export const EFFECT_OPS = Object.freeze([
  "add-entity", "del-entity", "add-edge", "del-edge", "retitle-entity",
]);

const ENTITY_CLASS_SET = new Set(ENTITY_CLASSES);
const EDGE_PREDICATE_SET = new Set(EDGE_PREDICATES);
const EFFECT_OP_SET = new Set(EFFECT_OPS);

// NUL-joined identity, the same discipline as domain.mjs's stateKeyFor: a
// multi-word title can never collide with the field separator. Spelled via
// fromCharCode because tooling has turned a source-level escape into a literal
// NUL byte in this repo before.
const SEP = String.fromCharCode(0);

const str = (value) => String(value ?? "");

const entitySort = (a, b) =>
  a.id.localeCompare(b.id) || a.class.localeCompare(b.class) || a.title.localeCompare(b.title);

const edgeSort = (a, b) =>
  a.subject.localeCompare(b.subject) || a.predicate.localeCompare(b.predicate) || a.object.localeCompare(b.object);

const normEntity = (e) => ({ id: str(e.id), class: str(e.class), title: str(e.title) });
const normEdge = (r) => ({ subject: str(r.subject), predicate: str(r.predicate), object: str(r.object) });

const dedupSorted = (rows, keyOf) => {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

/** An empty code-graph state. */
export const emptyGraphState = () => ({ entities: [], edges: [] });

/** Canonical, sorted, de-duplicated copy of a state — the shape every function
 *  here returns, so a state is always in one normal form. */
export function normalizeGraphState(state) {
  const entities = dedupSorted(
    (state?.entities || []).map(normEntity).sort(entitySort),
    (e) => [e.id, e.class, e.title].join(SEP),
  );
  const edges = dedupSorted(
    (state?.edges || []).map(normEdge).sort(edgeSort),
    (r) => [r.subject, r.predicate, r.object].join(SEP),
  );
  return { entities, edges };
}

/** Throw unless an effect is a well-formed member of the closed vocabulary,
 *  over the closed class/predicate sets. The gate every apply/diff runs first,
 *  so a malformed delta never silently no-ops. */
export function validateEffect(effect) {
  const op = str(effect?.op);
  if (!EFFECT_OP_SET.has(op)) throw new Error(`unknown effect op ${JSON.stringify(op)} (not in EFFECT_OPS)`);
  if (op === "add-entity") {
    if (!str(effect.id)) throw new Error("add-entity needs an id");
    if (!ENTITY_CLASS_SET.has(str(effect.class))) throw new Error(`add-entity class ${JSON.stringify(str(effect.class))} is not an ENTITY_CLASS`);
  } else if (op === "del-entity") {
    if (!str(effect.id)) throw new Error("del-entity needs an id");
  } else if (op === "retitle-entity") {
    if (!str(effect.id)) throw new Error("retitle-entity needs an id");
    if (!str(effect.title)) throw new Error("retitle-entity needs a title");
  } else {
    // add-edge / del-edge
    if (!str(effect.subject) || !str(effect.object)) throw new Error(`${op} needs a subject and an object`);
    if (!EDGE_PREDICATE_SET.has(str(effect.predicate))) throw new Error(`${op} predicate ${JSON.stringify(str(effect.predicate))} is not an EDGE_PREDICATE`);
  }
  return op;
}

const hasEntity = (state, id) => state.entities.some((e) => e.id === id);
const edgeIncident = (state, id) => state.edges.some((r) => r.subject === id || r.object === id);

/** Apply one effect to a state, returning a NEW normalized state (the input is
 *  never mutated). Throws on an effect that cannot apply to this state — a
 *  duplicate add, a delete of something absent, an edge onto a missing endpoint,
 *  or a del-entity that would leave a dangling edge. A precondition that should
 *  have blocked the move is the caller's job (operators.mjs); this layer fails
 *  loud rather than producing an ill-formed graph. */
export function applyGraphEffect(state, effect) {
  const s = normalizeGraphState(state);
  const op = validateEffect(effect);
  if (op === "add-entity") {
    const id = str(effect.id);
    if (hasEntity(s, id)) throw new Error(`add-entity: ${id} already exists`);
    s.entities.push({ id, class: str(effect.class), title: str(effect.title) });
  } else if (op === "del-entity") {
    const id = str(effect.id);
    if (!hasEntity(s, id)) throw new Error(`del-entity: ${id} does not exist`);
    if (edgeIncident(s, id)) throw new Error(`del-entity: ${id} still has incident edges (remove them first)`);
    s.entities = s.entities.filter((e) => e.id !== id);
  } else if (op === "retitle-entity") {
    const id = str(effect.id);
    const ent = s.entities.find((e) => e.id === id);
    if (!ent) throw new Error(`retitle-entity: ${id} does not exist`);
    ent.title = str(effect.title);
  } else if (op === "add-edge") {
    const edge = normEdge(effect);
    if (!hasEntity(s, edge.subject)) throw new Error(`add-edge: subject ${edge.subject} is not an entity`);
    if (!hasEntity(s, edge.object)) throw new Error(`add-edge: object ${edge.object} is not an entity`);
    s.edges.push(edge);
  } else {
    const edge = normEdge(effect);
    if (!s.edges.some((r) => r.subject === edge.subject && r.predicate === edge.predicate && r.object === edge.object)) {
      throw new Error(`del-edge: (${edge.subject} ${edge.predicate} ${edge.object}) does not exist`);
    }
    s.edges = s.edges.filter((r) => !(r.subject === edge.subject && r.predicate === edge.predicate && r.object === edge.object));
  }
  return normalizeGraphState(s);
}

/** Fold a list of effects onto a state in order. */
export function applyGraphEffects(state, effects) {
  let s = normalizeGraphState(state);
  for (const effect of effects || []) s = applyGraphEffect(s, effect);
  return s;
}

/** The canonical identity of a state: its sorted entity and edge sets, joined.
 *  Keys the RESULTING graph, never the path — so independent-step reorderings
 *  that land on the same graph share one key. */
export function canonicalStateKey(state) {
  const s = normalizeGraphState(state);
  const eLines = s.entities.map((e) => ["E", e.id, e.class, e.title].join(SEP));
  const rLines = s.edges.map((r) => ["R", r.subject, r.predicate, r.object].join(SEP));
  return [...eLines, ...rLines].join("\n");
}

/** A canonical string for one effect, used to compare declared vs observed
 *  deltas irrespective of list order (PLAN_CODE.md §3.5 tier 1). */
export function effectKey(effect) {
  const op = validateEffect(effect);
  if (op === "add-entity") return [op, str(effect.id), str(effect.class), str(effect.title)].join(SEP);
  if (op === "del-entity") return [op, str(effect.id)].join(SEP);
  if (op === "retitle-entity") return [op, str(effect.id), str(effect.title)].join(SEP);
  return [op, str(effect.subject), str(effect.predicate), str(effect.object)].join(SEP);
}

/** True when two effect lists describe the same delta regardless of order. */
export function effectsEqual(a, b) {
  const keys = (list) => (list || []).map(effectKey).sort();
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** The observed delta between two states, as a sorted effect list: what a
 *  re-index would report an operator actually did. A del-entity's incident-edge
 *  removals surface as their own del-edge tokens, so a declared delta that lists
 *  every edge it removes matches the observed one exactly. */
export function diffGraphStates(before, after) {
  const a = normalizeGraphState(before);
  const b = normalizeGraphState(after);
  const aEnt = new Map(a.entities.map((e) => [e.id, e]));
  const bEnt = new Map(b.entities.map((e) => [e.id, e]));
  const effects = [];
  for (const e of a.entities) if (!bEnt.has(e.id)) effects.push({ op: "del-entity", id: e.id });
  for (const e of b.entities) {
    if (!aEnt.has(e.id)) { effects.push({ op: "add-entity", id: e.id, class: e.class, title: e.title }); continue; }
    if (aEnt.get(e.id).title !== e.title) effects.push({ op: "retitle-entity", id: e.id, title: e.title });
  }
  const edgeKey = (r) => [r.subject, r.predicate, r.object].join(SEP);
  const aEdge = new Set(a.edges.map(edgeKey));
  const bEdge = new Set(b.edges.map(edgeKey));
  for (const r of a.edges) if (!bEdge.has(edgeKey(r))) effects.push({ op: "del-edge", ...r });
  for (const r of b.edges) if (!aEdge.has(edgeKey(r))) effects.push({ op: "add-edge", ...r });
  return effects.sort((x, y) => effectKey(x).localeCompare(effectKey(y)));
}

/** Build a code-graph state from a loaded graph payload (the .tmct/graph.json
 *  shape). Reads the code individuals (skipping the schema:* meta-entities) and
 *  every objectProperties edge over a known predicate. Pure — a test can build a
 *  state from the committed fixture graph without touching disk logic here. */
export function graphStateFromEntities(payload) {
  const individuals = Array.isArray(payload?.individuals) ? payload.individuals : [];
  const entities = [];
  for (const ind of individuals) {
    if (!ind?.id || typeof ind.id !== "string") continue;
    if (ind.id.startsWith("schema:")) continue; // ontology meta-entities, not code
    if (!ENTITY_CLASS_SET.has(str(ind.class))) continue;
    entities.push({ id: ind.id, class: str(ind.class), title: str(ind.label) });
  }
  const known = new Set(entities.map((e) => e.id));
  const groups = Array.isArray(payload?.objectProperties) ? payload.objectProperties : [];
  const edges = [];
  for (const group of groups) {
    const predicate = str(group?.predicate);
    if (!EDGE_PREDICATE_SET.has(predicate)) continue;
    for (const ex of Array.isArray(group.examples) ? group.examples : []) {
      if (!ex?.subject || !ex?.object) continue;
      if (!known.has(ex.subject) || !known.has(ex.object)) continue; // never a dangling edge
      edges.push({ subject: str(ex.subject), predicate, object: str(ex.object) });
    }
  }
  return normalizeGraphState({ entities, edges });
}
