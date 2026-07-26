// The Repository Interface — tmct's OWNED, versioned contract between "interpret
// the query" (tmct, the brittle side) and "ask the graph for truth" (a provider,
// the stable side).
//
// tmct defines and versions this shape; a provider (seonix, a fixture, a browser
// page) IMPLEMENTS it over its native graph. Both sides already agree on the
// TYPES — every Individual.class is a `tmct:` class and every Edge.predicate a
// `tmct:` object property (ontology/tmct-core.ttl is the type dictionary) — so
// the interface only names the OPERATIONS over those shared types.
//
// The error contract is the load-bearing rule: a clean miss is a first-class
// RETURN VALUE from a small CLOSED set of reasons (MISS_REASONS), never a throw.
// Presentation (the render* layer, the chat surface) lives on tmct's side of the
// seam and turns these typed results into prose; the interface returns data.
//
// This module is pure data + tiny constructors — no fs, no graph, no LLM.

/** SemVer of the interface. Additive-by-default: new services / optional args are
 *  minor bumps; the suite for version N stays green under N+1. A breaking change
 *  is a new MAJOR with its own suite. */
export const INTERFACE_VERSION = "1.1.0";

/** The OWL vocabulary the types are grounded in. */
export const ONTOLOGY_IRI = "urn:tmct:core";

/**
 * The CLOSED set of miss reasons. A service that cannot answer returns
 * `miss(reason, detail)` with `reason` drawn from exactly these — the interpreter
 * renders the reason, never free-text error prose.
 *
 * - UNRESOLVED_TERM   the term named no individual in the graph.
 * - CAPABILITY_ABSENT the provider does not implement this service (negotiated away).
 * - TRUNCATED_GRAPH   the answer exists but the provider shipped a truncated sample.
 * - NO_SOURCE         a source-reaching service, but the provider exposes no working tree.
 */
export const MISS_REASONS = Object.freeze({
  UNRESOLVED_TERM: "UNRESOLVED_TERM",
  CAPABILITY_ABSENT: "CAPABILITY_ABSENT",
  TRUNCATED_GRAPH: "TRUNCATED_GRAPH",
  NO_SOURCE: "NO_SOURCE",
});

/** The closed vocabulary of edge kinds `edges(id, kind)` traverses, each aligned
 *  to a `tmct:` object property (ontology/tmct-core.ttl). Symbol-granular kinds
 *  (callsSymbol/touchesSymbol) stay separate from module-coarse calls/touches. */
export const EDGE_KINDS = Object.freeze([
  "imports", "calls", "callsSymbol", "defines", "tests",
  "touches", "touchesSymbol", "contains", "inherits", "cochange", "reexports",
]);

/** edge-kind → the `tmct:` object property it realizes (the OWL grounding). */
export const EDGE_KIND_TO_TMCT = Object.freeze({
  imports: "tmct:imports",
  calls: "tmct:calls",
  callsSymbol: "tmct:calls",
  defines: "tmct:defines",
  tests: "tmct:covers",
  touches: "tmct:touches",
  touchesSymbol: "tmct:touches",
  contains: "tmct:contains",
  inherits: "tmct:extends",
  cochange: "tmct:dependsOn",
  reexports: "tmct:exports",
});

/** The named services, grouped as in the plan's six-group inventory. Names are
 *  the interface's stable identifiers; a provider advertises which it implements
 *  as its `capabilities`. `source: true` marks the working-tree-reaching services
 *  a graph-only provider may satisfy with an honest NO_SOURCE miss. */
export const SERVICE_GROUPS = Object.freeze({
  resolution: ["resolve", "describe", "members", "subclasses", "exports", "signature"],
  traversal: ["edges", "impact"],
  source: ["snippet", "context"],
  aggregate: ["architecture", "untested", "stats"],
  temporal: ["history"],
  search: ["search", "ask"],
});

/** Flat list of every service name. */
export const SERVICES = Object.freeze(
  Object.values(SERVICE_GROUPS).flat(),
);

