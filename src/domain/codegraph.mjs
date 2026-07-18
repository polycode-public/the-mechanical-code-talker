import { lookupByProseTokens, proseLayerHits, splitIdentifierWords } from "./prose.mjs";
import { CREATED_AT_PROP, UPDATED_AT_PROP } from "./memory/trust.mjs";
import { isTestPath } from "./module-paths.mjs";
import { idfWeight } from "./text-stats.mjs";
import { bfsLevels } from "./planning.mjs";

// Pure (no-network, no-fs) query logic over the typed `entities` payload that the
// deterministic indexer writes to <repo>/.tmct/graph.json (shape produced by
// src/adapters/graph-build.mjs):
//
//   {
//     generated_at, classes: [{name, count, sample[]}],
//     objectProperties: [{predicate, prop, count, examples: [{subject, object,
//                         subjectLabel, objectLabel}]}],
//     individuals: [{id, label, class, derived_from: [ref], mentions: [{id, count}],
//                    attributes?: [{prop, key, value}]}],
//   }

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
    // word -> [individual ids]; {} when prose was disabled at build time
    proseIndex: payload?.proseIndex || {},
  };
}

/** Code entities (Modules) in the loaded graph — the "is there a code graph here"
 *  test. 0 means a graph-less bootstrap OR a graph.json with no code entities (the
 *  degenerate trap); both orient rather than over-promise. */
export function moduleCountOf(graph) {
  if (!graph || !Array.isArray(graph.individuals)) return 0;
  return graph.individuals.filter((i) => (i.class || "") === "Module").length;
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
  // symbol-level edges stay separate kinds so the module-coarse impact closure is unchanged
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
  // memory-graph predicates map to themselves so adjacencyForKinds/edgesOfKind can walk them too
  "mgx:saidinsession": "saidInSession",
  "mgx:inreplyto": "inReplyTo",
  "mgx:statedby": "statedBy",
  "mgx:canonicalisedfrom": "canonicalisedFrom",
};

