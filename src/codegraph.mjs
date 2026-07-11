import { lookupByProseTokens, proseLayerHits } from "./prose.mjs";
import { cosine } from "./embed.mjs";
// Single-sourced predicate strings (memory/core.mjs owns these constants) — no
// circular-import risk: core.mjs imports trust.mjs/shacl.mjs/planning.mjs, never
// codegraph.mjs, in either direction.
import { CREATED_AT_PROP, UPDATED_AT_PROP } from "./memory/core.mjs";

// Pure (no-network, no-fs) query logic over the typed `entities` payload that the
// deterministic indexer writes to <repo>/.tmct/graph.json (shape produced by
// src/graph-build.mjs):
//
//   {
//     generated_at, classes: [{name, count, sample[]}],
//     objectProperties: [{predicate, prop, count, examples: [{subject, object,
//                         subjectLabel, objectLabel}]}],
//     individuals: [{id, label, class, derived_from: [ref], mentions: [{id, count}],
//                    attributes?: [{prop, key, value}]}],
//   }
//
// Ported ≈verbatim from marginalia seon-mcp/src/codegraph.mjs (the shipped,
// tested typed-edge query layer). The only edits: provenance/attestation wording
// is code-graph-generic (git:<sha> / file:line refs, not memory-node prose), and
// a renderSearch() is added for the local, deterministic tmct_search.
//
// Edge inventory is read DYNAMICALLY from the payload (predicate verb + the closed
// `prop` token like "mg:imports"); only the kind-classifier for the impact closure
// hardcodes the relation set.

// ---- payload parsing ---------------------------------------------------------

export function parseEntities(payload) {
  const individuals = Array.isArray(payload?.individuals) ? payload.individuals : [];
  const byId = new Map();
  for (const ind of individuals) {
    if (ind && ind.id) byId.set(ind.id, ind);
  }
  const relations = (Array.isArray(payload?.objectProperties) ? payload.objectProperties : [])
    .filter((g) => g && (g.predicate || g.prop))
    .map((g) => {
      const edges = (Array.isArray(g.examples) ? g.examples : []).filter((e) => e && e.subject && e.object);
      return {
        predicate: String(g.predicate || ""),
        prop: g.prop || null,
        count: Number(g.count) || edges.length,
        edges,
      };
    });
  const truncated = relations
    .filter((g) => g.count > g.edges.length)
    .map((g) => ({ predicate: g.predicate, count: g.count, shown: g.edges.length }));
  return {
    individuals,
    byId,
    relations,
    truncated,
    generatedAt: payload?.generated_at || null,
    // Second pass (PLAN_PROSE_INDEX.md): word -> [individual ids], passed through
    // byte-identical from the payload so ask.mjs's resolveObject can consult it as a
    // fallback tier without reaching back into the raw payload itself. {} when the
    // build had prose disabled or the payload predates this field.
    proseIndex: payload?.proseIndex || {},
  };
}

// ---- relation-kind classifier (for impact + tests-coverage) -------------------

const KINDS = ["imports", "calls", "defines", "tests", "touches", "contains", "inherits", "callsSymbol", "touchesSymbol"];

// Closed prop tokens → relation kind. Primary vocabulary is SEON (se-on.org) +
// our `mgx:` extension; the legacy `mg:` tokens are kept so a stale artifact still
// classifies. Lower-cased keys.
const PROP_KIND = {
  // v2.0 faithful tokens (SEON-faithful realign)
  "mgx:importsnamespace": "imports",
  "mgx:callscoarse": "calls",
  "seon:declaresmethod": "defines",
  "mgx:testscoverage": "tests",
  "mgx:touchedbycommit": "touches",
  "seon:containscodeentity": "contains",
  "seon:hassupertype": "inherits",
  "mgx:changecoupledwith": "cochange",
  "mgx:reexports": "reexports",
  // fine-grained symbol-level edges (Commit→symbol history, fn→fn in-repo calls).
  // These stay SEPARATE kinds from the module-coarse "touches"/"calls" so the impact
  // closure (module-coarse) is unchanged.
  "mgx:touchessymbol": "touchesSymbol",
  "mgx:callssymbol": "callsSymbol",
  // legacy tokens (pre-realign graphs) — kept so a stale artifact still classifies
  "seon:usescomplextype": "imports",
  "seon:invokesmethod": "calls",
  "seon:history": "touches",
  "mgx:subclassof": "inherits",
  "mg:imports": "imports",
  "mg:calls": "calls",
  "mg:defines": "defines",
  "mg:tests": "tests",
  "mg:touches": "touches",
  // memory-graph predicates (src/memory/core.mjs, src/sessions.mjs) — each maps to
  // itself as its own kind name (no module-rollup abbreviation needed, unlike
  // imports/calls) so adjacencyForKinds/edgesOfKind can walk the memory graph too.
  "mgx:saidinsession": "saidInSession",
  "mgx:inreplyto": "inReplyTo",
  "mgx:statedby": "statedBy",
  "mgx:canonicalisedfrom": "canonicalisedFrom",
};

export function relationKind(group) {
  const prop = String(group?.prop || "").toLowerCase();
  if (PROP_KIND[prop]) return PROP_KIND[prop];
  const pred = String(group?.predicate || "").toLowerCase();
  // symbol-granular fallbacks first, so a near-miss token name still classifies to the
  // fine-grained kind rather than collapsing to module-coarse calls/touches.
  if (/symbol/.test(pred)) {
    if (/\b(call|invoke)/.test(pred)) return "callsSymbol";
    if (/(touch|chang|modif)/.test(pred)) return "touchesSymbol";
  }
  if (/\bimport/.test(pred)) return "imports";
  if (/\b(call|invoke)/.test(pred)) return "calls";
  if (/\b(define|export|declare)/.test(pred)) return "defines";
  if (/\b(test|cover)/.test(pred)) return "tests";
  if (/\b(touch|chang|modif)/.test(pred)) return "touches";
  if (/\bcontain/.test(pred)) return "contains";
  if (/\b(inherit|subclass|extend|specializ)/.test(pred)) return "inherits";
  return null;
}

// ---- symbol resolution (exact → normalised path → substring) ------------------

