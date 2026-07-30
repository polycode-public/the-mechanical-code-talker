// src/domain/router/registry.mjs — the capability registry.
//
// Each tmct tool is modelled as a STRIPS/PDDL operator declared as DATA: a `Capability` with
// typed `Parameter`s, `Precondition`s, and `Effect`s (add-list/delete-list). resolver.mjs
// backward-chains from a goal to a capability whose add-list achieves it, and proves the
// preconditions bind before the call fires.
//
// Plain data + pure accessors, no I/O. Tool names + parameter arg keys are the
// exact ones src/tools/server.mjs `dispatchTool` reads, so a bound call this registry validates is
// directly dispatchable.

const PREFIXES = Object.freeze({
  cap: "urn:tmct:cap#", // the capability/operator vocabulary (this module)
  taught: "urn:tmct:taught#", // taught-action operators + their world-state predicates (taught.mjs)
  mgx: "urn:tmct:mgx#", // tmct's code-graph predicates (imports/calls/tests/…)
  seon: "http://se-on.org/ontologies/seon.owl#", // software-evolution ontology classes
});

// The OWL classes this registry mints individuals of.
export const VOCAB = Object.freeze({
  Capability: "cap:Capability", // rdf:type of a declared tool/operator
  Parameter: "cap:Parameter",
  Precondition: "cap:Precondition",
  Effect: "cap:Effect",
});

// Parameter entity-KINDS — the seon/mgx classes a slot ranges over. `Query` and
// `Kind`/`Package` are free-text / enum slots (no graph resolution); the rest
// name a graph entity the resolver must prove RESOLVES before the call fires —
// code-graph kinds through resolveObject (ask.mjs), MemoryTerm through
// resolveMemoryTerm (resolver.mjs), the conversational-memory sibling oracle.
export const KINDS = Object.freeze({
  Symbol: "seon:CodeEntity", // any code symbol: function/method/class/module/attribute
  Module: "mgx:Module", // SEON has no JS-module class (its nearest are Namespace/main:File); owned
  Class: "seon:ClassType", // SEON's real class for a class definition
  MemoryTerm: "mgx:MemoryTerm", // owned: a conversational-memory term (a minted skos:Concept or a world-fact subject/object) — binds in the memory graph, never the code graph
  Query: "cap:FreeText", // lexical search string — no resolution precondition
  Kind: "cap:KindFilter", // enum: function|class|method|… (search filter)
  Package: "cap:PackageName", // optional architecture-scope filter
});

// The kinds that bind in the conversational-memory graph (resolveMemoryTerm)
// rather than the code graph (resolveObject). A consumer that walks KINDS for
// code-graph-resolvable classes (e.g. the synthbench enumerator's focus
// classes) must exclude these — a memory term is never a code-graph focus.
export const MEMORY_KINDS = Object.freeze([KINDS.MemoryTerm]);

// Precondition PREDICATE tags (the small closed vocabulary a precondition uses).
export const PRECOND = Object.freeze({
  graphLoaded: "cap:graph-loaded", // a graph artifact is present + parseable
  resolves: "cap:resolves", // { param, as } — the slot binds to an entity of kind `as`
  anyPresent: "cap:any-present", // { params } — at least one of these slots is provided
  memoryFacts: "cap:memory-facts", // the conversational-memory store holds relation facts for the term
});

// ---- capability builder (returns PLAIN FROZEN data) -------------------------

/** A parameter slot. `arg` is the exact key src/tools/server.mjs `dispatchTool` reads. */
const param = (name, kind, { arg = name, required = true, note = "" } = {}) =>
  Object.freeze({ type: VOCAB.Parameter, name, kind, arg, required, note });

/** graph-loaded precondition — every graph-query capability carries it. */
const graphLoaded = () => Object.freeze({ type: VOCAB.Precondition, pred: PRECOND.graphLoaded });
/** resolves(param, as) — the named slot must bind to a graph entity of kind `as`. */
const resolves = (paramName, as) =>
  Object.freeze({ type: VOCAB.Precondition, pred: PRECOND.resolves, param: paramName, as });
/** any-present(params) — search-style disjunction (query OR kind must be given). */
const anyPresent = (params) =>
  Object.freeze({ type: VOCAB.Precondition, pred: PRECOND.anyPresent, params: Object.freeze([...params]) });
/** memory-facts — the memory graph holds mgx:synonym / mgx:relatedTo / mgx:similarTo
 *  facts for the term. The memory-graph sibling of graph-loaded: the SKOS view
 *  answers from the conversational-memory store and misses honestly without it,
 *  with or without a code-map graph. */
const memoryFacts = () => Object.freeze({ type: VOCAB.Precondition, pred: PRECOND.memoryFacts });

/** Add-effect: after the call the agent knows `topic` about `?of`. */
const knows = (topic, ofParam = null) =>
  Object.freeze({ type: VOCAB.Effect, pred: "cap:knows", topic, of: ofParam ? `?${ofParam}` : null });