export function relationKind(group) {
  const prop = String(group?.prop || "").toLowerCase();
  if (PROP_KIND[prop]) return PROP_KIND[prop];
  const pred = String(group?.predicate || "").toLowerCase();
  // symbol-granular fallbacks first, so a near-miss still classifies fine-grained
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

const isProvRef = (r) => /^(git|turn):/.test(String(r || ""));

function turnRefCount(ind) {
  return (ind?.derived_from || []).filter(isProvRef).length;
}

function mentionTotal(ind) {
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

/** A class enum in a rendered heading: a multi-word enum reads as words
 *  ("GlobalVariable" -> "Global Variable"); a single-word enum stays verbatim,
 *  keeping the long-standing Module/Function/Entity headings byte-identical.
 *  Title-cased (unlike ask.mjs's lowercase classDisplayName) because these
 *  sites use the enum as a heading label, not mid-sentence prose — and ask.mjs
 *  already imports this module, so reusing its formatter here would be a cycle. */
function classHeading(cls) {
  const c = cls || "Entity";
  const words = splitIdentifierWords(c);
  if (words.length < 2) return c;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// Show the first `n` items, then a "+K more" tail with the true count.
function capJoin(items, n, sep = ", ") {
  if (items.length <= n) return items.join(sep);
  return items.slice(0, n).join(sep) + `, +${items.length - n} more`;
}

const DESCRIBE_EDGE_CAP = 30;
const PROV_CAP = 8;

/** Compact plain-text description of one individual — for an agent consumer. */
export function renderDescribe(graph, ind, { candidates = [] } = {}) {
  const lines = [];
  lines.push(`${ind.label} — ${classHeading(ind.class)} (id: ${ind.id})`);

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
    lines.push(`other matches: ${candidates.map((c) => `${c.label} (${classHeading(c.class)})`).join(", ")}`);
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

// ---- compare ----

/** One side-by-side row for a classified relation. `field` picks the edge
 *  endpoint for the direction ("out" reads object, "incoming" reads subject). */
function compareRow(prefix, key, aEdges, bEdges, labelA, labelB, field) {
  const fmt = (edges) => (edges.length ? capJoin(edges.map((e) => e[`${field}Label`] || e[field]), DESCRIBE_EDGE_CAP) : "none");
  return `  ${prefix}${key}: ${labelA} (${aEdges.length}) -> ${fmt(aEdges)}; ${labelB} (${bEdges.length}) -> ${fmt(bEdges)}`;
}

/** predicate-label -> {group, aEdges, bEdges}, a union-by-key merge of both
 *  sides' edge groups for one direction. */
function pairByPredicate(aGroups, bGroups) {
  const byPred = new Map();
  for (const { group, edges } of aGroups) byPred.set(relLabel(group), { group, aEdges: edges, bEdges: [] });
  for (const { group, edges } of bGroups) {
    const key = relLabel(group);
    if (!byPred.has(key)) byPred.set(key, { group, aEdges: [], bEdges: [] });
    byPred.get(key).bEdges = edges;
  }
  return byPred;
}

/** Side-by-side comparison of two same-kind individuals. Returns null for
 *  mismatched kinds or comparing an individual to itself. */
export function renderCompare(graph, indA, indB) {
  if (!indA || !indB || indA.id === indB.id) return null;
  const klass = indA.class || "Entity";
  if ((indB.class || "Entity") !== klass) return null;

  const lines = [`Comparing ${indA.label} and ${indB.label} (both ${classHeading(klass)}):`];
  const a = edgesFor(graph, indA.id);
  const b = edgesFor(graph, indB.id);
  const outByPred = pairByPredicate(a.out, b.out);
  const inByPred = pairByPredicate(a.incoming, b.incoming);

  if (!outByPred.size && !inByPred.size) {
    lines.push("  edges: none recorded for either in the current artifact.");
  } else {
    for (const [key, { aEdges, bEdges }] of outByPred) {
      lines.push(compareRow("", key, aEdges, bEdges, indA.label, indB.label, "object"));
    }
    for (const [key, { aEdges, bEdges }] of inByPred) {
      lines.push(compareRow("<- ", key, aEdges, bEdges, indA.label, indB.label, "subject"));
    }
  }

  // only mismatches are worth surfacing as a "difference"
  const attrsA = new Map((indA.attributes || []).map((x) => [x.key, x.value]));
  const attrsB = new Map((indB.attributes || []).map((x) => [x.key, x.value]));
  const attrKeys = new Set([...attrsA.keys(), ...attrsB.keys()]);
  for (const k of attrKeys) {
    const va = attrsA.has(k) ? attrsA.get(k) : "(none)";
    const vb = attrsB.has(k) ? attrsB.get(k) : "(none)";
    if (va !== vb) lines.push(`  attribute ${k}: ${indA.label} = ${va}; ${indB.label} = ${vb}`);
  }

  if (graph.truncated.length) lines.push(truncationNote(graph));
  return lines.join("\n");
}

// ---- impact (transitive reverse closure over imports/calls) ---------------------

/** BFS the reverse of imports/calls edges from `ind` — "what would break".
 *  Diamonds collapse to shortest depth; cycles terminate via the visited set.
 *  `callsSymbol` is folded in too, coarsened to module level on read: it has
 *  no import-backing requirement, so it can reach dependents "calls" alone would miss. */
export function impactClosure(graph, ind, { maxDepth = 8 } = {}) {
  const dependents = new Map();
  const coveredBy = new Map(); // moduleId → [test labels]
  const addDependent = (objectId, subjectId, subjectLabel, via) => {
    // callsSymbol coarsens to module level, so two symbols in the same module
    // calling each other must not produce a module pointing at itself
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
        // Keyed under the callee's SYMBOL id too: an impact query resolving a
        // function name seeds the BFS from the symbol, and the module-coarse
        // key above is invisible from there — the caller's module was a real
        // dependent that read back as "no dependents found". Same-module
        // calls stay skipped, mirroring the self-skip on the coarse key.
        if (subjModId !== objModId) addDependent(e.object, subjModId, subjLabel, g.predicate);
      }
    } else if (kind === "tests") {
      for (const e of g.edges) {
        if (!coveredBy.has(e.object)) coveredBy.set(e.object, []);
        coveredBy.get(e.object).push(e.subjectLabel || e.subject);
      }
    }
  }

  const levels = []; // [[{id, label, via, tests[]}], …] indexed by depth-1
  for (const level of bfsLevels(ind.id, (id) => dependents.get(id) || [], { maxDepth, keyOf: (dep) => dep.id })) {
    if (!level.length) continue;
    const withTests = level
      .map((dep) => ({ ...dep, tests: coveredBy.get(dep.id) || [] }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    levels.push(withTests);
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
// Locate scoring is IDF-weighted and component-aware: weight each token by
// rarity across modules so a distinctive term decides over ubiquitous ones,
// and match identifier components (boundary-aware) so "text" hits
// utils/text.py but not "ci<text>". Deterministic; no models.
const PATH_W = 3;          // token == a path component
const SYM_W = 2;           // token == a component of a defined symbol name
const EXACT_W = 5;         // token == a whole defined symbol name
const SYM_MATCH_CAP = 4;   // only the top-K highest-IDF symbol-component hits count
const PROX_FRAC = 0.2;     // import-adjacency bonus = this × the strongest matched neighbour
const PROX_CAP_FRAC = 0.35; // capped at this × the module's own score
// opt-in via demoteNonProd: demote (not exclude) example/fixture/sample/demo/test-*
// paths, which share vocabulary with production modules and would otherwise shadow them
const NONPROD_DEMOTE = 0.15;
const isNonProdLabel = (s) => /(^|\/)(examples?|fixtures?|samples?|demos?|benchmarks?|test-[^/]+)(\/|$)/.test(s);
// opt-in via callAdjacency: same bounded-nudge shape as import-proximity, Python-value
// only today (C#/Java extractors emit ~no call edges)
const CALL_PROX_FRAC = 0.2;
const CALL_PROX_CAP_FRAC = 0.35;
// opt-in via implOfInterface: boost a module implementing an interface in a strongly-
// matched module. C#-only: interfaces are detected by the `I<Uppercase>` naming
// convention against unresolved `ext:<Name>` inherits targets; Java's inherits edges
// carry no equivalent signal to distinguish interface implementation from inheritance.
const IMPL_PROX_FRAC = 0.2;
const IMPL_PROX_CAP_FRAC = 0.35;
const isCsModuleLabel = (s) => /\.cs$/i.test(s);
const looksLikeCsInterface = (label) => /^I[A-Z]/.test(String(label || ""));

// opt-in via proseBoost: bounded nudge for modules whose match comes from a
// decomposed identifier or doc-comment elsewhere in the module, not its path/symbol names
const PROSE_PROX_FRAC = 0.2;
const PROSE_PROX_CAP_FRAC = 0.35;
const PROSE_LOOKUP_LIMIT = 50;

// opt-in via proseLayers: lets a query token that only matches via a normalised
// layer (stem/lemma/spell-corrected/canonical) still contribute, discounted (halved)
// relative to a verbatim match, via prose.mjs's proseLayerHits
const PROSE_LAYER_FRAC = 0.2;
const PROSE_LAYER_CAP_FRAC = 0.35;
const PROSE_LAYER_DISCOUNT = 0.5;

// opt-in via literalMention: recovers a literal dotted module reference the query
// tokenizer would otherwise scatter ("django.utils.http" -> {django,utils,http}),
// by scanning the raw query for whole, boundary-checked module dotted-name/path hits
const LIT_W = EXACT_W;
const LIT_MIN_COMPONENTS = 3;  // "django.utils.http" fires; "utils" alone never does
const LIT_COMP_CAP = 4;
const LIT_FRAC = 1.0;
const LIT_CAP_FRAC = 0.9;

// opt-in via beamSearch: multi-ply adaptive expansion of the proximity nudge above.
// Beam width is a margin relative to each ply's best score (not a fixed count), so a
// weak-then-strong candidate isn't prematurely discarded. Successors are generated
// and pruned per edge kind independently so a dense kind (imports) can't crowd out a
// sparse one (inherits). Only re-ranks modules already present in `scored`.
const BEAM_MARGIN_FRAC = 0.5;
const BEAM_PROX_FRAC = 0.2;
const BEAM_PROX_CAP_FRAC = 0.35;
const BEAM_OVERFLOW_CAP = 4;     // near-miss safety valve size
const BEAM_PLIES = 2;
const BEAM_EDGE_GROUPS = [["imports"], ["calls", "callsSymbol"], ["inherits"], ["cochange"]];

// ---- spiral expansion (opt-in, default off): a deterministic bounded-radius ego
// walk from the lexical seeds, ordered fewest-arcs-first with a degree-quantile hub
// gate. Unlike beamExpand it may introduce modules with no lexical match at all. ----
const SPIRAL_DEPTH_DEFAULT = 3;
const SPIRAL_NODE_LIMIT_DEFAULT = 12;
const SPIRAL_Q_DEFAULT = 0.9; // keep only the least-connected 90% at each step
const SPIRAL_EXPAND_KINDS = ["imports", "calls", "callsSymbol", "inherits"]; // cochange dropped
const SPIRAL_EMIT_FRAC = 0.5;
const SPIRAL_HOP_DECAY = 0.6;
const SPIRAL_PROX_FRAC = 0.2;
const SPIRAL_PROX_CAP_FRAC = 0.35;

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

/** Undirected adjacency (Map<id, Set<id>>) over any edge in `kinds`. Endpoints
 *  are folded to their containing module by default; `idNormalizer` lets a
 *  caller (e.g. the memory graph, which has no "module" concept) walk raw ids instead. */
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

/** Beam-search-style multi-ply expansion (see BEAM_* constants above). Mutates
 *  `s.score` in place on boosted `scored` entries. */
function beamExpand(graph, scored, beamWidth) {
  if (scored.length < 2) return;
  const byId = new Map(scored.map((s) => [s.ind.id, s]));
  const baseScore = new Map(scored.map((s) => [s.ind.id, s.score]));

  // Margin+cap prune a candidate-score Map down to this ply's beam, returning [survivors, overflow]
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

  // Ply 0 beam = the current top-scoring already-matched modules
  let [beam, overflow] = pruneToBeam(new Map(scored.map((s) => [s.ind.id, s.score])));
  const boosted = new Set(beam.map(([id]) => id));

  for (let ply = 0; ply < BEAM_PLIES && beam.length; ply++) {
    // per-edge-kind successor generation, scored/pruned independently, then merged
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
    for (const [id, propagated] of merged) {
      if (boosted.has(id)) continue;
      const s = byId.get(id);
      if (!s) continue;
      s.score += Math.min(propagated * BEAM_PROX_FRAC, s.score * BEAM_PROX_CAP_FRAC);
      boosted.add(id);
    }
    beam = [...merged.entries()];
    // if this ply's beam ran dry, reconsider the near-miss overflow instead of stopping
    if (!beam.length && overflow.length) {
      beam = overflow.splice(0, BEAM_OVERFLOW_CAP).filter(([id]) => !boosted.has(id));
    }
  }
}

/** Deterministic bounded-radius ego walk from the lexical seeds (`scored`, or
 *  an explicit `seeds` override), popped fewest-arcs-first with a degree-
 *  quantile hub gate. Unlike beamExpand, it may push modules with no lexical
 *  match into `scored`. `kinds`/`classPredicate`/`idNormalizer` let a
 *  memory-graph caller reuse the same walk over its own individuals/edges;
 *  `hubDegree` (default Infinity) caps a node's own fan-out so a hypernym hub
 *  can't swallow the whole emit budget, but never blocks a walk started
 *  directly on that hub. Returns `[{id, hop}]` for every popped node. */
export function spiralExpand(graph, scored = [], {
  depth = SPIRAL_DEPTH_DEFAULT,
  q = SPIRAL_Q_DEFAULT,
  nodeLimit = SPIRAL_NODE_LIMIT_DEFAULT,
  kinds = SPIRAL_EXPAND_KINDS,
  classPredicate = (ind) => (ind.class || "") === "Module",
  idNormalizer = null,
  seeds: seedsOpt = null,
  hubDegree = Infinity,
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
    // exempts hop 0: seeding directly on a hub term must still show its own
    // immediate neighbourhood, or --term/click-to-recentre is pointless on exactly
    // the popular terms it exists for
    if (node.hop > 0 && degree(node.id) > hubDegree) continue;
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

/** Shared module-ranking core behind renderSearch and searchModulesRanked.
 *  IDF-weights each query token, scores path/symbol/exact-symbol matches, and
 *  re-ranks with a bounded import-proximity bonus. Pure; deterministic. */
function scoreModules(graph, tokens, opts = {}) {
  const { demoteNonProd = false, callAdjacency = false, implOfInterface = false, beamSearch = false, spiral = false, proseBoost = false, proseLayers = false, literalMention = false, rawQuery = "" } = opts;
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
    const dotted = literalMention
      ? String((ind.attributes || []).find((a) => a.key === "dotted")?.value || "").toLowerCase()
      : "";
    modules.push({ ind, label, labelLc, defines, symSet, symComps, dotted });
  }
  const N = modules.length || 1;
  // idf = log(1 + N/(1+df)): near-zero for ubiquitous tokens, large for rare ones.
  // Memoized so the literalMention pass below can price candidate tokens the query
  // tokenizer never produced without recomputing document frequency for the rest.
  const idf = new Map();
  const documentFrequencyOf = (t) => {
    let df = 0;
    for (const m of modules) if (m.labelLc.includes(t) || m.symComps.has(t) || m.symSet.has(t)) df++;
    return df;
  };
  const idfOf = (t) => {
    if (!idf.has(t)) idf.set(t, idfWeight(N, documentFrequencyOf(t)));
    return idf.get(t);
  };
  for (const t of tokens) idfOf(t);
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
    if (demoteNonProd && (isTestPath(m.labelLc) || isNonProdLabel(m.labelLc))) score *= NONPROD_DEMOTE;
    else if (isTestPath(m.labelLc)) score *= 0.4; // source first; tests still discoverable
    const matching = m.defines.filter((d) => { const dl = d.toLowerCase(); const cs = identComponents(d); return tokens.some((t) => dl === t || cs.has(t)); });
    const density = m.defines.length ? matchCount / m.defines.length : 0;
    scored.push({ ind: m.ind, score, defineCount: m.defines.length, matching, density });
  }
  // literalMention: runs before the proximity families so a mentioned module donates adjacency too
  if (literalMention && rawQuery && scored.length) {
    const rawLc = String(rawQuery).toLowerCase();
    const continues = (ch) => ch != null && /[a-z0-9_./]/.test(ch);
    const mentioned = (cand) => {
      for (let i = rawLc.indexOf(cand); i !== -1; i = rawLc.indexOf(cand, i + 1)) {
        if (!continues(rawLc[i - 1]) && !continues(rawLc[i + cand.length])) return true;
      }
      return false;
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
        if (cand.split(/[./]+/).filter(Boolean).length < LIT_MIN_COMPONENTS) continue;
        if (!mentioned(cand)) continue;
        const weights = [...new Set(cand.split(/[^a-z0-9_]+/).filter(Boolean))].map(idfOf).sort((a, b) => b - a);
        let w = 0;
        for (let i = 0; i < Math.min(weights.length, LIT_COMP_CAP); i++) w += weights[i] * LIT_W;
        litWeight = Math.max(litWeight, w);
      }
      if (litWeight) s.score += Math.min(litWeight * LIT_FRAC, maxBase * LIT_CAP_FRAC);
    }
  }
  // import-graph proximity: a matched module importing/imported-by a stronger match rises with it
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
  // callAdjacency: same formula as import-proximity, over resolved call edges (folded to modules)
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
  // implOfInterface: a C# module implementing an interface rises with the interface's own match
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
  // proseBoost: absolute per-module prose-token overlap, so it applies with only one match too
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
  // proseLayers: a token that only matches via a normalised layer adds discounted, additive
  // evidence — never double-counted against a token the base score already saw
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
        if (!scoredById.has(modId)) continue; // never a new zero-match candidate
        const m = modById.get(modId);
        if (m && (m.symSet.has(t) || m.symComps.has(t) || m.labelLc.includes(t))) continue; // already matched lexically
        layerSignal.set(modId, (layerSignal.get(modId) || 0) + w * PROSE_LAYER_DISCOUNT);
      }
    }
    for (const s of scored) {
      const signal = layerSignal.get(s.ind.id) || 0;
      if (!signal) continue;
      s.score += Math.min(signal * PROSE_LAYER_FRAC, s.score * PROSE_LAYER_CAP_FRAC);
    }
  }
  // beamSearch (opt-in): multi-ply generalization of the single-hop families above.
  if (beamSearch && scored.length > 1) beamExpand(graph, scored, beamWidth);
  // SPIRAL (opt-in): bounded-radius ego walk that may introduce lexically-invisible modules — runs
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

/** The ranked module list as plain `{path, score}` (highest-first), using the same
 *  ranking renderSearch uses (path + symbol + exact-symbol + import-proximity). Lets the rig
 *  read the score gap between rank-1 and rank-2 (which the text renderer hides) so it can keep
 *  rank-2 only when it is close. Pure; deterministic.
 *  Note: scoreModules still ranks (locate always returns modules), but the score-gap top-1
 *  selection that consumes this gap is off by default in run.mjs/selectModules — it over-injected
 *  on some tasks. The shipped default takes the top-2 instead. */
export function searchModulesRanked(graph, query, opts = {}) {
  const raw = String(query || "");
  const tokens = raw.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  if (!tokens.length) return [];
  // literalMention needs the query BEFORE tokenization (the tokenizer destroys the dotted refs
  // it matches on); threaded only when a flag that consumes it is on, so the OFF path is
  // provably unchanged.
  const effOpts = opts.literalMention ? { ...opts, rawQuery: raw } : opts;
  return scoreModules(graph, tokens, effOpts).map((s) => ({ path: String(s.ind.label), score: s.score }));
}

// 0.6 is the exact ratio tested throughout — do not drift it from bench/arms.mjs's arm values
// or scripts/rank-gate.mjs's --gap default; all three should read this constant.
export const DEFAULT_SCORE_GAP = 0.6;

/** Take the top_k ranked hits, then extend to ranks (top_k)..2 whose score
 *  sits within `scoreGapK` of rank 1 — the near-tie case where another module
 *  is genuinely as relevant as the top hit. `scoreGapK` defaults to null
 *  (off): the shipped `DEFAULT_SCORE_GAP` is a caller-applied policy, not a
 *  library default, so bench arms stay byte-identical when the flag is off. */
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

// ---- the `name` filter: caller text compiled to a regex, under a work bound ----

/* A backtracking engine can be made to run for minutes on one short label, and
   `name` arrives from a tool call, so the pattern is compiled under bounds
   rather than trusted. Two independent shapes cost real time, and measurement
   is the only way to tell them apart:

     (a+)+$        vs 30 characters   — over 30s   (a quantified group backtracks
                                                    exponentially in label length)
     a*a*a*a*a*$   vs 128 characters  — 101s       (no group at all; every extra
                                                    quantifier raises the degree
                                                    of a polynomial in the same
                                                    length)

   So the pattern gate refuses a quantified group and a back-reference, which is
   what exponential backtracking needs, and caps the quantifier count, which
   bounds the polynomial's degree. Capping the tested label length bounds its
   base. The budget then backstops the pair: a static gate is exactly the kind of
   thing that can miss a case, and the budget bounds the damage when it does. */
const NAME_PATTERN_MAX_LENGTH = 128;
const NAME_PATTERN_MAX_QUANTIFIERS = 4;
const NAME_MATCH_MAX_LABEL = 64;      // the longest label measured across real graphs is 27
const NAME_MATCH_BUDGET_MS = 250;

class NameFilterBudgetExceeded extends Error {}

/** Classifies the backtracking hazards in `pattern`: how many quantifiers it
 *  applies, whether any of them quantifies a group, and whether it back-refers.
 *  Escapes and character-class interiors are inert, `(?` opens a group rather
 *  than quantifying, and a `?` right after a quantifier only marks it lazy.
 *  @returns {{quantifiers: number, quantifiedGroup: boolean, backreference: boolean}} */
export function scanNamePattern(pattern) {
  let quantifiers = 0;
  let quantifiedGroup = false;
  let backreference = false;
  let inClass = false;
  let prev = "";
  let prevWasQuantifier = false;
  const countQuantifier = () => {
    quantifiers += 1;
    if (prev === ")") quantifiedGroup = true;
    prevWasQuantifier = true;
  };
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[i + 1] || "";
      if (!inClass && next >= "1" && next <= "9") backreference = true;
      i += 1;
      prev = "";
      prevWasQuantifier = false;
      continue;
    }
    if (inClass) {
      if (ch === "]") { inClass = false; prev = "]"; prevWasQuantifier = false; }
      continue;
    }
    if (ch === "[") { inClass = true; prev = "["; prevWasQuantifier = false; continue; }
    if (ch === "?" && (prev === "(" || prevWasQuantifier)) { prev = "?"; prevWasQuantifier = false; continue; }
    if (ch === "*" || ch === "+" || ch === "?") { countQuantifier(); prev = ch; continue; }
    if (ch === "{") {
      const close = pattern.indexOf("}", i);
      const body = close === -1 ? "" : pattern.slice(i + 1, close);
      if (close !== -1 && /^\d+(,\d*)?$/.test(body)) { countQuantifier(); i = close; prev = "}"; continue; }
      prev = "{";
      prevWasQuantifier = false;
      continue;
    }
    prev = ch;
    prevWasQuantifier = false;
  }
  return { quantifiers, quantifiedGroup, backreference };
}

/** Compiles the `name` filter into a label matcher whose total work is bounded.
 *  `now` is injectable so a test can drive the budget without waiting on it.
 *  @returns {{test: (label: string) => boolean}|{error: string}} */
export function compileNameFilter(name, { now = Date.now } = {}) {
  const pattern = String(name);
  if (pattern.length > NAME_PATTERN_MAX_LENGTH) {
    return { error: `name pattern is ${pattern.length} characters; the limit is ${NAME_PATTERN_MAX_LENGTH}.` };
  }
  const { quantifiers, quantifiedGroup, backreference } = scanNamePattern(pattern);
  if (quantifiedGroup) {
    return { error: `name pattern "${pattern}" quantifies a group, which can backtrack for minutes on one label. Quantify a character or a class instead.` };
  }
  if (backreference) {
    return { error: `name pattern "${pattern}" uses a back-reference, which can backtrack for minutes on one label.` };
  }
  if (quantifiers > NAME_PATTERN_MAX_QUANTIFIERS) {
    return { error: `name pattern "${pattern}" has ${quantifiers} quantifiers; the limit is ${NAME_PATTERN_MAX_QUANTIFIERS}.` };
  }
  let re;
  try { re = new RegExp(pattern, "i"); } catch { return { error: `invalid name pattern: ${pattern}` }; }
  let deadline = null;
  return {
    test(label) {
      if (deadline === null) deadline = now() + NAME_MATCH_BUDGET_MS;
      else if (now() > deadline) {
        throw new NameFilterBudgetExceeded(`name pattern "${pattern}" exceeded its ${NAME_MATCH_BUDGET_MS}ms matching budget.`);
      }
      return re.test(String(label).slice(0, NAME_MATCH_MAX_LABEL));
    },
  };
}

export function renderSearch(graph, query, { limit = SEARCH_LIMIT, kind = "", decorator = "", name = "" } = {}) {
  const tokens = String(query || "").toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  const wantKind = String(kind || "").trim().toLowerCase();
  const decFilter = String(decorator || "").trim().toLowerCase();
  let nameRe = null;
  if (name) {
    const compiled = compileNameFilter(name);
    if (compiled.error) return compiled.error;
    nameRe = compiled;
  }
  // kind= switches to symbol search (functions/classes/methods/attributes); the
  // default (no kind) keeps the module "where does this live" search unchanged.
  if (wantKind && wantKind !== "module") {
    try {
      return searchSymbols(graph, tokens, { limit, kind: wantKind, decFilter, nameRe });
    } catch (e) {
      if (e instanceof NameFilterBudgetExceeded) return e.message;
      throw e;
    }
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

// ---- read-replacing tools (members / inheritance / architecture / coverage /
//      history / call neighbours). Each answers ONE question in one compact call so
//      the agent need not Read/Grep. All keep the bounded-output discipline. -------

// Per-graph, per-kind memo: a loaded graph's `relations` are never mutated in
// place (a refresh builds a new graph object), so caching on graph identity
// is correctness-safe and collapses repeated O(relations) scans to O(1).
const edgesOfKindCache = new WeakMap();

/** All edges of a classified relation kind, flattened across every raw
 *  relation group that classifies to it. Memoized per (graph, kind). */
export function edgesOfKind(graph, kind) {
  let byKind = edgesOfKindCache.get(graph);
  if (!byKind) { byKind = new Map(); edgesOfKindCache.set(graph, byKind); }
  const cached = byKind.get(kind);
  if (cached) return cached;
  const out = [];
  // plain-loop append, not spread: argument spread overflows the stack past ~100k edges
  for (const g of graph.relations) {
    if (relationKind(g) !== kind) continue;
    for (const e of g.edges) out.push(e);
  }
  byKind.set(kind, out);
  return out;
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
  const lines = [`${ind.label} — ${classHeading(ind.class)} (id: ${ind.id})`];
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
  const lines = [`${ind.label} — ${classHeading(ind.class)}${spanTag(site)}`];
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
 *  replaces grepping `class X(Base)` across the tree. Uses `inherits` (seon:hasSuperType). */
export function renderSubclasses(graph, ind) {
  const inherits = edgesOfKind(graph, "inherits");
  const bases = inherits.filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object);
  const childrenOf = new Map();
  for (const e of inherits) {
    if (!childrenOf.has(e.object)) childrenOf.set(e.object, []);
    childrenOf.get(e.object).push({ id: e.subject, label: e.subjectLabel || e.subject });
  }
  const lines = [`${ind.label} — ${classHeading(ind.class)} (id: ${ind.id})`];
  lines.push(bases.length ? `extends: ${capJoin(bases, SUBCLASS_CAP)}` : "extends: (no internal/recorded base classes)");
  const levels = [];
  for (const level of bfsLevels(ind.id, (id) => childrenOf.get(id) || [], { maxDepth: 8, keyOf: (c) => c.id })) {
    if (!level.length) continue;
    levels.push(level.map((c) => c.label).sort((a, b) => String(a).localeCompare(String(b))));
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
const TESTS_GRAIN_NOTE = "tests edges are recorded module to module, so this is module-grain coverage.";

/** The test modules covering a symbol/module — from the `tests` (mgx:testsCoverage)
 *  relation. Replaces grepping `tests/` for who imports the target.
 *
 *  `tests` edges run module to module, so a FUNCTION has no coverage of its
 *  own to report and the answer is its defining module's. Asked about a
 *  function, say both: which module the question hopped to, and that the
 *  coverage is module-grain. Without that the answer names a module the user
 *  never mentioned and silently passes off module coverage as the function's.
 *  The grain note sits outside the indented list on purpose — indented, it
 *  reads as one more test module. */
export function renderTestsFor(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return `cannot map ${ind.label} to a module.`;
  // A symbol's module id is derived from its own recorded site, so it can name
  // a module the index doesn't carry an individual for. The site's path is
  // then the only honest spelling of it — never the raw id.
  const modLabel = graph.byId.get(modId)?.label || siteOf(ind)?.path || modId;
  const tests = [...new Set(edgesOfKind(graph, "tests").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))];
  const covered = tests.length > 0;
  const verdict = covered
    ? `covered by ${tests.length} test module(s):\n  ${capJoin(tests, COVERAGE_CAP, "\n  ")}`
    : "no covering tests recorded (no test module imports it).";
  if (modId === ind.id) return `${modLabel}: ${verdict}`;
  return `${ind.label} is defined in ${modLabel}, which ${covered ? "is" : "has"} ${verdict}\n${TESTS_GRAIN_NOTE}`;
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
        !isTestPath(String(i.label).toLowerCase()) &&
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
// classes whose call graph lives on the fn/method-precise callsSymbol edge, not module-coarse calls
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
    return `${ind.label} — ${classHeading(ind.class)}: no in-repo calls recorded (calls only stdlib/external, or fine-grained call edges are not in the extracted graph).`;
  }
  const items = calls.map((e) => calleeRef(graph, e));
  return `${ind.label} — ${classHeading(ind.class)} calls ${calls.length} in-repo symbol(s):\n  ${capJoin(items, CALL_CAP, "\n  ")}`;
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
    return `${ind.label} — ${classHeading(ind.class)}: no symbol-level commit history recorded (outside the git-log window, or fine-grained history is not in the extracted graph).`;
  }
  const shown = commits.slice(0, HISTORY_CAP).map((e) => `  ${commitLine(graph, e.subject, e.subjectLabel)}`);
  const tail = commits.length > HISTORY_CAP ? `\n  …+${commits.length - HISTORY_CAP} more` : "";
  return `${ind.label} — ${classHeading(ind.class)}: touched by ${commits.length} commit(s):\n${shown.join("\n")}${tail}`;
}

/** Method history — commits touching a specific method symbol (`touchesSymbol`). */
export function renderMethodHistory(graph, ind) {
  return renderSymbolHistory(graph, ind);
}

/** Class history — commits touching a specific class symbol (`touchesSymbol`). */
export function renderClassHistory(graph, ind) {
  return renderSymbolHistory(graph, ind);
}

// ---- author identity: the Commit "author" attribute answered as a person
// ("who is <Name>", "what did <Name> touch"). Author is an attribute, never
// an individual, so these renderers read it off every Commit and aggregate.
// All return null on an unknown name; the chat lane falls through to an honest miss. ----

const AUTHOR_TOUCH_CAP = 15;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Map of lowercased author name → that author's Commit individuals (payload order).
 *  Tolerates both attribute-key conventions (author / commitAuthor), like commitLine. */
function authorIndex(graph) {
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

/** The structured scorer behind searchSymbols: filters to `kind`'s class,
 *  scores by token substring hits, sorts score desc then shorter label first.
 *  An unrecognised `kind` yields an empty ranked list.
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

// ---- tmct_context: a one-shot "edit bundle" plan (pure; the server adds the
// file reads). Returns everything needed to add a sibling to a module in one
// call, so the agent need not search->describe->snippet->read x N. ----

const CONTEXT_SIBLING_CAP = 8; // the bundle is re-billed every turn — keep a few most-relevant siblings, not all
const CLASS_MEMBER_CAP = 16;   // class-internal members shown when the anchor is a class/method
const COCHANGE_MID_CAP = 4;
const CONTEXT_TESTS_CAP = 6;
const INSERTION_REGION_CAP = 40; // contiguous tail lines shown as the "write your new sibling here" region
// task-size thresholds, widened so a common "add a small sibling util" task
// lands at the lean TINY default and only genuinely bigger edits top up
const TINY_MAX_LOC = 12;
const TINY_MAX_ARITY = 2;
const LARGE_CLASS_MEMBERS = 8;
const INLINE_CALLEE_CAP = 3;
const INLINE_CALLEE_LOC = 120;

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

/** Rank siblings by relevance to the anchor: shared decorator (the module's
 *  registration pattern) > name-affinity (shared tokens) > nearest source
 *  position. Mutates a transient `_score` only. */
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
    const struct = structuralScore(s, structuralTarget); // tiebreaker within a name tier
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
  // index fn→fn in-repo callees once, so siblings/anchor carry their callee set
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
      // raises + one-line doc so a validator-style task sees the error-contract
      // without reading the body; params/returns/callees feed structural-similarity ranking
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
  // the structural target the exemplar should resemble: the anchor's own
  // shape, or the dominant pattern across siblings for a module anchor
  const structuralTarget = anchor ? profileOf(anchor) : dominantProfile(siblings);
  siblings = rankSiblings(siblings, anchor || { label: ind.label }, structuralTarget);
  // when the anchor is a module, surface the closest sibling's full body as
  // the copy-this exemplar — signatures alone made the agent fall back to Read
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
  // contiguous insertion region from the last top-level definition through
  // end-of-module; the server extends `end` to the real end-of-file
  let lastTop = null;
  for (const s of [...siblings, ...globals]) {
    if (s.site && (!lastTop || s.site.start > lastTop.start)) lastTop = s.site;
  }
  const insertionRegion = lastTop ? { start: lastTop.start, end: lastTop.end } : null;
  // the focal symbol (anchor, else the module's exemplar) drives the call
  // hint and the LARGE-tier inlined-callee bodies
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

// ---- task-size-adaptive bundle (TINY / MID / LARGE) ------------------------------

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

/** A trimmed mask for secondary (related-but-not-primary) digest modules: keep
 *  the cheap, cache-stable signal but drop expensive bodies and variable tails. */
export function trimBundleMask(mask) {
  return {
    ...mask,
    anchor: false, exemplar: false, inlinedCallees: false,
    classMembers: false, reexports: false, tests: false, cochange: false,
    registration: true, siblings: true, insertionRegion: true, allExports: true,
  };
}

/** Classify a context plan by task size, {tier, mask, topup}. Lean by default:
 *  start at TINY and escalate one tier only when the lean bundle would omit
 *  something the edit demonstrably needs. `topup` records whether auto-sizing
 *  escalated above TINY. */
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
    // `untuned` is a no-op for sizing now (kept so a legacy control-arm flag still resolves)
    if (loc > TINY_MAX_LOC || arity > TINY_MAX_ARITY || Boolean(focal.raises)) tier = "MID";
    // LARGE only for an explicit symbol focus: a cross-module call from the
    // anchor, or an anchor that's a method of a big class. A module-exemplar
    // focal never forces LARGE — MID's signatures suffice and keeps it lean.
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

/** Order secondary digest modules by relevance to the primary module: import
 *  adjacency outranks change-coupling weight; ties keep input order. Falls
 *  back to input order when the primary can't be mapped to a module. */
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

// ---- tmct_context_more: only the sections a TINY/MID bundle omits ---------------

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

/** Render a graph-only edit bundle: every contextPlan section except the
 *  fs-dependent body text, gated by `mask`. Lets a graph-only provider (no
 *  working tree) return a real hit instead of a NO_SOURCE miss; a
 *  source-capable provider layers the body sections on top. */
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