export function normPath(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

function basename(p) {
  const parts = normPath(p).split("/");
  return parts[parts.length - 1];
}

// Attestation: a ref prefixed `git:` (a commit that touched the entity) counts as
// one mention, so better-attested (more-churned) entities rank/render ahead of
// untouched ones even before per-node mention counts exist.
const isProvRef = (r) => /^(git|turn):/.test(String(r || ""));

export function turnRefCount(ind) {
  return (ind?.derived_from || []).filter(isProvRef).length;
}

export function mentionTotal(ind) {
  const fromMentions = (ind?.mentions || []).reduce((n, m) => n + (Number(m?.count) || 0), 0);
  return fromMentions + turnRefCount(ind);
}

/**
 * Rank individuals against a symbol. Tiers:
 *   100 exact (label or id, case-insensitive)
 *    80 normalised path (path suffix / basename / extension-stripped basename)
 *    50 substring (label contains symbol), minus a length penalty
 * Ties break on mention total (better-attested first), then label length.
 * Returns { match, candidates } — candidates are the runners-up (≤4).
 */
export function resolveSymbol(graph, symbol) {
  const s = normPath(symbol);
  if (!s) return { match: null, candidates: [] };
  const sBase = basename(s);
  const scored = [];
  for (const ind of graph.individuals) {
    const label = normPath(ind.label);
    const id = String(ind.id || "").toLowerCase();
    let score = 0;
    if (label === s || id === s) score = 100;
    else if (
      label.endsWith(`/${s}`) ||
      basename(label) === sBase ||
      basename(label).replace(/\.[a-z]+$/, "") === sBase
    )
      score = 80;
    else if (label.includes(s)) score = Math.max(10, 50 - (label.length - s.length));
    if (score > 0) scored.push({ ind, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      mentionTotal(b.ind) - mentionTotal(a.ind) ||
      String(a.ind.label).length - String(b.ind.label).length,
  );
  return {
    match: scored[0]?.ind || null,
    candidates: scored.slice(1, 5).map((x) => x.ind),
  };
}

// ---- source site (for tmct_snippet) -------------------------------------------

/** Parse a Function/Class individual's `site` attribute ("path:start[-end]") into
 *  {path, start, end}, or null if it has none (e.g. a Module). Pure. */
export function siteOf(ind) {
  const a = (ind?.attributes || []).find((x) => x.key === "site");
  if (!a) return null;
  const m = String(a.value).match(/^(.*):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  return { path: m[1], start: Number(m[2]), end: m[3] ? Number(m[3]) : Number(m[2]) };
}

// ---- describe ------------------------------------------------------------------

function edgesFor(graph, id) {
  const out = [];
  const incoming = [];
  for (const g of graph.relations) {
    const outgoing = g.edges.filter((e) => e.subject === id);
    const inbound = g.edges.filter((e) => e.object === id);
    if (outgoing.length) out.push({ group: g, edges: outgoing });
    if (inbound.length) incoming.push({ group: g, edges: inbound });
  }
  return { out, incoming };
}

function relLabel(g) {
  return g.prop ? `${g.predicate} [${g.prop}]` : g.predicate;
}

// Bounded list rendering — token efficiency is the whole point of the graph, so
// hub entities must never dump hundreds of edges. Show the first `n`, then a
// "+K more" tail with the true count.
function capJoin(items, n, sep = ", ") {
  if (items.length <= n) return items.join(sep);
  return items.slice(0, n).join(sep) + `, +${items.length - n} more`;
}

const DESCRIBE_EDGE_CAP = 30;
const PROV_CAP = 8;

/** Compact plain-text description of one individual — for an agent consumer. */
export function renderDescribe(graph, ind, { candidates = [] } = {}) {
  const lines = [];
  lines.push(`${ind.label} — ${ind.class || "Entity"} (id: ${ind.id})`);

  const refs = (ind.derived_from || []).filter(isProvRef);
  if (refs.length) lines.push(`attestation: touched by ${refs.length} commit(s)`);

  for (const a of ind.attributes || []) {
    lines.push(`attribute: ${a.key} = ${a.value}${a.prop ? ` [${a.prop}]` : ""}`);
  }

  const { out, incoming } = edgesFor(graph, ind.id);
  if (!out.length && !incoming.length) {
    lines.push("edges: none in the current artifact");
  } else {
    lines.push("edges:");
    for (const { group, edges } of out) {
      lines.push(`  ${relLabel(group)} (${edges.length}) → ${capJoin(edges.map((e) => e.objectLabel || e.object), DESCRIBE_EDGE_CAP)}`);
    }
    for (const { group, edges } of incoming) {
      lines.push(`  ← ${relLabel(group)} (${edges.length}) by ${capJoin(edges.map((e) => e.subjectLabel || e.subject), DESCRIBE_EDGE_CAP)}`);
    }
  }

  const prov = (ind.derived_from || []);
  if (prov.length) {
    lines.push(`provenance: ${capJoin(prov, PROV_CAP)}`);
  }

  if (candidates.length) {
    lines.push(`other matches: ${candidates.map((c) => `${c.label} (${c.class})`).join(", ")}`);
  }
  if (graph.truncated.length) {
    lines.push(truncationNote(graph));
  }
  return lines.join("\n");
}

function truncationNote(graph) {
  const list = graph.truncated.map((t) => `${t.predicate} (${t.shown}/${t.count})`).join(", ");
  return `note: partial edge lists for: ${list}. Counts are complete; the lists are not.`;
}

// ---- impact (transitive reverse closure over imports/calls) ---------------------

/**
 * BFS the REVERSE of imports/calls edges from `ind` — "what would break".
 * Diamonds collapse (a node appears once, at its shortest depth); cycles
 * terminate via the visited set. Each dependent carries the via-predicate and
 * the test modules covering it (subjects of tests-kind edges pointing at it).
 *
 * Module-coarse "calls" (`mgx:callsCoarse`, graph-build.mjs) is deliberately
 * conservative — it only fires when the callee's module is ALREADY in the
 * caller's import list ("coarse, import-backed calls", graph-build.mjs's own
 * comment), so by construction every "calls" edge is a strict subset of an
 * "imports" edge between the same pair — it never independently extends this
 * closure's reach beyond what "imports" alone already gives it. `callsSymbol`
 * (fn/method-granular, no import-backing requirement — same-module calls,
 * ambiguous-name calls the coarse pass drops) is the richer signal; this
 * closure also folds it in, coarsened to module level on read (never stored),
 * mirroring the technique `adjacencyForKinds`/`BEAM_EDGE_GROUPS` already use
 * for the same reason.
 */
export function impactClosure(graph, ind, { maxDepth = 8 } = {}) {
  const dependents = new Map();
  const coveredBy = new Map(); // moduleId → [test labels]
  const addDependent = (objectId, subjectId, subjectLabel, via) => {
    // Self-loop guard: callsSymbol coarsens to module level, so two symbols in
    // the SAME module calling each other must not produce a module pointing at
    // itself (imports/calls edges are already module-to-module and can't self-loop).
    if (!objectId || !subjectId || objectId === subjectId) return;
    if (!dependents.has(objectId)) dependents.set(objectId, []);
    dependents.get(objectId).push({ id: subjectId, label: subjectLabel, via });
  };
  for (const g of graph.relations) {
    const kind = relationKind(g);
    if (kind === "imports" || kind === "calls") {
      for (const e of g.edges) addDependent(e.object, e.subject, e.subjectLabel || e.subject, g.predicate);
    } else if (kind === "callsSymbol") {
      for (const e of g.edges) {
        const subjModId = moduleIdOfId(graph, e.subject);
        const objModId = moduleIdOfId(graph, e.object);
        if (!subjModId || !objModId) continue;
        const subjLabel = graph.byId.get(subjModId)?.label || subjModId;
        addDependent(objModId, subjModId, subjLabel, g.predicate);
      }
    } else if (kind === "tests") {
      for (const e of g.edges) {
        if (!coveredBy.has(e.object)) coveredBy.set(e.object, []);
        coveredBy.get(e.object).push(e.subjectLabel || e.subject);
      }
    }
  }

  const levels = []; // [[{id, label, via, tests[]}], …] indexed by depth-1
  const visited = new Set([ind.id]);
  let frontier = [ind.id];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next = [];
    const level = [];
    for (const id of frontier) {
      for (const dep of dependents.get(id) || []) {
        if (visited.has(dep.id)) continue;
        visited.add(dep.id);
        level.push({ ...dep, tests: coveredBy.get(dep.id) || [] });
        next.push(dep.id);
      }
    }
    if (level.length) {
      level.sort((a, b) => String(a.label).localeCompare(String(b.label)));
      levels.push(level);
    }
    frontier = next;
  }
  return levels;
}

const IMPACT_DEPTHS_LISTED = 2;   // list members for the first N depths; deeper = counts only
const IMPACT_PER_DEPTH = 25;      // members listed per depth
const IMPACT_TESTS_PER_DEP = 3;   // covering tests listed per dependent

export function renderImpact(graph, ind, { maxDepth = 8 } = {}) {
  const levels = impactClosure(graph, ind, { maxDepth });
  const lines = [`Impact of changing ${ind.label} (reverse closure over imports/calls edges, module- and function-level):`];
  if (!levels.length) {
    lines.push("no dependents found in the current artifact — nothing imports or calls it (or its edges are not in the extracted graph yet).");
  }
  const totalCount = levels.reduce((n, l) => n + l.length, 0);
  // Headline first so the magnitude is clear even when the lists are capped.
  if (levels.length) {
    lines.push(`total: ${totalCount} dependent(s) across ${levels.length} depth level(s) (lists capped for brevity).`);
  }
  levels.forEach((level, i) => {
    if (i >= IMPACT_DEPTHS_LISTED) {
      lines.push(`depth ${i + 1}: ${level.length} more dependent(s) (not listed)`);
      return;
    }
    lines.push(i === 0 ? `depth 1 (${level.length} direct dependents):` : `depth ${i + 1} (${level.length}):`);
    for (const dep of level.slice(0, IMPACT_PER_DEPTH)) {
      const tests = dep.tests.length
        ? `tests: ${capJoin(dep.tests, IMPACT_TESTS_PER_DEP)}`
        : "tests: none recorded";
      lines.push(`  - ${dep.label} (${dep.via} it) — ${tests}`);
    }
    if (level.length > IMPACT_PER_DEPTH) lines.push(`  …+${level.length - IMPACT_PER_DEPTH} more at depth ${i + 1}`);
  });
  const truncatedStructural = graph.truncated.filter((t) => {
    const kind = relationKind({ predicate: t.predicate });
    return kind === "imports" || kind === "calls" || kind === "callsSymbol" || kind === "tests";
  });
  if (truncatedStructural.length) {
    lines.push(
      "warning: partial edge lists (" +
        truncatedStructural.map((t) => `${t.predicate}: ${t.shown}/${t.count}`).join(", ") +
        ") — this closure may be missing edges. Cross-check critical results with tmct_search.",
    );
  }
  return lines.join("\n");
}

// ---- search (local, deterministic lexical lookup) ------------------------------

/** Index subjectId → [defined symbol labels] from the defines relation, once. */
function definesIndex(graph) {
  const idx = new Map();
  for (const g of graph.relations) {
    if (relationKind(g) !== "defines") continue;
    for (const e of g.edges) {
      if (!idx.has(e.subject)) idx.set(e.subject, []);
      idx.get(e.subject).push(e.objectLabel || e.object);
    }
  }
  return idx;
}

/**
 * Local, deterministic free-text lookup over the typed graph — the offline
 * replacement for marginalia's LLM-backed A2A tmct_search. Finds the MODULE
 * where code lives ("where do template filters / validators live?"): scores
 * modules by query-token hits in the path (strong) plus the count of DEFINED
 * SYMBOLS whose name matches a token (capped so a giant module can't dominate),
 * with a penalty for test modules. Renders each hit compactly with the matching
 * symbols, so the agent can jump straight to tmct_describe. No model calls.
 */
export const SEARCH_LIMIT = 10;
const SEARCH_SYMBOLS_SHOWN = 8;
// Locate scoring — IDF-weighted, component-aware. The rig queries with the WHOLE problem
// statement, so ubiquitous tokens (template/filter/value/text) would swamp the score; weight each
// token by rarity across modules (inverse module-frequency) so the distinctive term decides. Match
// identifier COMPONENTS (boundary-aware) so "text" hits utils/text.py but NOT "ci<text>". An EXACT
// defined-symbol-name hit is the strongest "the code lives here" signal. Deterministic; no models.
const PATH_W = 3;          // token == a path component (django/utils/<text>.py)
const SYM_W = 2;           // token == a component of a defined symbol name
const EXACT_W = 5;         // token == a whole defined symbol name (strongest locate signal)
const SYM_MATCH_CAP = 4;   // only the top-K highest-IDF symbol-COMPONENT hits count, so a giant
                           // bag-of-symbols module (e.g. db/backends features) can't accrete noise
const PROX_FRAC = 0.2;     // import-adjacency bonus = this × the strongest matched neighbour …
const PROX_CAP_FRAC = 0.35; //  … capped at this × the module's own score (a nudge — hubs can't run away)
const isTestLabel = (s) => /(^|\/)tests?\//.test(s) || /(^|\/)test_[^/]*\.py$/.test(s) || /\.tests(\.|$)/.test(s);
// B016 R1a (opt-in via demoteNonProd): non-production paths — examples, fixtures, sample/demo
// apps, and test-* harness packages — share path/symbol vocabulary with the production module
// and shadow it in locate (B015: js-express injected examples/route-middleware/index.js at
// rank 1; java-gson's TOP2 slot 2 was a test-shrinker fixture). DEMOTED, not excluded: none of
// the B015 truths live under these paths (checked corpus/instances-*/…/spec.json 2026-07-02),
// but a future task whose truth IS a test/example file must stay reachable.
const NONPROD_DEMOTE = 0.15;
const isNonProdLabel = (s) => /(^|\/)(examples?|fixtures?|samples?|demos?|benchmarks?|test-[^/]+)(\/|$)/.test(s);
// B016 E1a (opt-in via callAdjacency): resolved-call adjacency, same bounded-nudge shape as the
// import-proximity bonus. Python graphs carry call edges (django: 993 calls / 23,596 callsSymbol);
// the syntax-level C#/Java extractors emit ~none today, so this flag is Python-value only.
const CALL_PROX_FRAC = 0.2;
const CALL_PROX_CAP_FRAC = 0.35;
// B016 E1b (opt-in via implOfInterface): boost a module that implements an interface DEFINED
// in a strongly-matched module (C# IBasketService→BasketService, the rank-4 case). PLAN_B016
// §6.1 specified an `isAbstract` guard, but that field is never populated by any extractor —
// verified empirically 2026-07-02 against django/eshoponweb/java-gson .tmct/graph.json: 0
// individuals carry `isAbstract` in all three. The only real distinguishing signal in the data
// is C#'s naming convention (interfaces prefixed `I<Uppercase>`, e.g. IBasketService) — and C#'s
// `inherits` edges point at an UNRESOLVED `ext:<Name>` id rather than the interface's own
// individual, so the object must be resolved by an exact label match against internal
// Class-labeled individuals. SCOPED to `.cs` implementer modules only: without that scope, 11 of
// django's 7,014 inherits edges superficially match `I[A-Z]` (IOBase, IExact, IContains, …ordinary
// Python class names, not interfaces) and would reintroduce the over-injection E1a already showed
// on class-heavy Python graphs. Java's `inherits` predicate resolves cleanly to real individuals
// but carries no tag or naming convention distinguishing interface implementation from concrete
// inheritance (TypeAdapterFactory IS an interface in Gson, no "I" prefix) — a Java-safe guard does
// not exist without an extractor change (E1c, deferred). E1b is C#-only until then.
const IMPL_PROX_FRAC = 0.2;
const IMPL_PROX_CAP_FRAC = 0.35;
const isCsModuleLabel = (s) => /\.cs$/i.test(s);
const looksLikeCsInterface = (label) => /^I[A-Z]/.test(String(label || ""));

// PLAN_PROSE_INDEX.md §6 (opt-in via proseBoost, 2026-07-02): a matched module whose lexical
// score comes only from its path/symbol NAMES misses the case where the query's vocabulary
// only overlaps a decomposed identifier or a doc-comment elsewhere in that module (e.g. "billing
// calculation" never appears in `calculateTotalPrice`'s own path, only in its prose tokens).
// Same bounded-nudge shape/magnitude as the other proximity families — a nudge onto modules that
// ALREADY matched lexically (never a new zero-match candidate), never a replacement for the
// lexical score. NOT wired into any bench arm and NOT a shipped default — an available lever
// only, exactly like §5.15 beam search before it, pending its own gate/benchmark evidence.
const PROSE_PROX_FRAC = 0.2;
const PROSE_PROX_CAP_FRAC = 0.35;
const PROSE_LOOKUP_LIMIT = 50; // bounds lookupByProseTokens' scan; the CAP_FRAC bounds the nudge regardless

// Layered prose normalisation (opt-in via proseLayers, 2026-07-02): the prose index now carries
// NORMALISED layers (spell-corrected / canonical-schema-term / stem / lemma) under
// proseIndex["tmct:layers"] (built by the prose pre-pass; consumed read-only via prose.mjs's
// proseLayerHits). Today the locate scorer matches query tokens against a module's path/symbol
// text VERBATIM, so a task-text word that only reaches a module via its stem/lemma/canonical form
// scores nothing. With the flag on, a query token that does NOT already match a module lexically,
// but DOES resolve to one of that module's individuals through a normalised layer, contributes a
// bounded, DISCOUNTED signal — weaker evidence than a verbatim match by construction (halved, then
// the shared FRAC/CAP nudge), and, like every proximity family, it only re-ranks modules ALREADY
// in `scored` — it never invents a zero-match candidate and never overrides an exact hit. NOT a
// shipped default and NOT wired into any bench arm — an available lever pending its own gate
// evidence, exactly like proseBoost/beamSearch before it.
const PROSE_LAYER_FRAC = 0.2;      // bounded nudge — same shape/magnitude as the other proximity families …
const PROSE_LAYER_CAP_FRAC = 0.35; //  … capped at this × the module's own base score (a nudge; hubs can't run away)
const PROSE_LAYER_DISCOUNT = 0.5;  // a normalised-layer hit is WEAKER evidence than an exact/component token
                                   // match — halved before the FRAC/CAP nudge, so a layer hit can never rival
                                   // a verbatim lexical match (the "a miss beats a guess" discipline).

// PLAN_SEON_TUNING.md §7.5 finding 1 / §7.6(5a) (opt-in via literalMention, 2026-07-02): the query
// tokenizer split(/[^a-z0-9_]+/) DESTROYS a literal dotted module reference present verbatim in
// task text — "django.utils.http" scatters into {django,utils,http}, tokens so common across
// 2,931 modules that utils/http.py ranked 41 on B016's domain-filter — while every Module
// individual carries an unread `dotted` attribute. The lever scans the RAW query (threaded through
// as opts.rawQuery by searchModulesRanked) for whole, boundary-checked occurrences of each
// module's `dotted` name and repo-relative path (label). Boundary rule: a match flanked by an
// identifier/dotted/path continuation char ([a-z0-9_./]) does not count — which is also
// longest-match-wins for free: a package __init__'s dotted prefix ("django.utils" inside
// "django.utils.http") is followed by ".", so only the full module's own name fires (the two
// __init__.py prefix artifacts the 2026-07-02 review flagged). Specificity floor: a candidate
// with fewer than LIT_MIN_COMPONENTS dot/slash components never fires (a bare "utils" — or
// "django.utils" — must not). A hit adds a bounded BASE-score component weighted like the
// exact-symbol channel (LIT_W = EXACT_W per component IDF, top-LIT_COMP_CAP components like
// SYM_MATCH_CAP), then capped at LIT_CAP_FRAC × the strongest base score — the FRAC/CAP shape of
// the proximity families, anchored to the query's own best lexical evidence: a verbatim mention
// can lift a module INTO the top ranks but can never become an unbounded override. Applied
// BEFORE the proximity families so a mentioned module also donates adjacency like any other
// strong match. Only modules that already matched lexically are eligible (a mentioned module
// always is — its path components are query tokens by construction), preserving the levers'
// shared no-new-candidates safety scope.
const LIT_W = EXACT_W;         // per-component weight — a verbatim module mention is the strongest locate signal
const LIT_MIN_COMPONENTS = 3;  // "django.utils.http" fires; "django.utils"/"utils" never do
const LIT_COMP_CAP = 4;        // like SYM_MATCH_CAP: only the top-K highest-IDF components accrue
const LIT_FRAC = 1.0;          // bonus = min(litWeight × this, maxBase × LIT_CAP_FRAC)
const LIT_CAP_FRAC = 0.9;      //  … so a mention approaches — never dwarfs — the best lexical score

// PLAN_SEON_TUNING.md §7.6(5b) (opt-in via embedRank + an injected embedder, 2026-07-02): static-
// embedding re-rank — the deterministic "near-LLM" lever. The caller loads embed.mjs's
// potion-base-8M table (loadEmbedder(); null when the one-time-fetch weights are absent) and
// passes it as opts.embedder, keeping this module pure (no fs here; the flag no-ops with a
// one-time stderr note when the embedder is missing, so CI never needs the 30 MB artifact).
// Per-module text = path components + defined symbol names + doc first-lines — all read from the
// graph, never from source — embedded lazily and cached per process (EMB_CACHE, WeakMap-keyed on
// the graph). Cosine(query, module) becomes the same bounded FRAC/CAP nudge as the proximity
// families: only re-ranks modules that ALREADY matched lexically, never introduces a candidate.
const EMB_FRAC = 0.2;
const EMB_CAP_FRAC = 0.35;
const EMB_TEXT_SYMBOL_CAP = 64; // bound the per-module text: top defines …
const EMB_TEXT_DOC_CAP = 12;    //  … and doc first-lines (a giant module can't grow an unbounded text)
const EMB_CACHE = new WeakMap(); // graph -> { embedder, texts, vecs: Map<moduleId, Float32Array> }
let embedWarned = false;

// PLAN_SEON_TUNING.md §5.15 "discriminative multi-hop expansion" (opt-in via beamSearch):
// generalizes the R1a/E1a/E1b family's single fixed-type, single-hop nudge into an adaptive,
// multi-PLY expansion. Terminology follows Wikipedia's "Beam search" and Lowerre & Reddy, "The
// Harpy Speech Understanding System" (Carnegie-Mellon, the paper that coined "beam search" — no
// University of Essex 1980s/90s beam-search paper exists; searched 2026-07-02, none found, this
// is the honest substitute). One hop of expansion = a PLY; the surviving candidate set at a ply =
// the BEAM; beamWidth (β) caps how many survive; discarding non-survivors = PRUNING.
//
// Harpy's own beamwidth was a MARGIN/THRESHOLD relative to the ply's best score ("candidates
// that fall below a threshold of acceptability are pruned"), not a fixed count — this is a
// threshold+cap HYBRID (keep everyone within BEAM_MARGIN_FRAC of the ply's best, THEN cap at β),
// not naive top-k. A fixed-count beam would prematurely discard exactly the kind of weak-then-
// strong candidate E1b's own motivating case demonstrated: BasketService.cs sat at lexical rank 4
// and was only promoted by considering impl-of-interface structure beyond the first pass — a
// hard top-k cut at ply 0 could drop such a candidate before any later ply had a chance to
// recover it (Russell & Norvig's "local beam search... quickly becomes concentrated in a small
// region" failure mode, which Wikipedia's article cites for exactly this risk).
//
// Successors are generated PER EDGE KIND separately (not pooled then pruned once), so a dense
// edge type (imports) cannot crowd out a sparse-but-discriminative one (inherits) — each kind's
// survivors are computed independently, then MERGED (Harpy's own "candidate merging": two states
// reaching the same successor collapse to one path, keeping the better score). A short overflow
// list of near-miss pruned candidates is kept as a safety valve: if a ply's beam runs dry, the
// overflow is reconsidered rather than the walk simply stopping.
//
// SAFETY SCOPE: like every proximity family above, this only re-ranks modules that ALREADY
// matched lexically (present in `scored`) — it never introduces a zero-match candidate, so it
// cannot regress precision/over-injection the way an unbounded multi-hop walk could.
const BEAM_MARGIN_FRAC = 0.5;    // keep ply candidates scoring >= (ply-best * this), before the cap
const BEAM_PROX_FRAC = 0.2;      // bounded nudge — same shape/magnitude as the other proximity families
const BEAM_PROX_CAP_FRAC = 0.35;
const BEAM_OVERFLOW_CAP = 4;     // near-miss safety valve size
const BEAM_PLIES = 2;            // hops of expansion
const BEAM_EDGE_GROUPS = [["imports"], ["calls", "callsSymbol"], ["inherits"], ["cochange"]];

// ---- SPIRAL expansion (opt-in, default off; BEAM_RESEARCH.md's "fix #2/#3" made concrete) ------
// Deterministic bounded-radius ego walk from the lexical seeds, ordered fewest-arcs-first, with a
// degree-quantile hub gate. UNLIKE beamExpand it MAY introduce modules that had no lexical match
// (it walks the graph from the seeds), so it can in principle lift a lexically-invisible truth into
// top-k — the whole point. cochange is dropped (temporal-coupling noise; see the research synthesis).
//   • spiralDepth          — max hop radius from the seeds (bounded ego expansion). Default 3.
//   • mostDistinctiveBeams — degree-quantile gate q∈(0,1]: at each expansion step keep only the
//                            lowest-degree ⌊q·n⌋ candidates (drop the top (1−q) hubs); q=1.0 keeps
//                            all. Never empties the frontier (keeps ≥1 — the least-connected).
//   • spiralNodeLimit      — emit budget: how many newly-reached nodes the spiral surfaces. Held at
//                            12 (MID-tier digest breadth, a KNOWN-DOABLE token budget) — a fixed
//                            budget, NOT a recall dial.
const SPIRAL_DEPTH_DEFAULT = 3;
const SPIRAL_NODE_LIMIT_DEFAULT = 12;
const SPIRAL_Q_DEFAULT = 0.9;                 // mild hub pruning (drop only the densest 10%) — the centre point
const SPIRAL_EXPAND_KINDS = ["imports", "calls", "callsSymbol", "inherits"]; // cochange dropped
// The memory graph's real edge-kind inventory (traced via every objectProperties.push/.find
// site in src/memory/*.mjs and src/sessions.mjs) — the `kinds` a memory-graph spiralExpand call
// passes so it walks Session/Fact/Source/Utterance individuals rather than code-graph Modules.
// NOTE: mgx:asksAbout (src/sessions.mjs) is deliberately EXCLUDED — that predicate lives in the
// CODE graph (Session ↔ code entities a chat turn resolved/answered), not the memory graph.
export const MEMORY_SPIRAL_EXPAND_KINDS = ["saidInSession", "inReplyTo", "statedBy", "canonicalisedFrom"];
const SPIRAL_EMIT_FRAC = 0.5;                 // a newly-surfaced node's base score = maxSeed × this …
const SPIRAL_HOP_DECAY = 0.6;                 //  … decayed by this per hop from the seeds (bounded < maxSeed, so a walked-in node never dominates rank 1)
const SPIRAL_PROX_FRAC = 0.2;                 // an ALREADY-matched module the spiral re-reaches gets a bounded nudge …
const SPIRAL_PROX_CAP_FRAC = 0.35;            //  … capped at this × its own score (same shape as every other proximity family)

/** embedRank: per-module embeddable text — path components + defined symbol names + doc
 *  first-lines, ALL already in the graph (never re-reads source), bounded by the EMB_TEXT_*
 *  caps. Built once per graph and cached alongside the vectors in EMB_CACHE. */
function moduleEmbedTexts(graph) {
  const texts = new Map(); // moduleId -> text
  const defIdx = definesIndex(graph);
  const docs = new Map();  // moduleId -> [doc first-lines]
  for (const ind of graph.individuals) {
    const doc = (ind.attributes || []).find((a) => a.key === "doc")?.value;
    if (!doc) continue;
    const modId = (ind.class || "") === "Module" ? ind.id : moduleIdOf(graph, ind);
    if (!modId) continue;
    let arr = docs.get(modId);
    if (!arr) docs.set(modId, (arr = []));
    if (arr.length < EMB_TEXT_DOC_CAP) arr.push(String(doc).split("\n")[0]);
  }
  for (const ind of graph.individuals) {
    if ((ind.class || "") !== "Module") continue;
    const parts = String(ind.label).split(/[^a-zA-Z0-9_]+/).filter(Boolean);
    const syms = (defIdx.get(ind.id) || []).slice(0, EMB_TEXT_SYMBOL_CAP);
    texts.set(ind.id, [...parts, ...syms, ...(docs.get(ind.id) || [])].join(" "));
  }
  return texts;
}

/** Split a lowercased path label into boundary components: django/utils/text.py →
 *  {django,utils,text,py}. Component equality (not substring) stops "text" matching "ci<text>". */
function pathComponents(labelLc) {
  return new Set(labelLc.split(/[^a-z0-9]+/).filter(Boolean));
}
/** Split an identifier into lowercased components across snake_case AND camelCase boundaries:
 *  get_text_list → {get,text,list}; TruncatorLines → {truncator,lines}. */
function identComponents(name) {
  return new Set(String(name).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** For one edge-kind group, the depth-1 successor of `fromId` reachable via any edge in `kinds`,
 *  as a Map<moduleId, neighbourModuleId> adjacency (undirected — a module's neighbours via that
 *  kind, in either edge direction). Endpoints are mapped to their containing module first (call
 *  edges live at function granularity), matching the existing E1a call-adjacency convention.
 *  `idNormalizer` (default null) lets a caller fold edge endpoints some OTHER way — the memory
 *  graph has no "containing module" concept, so a memory-graph caller passes `(id) => id` to walk
 *  its raw individual ids unchanged. Defaulting to null (rather than `moduleIdOfId` directly)
 *  keeps the sole existing caller (`adjacencyForKinds(graph, kinds)` in beamExpand) byte-identical. */
export function adjacencyForKinds(graph, kinds, idNormalizer = null) {
  const norm = idNormalizer || ((id) => moduleIdOfId(graph, id));
  const adj = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const kind of kinds) {
    for (const e of edgesOfKind(graph, kind)) {
      link(norm(e.subject), norm(e.object));
    }
  }
  return adj;
}

/** Beam-search-style multi-PLY expansion (PLAN_SEON_TUNING.md §5.15; see the BEAM_* constants'
 *  comment above for the full design rationale). Mutates `s.score` in place on `scored` entries
 *  it boosts — same bounded-nudge shape as the single-hop proximity families, just reachable over
 *  more than one hop when a ply's beam survives that far. Pure otherwise (no fs/network). */
function beamExpand(graph, scored, beamWidth) {
  if (scored.length < 2) return;
  const byId = new Map(scored.map((s) => [s.ind.id, s]));
  const baseScore = new Map(scored.map((s) => [s.ind.id, s.score]));

  // Margin+cap prune a candidate-score Map down to this ply's beam, returning [survivors, overflow].
  const pruneToBeam = (candidates) => {
    if (!candidates.size) return [[], []];
    let best = 0;
    for (const v of candidates.values()) best = Math.max(best, v);
    const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
    const survivors = [];
    const overflow = [];
    for (const [id, score] of ranked) {
      if (score >= best * BEAM_MARGIN_FRAC && survivors.length < beamWidth) survivors.push([id, score]);
      else if (overflow.length < BEAM_OVERFLOW_CAP) overflow.push([id, score]);
    }
    return [survivors, overflow];
  };

  // Ply 0 beam = the current top-scoring already-matched modules (margin+cap over the whole set).
  let [beam, overflow] = pruneToBeam(new Map(scored.map((s) => [s.ind.id, s.score])));
  const boosted = new Set(beam.map(([id]) => id));

  for (let ply = 0; ply < BEAM_PLIES && beam.length; ply++) {
    // Per-edge-kind successor generation, scored, pruned INDEPENDENTLY per kind (so a dense kind
    // like imports can't crowd out a sparse-but-discriminative one like inherits), then merged.
    const merged = new Map(); // successorId -> best propagated score across all kinds this ply
    const plyOverflow = [];
    for (const kinds of BEAM_EDGE_GROUPS) {
      const adj = adjacencyForKinds(graph, kinds);
      const candidates = new Map();
      for (const [parentId, parentScore] of beam) {
        for (const neighbourId of adj.get(parentId) || []) {
          if (!baseScore.has(neighbourId)) continue; // only re-rank already-matched modules
          candidates.set(neighbourId, Math.max(candidates.get(neighbourId) || 0, parentScore));
        }
      }
      const [survivors, kindOverflow] = pruneToBeam(candidates);
      for (const [id, score] of survivors) merged.set(id, Math.max(merged.get(id) || 0, score));
      plyOverflow.push(...kindOverflow);
    }
    overflow.push(...plyOverflow);
    // Apply the bounded nudge once per module (first ply it's reached), same shape as the other
    // proximity families — a nudge, never a replacement.
    for (const [id, propagated] of merged) {
      if (boosted.has(id)) continue;
      const s = byId.get(id);
      if (!s) continue;
      s.score += Math.min(propagated * BEAM_PROX_FRAC, s.score * BEAM_PROX_CAP_FRAC);
      boosted.add(id);
    }
    beam = [...merged.entries()];
    // Safety valve: if this ply's beam ran dry, reconsider the near-miss overflow instead of
    // just stopping — cheap insurance against a total pruning failure.
    if (!beam.length && overflow.length) {
      beam = overflow.splice(0, BEAM_OVERFLOW_CAP).filter(([id]) => !boosted.has(id));
    }
  }
}

/** SPIRAL expansion (opt-in; see the SPIRAL_* constants' comment above for the full design).
 *  A deterministic bounded-radius ego walk from the lexical seeds (`scored`, or an explicit
 *  `seeds` override — see below), popped fewest-arcs-first via a min-heap keyed (hop ASC,
 *  in-graph degree ASC, id ASC), with a degree-quantile hub gate at each expansion step. Emits
 *  up to `nodeLimit` newly-reached nodes in pop order, scoring each seed-relative and bounded so
 *  a hub can't dominate rank 1.
 *  CRITICAL vs beamExpand: it deliberately OMITS the `if (!baseScore.has) continue` guard, so it
 *  MAY push modules that had NO lexical match into `scored` — the one path to breaking the lexical
 *  ceiling. Mutates `scored` (nudges re-reached matches in place; APPENDS newly-surfaced modules)
 *  when the score-nudge machinery is active. Pure otherwise (no fs/network); deterministic total
 *  ordering throughout.
 *
 *  Generalised (2026-07-11) past its original code-graph-only, `scored`-only shape so a pure
 *  graph-visualisation walk (no lexical match list at all) can reuse the exact same traversal:
 *   - `scored` is now OPTIONAL (default `[]`) — a bare walk with no ranking machinery.
 *   - `kinds` (default `SPIRAL_EXPAND_KINDS`) — the edge-kind set to walk; a memory-graph caller
 *     passes `MEMORY_SPIRAL_EXPAND_KINDS`.
 *   - `classPredicate` (default `(ind) => (ind.class || "") === "Module"`) — replaces the two
 *     hardcoded `"Module"` checks below, so a memory-graph caller can pass `() => true` (every
 *     class walkable) or any other individual filter.
 *   - `idNormalizer` (default `null`) — threaded straight into the internal `adjacencyForKinds`
 *     call; a memory-graph caller passes `(id) => id` (no module-folding).
 *   - `seeds` (default derived from `scored`, as before) — an explicit id iterable, so a caller
 *     with no `scored` list at all (e.g. `mostRecentIndividual`'s single seed) can still drive
 *     the walk.
 *  The score-nudge machinery (mutating `scored`/introducing newly-surfaced individuals into it)
 *  is gated behind `scored.length > 0 && maxSeed > 0` — the exact condition the original early
 *  return checked — so an empty `scored` degrades gracefully into a pure walk rather than erroring.
 *  Returns `[{id, hop}]` for every node the walk actually pops (seeds included, at hop 0) — this
 *  used to return `undefined`; safe, since the sole caller (`scoreModules`) already discards the
 *  return value (confirmed by inspection, not assumed). */
export function spiralExpand(graph, scored = [], {
  depth = SPIRAL_DEPTH_DEFAULT,
  q = SPIRAL_Q_DEFAULT,
  nodeLimit = SPIRAL_NODE_LIMIT_DEFAULT,
  kinds = SPIRAL_EXPAND_KINDS,
  classPredicate = (ind) => (ind.class || "") === "Module",
  idNormalizer = null,
  seeds: seedsOpt = null,
} = {}) {
  const byId = new Map(scored.map((s) => [s.ind.id, s]));
  let maxSeed = 0;
  for (const s of scored) maxSeed = Math.max(maxSeed, s.score);
  const nudgeActive = scored.length > 0 && maxSeed > 0; // the original "!(maxSeed > 0) → return" guard, now a gate rather than a bail-out
  const seeds = new Set(seedsOpt != null ? seedsOpt : byId.keys());
  if (!seeds.size) return [];
  // Combined undirected adjacency over the expansion kinds (cochange dropped for the code-graph
  // default). In-graph degree = neighbour count over these kinds — the "arcs" the frontier orders
  // and the quantile gate reads.
  const adj = adjacencyForKinds(graph, kinds, idNormalizer);
  const degree = (id) => (adj.get(id)?.size || 0);
  // Binary min-heap over the frontier, keyed (hop ASC, degree ASC, id ASC) — pop the closest,
  // least-connected node first, so expansion fans through the sparse surroundings and fizzles at
  // hubs. The id tiebreak makes the order a deterministic total order (no RNG, no insertion bias).
  const heap = [];
  const less = (a, b) => a.hop !== b.hop ? a.hop < b.hop
    : a.deg !== b.deg ? a.deg < b.deg
    : a.id < b.id;
  const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const push = (node) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { swap(i, p); i = p; } else break; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        swap(i, m); i = m;
      }
    }
    return top;
  };
  const visited = new Set(seeds);
  for (const id of seeds) push({ id, hop: 0, deg: degree(id) });
  let defIdx = null; // lazy: only the nudge-active path (newly-surfaced individuals) needs this
  let emitted = 0;
  const results = [];
  while (heap.length && emitted < nodeLimit) {
    const node = pop();
    results.push({ id: node.id, hop: node.hop });
    if (!seeds.has(node.id)) {
      if (nudgeActive) {
        // Slot this newly-reached node: seed-relative base, hop-decayed and bounded below maxSeed.
        const emitScore = maxSeed * SPIRAL_EMIT_FRAC * Math.pow(SPIRAL_HOP_DECAY, node.hop - 1);
        const existing = byId.get(node.id);
        if (existing) { // already lexically matched (below-k) → bounded nudge, never a replacement
          existing.score += Math.min(emitScore * SPIRAL_PROX_FRAC, existing.score * SPIRAL_PROX_CAP_FRAC);
        } else { // lexically INVISIBLE → introduce it (the beam structurally cannot)
          const ind = graph.byId?.get?.(node.id);
          if (ind && classPredicate(ind)) {
            if (!defIdx) defIdx = definesIndex(graph);
            const defines = defIdx.get(ind.id) || [];
            const entry = { ind, score: emitScore, defineCount: defines.length, matching: [], density: 0 };
            scored.push(entry);
            byId.set(node.id, entry);
          }
        }
      }
      emitted++;
    }
    if (node.hop >= depth) continue;
    // This step's candidate set = the popped node's unvisited neighbours matching classPredicate;
    // quantile-gate by degree, keeping the lowest-degree ⌊q·n⌋ (drop the densest hubs), never
    // fewer than one.
    const cands = [];
    for (const nid of adj.get(node.id) || []) {
      if (visited.has(nid)) continue;
      const ind = graph.byId?.get?.(nid);
      if (!ind || !classPredicate(ind)) continue; // no phantom (fn-fallback) ids
      cands.push({ id: nid, deg: degree(nid) });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => a.deg - b.deg || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const keep = Math.max(1, Math.floor(q * cands.length)); // lowest-degree q-fraction; never empty
    for (let i = 0; i < keep; i++) {
      const c = cands[i];
      visited.add(c.id);
      push({ id: c.id, hop: node.hop + 1, deg: c.deg });
    }
  }
  return results;
}

/** The individual with the most recent `createdAtProp` attribute — item 1's ("Traversal") seed
 *  default: "sort memory-graph individuals by mgx:createdAt descending, seed from the single most
 *  recent." Deterministic tie-break by id (lowest id wins) when two individuals share the exact
 *  same timestamp — same total-order convention `spiralExpand`'s own heap uses. Null when no
 *  individual carries the attribute at all (empty graph, or a graph that predates timestamps).
 *  ISO-8601 timestamps compare correctly as plain strings (same zero-padded width throughout this
 *  codebase), so no Date parsing is needed. */
export function mostRecentIndividual(graph, createdAtProp = CREATED_AT_PROP) {
  let best = null; // { ind, v }
  for (const ind of graph?.individuals || []) {
    const v = (ind?.attributes || []).find((a) => a?.prop === createdAtProp)?.value;
    if (!v) continue;
    if (!best || v > best.v || (v === best.v && String(ind.id) < String(best.ind.id))) best = { ind, v };
  }
  return best ? best.ind : null;
}

/** The shared module-ranking core behind renderSearch (text) and searchModulesRanked (path+score).
 *  IDF-weights each query token by rarity across modules (so a whole-problem-statement query is not
 *  swamped by ubiquitous words like template/filter/value), scores path-component + symbol-component
 *  + EXACT-symbol matches, re-ranks with a bounded import-proximity bonus, and breaks ties by
 *  matched-symbol DENSITY (a concrete signal — never ground truth). Pure; deterministic. */
function scoreModules(graph, tokens, opts = {}) {
  const { demoteNonProd = false, callAdjacency = false, implOfInterface = false, beamSearch = false, spiral = false, proseBoost = false, proseLayers = false, literalMention = false, embedRank = false, rawQuery = "" } = opts;
  const beamWidth = Number.isFinite(opts.beamWidth) && opts.beamWidth > 0 ? opts.beamWidth : 8;
  const defIdx = definesIndex(graph);
  // Precompute each module's path components + defined-symbol exact/component sets, once.
  const modules = [];
  for (const ind of graph.individuals) {
    if ((ind.class || "") !== "Module") continue; // "where does this live" → modules
    const label = String(ind.label);
    const labelLc = label.toLowerCase();
    const defines = defIdx.get(ind.id) || [];
    const symSet = new Set(defines.map((d) => d.toLowerCase())); // exact symbol names
    const symComps = new Set();
    for (const d of defines) for (const c of identComponents(d)) symComps.add(c);
    // literalMention only: the Module's `dotted` attribute (mgx:dotted) — the verbatim form a
    // task statement uses ("django.utils.http"); "" when absent. Gated so OFF does zero work.
    const dotted = literalMention
      ? String((ind.attributes || []).find((a) => a.key === "dotted")?.value || "").toLowerCase()
      : "";
    modules.push({ ind, label, labelLc, defines, symSet, symComps, dotted });
  }
  const N = modules.length || 1;
  // Inverse module-frequency: a token in many modules carries little locating signal; a rare one
  // decides. df = modules where the token appears in the path (substring — keeps "filter" matching
  // "defaultfilters"), as a symbol component, or as an exact symbol name. A loose path substring like
  // "text" that hits many modules therefore earns a low weight, so "ci<text>" can't beat utils/text.py.
  // idf = log(1 + N/(1+df)) → ~0 for ubiquitous tokens, large for rare ones.
  const idf = new Map();
  for (const t of tokens) {
    if (idf.has(t)) continue;
    let df = 0;
    for (const m of modules) if (m.labelLc.includes(t) || m.symComps.has(t) || m.symSet.has(t)) df++;
    idf.set(t, Math.log(1 + N / (1 + df)));
  }
  const scored = [];
  for (const m of modules) {
    let exactScore = 0, pathScore = 0, matchCount = 0;
    const compWeights = []; // weak symbol-component hits, capped below so big modules can't run away
    for (const t of tokens) {
      const w = idf.get(t) || 0;
      if (!w) continue;
      if (m.symSet.has(t)) { exactScore += w * EXACT_W; matchCount++; }   // exact defined-symbol name
      else if (m.symComps.has(t)) { compWeights.push(w); matchCount++; }  // a component of a symbol name
      if (m.labelLc.includes(t)) pathScore += w * PATH_W;                 // path substring (IDF-tamed)
    }
    compWeights.sort((a, b) => b - a);
    let symScore = 0;
    for (let i = 0; i < Math.min(compWeights.length, SYM_MATCH_CAP); i++) symScore += compWeights[i] * SYM_W;
    let score = exactScore + pathScore + symScore;
    if (!score) continue;
    if (demoteNonProd && (isTestLabel(m.labelLc) || isNonProdLabel(m.labelLc))) score *= NONPROD_DEMOTE; // B016 R1a
    else if (isTestLabel(m.labelLc)) score *= 0.4; // source first; tests still discoverable
    const matching = m.defines.filter((d) => { const dl = d.toLowerCase(); const cs = identComponents(d); return tokens.some((t) => dl === t || cs.has(t)); });
    const density = m.defines.length ? matchCount / m.defines.length : 0;
    scored.push({ ind: m.ind, score, defineCount: m.defines.length, matching, density });
  }
  // §7.5/§7.6(5a) literalMention (opt-in): verbatim dotted-name/path mentions in the RAW query —
  // see the LIT_* constants' comment above for the full design. Runs before the proximity
  // families so a mentioned module donates adjacency like any other strong match.
  if (literalMention && rawQuery && scored.length) {
    const rawLc = String(rawQuery).toLowerCase();
    const continues = (ch) => ch != null && /[a-z0-9_./]/.test(ch);
    // Whole, boundary-checked occurrence of `cand` in the raw query (see boundary rule above).
    const mentioned = (cand) => {
      for (let i = rawLc.indexOf(cand); i !== -1; i = rawLc.indexOf(cand, i + 1)) {
        if (!continues(rawLc[i - 1]) && !continues(rawLc[i + cand.length])) return true;
      }
      return false;
    };
    // IDF for a candidate's components: normally already in the map (they are query tokens by
    // construction when tokens came from this same raw query); computed-and-cached otherwise
    // (a caller passing mismatched tokens/rawQuery must not crash or skew).
    const idfOf = (t) => {
      if (!idf.has(t)) {
        let df = 0;
        for (const m of modules) if (m.labelLc.includes(t) || m.symComps.has(t) || m.symSet.has(t)) df++;
        idf.set(t, Math.log(1 + N / (1 + df)));
      }
      return idf.get(t);
    };
    const byModId = new Map(modules.map((m) => [m.ind.id, m]));
    let maxBase = 0;
    for (const s of scored) maxBase = Math.max(maxBase, s.score);
    for (const s of scored) {
      const m = byModId.get(s.ind.id);
      if (!m) continue;
      let litWeight = 0; // best single matched candidate (dotted vs path share components anyway)
      for (const cand of new Set([m.dotted, m.labelLc])) {
        if (!cand) continue;
        if (cand.split(/[./]+/).filter(Boolean).length < LIT_MIN_COMPONENTS) continue; // specificity floor
        if (!mentioned(cand)) continue;
        // IDF-weight the candidate's tokens (same tokenizer as the query), highest first.
        const weights = [...new Set(cand.split(/[^a-z0-9_]+/).filter(Boolean))].map(idfOf).sort((a, b) => b - a);
        let w = 0;
        for (let i = 0; i < Math.min(weights.length, LIT_COMP_CAP); i++) w += weights[i] * LIT_W;
        litWeight = Math.max(litWeight, w);
      }
      if (litWeight) s.score += Math.min(litWeight * LIT_FRAC, maxBase * LIT_CAP_FRAC);
    }
  }
  // Import-graph proximity (rescaled): a matched module that imports / is imported by a
  // STRONGER-matching module gets a bonus proportional to that neighbour, so a genuine 2nd module
  // (truncatelines' text.py) rises with its sibling. Only re-ranks modules that ALREADY matched.
  if (scored.length > 1) {
    const baseById = new Map(scored.map((s) => [s.ind.id, s.score]));
    const adj = new Map();
    for (const e of edgesOfKind(graph, "imports")) {
      if (!baseById.has(e.subject) && !baseById.has(e.object)) continue;
      if (!adj.has(e.subject)) adj.set(e.subject, new Set());
      if (!adj.has(e.object)) adj.set(e.object, new Set());
      adj.get(e.subject).add(e.object);
      adj.get(e.object).add(e.subject);
    }
    for (const s of scored) {
      let bestNeighbor = 0;
      for (const nid of adj.get(s.ind.id) || []) bestNeighbor = Math.max(bestNeighbor, baseById.get(nid) || 0);
      s.score += Math.min(bestNeighbor * PROX_FRAC, s.score * PROX_CAP_FRAC);
    }
  }
  // B016 E1a (opt-in): resolved-call adjacency — a matched module CALLED BY (or calling) a
  // stronger-matching module rises with it (initials-filter: defaultfilters.py calls into
  // utils/text.py, whose lexical rank was 8). Call edges live at function level, so endpoints
  // map to their containing modules first. Same bounded-nudge formula as import-proximity;
  // only re-ranks modules that already matched.
  if (callAdjacency && scored.length > 1) {
    const baseById = new Map(scored.map((s) => [s.ind.id, s.score]));
    const adj = new Map();
    for (const kind of ["calls", "callsSymbol"]) {
      for (const e of edgesOfKind(graph, kind)) {
        const sm = moduleIdOfId(graph, e.subject);
        const om = moduleIdOfId(graph, e.object);
        if (!sm || !om || sm === om) continue;
        if (!baseById.has(sm) && !baseById.has(om)) continue;
        if (!adj.has(sm)) adj.set(sm, new Set());
        if (!adj.has(om)) adj.set(om, new Set());
        adj.get(sm).add(om);
        adj.get(om).add(sm);
      }
    }
    for (const s of scored) {
      let bestNeighbor = 0;
      for (const nid of adj.get(s.ind.id) || []) bestNeighbor = Math.max(bestNeighbor, baseById.get(nid) || 0);
      s.score += Math.min(bestNeighbor * CALL_PROX_FRAC, s.score * CALL_PROX_CAP_FRAC);
    }
  }
  // B016 E1b (opt-in): impl-of-interface — a C# module implementing an interface DEFINED in a
  // stronger-matching module rises with it (eshoponweb: IBasketService.cs rank 1, BasketService.cs
  // rank 4). `inherits` edges point the OBJECT at an unresolved `ext:<Name>` id for C#, so resolve
  // by exact label match against internal Class individuals. Only re-ranks modules that already
  // matched, and only when both the implementer module is `.cs` and the base name looks like a C#
  // interface (see the const block above for why — isAbstract does not exist in the data).
  if (implOfInterface && scored.length > 1) {
    const baseById = new Map(scored.map((s) => [s.ind.id, s.score]));
    const classByLabel = new Map();
    for (const ind of graph.individuals) {
      if ((ind.class || "") === "Class" && ind.label) classByLabel.set(String(ind.label), ind);
    }
    for (const s of scored) {
      if (!isCsModuleLabel(s.ind.label)) continue;
      let bestNeighbor = 0;
      for (const e of edgesOfKind(graph, "inherits")) {
        const subjModId = moduleIdOfId(graph, e.subject);
        if (subjModId !== s.ind.id) continue;
        if (!looksLikeCsInterface(e.objectLabel)) continue;
        let ifaceModId = moduleIdOfId(graph, e.object); // resolves real (non-ext:) targets
        if (!ifaceModId) {
          const ifaceInd = classByLabel.get(String(e.objectLabel || ""));
          if (ifaceInd) ifaceModId = moduleIdOf(graph, ifaceInd);
        }
        if (ifaceModId) bestNeighbor = Math.max(bestNeighbor, baseById.get(ifaceModId) || 0);
      }
      s.score += Math.min(bestNeighbor * IMPL_PROX_FRAC, s.score * IMPL_PROX_CAP_FRAC);
    }
  }
  // PLAN_PROSE_INDEX.md §6 (opt-in): lexical boost from decomposed-identifier/doc-comment
  // prose tokens — see the PROSE_PROX_* comment above for the full rationale. One
  // lookupByProseTokens call for the whole query (not per-module), then aggregated into a
  // per-module signal via moduleIdOfId, same as the call-adjacency/impl-of-interface families.
  // Unlike the proximity families above, this signal is absolute per-module (prose-token
  // overlap), not relative to a stronger NEIGHBOUR in `scored` — so it applies even when
  // only one module matched lexically (no ">1" gate needed).
  if (proseBoost && scored.length && graph.proseIndex) {
    const proseHits = lookupByProseTokens(graph.proseIndex, tokens.join(" "), { limit: PROSE_LOOKUP_LIMIT });
    if (proseHits.length) {
      const proseByModule = new Map();
      for (const { id, score } of proseHits) {
        const modId = moduleIdOfId(graph, id);
        if (!modId) continue;
        proseByModule.set(modId, (proseByModule.get(modId) || 0) + score);
      }
      for (const s of scored) {
        const signal = proseByModule.get(s.ind.id) || 0;
        if (!signal) continue;
        s.score += Math.min(signal * PROSE_PROX_FRAC, s.score * PROSE_PROX_CAP_FRAC);
      }
    }
  }
  // Layered prose normalisation (opt-in): a query token that did NOT match a module lexically but
  // resolves to one of its individuals through a NORMALISED prose layer (stem/lemma/canonical/spell)
  // adds a bounded, discounted signal — see the PROSE_LAYER_* comment above. One proseLayerHits call
  // per DISTINCT query token, ids folded to their containing module via moduleIdOfId (same as the
  // proseBoost/call-adjacency families). Only tokens NOT already matching a module lexically count
  // for that module (a layer hit is purely ADDITIVE evidence for otherwise-missed words — never
  // double-counting a token the base score already saw), weighted by the token's own IDF (so a
  // ubiquitous word contributes almost nothing) and halved (PROSE_LAYER_DISCOUNT: weaker than a
  // verbatim match), then the shared FRAC/CAP nudge. Only re-ranks modules already in `scored`.
  if (proseLayers && scored.length && graph.proseIndex) {
    const scoredById = new Map(scored.map((s) => [s.ind.id, s]));
    const modById = new Map(modules.map((m) => [m.ind.id, m]));
    const layerSignal = new Map(); // moduleId -> accumulated discounted, IDF-weighted layer signal
    for (const t of new Set(tokens)) {
      const w = idf.get(t) || 0;
      if (!w) continue;
      const { ids } = proseLayerHits(graph.proseIndex, t);
      if (!ids.length) continue;
      const hitMods = new Set();
      for (const id of ids) {
        const modId = moduleIdOfId(graph, id);
        if (!modId || hitMods.has(modId)) continue;
        hitMods.add(modId);
        if (!scoredById.has(modId)) continue;              // never a new zero-match candidate
        const m = modById.get(modId);
        if (m && (m.symSet.has(t) || m.symComps.has(t) || m.labelLc.includes(t))) continue; // already matched lexically → not additive
        layerSignal.set(modId, (layerSignal.get(modId) || 0) + w * PROSE_LAYER_DISCOUNT);
      }
    }
    for (const s of scored) {
      const signal = layerSignal.get(s.ind.id) || 0;
      if (!signal) continue;
      s.score += Math.min(signal * PROSE_LAYER_FRAC, s.score * PROSE_LAYER_CAP_FRAC);
    }
  }
  // §7.6(5b) embedRank (opt-in): static-embedding cosine re-rank — see the EMB_* constants'
  // comment above. The embedder is INJECTED (opts.embedder, from embed.mjs's loadEmbedder) so
  // this module stays fs-free; absent embedder → no-op with a one-time stderr note, never a
  // failure (the 30 MB weights are a local opt-in fetch, not a test/CI dependency).
  if (embedRank) {
    if (!opts.embedder) {
      if (!embedWarned) {
        embedWarned = true;
        process.stderr.write("tmct: embedRank requested but no embedder available (weights not fetched? see `npm run refs:embeddings`) — flag is a no-op\n");
      }
    } else if (scored.length) {
      const embedder = opts.embedder;
      let cache = EMB_CACHE.get(graph);
      if (!cache || cache.embedder !== embedder) {
        cache = { embedder, texts: moduleEmbedTexts(graph), vecs: new Map() };
        EMB_CACHE.set(graph, cache);
      }
      const qv = embedder.embed(rawQuery || tokens.join(" "));
      let maxBase = 0;
      for (const s of scored) maxBase = Math.max(maxBase, s.score);
      for (const s of scored) {
        let v = cache.vecs.get(s.ind.id);
        if (!v) {
          v = embedder.embed(cache.texts.get(s.ind.id) || String(s.ind.label));
          cache.vecs.set(s.ind.id, v);
        }
        const sim = Math.max(0, cosine(qv, v)); // negative similarity never penalises
        if (!sim) continue;
        s.score += Math.min(sim * maxBase * EMB_FRAC, s.score * EMB_CAP_FRAC);
      }
    }
  }
  // §5.15 beam search (opt-in): multi-ply generalization of the single-hop families above.
  if (beamSearch && scored.length > 1) beamExpand(graph, scored, beamWidth);
  // SPIRAL (opt-in): bounded-radius ego walk that MAY introduce lexically-invisible modules — runs
  // last (after every family has finalised the seed scores) so its seed-relative emit scores and
  // hub gate read the settled ranking, and before the sort so surfaced nodes slot into it.
  if (spiral && scored.length) spiralExpand(graph, scored, {
    depth: Number.isFinite(opts.spiralDepth) && opts.spiralDepth > 0 ? opts.spiralDepth : SPIRAL_DEPTH_DEFAULT,
    q: Number.isFinite(opts.mostDistinctiveBeams) && opts.mostDistinctiveBeams > 0 ? opts.mostDistinctiveBeams : SPIRAL_Q_DEFAULT,
    nodeLimit: Number.isFinite(opts.spiralNodeLimit) && opts.spiralNodeLimit > 0 ? opts.spiralNodeLimit : SPIRAL_NODE_LIMIT_DEFAULT,
  });
  // Tie-break: score → matched-symbol DENSITY (concrete, not ground truth) → fewer defines → shorter label.
  scored.sort((a, b) => b.score - a.score || b.density - a.density || a.defineCount - b.defineCount || String(a.ind.label).length - String(b.ind.label).length);
  return scored;
}

/** TUNING #3: the ranked module list as plain `{path, score}` (highest-first), using the SAME
 *  ranking renderSearch uses (path + symbol + exact-symbol + import-proximity). Lets the rig
 *  read the score GAP between rank-1 and rank-2 (which the text renderer hides) so it can keep
 *  rank-2 only when it is close. Pure; deterministic.
 *  NOTE: scoreModules still RANKS (locate always returns modules), but the score-gap top-1
 *  SELECTION that consumes this gap is OFF by default in run.mjs/selectModules — it over-injected
 *  on some tasks. The shipped default takes the top-2 instead. */
export function searchModulesRanked(graph, query, opts = {}) {
  const raw = String(query || "");
  const tokens = raw.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  if (!tokens.length) return [];
  // literalMention needs the query BEFORE tokenization (the tokenizer destroys the dotted refs
  // it matches on) and embedRank embeds the raw phrasing; threaded only when a flag that
  // consumes it is on, so the OFF path is provably unchanged.
  const effOpts = (opts.literalMention || opts.embedRank) ? { ...opts, rawQuery: raw } : opts;
  return scoreModules(graph, tokens, effOpts).map((s) => ({ path: String(s.ind.label), score: s.score }));
}

// B016 R1b, promoted to the shipped default (2026-07-02): positive in every measured cell across
// B016's P1 (tuning task + a genuinely held-out task) and P2 (both eshoponweb tasks; clears the
// ≥50%-vs-otb bar outright on order-service-total). See PLAN_B016.md §6.9. 0.6 is the exact ratio
// tested throughout — do not drift it from bench/arms.mjs's arm values or scripts/rank-gate.mjs's
// --gap default; all three should read this constant.
export const DEFAULT_SCORE_GAP = 0.6;

/** Score-gap-driven module selection: take the top_k ranked hits, then extend the selection to
 *  include ranks (top_k)..2 whose score sits within `scoreGapK` of rank 1 — the near-tie case
 *  where a second (or third) module is genuinely as relevant as the top hit, not filler. Never
 *  resurrects a suppressed (empty) selection: a top_k of 0 stays empty regardless of scoreGapK.
 *  Pure — the single source of truth for gap-extension, shared by the CLI product surface
 *  (cli.mjs's query-based `digest`) and the bench rig (bench/run.mjs's selectModules).
 *
 *  DELIBERATELY NEUTRAL BY DEFAULT: `scoreGapK` defaults to `null` (gap-extension OFF, plain
 *  top-`top_k`) here — the SHIPPED default of `DEFAULT_SCORE_GAP` is a product-surface policy
 *  decision, applied explicitly by the caller (cli.mjs's digest query-mode), not baked into this
 *  primitive. A library default of "on" would make every future caller who forgets to pass
 *  `scoreGapK` silently inherit gap-extension — including future bench arms, breaking the
 *  paired-arm "byte-identical when off" comparability this repo's whole measurement methodology
 *  depends on. See test/selectRankedModules.test.mjs's "absent scoreGapK is byte-identical to
 *  plain top-k" case. */
export function selectRankedModules(ranked, { top_k = 2, scoreGapK = null } = {}) {
  if (!ranked.length || top_k <= 0) return [];
  const picked = ranked.slice(0, top_k).map((r) => r.path);
  if (scoreGapK && picked.length >= 1 && ranked[0].score > 0) {
    for (const r of ranked.slice(1, 3)) {
      if (r.score / ranked[0].score >= scoreGapK && !picked.includes(r.path)) picked.push(r.path);
    }
  }
  return picked;
}

export function renderSearch(graph, query, { limit = SEARCH_LIMIT, kind = "", decorator = "", name = "" } = {}) {
  const tokens = String(query || "").toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  const wantKind = String(kind || "").trim().toLowerCase();
  const decFilter = String(decorator || "").trim().toLowerCase();
  let nameRe = null;
  if (name) {
    try { nameRe = new RegExp(name, "i"); } catch { return `invalid name pattern: ${name}`; }
  }
  // kind= switches to symbol search (functions/classes/methods/attributes); the
  // default (no kind) keeps the module "where does this live" search unchanged.
  if (wantKind && wantKind !== "module") {
    return searchSymbols(graph, tokens, { limit, kind: wantKind, decFilter, nameRe });
  }
  if (!tokens.length && !nameRe && !decFilter) return "empty query";
  const scored = scoreModules(graph, tokens);
  if (!scored.length) {
    return `no module matches "${query}". Try broader keywords, or tmct_describe <path> if you know where it lives.`;
  }
  const hits = scored.slice(0, limit);
  const lines = [`${scored.length} module(s) match "${query}" (top ${hits.length}):`];
  for (const { ind, defineCount, matching } of hits) {
    const m = matching.length ? ` — matching: ${capJoin([...new Set(matching)], SEARCH_SYMBOLS_SHOWN)}` : "";
    lines.push(`- ${ind.label} (defines ${defineCount} symbol(s))${m}`);
  }
  lines.push("Then tmct_describe <path> for the full sibling list + typed edges, or tmct_impact <path> for dependents.");
  return lines.join("\n");
}

// ---- §9 read-replacing tools (members / inheritance / architecture / coverage /
//      history / call neighbours). Each answers ONE question in one compact call so
//      the agent need not Read/Grep. All keep the bounded-output discipline. -------

/** Per-graph, per-kind memo for edgesOfKind's own flattened scan — WeakMap<graph,
 *  Map<kind, edge[]>>, mirroring qualCache's (ask.mjs) established per-graph-object
 *  caching convention: a loaded graph's `relations` are never mutated in place after
 *  parseEntities builds it (every refresh constructs a NEW graph object), so caching
 *  keyed on graph object identity is correctness-safe for a graph's whole lifetime —
 *  same invariant qualCache already relies on in production. edgesOfKind is called
 *  repeatedly on the SAME (graph, kind) pair across a single query's traversal
 *  (evalSet/traverse/adjacencyForKinds/renderArchitecture/… all re-derive it), and at
 *  monorepo scale (tens of thousands of modules) that repeated O(relations) scan is a
 *  real latency/GC cost — this collapses every call after the first to an O(1) lookup. */
const edgesOfKindCache = new WeakMap();

/** All edges whose relation classifies to `kind`, flattened across relation groups. */
/** All edges of a classified relation kind (imports/calls/defines/tests/touches/inherits/
 *  cochange/reexports/callsSymbol/touchesSymbol/contains — see relationKind/PROP_KIND above),
 *  flattened across every raw relation group that classifies to it. Exported for ask.mjs's
 *  mechanical NL-query engine (PLAN_MECHANICAL_CHAT.md) to orchestrate rather than duplicate.
 *  Memoized per (graph, kind) — see edgesOfKindCache's own doc above (perf lever, HANDOVER
 *  follow-up #8: latency/GC on monorepo-scale graphs, not a correctness fix — the earlier
 *  stack-overflow bug below is already fixed and unrelated). */
export function edgesOfKind(graph, kind) {
  let byKind = edgesOfKindCache.get(graph);
  if (!byKind) { byKind = new Map(); edgesOfKindCache.set(graph, byKind); }
  const cached = byKind.get(kind);
  if (cached) return cached;
  const out = [];
  // Plain-loop append, NOT out.push(...g.edges): argument spread materialises every
  // element as a call argument and overflows the stack past ~100k edges (live report:
  // 27,770-module repo, "list modules in <dir>" → "Maximum call stack size exceeded").
  for (const g of graph.relations) {
    if (relationKind(g) !== kind) continue;
    for (const e of g.edges) out.push(e);
  }
  byKind.set(kind, out);
  return out;
}

/** A node's "last touched" moment, DERIVED rather than stored (PLAN_VIZ.md §2): the node's own
 *  `updatedAtProp`/`createdAtProp` attribute, or the max `createdAt` over every edge (in
 *  `graph.relations`, ACROSS every kind, not just classified ones) touching it as either
 *  subject or object — whichever is newer. `""` when nothing carries a timestamp at all. Compares
 *  ISO-8601 strings directly (correct for same-width zero-padded timestamps, no Date parsing).
 *  Tolerates edges with no `createdAt` field (pre-dating `upsertEdge`'s own stamp, or written by
 *  a path that bypasses `upsertEdge` entirely) by simply skipping them, never throwing. Operates
 *  on the shared parsed-graph shape (`graph.relations`/`graph.individuals`), not memory-specific —
 *  same reasoning `edgesOfKind`/`moduleIdOf` already document. */
export function derivedUpdatedAt(graph, ind, { createdAtProp = CREATED_AT_PROP, updatedAtProp = UPDATED_AT_PROP } = {}) {
  if (!ind) return "";
  const attrs = ind.attributes || [];
  const own = attrs.find((a) => a?.prop === updatedAtProp)?.value || attrs.find((a) => a?.prop === createdAtProp)?.value || "";
  let best = own || "";
  for (const g of graph?.relations || []) {
    for (const e of g.edges || []) {
      if (!e || (e.subject !== ind.id && e.object !== ind.id)) continue;
      const c = e.createdAt;
      if (!c) continue; // no timestamp on this edge — skip, never throw
      if (!best || c > best) best = c;
    }
  }
  return best;
}

/** Turn a `spiralExpand` walk (`[{id, hop}]`) into the `{nodes, edges}` shape
 *  `tmct viz` renders — pure, no I/O, shared verbatim between the CLI
 *  (`src/viz.mjs`'s `computeVizGraph`) and the browser bundle's client-side
 *  re-walk/recentre (PLAN_BREADTH_FIRST_NLU.md §5 follow-on, operator
 *  directive 2026-07-11) so both paths render byte-identically from the same
 *  logic, never two hand-maintained copies. `nodes` enrich each walked id with
 *  its real label/class/timestamps (`derivedUpdatedAt`, above); `edges` are
 *  every relation-group edge connecting two walked nodes (not just the kinds
 *  the walk itself traversed through — an incidental edge between two reached
 *  nodes still renders), de-duped on (subject, object, predicate) across
 *  relation groups. */
export function buildVizNodesAndEdges(graph, walked, { createdAtProp = CREATED_AT_PROP, updatedAtProp = UPDATED_AT_PROP } = {}) {
  const nodeIds = new Set(walked.map((w) => w.id));
  const nodes = walked.map(({ id, hop }) => {
    const ind = graph.byId.get(id) || null;
    const attrs = ind?.attributes || [];
    const createdAt = attrs.find((a) => a?.prop === createdAtProp)?.value || "";
    return {
      id, hop, label: ind?.label || id, class: ind?.class || "", createdAt,
      updatedAt: derivedUpdatedAt(graph, ind, { createdAtProp, updatedAtProp }),
    };
  });
  const edges = [];
  const seen = new Set();
  for (const group of graph.relations || []) {
    for (const e of group.edges || []) {
      if (!nodeIds.has(e.subject) || !nodeIds.has(e.object)) continue;
      const key = `${e.subject} ${e.object} ${group.predicate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: e.subject, target: e.object, kind: group.predicate });
    }
  }
  return { nodes, edges };
}

/** moduleIdOf by raw edge-endpoint id: resolves through byId when the individual exists,
 *  else falls back to parsing an `fn:<path>#name` id directly (callsSymbol objects may name
 *  symbols with no individual of their own). Null if it cannot be mapped. */
function moduleIdOfId(graph, id) {
  const ind = graph.byId?.get?.(id);
  if (ind) return moduleIdOf(graph, ind);
  const m = String(id || "").match(/^fn:(.+)#/);
  return m ? `mod:${m[1]}` : null;
}

/** The module id an individual belongs to (itself if a Module; via its site span,
 *  else parsed from an `fn:<path>#name` id). Null if it cannot be mapped. */
function moduleIdOf(graph, ind) {
  if ((ind?.class || "") === "Module") return ind.id;
  const site = siteOf(ind);
  if (site) return `mod:${site.path}`;
  const m = String(ind?.id || "").match(/^fn:(.+)#/);
  return m ? `mod:${m[1]}` : null;
}

function spanTag(site) {
  if (!site) return "";
  const s = site.end > site.start ? `${site.start}-${site.end}` : `${site.start}`;
  return ` [${site.path}:${s}]`;
}

function decoratorOf(ind) {
  return (ind?.attributes || []).find((a) => a.key === "decorators")?.value || "";
}

const MEMBERS_CAP = 40;
const SUBCLASS_CAP = 40;
const CALL_CAP = 30;

/** A class's methods + attributes (with sites/decorators) in one slice — replaces
 *  reading the class body. Uses the `contains` (seon:containsCodeEntity) relation. */
export function renderMembers(graph, ind) {
  const lines = [`${ind.label} — ${ind.class || "Entity"} (id: ${ind.id})`];
  const contains = edgesOfKind(graph, "contains").filter((e) => e.subject === ind.id);
  if (!contains.length) {
    lines.push("members: none recorded (empty class, or members not in the extracted graph). Use tmct_describe for its edges.");
    return lines.join("\n");
  }
  const methods = [];
  const attrs = [];
  for (const e of contains) {
    const member = graph.byId.get(e.object);
    const where = spanTag(member ? siteOf(member) : null);
    const dec = member ? decoratorOf(member) : "";
    const entry = `${e.objectLabel || e.object}${where}${dec ? ` @${dec}` : ""}`;
    ((member?.class || "") === "Attribute" ? attrs : methods).push(entry);
  }
  if (methods.length) lines.push(`methods (${methods.length}): ${capJoin(methods, MEMBERS_CAP)}`);
  if (attrs.length) lines.push(`attributes (${attrs.length}): ${capJoin(attrs, MEMBERS_CAP)}`);
  lines.push("Use tmct_snippet <Class.member> for an exact body.");
  return lines.join("\n");
}

const attrVal = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value || "";

/** The mechanical-enrichment signature of a symbol in ONE compact block — params,
 *  return annotation, raises/catches, self-fields, flags, decorators, one-line doc —
 *  so the agent gets the API surface without reading the body. Deterministic ast facts
 *  (kept OUT of tmct_context's lean bundle; this is the targeted tool for them). */
export function renderSignature(graph, ind) {
  const site = siteOf(ind);
  const lines = [`${ind.label} — ${ind.class || "Entity"}${spanTag(site)}`];
  const params = attrVal(ind, "params");
  const returns = attrVal(ind, "returns");
  if (params || returns || (ind.class || "") === "Method" || (ind.class || "") === "Function") {
    lines.push(`signature: ${ind.label}(${params})${returns ? ` -> ${returns}` : ""}`);
  }
  const flags = [];
  if (attrVal(ind, "isStatic")) flags.push("static");
  if (attrVal(ind, "isAbstract")) flags.push("abstract");
  if (attrVal(ind, "isConstant")) flags.push("constant");
  const vis = attrVal(ind, "visibility");
  if (vis) flags.push(vis);
  if (flags.length) lines.push(`flags: ${flags.join(", ")}`);
  const dec = decoratorOf(ind);
  if (dec) lines.push(`decorators: @${dec.split(", ").join(", @")}`);
  const raises = attrVal(ind, "raises");
  if (raises) lines.push(`raises: ${raises}`);
  const catches = attrVal(ind, "catches");
  if (catches) lines.push(`catches: ${catches}`);
  const fields = attrVal(ind, "self_fields");
  if (fields) lines.push(`self fields: ${fields}`);
  const value = attrVal(ind, "value");
  if (value) lines.push(`value: ${value}`);
  const doc = attrVal(ind, "doc");
  if (doc) lines.push(`doc: ${doc}`);
  if (lines.length === 1) lines.push("(no signature detail recorded for this symbol — likely a module or attribute; use tmct_snippet for its source.)");
  lines.push("Use tmct_snippet for the exact body.");
  return lines.join("\n");
}

/** Forward bases + the transitive reverse inheritance closure (who extends this) —
 *  replaces grepping `class X(Base)` across the tree. Uses `inherits` (mgx:subclassOf). */
export function renderSubclasses(graph, ind) {
  const inherits = edgesOfKind(graph, "inherits");
  const bases = inherits.filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object);
  const childrenOf = new Map();
  for (const e of inherits) {
    if (!childrenOf.has(e.object)) childrenOf.set(e.object, []);
    childrenOf.get(e.object).push({ id: e.subject, label: e.subjectLabel || e.subject });
  }
  const lines = [`${ind.label} — ${ind.class || "Entity"} (id: ${ind.id})`];
  lines.push(bases.length ? `extends: ${capJoin(bases, SUBCLASS_CAP)}` : "extends: (no internal/recorded base classes)");
  const visited = new Set([ind.id]);
  const levels = [];
  let frontier = [ind.id];
  for (let depth = 1; depth <= 8 && frontier.length; depth += 1) {
    const next = [];
    const level = [];
    for (const id of frontier) {
      for (const c of childrenOf.get(id) || []) {
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        level.push(c.label);
        next.push(c.id);
      }
    }
    if (level.length) {
      level.sort((a, b) => String(a).localeCompare(String(b)));
      levels.push(level);
    }
    frontier = next;
  }
  const total = levels.reduce((n, l) => n + l.length, 0);
  if (!total) {
    lines.push("subclasses: none recorded — nothing extends it in the extracted graph.");
  } else {
    lines.push(`subclasses: ${total} total across ${levels.length} level(s).`);
    levels.forEach((l, i) => lines.push(`  depth ${i + 1} (${l.length}): ${capJoin(l, SUBCLASS_CAP)}`));
  }
  return lines.join("\n");
}

const ARCH_PKG_CAP = 25;
const ARCH_HUB_CAP = 15;

/** Package/module tree + the most-imported (hub) modules — replaces reading the dir
 *  tree and many files to learn the shape. Optional `pkg` prefix scopes it. */
export function renderArchitecture(graph, { pkg = "" } = {}) {
  const norm = normPath(pkg);
  const modules = graph.individuals.filter(
    (i) => (i.class || "") === "Module" && (!norm || normPath(i.label).startsWith(norm)),
  );
  if (!modules.length) return norm ? `no modules under "${pkg}".` : "no modules in the graph.";
  const pkgCount = new Map();
  for (const m of modules) {
    const dir = m.label.includes("/") ? m.label.slice(0, m.label.lastIndexOf("/")) : "(root)";
    pkgCount.set(dir, (pkgCount.get(dir) || 0) + 1);
  }
  const inDeg = new Map();
  for (const e of edgesOfKind(graph, "imports")) inDeg.set(e.object, (inDeg.get(e.object) || 0) + 1);
  const modSet = new Set(modules.map((m) => m.id));
  const hubs = [...inDeg.entries()]
    .filter(([id]) => modSet.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, ARCH_HUB_CAP)
    .map(([id, n]) => `${graph.byId.get(id)?.label || id} (${n} importers)`);
  const pkgs = [...pkgCount.entries()].sort((a, b) => b[1] - a[1]);
  const lines = [`Architecture${norm ? ` of ${pkg}` : ""}: ${modules.length} module(s) in ${pkgs.length} package(s).`];
  lines.push(`packages (by module count): ${capJoin(pkgs.map(([d, n]) => `${d} (${n})`), ARCH_PKG_CAP)}`);
  lines.push(hubs.length ? `hub modules (most imported): ${hubs.join(", ")}` : "hub modules: none (no internal imports recorded).");
  return lines.join("\n");
}

const COVERAGE_CAP = 40;

/** The test modules covering a symbol/module — from the `tests` (mgx:testsCoverage)
 *  relation. Replaces grepping `tests/` for who imports the target. */
export function renderTestsFor(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const tests = [...new Set(edgesOfKind(graph, "tests").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))];
  if (!tests.length) return `${modLabel}: no covering tests recorded (no test module imports it).`;
  return `${modLabel}: covered by ${tests.length} test module(s):\n  ${capJoin(tests, COVERAGE_CAP, "\n  ")}`;
}

/** Source modules with no covering test module — a coverage gap view. Test
 *  modules (subjects of test edges, or test-named paths) are excluded. */
export function renderUntested(graph) {
  const covered = new Set();
  const testModules = new Set();
  for (const e of edgesOfKind(graph, "tests")) {
    covered.add(e.object);
    testModules.add(e.subject);
  }
  const untested = graph.individuals
    .filter(
      (i) =>
        (i.class || "") === "Module" &&
        !testModules.has(i.id) &&
        !isTestLabel(String(i.label).toLowerCase()) &&
        !covered.has(i.id),
    )
    .map((i) => i.label)
    .sort();
  if (!untested.length) return "every source module has at least one covering test module.";
  return `${untested.length} source module(s) with no covering test module:\n  ${capJoin(untested, COVERAGE_CAP, "\n  ")}`;
}

export const HISTORY_CAP = 15;

/** Recent commits that touched a symbol's module — from `touches` (seon:history).
 *  Replaces `git log -- <file>`. Commits are listed newest-first (git-log order). */
export function renderHistory(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const commits = edgesOfKind(graph, "touches").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject);
  if (!commits.length) return `${modLabel}: no commit history recorded (outside the git-log window or unmodified).`;
  return `${modLabel}: touched by ${commits.length} recent commit(s): ${capJoin(commits, HISTORY_CAP)}`;
}

/** Modules that call into the target's module (one hop over `calls`). */
// Symbol-grain classes whose call graph lives on the fn/method-precise `callsSymbol`
// edge, not the module-coarse `calls`. When the resolved target IS one of these, callers/
// callees must read the SYMBOL node's own edges — mapping it to its enclosing module (the
// old behaviour) both mislabels the answer with `mod:<path>` and scans the wrong edge set,
// so "Widget.render --callsSymbol--> fnAlpha" was reported as "no recorded callers".
const CALL_SYMBOL_CLASSES = new Set(["Function", "Method"]);

export function renderCallers(graph, ind) {
  // symbol grain: a fine symbol's callers are the SUBJECTS of callsSymbol edges into it.
  if (CALL_SYMBOL_CLASSES.has(ind.class)) {
    const callers = [...new Set(edgesOfKind(graph, "callsSymbol").filter((e) => e.object === ind.id).map((e) => e.subjectLabel || e.subject))];
    if (!callers.length) return `${ind.label}: no recorded callers (fine-grained call edges are conservative — absence is not proof). Try tmct_impact for the full reverse closure.`;
    return `${ind.label} — called by ${callers.length} symbol(s):\n  ${capJoin(callers, CALL_CAP, "\n  ")}`;
  }
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const callers = [...new Set(edgesOfKind(graph, "calls").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))];
  if (!callers.length) return `${modLabel}: no recorded callers (calls are coarse/import-backed — absence is not proof). Try tmct_impact for the full reverse closure.`;
  return `${modLabel} — called by ${callers.length} module(s):\n  ${capJoin(callers, CALL_CAP, "\n  ")}`;
}

/** Callees of the target: the fn/method-precise callsSymbol edges when it is a fine symbol,
 *  else the module-coarse `calls` one hop from its module. */
export function renderCallees(graph, ind) {
  // symbol grain: a fine symbol's callees are the OBJECTS of its callsSymbol edges.
  if (CALL_SYMBOL_CLASSES.has(ind.class)) {
    const callees = [...new Set(edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object))];
    if (!callees.length) return `${ind.label}: no recorded callees (calls only stdlib/external, or fine-grained call edges are not in the extracted graph).`;
    return `${ind.label} — calls into ${callees.length} symbol(s):\n  ${capJoin(callees, CALL_CAP, "\n  ")}`;
  }
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const callees = [...new Set(edgesOfKind(graph, "calls").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object))];
  if (!callees.length) return `${modLabel}: no recorded callees.`;
  return `${modLabel} — calls into ${callees.length} module(s):\n  ${capJoin(callees, CALL_CAP, "\n  ")}`;
}