/** Declare one capability as STRIPS data. */
function capability({ name, label, question, params = [], preconditions = [], add = [], del = [] }) {
  return Object.freeze({
    type: VOCAB.Capability,
    name, // the dispatchTool tool name — directly callable
    label, // human label (the slash-command verb)
    question, // one-line "what question does this answer"
    readOnly: true, // dispatching this capability performs no writes
    parameters: Object.freeze(params),
    preconditions: Object.freeze(preconditions),
    effects: Object.freeze({ add: Object.freeze(add), del: Object.freeze(del) }),
  });
}

// ---- the declared capabilities -----------------------------------------------
// Arg keys verified against src/tools/server.mjs `dispatchTool`'s switch: describe/callers/
// callees/tests/history/… take `symbol`; impact/exports take `module`; members/
// subclasses take `class`; search takes `query` (+ optional kind/name/decorator);
// architecture takes an optional `package`; untested takes nothing; related
// takes `term` (a memory-graph concept term); sprite takes `class` (a memory-graph
// term) plus optional `expression`/`size`.

const CAPABILITIES = Object.freeze([
  capability({
    name: "tmct_search", label: "search", question: "lexical search across the graph",
    params: [
      param("query", KINDS.Query, { required: false, note: "required unless a kind filter is given" }),
      param("kind", KINDS.Kind, { required: false }),
      param("name", KINDS.Query, { required: false }),
      param("decorator", KINDS.Query, { required: false }),
    ],
    preconditions: [graphLoaded(), anyPresent(["query", "kind"])],
    add: [knows("matches", "query")],
  }),
  capability({
    name: "tmct_describe", label: "describe", question: "a symbol's definition, kind and relations",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("description", "symbol")],
  }),
  capability({
    name: "tmct_signature", label: "signature", question: "a symbol's signature only",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("signature", "symbol")],
  }),
  capability({
    name: "tmct_impact", label: "impact", question: "what a change to this module or symbol reaches (impact closure)",
    params: [param("module", KINDS.Symbol, { note: "a Module, or any sited symbol — a fine-grained seed walks callsSymbol dependents and coarsens them to module grain" })],
    preconditions: [graphLoaded(), resolves("module", KINDS.Symbol)],
    add: [knows("impact", "module")],
  }),
  capability({
    name: "tmct_members", label: "members", question: "the methods/attributes of a class",
    params: [param("class", KINDS.Class, { arg: "class" })],
    preconditions: [graphLoaded(), resolves("class", KINDS.Class)],
    add: [knows("members", "class")],
  }),
  capability({
    name: "tmct_subclasses", label: "subclasses", question: "the subclasses of a class",
    params: [param("class", KINDS.Class, { arg: "class" })],
    preconditions: [graphLoaded(), resolves("class", KINDS.Class)],
    add: [knows("subclasses", "class")],
  }),
  capability({
    name: "tmct_exports", label: "exports", question: "a module's public exports",
    params: [param("module", KINDS.Module)],
    preconditions: [graphLoaded(), resolves("module", KINDS.Module)],
    add: [knows("exports", "module")],
  }),
  capability({
    name: "tmct_callers", label: "callers", question: "functions that call this symbol",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("callers", "symbol")],
  }),
  capability({
    name: "tmct_callees", label: "callees", question: "functions this symbol calls",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("callees", "symbol")],
  }),
  capability({
    name: "tmct_calls", label: "calls", question: "the call edges out of this symbol/module",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("calls", "symbol")],
  }),
  capability({
    name: "tmct_tests_for", label: "tests", question: "the tests covering this symbol",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("tests", "symbol")],
  }),
  capability({
    name: "tmct_untested", label: "untested", question: "symbols with no covering test",
    params: [],
    preconditions: [graphLoaded()],
    add: [knows("untested", null)],
  }),
  capability({
    name: "tmct_history", label: "history", question: "the commit history of this symbol",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("history", "symbol")],
  }),
  capability({
    name: "tmct_cochanges", label: "cochanges", question: "symbols that change together with this one",
    params: [param("symbol", KINDS.Symbol)],
    preconditions: [graphLoaded(), resolves("symbol", KINDS.Symbol)],
    add: [knows("cochanges", "symbol")],
  }),
  capability({
    name: "tmct_architecture", label: "arch", question: "the architecture overview (optional package filter)",
    params: [param("package", KINDS.Package, { required: false })],
    preconditions: [graphLoaded()],
    add: [knows("architecture", "package")],
  }),
  capability({
    name: "tmct_related", label: "related", question: "a term's synonyms and related concepts (the SKOS view over the conversational-memory graph)",
    params: [param("term", KINDS.MemoryTerm, { note: "a concept term, matched against memory relation facts rather than resolved in the code graph" })],
    preconditions: [memoryFacts(), resolves("term", KINDS.MemoryTerm)],
    add: [knows("related", "term")],
  }),
  capability({
    name: "tmct_sprite", label: "sprite", question: "the sprite for a class, with the expression and size asked for",
    params: [
      param("class", KINDS.MemoryTerm, { arg: "class", note: "a world class, matched against the memory graph's own fact rows rather than resolved in the code graph" }),
      param("expression", KINDS.Kind, { required: false, note: "one of sprite-expressions.mjs's palette words, carried as an mgx:feels fact" }),
      param("size", KINDS.Kind, { required: false, note: "a taught mgx:hasProperty size word, resolved to a render scale — not a template tier" }),
    ],
    preconditions: [memoryFacts(), resolves("class", KINDS.MemoryTerm)],
    add: [knows("sprite", "class")],
  }),
]);