/** The subset that reaches past the graph into a working tree. */
export const SOURCE_SERVICES = Object.freeze(new Set(SERVICE_GROUPS.source));

// ---- result constructors — the honest-miss ethos as tiny values --------------

/** A successful result carrying typed `value`. */
export function hit(value) {
  return { ok: true, value };
}

/** A first-class miss: `reason` ∈ MISS_REASONS, optional `detail` (free text for
 *  the human render) and `term` (what was looked up). Never thrown. */
export function miss(reason, { detail = "", term = null } = {}) {
  if (!MISS_REASONS[reason]) {
    throw new TypeError(`miss(): unknown reason "${reason}" (not in MISS_REASONS)`);
  }
  return { ok: false, miss: { reason, detail, term } };
}

export const isHit = (r) => Boolean(r && r.ok === true);
export const isMiss = (r) => Boolean(r && r.ok === false);

// ---- type projections — raw graph rows → the interface's shared shapes --------

/**
 * Project a raw graph individual to the interface `Individual`:
 *   { id, label, class, attributes: [{ key, value, prop }] }
 * `class` is a `tmct:` class token; `attributes[].prop` is the SEON/mgx token the
 * value was asserted under (OWL grounding preserved). Pure; tolerant of partials.
 * @returns {Individual|null}
 */
export function toIndividual(ind) {
  if (!ind || !ind.id) return null;
  return {
    id: String(ind.id),
    label: ind.label != null ? String(ind.label) : String(ind.id),
    class: ind.class || "Entity",
    attributes: (Array.isArray(ind.attributes) ? ind.attributes : []).map((a) => ({
      key: a.key,
      value: a.value,
      prop: a.prop || null,
    })),
  };
}

/**
 * Project a raw relation edge to the interface `Edge`:
 *   { subject, object, predicate, prop, subjectLabel?, objectLabel?, weight? }
 * The required quartet is subject/object/predicate/prop; labels/weight are
 * additive conveniences a provider MAY carry.
 * @returns {Edge}
 */
export function toEdge(rawEdge, { predicate = "", prop = null } = {}) {
  const e = {
    subject: rawEdge.subject,
    object: rawEdge.object,
    predicate,
    prop: prop || null,
  };
  if (rawEdge.subjectLabel != null) e.subjectLabel = rawEdge.subjectLabel;
  if (rawEdge.objectLabel != null) e.objectLabel = rawEdge.objectLabel;
  if (rawEdge.weight != null) e.weight = rawEdge.weight;
  return e;
}

// ---- capability negotiation — CAPABILITY_ABSENT as a value, not a wall --------

/**
 * Invoke a service through capability negotiation. If the provider does not
 * advertise `service` in `svc.capabilities`, return `miss(CAPABILITY_ABSENT)`
 * rather than throwing — the interpreter degrades the query, never errors. When
 * present, calls `svc[service](...args)` and returns its result verbatim.
 *
 * This is how a host calls an interface it cannot assume is complete; the
 * reference providers implement every service, so they never trip it.
 */
export function invoke(svc, service, ...args) {
  const caps = svc && svc.capabilities;
  const has = Array.isArray(caps) ? caps.includes(service) : caps instanceof Set ? caps.has(service) : false;
  if (!has || typeof svc[service] !== "function") {
    return miss(MISS_REASONS.CAPABILITY_ABSENT, { detail: `service "${service}" is not implemented by this provider` });
  }
  return svc[service](...args);
}

// ---- the MACHINE-READABLE SHAPE ----------------------------------------------
// A single JSON-serializable object enumerating every service, its args, result
// type, and possible misses. tmct OWNS and versions this; docs/repository-
// interface.md is the prose peer and docs/repository-interface.schema.json is the
// committed serialization (the contract suite asserts they agree — no drift).

const IND = "Individual";
const EDGE = "Edge";