// ---- fine-grained in-repo calls (fn→fn, `callsSymbol`) ---------------------------

const CALL_HINT_CAP = 8;

/** Format one fn→fn callee edge as `name [path:line]` (path:line from the callee's site). */
function calleeRef(graph, e) {
  const callee = graph.byId.get(e.object);
  const cs = callee ? siteOf(callee) : null;
  return `${e.objectLabel || callee?.label || e.object}${cs ? ` [${cs.path}:${cs.start}]` : ""}`;
}

/** One-line "calls in-repo: name [path:line], …" hint for a function — appended to
 *  tmct_snippet and the tmct_context exemplar body so the agent sees the symbol's
 *  in-repo call dependencies inline. Empty string when it calls nothing in-repo. Pure. */
export function callHint(graph, ind) {
  if (!ind?.id) return "";
  const calls = edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id);
  if (!calls.length) return "";
  return `calls in-repo: ${capJoin(calls.map((e) => calleeRef(graph, e)), CALL_HINT_CAP)}`;
}

/** The in-repo symbols a function calls (fn→fn `callsSymbol` edges), with file:line.
 *  Cold tool — replaces reading a body to learn its in-repo call graph. */
export function renderCalls(graph, ind) {
  const calls = edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id);
  if (!calls.length) {
    return `${ind.label} — ${ind.class || "Entity"}: no in-repo calls recorded (calls only stdlib/external, or fine-grained call edges are not in the extracted graph).`;
  }
  const items = calls.map((e) => calleeRef(graph, e));
  return `${ind.label} — ${ind.class || "Entity"} calls ${calls.length} in-repo symbol(s):\n  ${capJoin(items, CALL_CAP, "\n  ")}`;
}

