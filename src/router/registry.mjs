// src/router/registry.mjs — the capability registry.
//
// Each tmct tool is modelled as a STRIPS/PDDL operator declared as DATA: a `Capability` with
// typed `Parameter`s, `Precondition`s, and `Effect`s (add-list/delete-list). Preconditions are
// the safety gate guardrail.mjs checks before a call fires; resolver.mjs backward-chains from
// a goal to a capability whose add-list achieves it.
//
// Plain data + pure accessors, no I/O. Tool names + parameter arg keys are the
// exact ones src/server.mjs `dispatchTool` reads, so a bound call this registry validates is
// directly dispatchable.

export const PREFIXES = Object.freeze({
  cap: "urn:tmct:cap#", // the capability/operator vocabulary (this module)
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
// name a graph entity the guardrail must prove RESOLVES before the call fires.
export const KINDS = Object.freeze({
  Symbol: "seon:CodeEntity", // any code symbol: function/method/class/module/attribute
  Module: "seon:Module",
  Class: "seon:ClassDefinition",
  Query: "cap:FreeText", // lexical search string — no resolution precondition
  Kind: "cap:KindFilter", // enum: function|class|method|… (search filter)
  Package: "cap:PackageName", // optional architecture-scope filter
});

// Precondition PREDICATE tags (the small closed vocabulary a precondition uses).
export const PRECOND = Object.freeze({
  graphLoaded: "cap:graph-loaded", // a graph artifact is present + parseable
  resolves: "cap:resolves", // { param, as } — the slot binds to an entity of kind `as`
  anyPresent: "cap:any-present", // { params } — at least one of these slots is provided
});

// ---- capability builder (returns PLAIN FROZEN data) -------------------------

/** A parameter slot. `arg` is the exact key src/server.mjs `dispatchTool` reads. */
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
// Arg keys verified against src/server.mjs `dispatchTool`'s switch: describe/callers/
// callees/tests/history/… take `symbol`; impact/exports take `module`; members/
// subclasses take `class`; search takes `query` (+ optional kind/name/decorator);
// architecture takes an optional `package`; untested takes nothing.

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
    name: "tmct_impact", label: "impact", question: "what a change to this module reaches (impact closure)",
    params: [param("module", KINDS.Module)],
    preconditions: [graphLoaded(), resolves("module", KINDS.Module)],
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
]);

// A frozen name→capability index (built once).
const BY_NAME = Object.freeze(
  CAPABILITIES.reduce((m, c) => { m[c.name] = c; return m; }, Object.create(null)),
);

// ---- unregistered dispatch tools ---------------------------------------------
// Dispatch tools not yet registered; each names the precondition work it needs first.
export const EXCLUDED_FROM_REGISTRY = Object.freeze({
  tmct_context: "unbounded edit-context bundle (multi-file); needs a size/budget precondition",
  tmct_context_more: "unbounded context continuation; same as tmct_context",
  tmct_snippet: "raw source-file read (reads the filesystem); needs a file-read + span precondition",
});

/** The full registry as a plain frozen object (facts + index), for callers that
 *  want the whole substrate. Prefer the accessors below for lookups. */
export const REGISTRY = Object.freeze({
  prefixes: PREFIXES,
  vocab: VOCAB,
  kinds: KINDS,
  precond: PRECOND,
  capabilities: CAPABILITIES,
});

// ---- pure accessors ---------------------------------------------------------

/** All declared capabilities (the operator set). */
export function capabilities() { return CAPABILITIES; }

/** The capability named `n`, or undefined. */
export function capabilityByName(n) { return BY_NAME[n]; }

/** True iff `n` names a declared capability. */
export function isCapability(n) { return Boolean(BY_NAME[n]); }

/** The parameter slots of capability `n` (empty array if unknown/no-arg). */
export function parametersOf(n) { return BY_NAME[n]?.parameters ?? []; }

/** The preconditions of capability `n` (the safety gate the guardrail checks). */
export function preconditionsOf(n) { return BY_NAME[n]?.preconditions ?? []; }

/** The effects of capability `n` — `{ add, del }` (the proof-chain contribution). */
export function effectsOf(n) { return BY_NAME[n]?.effects ?? { add: [], del: [] }; }

/** The set of arg keys capability `n` accepts (for the guardrail's unknown-arg
 *  check). Returns a Set of strings. */
export function argKeysOf(n) {
  return new Set(parametersOf(n).map((p) => p.arg));
}

/** The required arg keys of `n` (params with required:true). */
export function requiredArgsOf(n) {
  return parametersOf(n).filter((p) => p.required).map((p) => p.arg);
}