// The live capability set: the built-in frozen array is the seed; registration
// rebuilds `list`/`byName` wholesale so every accessor stays a plain read.
const buildIndex = (caps) => Object.freeze(
  caps.reduce((m, c) => { m[c.name] = c; return m; }, Object.create(null)),
);
let list = CAPABILITIES;
let byName = buildIndex(list);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}

/** Register a capability at runtime (e.g. a taught action family bridged in by
 *  src/domain/router/taught.mjs). `readOnly` must be an explicit boolean: it is
 *  what resolver.mjs's dispatch gate reads, and a `readOnly: false` record is
 *  never dispatched. `dispatchable` is derived from it for callers that want the
 *  record to state the conclusion. Returns an `unregister()` disposer. */
export function registerCapability(cap) {
  const name = cap && typeof cap.name === "string" ? cap.name.trim() : "";
  if (!name) throw new Error("registerCapability: a non-empty name is required");
  if (byName[name]) throw new Error(`registerCapability: "${name}" is already registered`);
  if (!Array.isArray(cap.parameters) || !Array.isArray(cap.preconditions)) {
    throw new Error(`registerCapability: "${name}" needs parameters[] and preconditions[]`);
  }
  if (!cap.effects || !Array.isArray(cap.effects.add) || !Array.isArray(cap.effects.del)) {
    throw new Error(`registerCapability: "${name}" needs effects {add: [], del: []}`);
  }
  if (typeof cap.readOnly !== "boolean") {
    throw new Error(`registerCapability: "${name}" needs an explicit boolean readOnly`);
  }
  const rec = deepFreeze({
    type: VOCAB.Capability,
    ...cap,
    name,
    dispatchable: cap.readOnly === true ? cap.dispatchable !== false : false,
  });
  list = Object.freeze([...list, rec]);
  byName = buildIndex(list);
  return function unregister() {
    list = Object.freeze(list.filter((c) => c !== rec));
    byName = buildIndex(list);
  };
}

// ---- unregistered dispatch tools ---------------------------------------------
// Dispatch tools not yet registered; each names the work it needs first — a
// precondition/effect design, or resolver wiring, before it can join the registry.
export const EXCLUDED_FROM_REGISTRY = Object.freeze({
  tmct_context: "unbounded edit-context bundle (multi-file); needs a size/budget precondition",
  tmct_context_more: "unbounded context continuation; same as tmct_context",
  tmct_snippet: "raw source-file read (reads the filesystem); needs a file-read + span precondition",
  tmct_ask: "the plain-English question entry point itself — calls ask.mjs directly and bypasses the capability planner; not one of the planner's operators",
  tmct_export: "reads the memory store's whole fact set with no discriminating param and no resolver goal frame; needs NL-reachability wiring before it can join",
  tmct_ingest: "writes into the memory store (grounds facts); capability() only models read-only operators, so a write path needs its own precondition/effect design first",
  tmct_file_history: "a module-grain cut of the same history edge tmct_history already models; no NL frame distinguishes the granularities yet",
  tmct_method_history: "a method-grain cut of the same history edge tmct_history already models; no NL frame distinguishes the granularities yet",
  tmct_class_history: "a class-grain cut of the same history edge tmct_history already models; no NL frame distinguishes the granularities yet",
});

/** The full registry as a plain frozen object (facts + index), for callers that
 *  want the whole substrate. Prefer the accessors below for lookups. */
export const REGISTRY = Object.freeze({
  prefixes: PREFIXES,
  vocab: VOCAB,
  kinds: KINDS,
  precond: PRECOND,
  get capabilities() { return list; },
});

// ---- pure accessors ---------------------------------------------------------

/** All declared capabilities (the operator set, plus any registered at runtime). */
export function capabilities() { return list; }

/** The capability named `n`, or undefined. */
export function capabilityByName(n) { return byName[n]; }

/** True iff `n` names a declared capability. */
export function isCapability(n) { return Boolean(byName[n]); }

/** The parameter slots of capability `n` (empty array if unknown/no-arg). */
export function parametersOf(n) { return byName[n]?.parameters ?? []; }

/** The preconditions of capability `n` (the safety gate the resolver checks). */
export function preconditionsOf(n) { return byName[n]?.preconditions ?? []; }

/** The effects of capability `n` — `{ add, del }` (the proof-chain contribution). */
export function effectsOf(n) { return byName[n]?.effects ?? { add: [], del: [] }; }

/** The set of arg keys capability `n` accepts (for call-validator.mjs's
 *  unknown-arg check). Returns a Set of strings. */
export function argKeysOf(n) {
  return new Set(parametersOf(n).map((p) => p.arg));
}

/** The required arg keys of `n` (params with required:true). */
export function requiredArgsOf(n) {
  return parametersOf(n).filter((p) => p.required).map((p) => p.arg);
}