// ---- commit history with author/date/subject (Commit attributes) ----------------

/** One commit rendered as "<sha> <date> <author> — <subject>", from the Commit
 *  individual's commitAuthor/commitDate/commitMessage attributes (graceful when absent). */
function commitLine(graph, commitId, fallbackLabel) {
  const c = graph.byId.get(commitId);
  const sha = c?.label || fallbackLabel || commitId;
  // Tolerate either attribute-key convention (commitAuthor/… or the shorter author/…).
  const date = attrVal(c, "commitDate") || attrVal(c, "date");
  const author = attrVal(c, "commitAuthor") || attrVal(c, "author");
  const msg = attrVal(c, "commitMessage") || attrVal(c, "message");
  const head = [sha, date, author].filter(Boolean).join(" ");
  return msg ? `${head} — ${msg}` : head;
}

/** File history: commits that touched a symbol's MODULE (module-coarse `touches`
 *  edges), each with author/date/subject. Newest-first (git-log order preserved). */
export function renderFileHistory(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const commits = edgesOfKind(graph, "touches").filter((e) => e.object === modId);
  if (!commits.length) return `${modLabel}: no commit history recorded (outside the git-log window or unmodified).`;
  const shown = commits.slice(0, HISTORY_CAP).map((e) => `  ${commitLine(graph, e.subject, e.subjectLabel)}`);
  const tail = commits.length > HISTORY_CAP ? `\n  …+${commits.length - HISTORY_CAP} more` : "";
  return `${modLabel}: touched by ${commits.length} recent commit(s):\n${shown.join("\n")}${tail}`;
}