/** Concurrency note shared by every read service: safe across handles — the graph
 *  is read-only truth and the only mutable state is the caller-owned session
 *  handle, never touched here. Proven by the suite's concurrent-session cases. */
const CONCURRENT_SAFE = "concurrent-safe: reads immutable graph truth; no shared mutable state";

export const REPOSITORY_INTERFACE = Object.freeze({
  version: INTERFACE_VERSION,
  ontology: ONTOLOGY_IRI,
  missReasons: Object.values(MISS_REASONS),
  edgeKinds: [...EDGE_KINDS],
  types: {
    Individual: {
      fields: {
        id: "string (opaque provider id)",
        label: "string (human/display name)",
        class: "string — a tmct: class token (module|class|function|method|attribute|variable|commit|test|…)",
        attributes: "Array<{ key: string, value: string, prop: string|null }> — prop is the SEON/mgx token grounding the value",
      },
    },
    Edge: {
      fields: {
        subject: "string (individual id)",
        object: "string (individual id)",
        predicate: "string — the relation predicate",
        prop: "string|null — the SEON/mgx property token; see edgeKinds → tmct: mapping",
        subjectLabel: "string? (additive)",
        objectLabel: "string? (additive)",
        weight: "number? (additive; e.g. cochange coupling)",
      },
    },
    Result: { shape: "{ ok: true, value: T } | { ok: false, miss: Miss }" },
    Miss: { shape: "{ reason: MISS_REASONS, detail: string, term: string|null }" },
  },
  capabilitiesModel:
    "A provider advertises `capabilities: string[]` (service names it implements). " +
    "A service outside the set is negotiated away to miss(CAPABILITY_ABSENT) — never an error. " +
    "snippet may be advertised yet answer miss(NO_SOURCE) when no working tree exists (it has " +
    "nothing useful without fs); context is graph-only-capable since INTERFACE_VERSION 1.1.0 — " +
    "it returns a real hit (graph-only bundle) for any resolvable symbol even with no working " +
    "tree, only escalating NO_SOURCE-style behavior to richer body text when source-capable.",
  services: {
    resolve: {
      group: "resolution", args: { term: "string" },
      result: `{ match: ${IND}, candidates: ${IND}[] }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "The resolveSymbol seam: map a free term to an individual + runner-up candidates. Every id-taking service consumes a resolved id.",
    },
    describe: {
      group: "resolution", args: { id: "string" },
      result: `{ individual: ${IND}, out: ${EDGE}[], incoming: ${EDGE}[] }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "Full typed portrait of one individual: its attributes and its outgoing/incoming edges.",
    },
    members: {
      group: "resolution", args: { classId: "string" },
      result: `{ methods: ${IND}[], attributes: ${IND}[] }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "A class's methods + attributes (via the contains relation) — replaces reading the class body.",
    },
    subclasses: {
      group: "resolution", args: { classId: "string" },
      result: `{ bases: ${IND}[], subclasses: ${IND}[], levels: Array<${IND}[]> }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "Forward bases + the transitive reverse inheritance closure (who extends this). `subclasses` is the flat closure; `levels` groups the same individuals by inheritance depth (direct children first), mirroring `impact`'s leveled shape.",
    },
    exports: {
      group: "resolution", args: { moduleId: "string" },
      result: `{ exports: ${IND}[] }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "A module's curated public API (resolved __all__ / re-exports).",
    },
    signature: {
      group: "resolution", args: { id: "string" },
      result: "{ id, label, class, params, returns, raises, decorators, doc, selfFields, flags }",
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "The compact API surface of a symbol without its body.",
    },
    edges: {
      group: "traversal", args: { id: "string", kind: "EDGE_KINDS member" },
      result: `{ kind: string, edges: ${EDGE}[] }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "Outgoing edges of one closed kind from an individual (an honest empty array is not a miss).",
      note: "An unknown kind (outside EDGE_KINDS) is a programming error and throws TypeError, not a miss.",
    },
    impact: {
      group: "traversal", args: { moduleId: "string" },
      result: `{ total: number, levels: Array<Array<{ id, label, via, tests }>> }`,
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "The transitive dependent closure the interpreter cannot compute without provider truth.",
    },
    snippet: {
      group: "source", args: { id: "string" },
      result: "{ path: string, span: { start, end }, body: string|null } — Promise<Result>",
      misses: ["UNRESOLVED_TERM", "NO_SOURCE"], concurrency: CONCURRENT_SAFE,
      purpose: "The exact source span of a symbol. A provider with no working tree returns miss(NO_SOURCE) honestly — snippet has nothing useful without fs.",
      note: "ASYNC (returns Promise<Result>) — a real body read is inherently fs I/O; callers should always await it. A graph-only provider still resolves synchronously-in-spirit (the promise settles on the same tick) but the return type is uniformly a Promise regardless of sourceAccess.",
    },
    context: {
      group: "source", args: { symbol: "string", depth: "min|auto|full?" },
      result: "{ text: string, tier: string } (a sized edit bundle) — Promise<Result>",
      // contextPlan/sizeBundle/renderGraphOnlyBundle are pure graph queries, so a graph-only
      // provider (sourceAccess:false) returns a REAL HIT for any resolvable symbol —
      // siblings, registration, class members, __all__/re-exports, insertion region, covering
      // tests, co-change — everything except anchor/exemplar/inlined-callee BODY TEXT, which
      // still needs a source-capable provider. NO_SOURCE is therefore not a miss reason
      // context() can return (not in the list below) — the only remaining miss is an
      // unresolvable symbol.
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "The composed edit bundle (exemplar, siblings, registration, insertion region). A graph-only provider returns the graph-only sections as a real hit; a source-capable provider (sourceAccess:true, repoRoot, readFile) additionally includes the anchor/exemplar/inlined-callee body text.",
      note: "ASYNC (returns Promise<Result>) — see snippet's note; source-capable rendering is fs I/O.",
    },
    architecture: {
      group: "aggregate", args: { package: "string?" },
      result: "{ modules: number, packages: Array<[dir, count]>, hubs: Array<{ id, label, importers }> }",
      misses: [], concurrency: CONCURRENT_SAFE,
      purpose: "Package/module shape + the most-imported hub modules. Optional package prefix scopes it.",
    },
    untested: {
      group: "aggregate", args: {},
      result: `{ modules: ${IND}[] }`,
      misses: [], concurrency: CONCURRENT_SAFE,
      purpose: "Modules with no covering test module (via the tests relation).",
    },
    stats: {
      group: "aggregate", args: {},
      result: "{ total: number, classes: Array<{ class: string, count: number }>, truncated: boolean }",
      misses: [], concurrency: CONCURRENT_SAFE,
      purpose: "Per-tmct:class individual counts, read straight from the payload.",
    },
    history: {
      group: "temporal", args: { id: "string" },
      result: "{ commits: Array<{ id, label, author, date, message }> }",
      misses: ["UNRESOLVED_TERM"], concurrency: CONCURRENT_SAFE,
      purpose: "The commits that touched an individual (tmct:commit individuals via tmct:touches).",
    },
    search: {
      group: "search", args: { query: "string", kind: "string?", name: "string?", decorator: "string?" },
      result: `{ results: ${IND}[] }`,
      misses: [], concurrency: CONCURRENT_SAFE,
      purpose: "Lexical, provider-local locate. An empty result set is honest, not a miss.",
    },
    ask: {
      group: "search", args: { query: "string" },
      result: "{ content: string, tmct_ask: object } (the composed NL round-trip envelope)",
      misses: [], concurrency: CONCURRENT_SAFE,
      purpose: "The mechanical, zero-model NL query over the graph — tmct's whole reason to exist.",
    },
  },
});

/** Freeze-deep helper is unnecessary; REPOSITORY_INTERFACE is treated as read-only
 *  data. Exported so the contract suite and docs generator share one source. */
export default REPOSITORY_INTERFACE;