/** Symbol-granular history: commits whose `touchesSymbol` edge points at THIS symbol's
 *  id (method/class/function), each with author/date/subject. Used by method/class history. */
function renderSymbolHistory(graph, ind) {
  const commits = edgesOfKind(graph, "touchesSymbol").filter((e) => e.object === ind.id);
  if (!commits.length) {
    return `${ind.label} — ${ind.class || "Entity"}: no symbol-level commit history recorded (outside the git-log window, or fine-grained history is not in the extracted graph).`;
  }
  const shown = commits.slice(0, HISTORY_CAP).map((e) => `  ${commitLine(graph, e.subject, e.subjectLabel)}`);
  const tail = commits.length > HISTORY_CAP ? `\n  …+${commits.length - HISTORY_CAP} more` : "";
  return `${ind.label} — ${ind.class || "Entity"}: touched by ${commits.length} commit(s):\n${shown.join("\n")}${tail}`;
}

/** Method history — commits touching a specific method symbol (`touchesSymbol`). */
export function renderMethodHistory(graph, ind) {
  return renderSymbolHistory(graph, ind);
}

/** Class history — commits touching a specific class symbol (`touchesSymbol`). */
export function renderClassHistory(graph, ind) {
  return renderSymbolHistory(graph, ind);
}

// ---- author identity (0.8.2 WS4): the Commit "author" attribute answered as a
//      person — "who is <Name>", "what did <Name> touch". Author is an ATTRIBUTE
//      (key "author"/mgx:commitAuthor), never an individual, so these read the
//      attribute off every Commit and aggregate. All renderers return null on an
//      unknown name — the chat lane falls through to the ordinary honest miss. ----

const AUTHOR_TOUCH_CAP = 15;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Map of lowercased author name → that author's Commit individuals (payload order).
 *  Tolerates both attribute-key conventions (author / commitAuthor), like commitLine. */
export function authorIndex(graph) {
  const idx = new Map();
  for (const ind of graph?.individuals || []) {
    if ((ind.class || "") !== "Commit") continue;
    const author = String(attrVal(ind, "author") || attrVal(ind, "commitAuthor")).trim();
    if (!author) continue;
    const key = author.toLowerCase();
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(ind);
  }
  return idx;
}

/** "May–Jun 2026"-style range over the commits' date attributes ("" when undated). */
function commitDateRange(commits) {
  const dates = commits
    .map((c) => new Date(attrVal(c, "date") || attrVal(c, "commitDate")))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b);
  if (!dates.length) return "";
  const fmt = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const lo = fmt(dates[0]);
  const hi = fmt(dates[dates.length - 1]);
  if (lo === hi) return lo;
  if (dates[0].getUTCFullYear() === dates[dates.length - 1].getUTCFullYear()) {
    return `${MONTHS[dates[0].getUTCMonth()]}–${hi}`;
  }
  return `${lo}–${hi}`;
}

/** The deduped labels of everything an author's commits touched (touches +
 *  touchesSymbol edge OBJECTS), in edge order. [] on an unknown author. */
function authorTouchedLabels(graph, commits) {
  const ids = new Set(commits.map((c) => c.id));
  const labels = [];
  const seen = new Set();
  for (const kind of ["touches", "touchesSymbol"]) {
    for (const e of edgesOfKind(graph, kind)) {
      if (!ids.has(e.subject)) continue;
      const label = e.objectLabel || graph.byId?.get?.(e.object)?.label || e.object;
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/** Identity card for an author name — "Grace Hopper — 2 commits in this index
 *  (May–Jun 2026), touching: <labels, capped>". Null on an unknown name. */
export function renderAuthorCard(graph, name) {
  const commits = authorIndex(graph).get(String(name || "").trim().toLowerCase());
  if (!commits?.length) return null;
  const display = String(attrVal(commits[0], "author") || attrVal(commits[0], "commitAuthor")).trim();
  const range = commitDateRange(commits);
  const touched = authorTouchedLabels(graph, commits);
  const touching = touched.length ? `, touching: ${capJoin(touched, AUTHOR_TOUCH_CAP)}` : "";
  return `${display} — ${commits.length} commit${commits.length === 1 ? "" : "s"} in this index${range ? ` (${range})` : ""}${touching}.`;
}

/** What an author touched — the deduped entity list off her commits' touches/
 *  touchesSymbol edges, capped like the other bounded renders. Null on an unknown
 *  name; an honest "no touch edges" line when the commits carry none. */
export function renderAuthorTouches(graph, name) {
  const commits = authorIndex(graph).get(String(name || "").trim().toLowerCase());
  if (!commits?.length) return null;
  const display = String(attrVal(commits[0], "author") || attrVal(commits[0], "commitAuthor")).trim();
  const touched = authorTouchedLabels(graph, commits);
  if (!touched.length) return `${display}: ${commits.length} commit${commits.length === 1 ? "" : "s"} in this index, but no touch edges recorded for them.`;
  return `${display} touched ${touched.length} entit${touched.length === 1 ? "y" : "ies"} across ${commits.length} commit${commits.length === 1 ? "" : "s"}:\n  ${capJoin(touched, AUTHOR_TOUCH_CAP, "\n  ")}`;
}

/** "authored by <author> (<date>)" for a commit named by sha (7-40 hex chars; the
 *  graph label and the typed sha may each be a prefix of the other). Null when the
 *  sha matches no commit or more than one — never a guess. */
export function renderCommitAuthor(graph, sha) {
  const s = String(sha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) return null;
  const hits = (graph?.individuals || []).filter((i) => {
    if ((i.class || "") !== "Commit") return false;
    const label = String(i.label || "").toLowerCase();
    return label.startsWith(s) || s.startsWith(label);
  });
  if (hits.length !== 1) return null;
  const c = hits[0];
  const author = String(attrVal(c, "author") || attrVal(c, "commitAuthor")).trim();
  if (!author) return null;
  const date = attrVal(c, "date") || attrVal(c, "commitDate");
  return `${c.label}: authored by ${author}${date ? ` (${date})` : ""}.`;
}

// ---- symbol search (kind=function/class/method/attribute, with name/decorator filters)

const SYMBOL_CLASSES = { function: "Function", class: "Class", method: "Method", attribute: "Attribute" };

/** The structured scorer behind searchSymbols (kind=function/class/method/attribute, with
 *  name/decorator filters): filters graph individuals to `kind`'s class, scores by token
 *  substring hits (or 1 for an empty query, matching everything of that kind), and sorts
 *  score desc, tie-broken by SHORTER label first (matches searchSymbols's original inline
 *  sort exactly). An unrecognised `kind` yields an empty ranked list — callers that need to
 *  distinguish "unknown kind" from "kind valid, nothing matched" check SYMBOL_CLASSES
 *  themselves (see searchSymbols below). Pure; deterministic.
 *  @returns {Array<{ind: object, score: number}>} */
export function scoreSymbolsRanked(graph, tokens, { kind, decFilter = "", nameRe = null } = {}) {
  const targetClass = SYMBOL_CLASSES[kind];
  if (!targetClass) return [];
  const hits = [];
  for (const ind of graph.individuals) {
    if ((ind.class || "") !== targetClass) continue;
    if (nameRe && !nameRe.test(ind.label)) continue;
    if (decFilter && !decoratorOf(ind).toLowerCase().includes(decFilter)) continue;
    const label = String(ind.label).toLowerCase();
    let score = tokens.length ? 0 : 1;
    for (const t of tokens) if (label.includes(t)) score += 5;
    if (tokens.length && !score) continue;
    hits.push({ ind, score });
  }
  hits.sort((a, b) => b.score - a.score || String(a.ind.label).length - String(b.ind.label).length);
  return hits;
}

function searchSymbols(graph, tokens, { limit = SEARCH_LIMIT, kind, decFilter, nameRe }) {
  const targetClass = SYMBOL_CLASSES[kind];
  if (!targetClass) return `unknown kind "${kind}" (use function, class, method, attribute, or module).`;
  const hits = scoreSymbolsRanked(graph, tokens, { kind, decFilter, nameRe });
  if (!hits.length) return `no ${kind} matches the given filters.`;
  const top = hits.slice(0, limit);
  const lines = [`${hits.length} ${kind}(s) match (top ${top.length}):`];
  for (const { ind } of top) lines.push(`- ${ind.label}${spanTag(siteOf(ind))}`);
  lines.push("Then tmct_snippet <name> for the exact body, or tmct_describe for its edges.");
  return lines.join("\n");
}

// ---- tmct_context: a one-shot "edit bundle" plan (pure; the server adds the file
//      reads). Returns everything needed to add-a-sibling to a module in ONE call,
//      so the agent need not search→describe→snippet→read×N (RepoGraph ego-network
//      idea; LocAgent: structured, replacement-shaped output drives tool adoption).

const CONTEXT_SIBLING_CAP = 8; // Lever 1: the bundle is re-billed every turn — keep a few most-relevant siblings, not all.
const CLASS_MEMBER_CAP = 16;   // Class-internal members shown when the anchor is a class/method.
const COCHANGE_MID_CAP = 4;    // #13: trim the MID bundle's co-change tail (was 8) — re-billed every turn.
const CONTEXT_TESTS_CAP = 6;   // #13: cap the covering-tests list in the bundle.
const INSERTION_REGION_CAP = 40; // #2: contiguous tail lines shown as the "write your new sibling here" region.
// #6 task-size thresholds (named, next to the caps above). B1/B6: widened so the COMMON
// "add a small sibling util / register a filter" task lands at the lean TINY default (a 1-2
// param helper with a short body), and only genuinely bigger edits top up to MID/LARGE.
const TINY_MAX_LOC = 12;       // TINY: exemplar/anchor body ≤ this many lines …
const TINY_MAX_ARITY = 2;      //   … AND ≤ this many params (value, arg) …
const LARGE_CLASS_MEMBERS = 8; // LARGE: anchor is a method of a class with ≥ this many members ("big class").
const INLINE_CALLEE_CAP = 3;   // LARGE: inline at most this many depth-1 in-repo callee bodies …
const INLINE_CALLEE_LOC = 120; //   … up to this many total lines.

const splitDecs = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const tokenize = (s) =>
  String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const countParams = (p) => { const s = String(p || "").trim(); return s ? s.split(",").map((x) => x.trim()).filter(Boolean).length : 0; };
const modeOf = (nums) => {
  const freq = new Map();
  let best = nums[0] ?? 0;
  let bestN = 0;
  for (const n of nums) { const c = (freq.get(n) || 0) + 1; freq.set(n, c); if (c > bestN) { bestN = c; best = n; } }
  return best;
};

/** A symbol's structural profile (param count, has-returns/raises, in-repo callee set)
 *  — the shape matched by the structural-similarity component of sibling ranking. */
function profileOf(x) {
  return {
    paramCount: countParams(x?.params),
    hasReturns: Boolean(x?.returns),
    hasRaises: Boolean(x?.raises),
    callees: x?.callees instanceof Set ? x.callees : new Set(),
  };
}

/** When the anchor is a Module (no single anchor symbol), derive the dominant structural
 *  pattern across the siblings so the exemplar can be chosen for structural closeness too. */
function dominantProfile(siblings) {
  if (!siblings.length) return { paramCount: 0, hasReturns: false, hasRaises: false, callees: new Set() };
  const counts = siblings.map((s) => countParams(s.params));
  const retYes = siblings.filter((s) => Boolean(s.returns)).length;
  const raiseYes = siblings.filter((s) => Boolean(s.raises)).length;
  const calleeFreq = new Map();
  for (const s of siblings) for (const c of s.callees || []) calleeFreq.set(c, (calleeFreq.get(c) || 0) + 1);
  const common = new Set([...calleeFreq.entries()].filter(([, n]) => n >= 2).map(([c]) => c));
  return {
    paramCount: modeOf(counts),
    hasReturns: retYes * 2 >= siblings.length,
    hasRaises: raiseYes * 2 >= siblings.length,
    callees: common,
  };
}

/** Structural affinity of a sibling to the target profile — bounded below name-affinity
 *  (max 16 < the 50/token name weight), so it only breaks ties within a name/decorator tier. */
function structuralScore(s, target) {
  if (!target) return 0;
  let score = Math.max(0, 4 - Math.abs(countParams(s.params) - target.paramCount));
  if (Boolean(s.returns) === target.hasReturns) score += 2;
  if (Boolean(s.raises) === target.hasRaises) score += 2;
  const shared = [...(s.callees || [])].filter((c) => target.callees.has(c)).length;
  return score + Math.min(shared, 4) * 2;
}

/** Lever 1: rank siblings by relevance to the anchor so the lean bundle shows the ones
 *  worth copying — shared decorator (the module's registration pattern, e.g.
 *  @register.filter) > name-affinity (shared tokens) > nearest source position. Pure;
 *  mutates a transient `_score` only. */
function rankSiblings(siblings, { decorators: anchorDecorators = "", label: anchorLabel = "", site: anchorSite = null } = {}, structuralTarget = null) {
  const decCount = new Map();
  for (const s of siblings) for (const d of splitDecs(s.decorators)) decCount.set(d, (decCount.get(d) || 0) + 1);
  let dominant = "";
  let bestCount = 1;
  for (const [d, c] of decCount) if (c > bestCount) { bestCount = c; dominant = d; }
  const anchorDecs = new Set(splitDecs(anchorDecorators));
  const targetDecs = anchorDecs.size ? anchorDecs : new Set(dominant ? [dominant] : []);
  const anchorTokens = new Set(tokenize(anchorLabel));
  const anchorStart = anchorSite?.start ?? null;
  for (const s of siblings) {
    const decMatch = splitDecs(s.decorators).some((d) => targetDecs.has(d)) ? 1 : 0;
    const nameAff = tokenize(s.label).filter((t) => anchorTokens.has(t)).length;
    // #3: structural affinity (param-count / has-returns / has-raises / shared in-repo
    // callees) sits BELOW name-affinity (max 16 < 50) — a tiebreaker within a name tier.
    const struct = structuralScore(s, structuralTarget);
    const pos = anchorStart != null && s.site ? 1 / (1 + Math.abs(s.site.start - anchorStart)) : 0;
    s._score = decMatch * 1000 + nameAff * 50 + struct + pos;
  }
  return [...siblings].sort((a, b) => b._score - a._score || (a.site?.start || 0) - (b.site?.start || 0));
}

/** Structured edit-context for `symbol`'s module: anchor span, RANKED top-level siblings
 *  (Function/Class) capped lean, the single closest exemplar (for its FULL body when the
 *  anchor itself is a module), registration globals, covering tests, and the insertion line.
 *  Pure — no fs. The server reads the module file once to flesh out the snippet + bodies. */
export function contextPlan(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  const moduleLabel = graph.byId.get(modId)?.label || String(modId || "").replace(/^mod:/, "");
  const defEdges = edgesOfKind(graph, "defines").filter((e) => e.subject === modId);
  // #3: index fn→fn in-repo callees once, so siblings/anchor carry their callee set for
  // structural ranking and the sizeBundle cross-module-call check.
  const calleeMap = new Map();
  for (const e of edgesOfKind(graph, "callsSymbol")) {
    if (!calleeMap.has(e.subject)) calleeMap.set(e.subject, new Set());
    calleeMap.get(e.subject).add(e.object);
  }
  let siblings = [];
  const globals = [];
  let insertion = 0;
  for (const e of defEdges) {
    const mem = graph.byId.get(e.object);
    if (!mem) continue;
    const cls = mem.class || "";
    const site = siteOf(mem);
    if (cls === "GlobalVariable") {
      globals.push({ label: mem.label, value: (mem.attributes || []).find((a) => a.key === "value")?.value || "", site });
      if (site) insertion = Math.max(insertion, site.end);
    } else if (cls === "Function" || cls === "Class") {
      // Carry each sibling's `raises` + one-line doc so a validator-style task sees the
      // error-contract without reading the body. #3 adds params/returns/callees for
      // structural-similarity ranking.
      siblings.push({
        id: mem.id, label: mem.label, class: cls, site, decorators: decoratorOf(mem),
        raises: attrVal(mem, "raises"), doc: attrVal(mem, "doc"),
        params: attrVal(mem, "params"), returns: attrVal(mem, "returns"),
        callees: calleeMap.get(mem.id) || new Set(),
      });
      if (site) insertion = Math.max(insertion, site.end);
    }
  }
  const anchorSite = siteOf(ind);
  const anchor = anchorSite && (ind.class || "") !== "Module"
    ? {
        id: ind.id, label: ind.label, class: ind.class || "", site: anchorSite, decorators: decoratorOf(ind),
        raises: attrVal(ind, "raises"), params: attrVal(ind, "params"), returns: attrVal(ind, "returns"),
        callees: calleeMap.get(ind.id) || new Set(),
      }
    : null;
  const totalSiblings = siblings.length;
  // #3: the structural target the exemplar should resemble — the anchor's own shape when
  // there is one, else the dominant pattern across siblings (module anchor case).
  const structuralTarget = anchor ? profileOf(anchor) : dominantProfile(siblings);
  siblings = rankSiblings(siblings, anchor || { label: ind.label }, structuralTarget);
  // Lever 2: when the anchor is a module (no anchor body shown), surface the single
  // closest sibling's FULL body as the copy-this exemplar; signatures alone made the
  // agent fall back to Read. With a function/class anchor its own body suffices.
  const exemplar = !anchor ? siblings.find((s) => s.site && s.label !== ind.label) || null : null;
  const tests = [...new Set(edgesOfKind(graph, "tests").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))].slice(0, CONTEXT_TESTS_CAP);
  const cochange = cochangeNeighbours(graph, modId).slice(0, COCHANGE_MID_CAP);
  const exports = edgesOfKind(graph, "reexports").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object).slice(0, 20);
  // The LITERAL __all__ membership (even unresolved) — the public surface a
  // new sibling must join to be importable.
  const allExports = attrVal(graph.byId.get(modId), "all");
  // Class-internal members. When the anchor IS a class (or a method of one),
  // the edit often lives inside that class (e.g. add Truncator.lines), so list its
  // members with signatures so the agent need not read/grep the class body.
  const contains = edgesOfKind(graph, "contains");
  let classOwnerId = null;
  if ((ind.class || "") === "Class") classOwnerId = ind.id;
  else if ((ind.class || "") === "Method") classOwnerId = contains.find((e) => e.object === ind.id)?.subject || null;
  let classMembers = null;
  if (classOwnerId) {
    const owner = graph.byId.get(classOwnerId);
    const members = contains.filter((e) => e.subject === classOwnerId).map((e) => {
      const m = graph.byId.get(e.object);
      return {
        label: e.objectLabel || m?.label || e.object,
        class: m?.class || "",
        site: m ? siteOf(m) : null,
        decorators: m ? decoratorOf(m) : "",
        params: m ? attrVal(m, "params") : "",
        returns: m ? attrVal(m, "returns") : "",
        raises: m ? attrVal(m, "raises") : "",
      };
    }).slice(0, CLASS_MEMBER_CAP);
    classMembers = { className: owner?.label || String(classOwnerId).replace(/^fn:.*#/, ""), members, total: contains.filter((e) => e.subject === classOwnerId).length };
  }
  // #2: contiguous insertion region — from the LAST top-level definition (sibling/global,
  // or the exemplar, which is a sibling) through end-of-module. We give the start line here;
  // the server extends `end` to the real end-of-file (capped) using the lines it reads.
  let lastTop = null;
  for (const s of [...siblings, ...globals]) {
    if (s.site && (!lastTop || s.site.start > lastTop.start)) lastTop = s.site;
  }
  const insertionRegion = lastTop ? { start: lastTop.start, end: lastTop.end } : null;
  // #6: the focal symbol (anchor when present, else the module's exemplar) drives both the
  // call hint and the LARGE-tier inlined-callee bodies.
  const focal = anchor || exemplar;
  const focalInd = focal?.id ? graph.byId.get(focal.id) : null;
  const callHintStr = focalInd ? callHint(graph, focalInd) : "";
  let calleeBodies = [];
  if (focal?.callees) {
    for (const cid of focal.callees) {
      const c = graph.byId.get(cid);
      const cs = c ? siteOf(c) : null;
      if (cs) calleeBodies.push({ label: c.label, site: cs });
      if (calleeBodies.length >= INLINE_CALLEE_CAP) break;
    }
  }
  return {
    modId, moduleLabel, anchor, siblings, totalSiblings, exemplar, globals, tests, cochange,
    exports, allExports, classMembers, insertion, insertionRegion, calleeBodies, callHint: callHintStr,
    siblingCap: CONTEXT_SIBLING_CAP,
  };
}

// ---- #6 task-size-adaptive bundle (TINY / MID / LARGE) ---------------------------

/** Which bundle sections a tier emits. TINY is genuinely minimal (header + one short
 *  exemplar body + registration + insertion region + __all__); MID is the full bundle;
 *  LARGE adds inlined depth-1 callee bodies. FULL forces everything on. Pure. */
export function bundleMask(tier) {
  const all = {
    anchor: true, exemplar: true, registration: true, insertionRegion: true, allExports: true,
    classMembers: true, siblings: true, reexports: true, tests: true, cochange: true, inlinedCallees: false,
  };
  if (tier === "TINY") return { ...all, classMembers: false, siblings: false, reexports: false, tests: false, cochange: false };
  if (tier === "LARGE" || tier === "FULL") return { ...all, inlinedCallees: true };
  return all; // MID
}

/** B2: a TRIMMED mask for SECONDARY (related-but-not-primary) digest modules — keep the cheap,
 *  cache-stable signal (registration globals, ranked sibling SIGNATURES, the insertion region,
 *  __all__) but drop the expensive bodies (anchor/exemplar/inlined callees) and the variable
 *  tails (tests/cochange/re-exports/class members). Pure. */
export function trimBundleMask(mask) {
  return {
    ...mask,
    anchor: false, exemplar: false, inlinedCallees: false,
    classMembers: false, reexports: false, tests: false, cochange: false,
    registration: true, siblings: true, insertionRegion: true, allExports: true,
  };
}

/** Classify a context plan by task size and return {tier, mask, topup}. B1/B6: lean by
 *  default — START at TINY and escalate ("top-up") one tier ONLY when the lean bundle would
 *  omit something the edit demonstrably needs (no exemplar body, a class/method edit, or a
 *  large/complex target → MID; a cross-module call or a big-class method → LARGE). `topup`
 *  records whether auto-sizing escalated above TINY (surfaced in the digest header). Pure. */
export function sizeBundle(plan, graph, { untuned = false } = {}) {
  const focal = plan.anchor || plan.exemplar;
  let tier = "TINY";
  // (a) no exemplar/anchor body to copy → the agent needs the sibling list (MID).
  const hasExemplarBody = Boolean((plan.anchor && plan.anchor.site) || (plan.exemplar && plan.exemplar.site));
  if (!hasExemplarBody) tier = "MID";
  // (b) the edit lives INSIDE a class (class/method anchor with members) → show members (MID).
  if (plan.classMembers && plan.classMembers.members && plan.classMembers.members.length) tier = "MID";
  if (focal) {
    // (c) a large/complex target (long body, many params, or it raises) → MID.
    const loc = focal.site ? focal.site.end - focal.site.start + 1 : Infinity;
    const arity = countParams(focal.params);
    // (c) a long/complex focal escalates TINY→MID. Escalation fires on any long focal: gating it on
    // an explicit symbol anchor (so a long-exemplar MODULE digest stayed TINY) regressed results,
    // because the trimmed sibling/test tail was load-bearing scaffolding. The `untuned` param is now
    // a no-op for sizing (kept so the tmct-b010 control arm's flag still resolves).
    if (loc > TINY_MAX_LOC || arity > TINY_MAX_ARITY || Boolean(focal.raises)) tier = "MID";
    // (d) LARGE — only for an EXPLICIT symbol focus (plan.anchor), where inlining the
    // depth-1 callee bodies / the class shape is worth the tokens: a cross-module call from
    // the anchor, OR an anchor that is a method of a big class. When the focal is merely a
    // module-EXEMPLAR (the digest/module-anchor case), a cross-module call does NOT force
    // LARGE — the exemplar body already shows the call, and MID's signatures suffice; this
    // keeps the common "register a filter" module bundle lean.
    let crossModule = false;
    if (plan.anchor) {
      for (const cid of focal.callees || []) {
        const c = graph.byId.get(cid);
        const cs = c ? siteOf(c) : null;
        if (cs && cs.path !== plan.moduleLabel) { crossModule = true; break; }
      }
    }
    const bigClassMethod = (plan.anchor?.class || "") === "Method" &&
      Number(plan.classMembers?.total || plan.classMembers?.members?.length || 0) >= LARGE_CLASS_MEMBERS;
    if (crossModule || bigClassMethod) tier = "LARGE";
  } else {
    tier = "MID"; // no focal symbol at all → not a tiny add; keep the fuller bundle.
  }
  return { tier, mask: bundleMask(tier), topup: tier !== "TINY" };
}

/** B2: order SECONDARY digest modules by relevance to the PRIMARY (first) module — import
 *  adjacency (either direction, incl. coarse calls) outranks change-coupling weight; ties keep
 *  the caller's input order (stable, deterministic). Returns the candidate labels reordered.
 *  Pure — no fs. Falls back to the input order when the primary can't be mapped to a module. */
export function rankModulesByProximity(graph, primaryLabel, candidateLabels) {
  const moduleIdFor = (label) => {
    const { match } = resolveSymbol(graph, label);
    return match && (match.class || "") === "Module" ? match.id : null;
  };
  const pid = moduleIdFor(primaryLabel);
  if (!pid) return [...candidateLabels];
  const adjacent = new Set();
  for (const kind of ["imports", "calls"]) {
    for (const e of edgesOfKind(graph, kind)) {
      if (e.subject === pid) adjacent.add(e.object);
      if (e.object === pid) adjacent.add(e.subject);
    }
  }
  const coWeight = new Map();
  for (const e of edgesOfKind(graph, "cochange")) {
    if (e.subject === pid) coWeight.set(e.object, (coWeight.get(e.object) || 0) + (e.weight || 0));
    else if (e.object === pid) coWeight.set(e.subject, (coWeight.get(e.subject) || 0) + (e.weight || 0));
  }
  return candidateLabels
    .map((label, i) => {
      const id = moduleIdFor(label);
      const score = id ? (adjacent.has(id) ? 10 : 0) + (coWeight.get(id) || 0) : 0;
      return { label, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.label);
}

// ---- #7 tmct_context_more: only the sections a TINY/MID bundle omits ------------

/** Render ONLY the bundle sections a lean bundle omits (sibling list / class members /
 *  re-exports / __all__ / tests / cochange) for a symbol's module. Pure (no fs). */
export function renderContextMore(plan) {
  const out = [`Additional context for ${plan.moduleLabel} (sections omitted from the lean bundle):`];
  if (plan.classMembers && plan.classMembers.members.length) {
    out.push(`\n## members of ${plan.classMembers.className}:`);
    for (const m of plan.classMembers.members) {
      const short = String(m.label).split(".").pop();
      const sig = m.params != null && m.params !== "" ? `(${m.params})${m.returns ? ` -> ${m.returns}` : ""}` : "";
      const dec = m.decorators ? `@${m.decorators} ` : "";
      const r = m.raises ? `  raises=${m.raises}` : "";
      out.push(`  ${m.class} ${short}${m.site ? ` :${m.site.start}` : ""}  ${dec}${short}${sig}${r}`);
    }
  }
  if (plan.siblings.length) {
    out.push(`\n## sibling symbols (most relevant first; ${plan.siblings.length} total):`);
    for (const s of plan.siblings.slice(0, plan.siblingCap)) {
      const dec = s.decorators ? `@${s.decorators} ` : "";
      const r = s.raises ? `  raises=${s.raises}` : "";
      out.push(`  ${s.class} ${s.label}${s.site ? ` :${s.site.start}` : ""}  ${dec}${r}`);
    }
    if (plan.siblings.length > plan.siblingCap) out.push(`  …+${plan.siblings.length - plan.siblingCap} more`);
  }
  if (plan.allExports) out.push(`\n## module __all__: ${plan.allExports}`);
  if (plan.exports && plan.exports.length) out.push(`\n## re-exported symbols: ${plan.exports.join(", ")}`);
  if (plan.tests.length) out.push(`\n## covering tests: ${plan.tests.join(", ")}`);
  if (plan.cochange && plan.cochange.length) {
    out.push(`\n## usually changed together: ${plan.cochange.map((c) => `${c.label} (×${c.weight})`).join(", ")}`);
  }
  if (out.length === 1) out.push("(no omitted sections — the lean bundle already contained everything for this symbol.)");
  return out.join("\n");
}

// ---- Repository Interface: graph-only context() bundle (no fs) -----------------

/** Render a graph-only edit bundle for `plan` — every contextPlan section EXCEPT the
 *  fs-dependent anchor/exemplar/inlined-callee body text (registration globals, class
 *  members, ranked siblings, __all__, re-exports, the insertion point, covering tests,
 *  co-change neighbours), gated by `mask` (see bundleMask/sizeBundle). Pure — no fs.
 *  Used by graph-service.mjs's context() service so a graph-only provider (no working
 *  tree) can still return a real HIT instead of an NO_SOURCE miss — see PLAN item 2d /
 *  INTERFACE_VERSION 1.1.0. A source-capable provider layers the body sections on top
 *  (it has fs access this module deliberately does not). */
export function renderGraphOnlyBundle(plan, mask) {
  const out = [
    `Edit context for ${plan.moduleLabel} (graph-only bundle — siblings/registration/tests are real graph truth; ` +
      "no source body without a source-capable provider).",
  ];
  if (mask.registration && plan.globals.length) {
    out.push(`\n## registration / module globals (replicate this pattern):`);
    for (const g of plan.globals) out.push(`  ${g.label} = ${g.value}${g.site ? `  [:${g.site.start}]` : ""}`);
  }
  if (mask.classMembers && plan.classMembers && plan.classMembers.members.length) {
    out.push(`\n## members of ${plan.classMembers.className}:`);
    for (const m of plan.classMembers.members) {
      const short = String(m.label).split(".").pop();
      const sig = m.params != null && m.params !== "" ? `(${m.params})${m.returns ? ` -> ${m.returns}` : ""}` : "";
      const dec = m.decorators ? `@${m.decorators} ` : "";
      const r = m.raises ? `  raises=${m.raises}` : "";
      out.push(`  ${m.class} ${short}${m.site ? ` :${m.site.start}` : ""}  ${dec}${short}${sig}${r}`);
    }
  }
  if (mask.siblings && plan.siblings.length) {
    out.push(`\n## sibling symbols to copy the style of (most relevant first; ${plan.siblings.length} total):`);
    for (const s of plan.siblings.slice(0, plan.siblingCap)) {
      const dec = s.decorators ? `@${s.decorators} ` : "";
      const r = s.raises ? `  raises=${s.raises}` : "";
      out.push(`  ${s.class} ${s.label}${s.site ? ` :${s.site.start}` : ""}  ${dec}${r}`);
    }
    if (plan.siblings.length > plan.siblingCap) out.push(`  …+${plan.siblings.length - plan.siblingCap} more`);
  }
  if (mask.allExports && plan.allExports) out.push(`\n## module __all__: ${plan.allExports}`);
  if (mask.reexports && plan.exports && plan.exports.length) out.push(`\n## re-exported symbols: ${plan.exports.join(", ")}`);
  if (mask.insertionRegion) {
    if (plan.insertionRegion) {
      out.push(`\n## insertion region starts at ${plan.moduleLabel}:${plan.insertionRegion.start} (write your new sibling here — no source body in this graph-only bundle).`);
    } else if (plan.insertion) {
      out.push(`\n## insert the new sibling after line ~${plan.insertion} (end of the last top-level definition).`);
    }
  }
  if (mask.tests && plan.tests.length) out.push(`\n## covering tests: ${plan.tests.join(", ")}`);
  if (mask.cochange && plan.cochange && plan.cochange.length) {
    out.push(`\n## usually changed together (consider editing these too): ${plan.cochange.map((c) => `${c.label} (×${c.weight})`).join(", ")}`);
  }
  return out.join("\n");
}

// ---- #7 cold-tool catalog (written to <repo>/.tmct/TOOLS.md by the index step) --

/** Markdown catalog of the COLD tools (everything except the hot catalog tools): each
 *  with a one-line purpose and the exact Bash invocation via the CLI `cli <tool>` route.
 *  Pure — `cliPath` is the absolute path to bin/cli.mjs the caller wants embedded. */
export function renderToolsCatalog(cliPath) {
  const cold = [
    ["tmct_describe", "Locate one symbol and list its typed edges (both directions) with provenance.", { symbol: "django/utils/text.py" }],
    ["tmct_signature", "One symbol's API surface (params, returns, raises/catches, flags, decorators, doc) without the body.", { symbol: "Truncator.chars" }],
    ["tmct_impact", "Transitive reverse closure over imports/calls — what breaks if a module changes, by depth, with tests.", { module: "django/utils/text.py" }],
    ["tmct_search", "Free-text/ranked lookup over the code-map to find the right module or symbol.", { query: "template filters", kind: "function" }],
    ["tmct_members", "A class's methods + attributes (file:line, decorators) in one slice.", { class: "Truncator" }],
    ["tmct_subclasses", "A class's base classes plus the transitive set of classes that extend it.", { class: "Field" }],
    ["tmct_architecture", "Package/module map + the most-imported hub modules (optionally scoped to a package).", { package: "django/template" }],
    ["tmct_exports", "A module's public __all__ surface, each name resolved to the module that defines it.", { module: "django/db/models/__init__.py" }],
    ["tmct_tests_for", "The test modules covering a symbol or module, from the typed test edges.", { symbol: "django/utils/text.py" }],
    ["tmct_untested", "Source modules with no covering test module — a coverage-gap view (no arguments).", {}],
    ["tmct_history", "Recent commits that touched a symbol's module (newest first).", { symbol: "django/utils/text.py" }],
    ["tmct_file_history", "Commits that touched a symbol's module, each with author / date / subject.", { symbol: "django/utils/text.py" }],
    ["tmct_method_history", "Commits that touched a specific method symbol (fine-grained), with author / date / subject.", { symbol: "Truncator.chars" }],
    ["tmct_class_history", "Commits that touched a specific class symbol (fine-grained), with author / date / subject.", { symbol: "Truncator" }],
    ["tmct_callers", "Modules that call into a symbol's module (one hop).", { symbol: "django/utils/text.py" }],
    ["tmct_callees", "Modules a symbol's module calls into (one hop).", { symbol: "django/utils/text.py" }],
    ["tmct_calls", "The in-repo symbols a function calls (fn→fn), each with file:line.", { symbol: "slugify" }],
    ["tmct_cochanges", "Modules that historically change in the same commit as a symbol's module (git co-change).", { symbol: "django/utils/text.py" }],
    ["tmct_context_more", "The bundle sections a lean tmct_context omitted (siblings / tests / cochange / class members / re-exports).", { symbol: "django/utils/text.py" }],
  ];
  const lines = [
    "# tmct cold-tool catalog",
    "",
    "The hot tools — `tmct_context` (start here to add/modify code; supports `depth: min|auto|full`) and `tmct_snippet` (exact source of one symbol) — carry full schemas in the TOOLS catalog.",
    "",
    "The cold tools below invoke via the CLI:",
    "",
  ];
  for (const [name, purpose, args] of cold) {
    lines.push(`## ${name}`);
    lines.push(purpose);
    lines.push("```bash");
    lines.push(`node ${cliPath} cli ${name} '${JSON.stringify(args)}'`);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

// ---- change-coupling (git co-change) — "what usually changes together" ----------

/** [{label, weight}] modules co-changed with modId, sorted by count desc. Pure. */
function cochangeNeighbours(graph, modId) {
  const hits = [];
  for (const e of edgesOfKind(graph, "cochange")) {
    if (e.subject === modId) hits.push({ label: e.objectLabel || e.object, weight: e.weight || 0 });
    else if (e.object === modId) hits.push({ label: e.subjectLabel || e.subject, weight: e.weight || 0 });
  }
  return hits.sort((a, b) => b.weight - a.weight);
}

const COCHANGE_CAP = 20;

/** Modules that historically change in the same commit as the target's module. */
export function renderCochanges(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const hits = cochangeNeighbours(graph, modId);
  if (!hits.length) return `${modLabel}: no change-coupling recorded (rarely co-committed, or outside the git-log window).`;
  const list = hits.slice(0, COCHANGE_CAP).map((h) => `${h.label} (×${h.weight})`);
  return `${modLabel} — usually changes together with ${hits.length} module(s) (edit these too):\n  ${list.join("\n  ")}` +
    (hits.length > COCHANGE_CAP ? `\n  …+${hits.length - COCHANGE_CAP} more` : "");
}

// ---- re-exports / public API (__all__) ------------------------------------------

const EXPORTS_CAP = 40;

/** A module's public export surface: each exported name → the module that actually
 *  defines it (so re-export hubs like __init__ / an index barrel are explicit). Reads the
 *  `reexports` edge (mgx:reExports), which the extractor emits for ANY public-API construct
 *  — Python `__all__` AND JS/TS `export` / `export { … } from …` — so the wording stays
 *  language-neutral rather than implying a Python-only `__all__`. */
export function renderExports(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  const modLabel = graph.byId.get(modId)?.label || modId;
  const edges = edgesOfKind(graph, "reexports").filter((e) => e.subject === modId);
  if (!edges.length) return `${modLabel}: no public exports recorded (no export list / __all__ found, or none resolved).`;
  const list = edges.slice(0, EXPORTS_CAP).map((e) => {
    const origin = graph.byId.get(e.object);
    const where = origin ? siteOf(origin) : null;
    const from = where ? ` ← ${where.path}` : "";
    return `${e.objectLabel || e.object}${from}`;
  });
  return `${modLabel} — public API (${edges.length} export(s)):\n  ${list.join("\n  ")}` +
    (edges.length > EXPORTS_CAP ? `\n  …+${edges.length - EXPORTS_CAP} more` : "");
}
