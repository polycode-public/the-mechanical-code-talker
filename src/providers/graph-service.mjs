// The reference Repository-Interface service over a parsed code graph.
// archive/PLAN_REPOSITORY_INTERFACE.md — "the executable specification".
//
// createGraphService(graph) returns a typed service object implementing EVERY
// service in src/repository-interface.mjs over the `{ individuals, byId,
// relations, … }` shape parseEntities() yields. Every method returns a typed
// Result (hit/miss) — a clean miss is a value, never a throw. The two providers
// tmct ships (fixture, bootstrap) are this same builder over a small real graph
// and over the empty bootstrap graph respectively.
//
// This is a GRAPH-ONLY provider: it advertises the source services (snippet,
// context) but answers them with an honest miss(NO_SOURCE) — it exposes no
// working tree. A host with a working tree (seonix, the chat shell) layers source
// access on top. Pure graph queries, no fs, no LLM.

import {
  resolveSymbol,
  siteOf,
  edgesOfKind,
  relationKind,
  impactClosure,
  scoreSymbolsRanked,
  searchModulesRanked,
  SEARCH_LIMIT,
} from "../codegraph.mjs";
import { ask } from "../ask.mjs";
import {
  hit,
  miss,
  toIndividual,
  toEdge,
  MISS_REASONS,
  EDGE_KINDS,
  SERVICES,
  SOURCE_SERVICES,
  INTERFACE_VERSION,
} from "../repository-interface.mjs";

const attrOf = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value ?? null;

/** Group an individual id's incoming/outgoing edges across all relations, projected
 *  to interface Edges. */
function edgesAround(graph, id) {
  const out = [];
  const incoming = [];
  for (const g of graph.relations) {
    for (const e of g.edges) {
      if (e.subject === id) out.push(toEdge(e, { predicate: g.predicate, prop: g.prop }));
      if (e.object === id) incoming.push(toEdge(e, { predicate: g.predicate, prop: g.prop }));
    }
  }
  return { out, incoming };
}

/** The kind-tagged relation group's predicate/prop for a given edge kind (for Edge
 *  projection). Returns the first relation group classifying to `kind`. */
function groupMetaForKind(graph, kind) {
  for (const g of graph.relations) if (relationKind(g) === kind) return { predicate: g.predicate, prop: g.prop };
  return { predicate: kind, prop: null };
}

/**
 * @param {object} graph  a parseEntities() result
 * @param {object} [opts]
 * @param {boolean} [opts.sourceAccess=false]  whether source services can read bodies
 * @returns the typed service object
 */
export function createGraphService(graph, { sourceAccess = false } = {}) {
  const byId = graph.byId;

  const resolveId = (id) => byId.get(id) || null;

  const svc = {
    version: INTERFACE_VERSION,
    /** Advertised services. Source services are listed but honestly answer NO_SOURCE
     *  unless a source-capable provider overrides them. */
    capabilities: [...SERVICES],
    sourceAccess: Boolean(sourceAccess),
    /** The underlying graph — tmct-internal presentation (render*) reads it; not
     *  part of the wire contract. */
    graph,

    resolve(term) {
      const { match, candidates } = resolveSymbol(graph, String(term ?? ""));
      if (!match) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: String(term ?? "") });
      return hit({ match: toIndividual(match), candidates: candidates.map(toIndividual) });
    },

    describe(id) {
      const ind = resolveId(id);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
      const { out, incoming } = edgesAround(graph, id);
      return hit({ individual: toIndividual(ind), out, incoming });
    },

    members(classId) {
      const ind = resolveId(classId);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: classId });
      const contains = edgesOfKind(graph, "contains").filter((e) => e.subject === classId);
      const methods = [];
      const attributes = [];
      for (const e of contains) {
        const m = byId.get(e.object);
        const proj = m ? toIndividual(m) : { id: e.object, label: e.objectLabel || e.object, class: "Entity", attributes: [] };
        if ((m?.class || "") === "Attribute") attributes.push(proj);
        else methods.push(proj);
      }
      return hit({ methods, attributes });
    },

    subclasses(classId) {
      const ind = resolveId(classId);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: classId });
      const inherits = edgesOfKind(graph, "inherits");
      const bases = inherits
        .filter((e) => e.subject === classId)
        .map((e) => byId.get(e.object) ? toIndividual(byId.get(e.object)) : { id: e.object, label: e.objectLabel || e.object, class: "Class", attributes: [] });
      // transitive reverse inheritance closure (who extends this)
      const childrenOf = new Map();
      for (const e of inherits) {
        if (!childrenOf.has(e.object)) childrenOf.set(e.object, []);
        childrenOf.get(e.object).push(e.subject);
      }
      const seen = new Set([classId]);
      const subs = [];
      let frontier = [classId];
      for (let d = 0; d < 8 && frontier.length; d += 1) {
        const next = [];
        for (const cur of frontier) {
          for (const childId of childrenOf.get(cur) || []) {
            if (seen.has(childId)) continue;
            seen.add(childId);
            const c = byId.get(childId);
            subs.push(c ? toIndividual(c) : { id: childId, label: childId, class: "Class", attributes: [] });
            next.push(childId);
          }
        }
        frontier = next;
      }
      return hit({ bases, subclasses: subs });
    },

    exports(moduleId) {
      const ind = resolveId(moduleId);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: moduleId });
      const edges = edgesOfKind(graph, "reexports").filter((e) => e.subject === moduleId);
      const exports = edges.map((e) =>
        byId.get(e.object) ? toIndividual(byId.get(e.object)) : { id: e.object, label: e.objectLabel || e.object, class: "Entity", attributes: [] });
      return hit({ exports });
    },

    signature(id) {
      const ind = resolveId(id);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
      const flags = [];
      for (const [attr, name] of [["isStatic", "static"], ["isAbstract", "abstract"], ["isConstant", "constant"]]) {
        if (attrOf(ind, attr)) flags.push(name);
      }
      const vis = attrOf(ind, "visibility");
      if (vis) flags.push(vis);
      return hit({
        id: ind.id,
        label: ind.label,
        class: ind.class || "Entity",
        params: attrOf(ind, "params"),
        returns: attrOf(ind, "returns"),
        raises: attrOf(ind, "raises"),
        decorators: attrOf(ind, "decorators"),
        doc: attrOf(ind, "doc"),
        selfFields: attrOf(ind, "self_fields"),
        flags,
      });
    },

    edges(id, kind, { limit, offset = 0 } = {}) {
      if (!EDGE_KINDS.includes(kind)) {
        throw new TypeError(`edges(): unknown kind "${kind}" (not in EDGE_KINDS)`);
      }
      const ind = resolveId(id);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
      const meta = groupMetaForKind(graph, kind);
      // edge order is stable/memoized (edgesOfKind's own docblock in codegraph.mjs) — a plain
      // slice after filter/map is a safe, backward-compatible pagination: an omitted `limit`
      // leaves the full list untouched (limit=undefined → slice(offset) → everything from offset).
      let edges = edgesOfKind(graph, kind)
        .filter((e) => e.subject === id)
        .map((e) => toEdge(e, meta));
      edges = limit == null ? edges.slice(offset) : edges.slice(offset, offset + limit);
      return hit({ kind, edges });
    },

    impact(moduleId, { maxDepth } = {}) {
      const ind = resolveId(moduleId);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: moduleId });
      const levels = maxDepth == null ? impactClosure(graph, ind) : impactClosure(graph, ind, { maxDepth });
      const total = levels.reduce((n, l) => n + l.length, 0);
      return hit({ total, levels });
    },

    snippet(id) {
      const ind = resolveId(id);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
      const site = siteOf(ind);
      if (!svc.sourceAccess) {
        return miss(MISS_REASONS.NO_SOURCE, {
          term: id,
          detail: site ? `span is ${site.path}:${site.start}-${site.end}; this provider exposes no working tree` : "no source span in the graph",
        });
      }
      if (!site) return miss(MISS_REASONS.NO_SOURCE, { term: id, detail: "no source span in the graph (likely a module)" });
      // A source-capable subclass overrides snippet to read the body; the graph-only
      // base returns the span with a null body.
      return hit({ path: site.path, span: { start: site.start, end: site.end }, body: null });
    },

    context(symbol) {
      const { match } = resolveSymbol(graph, String(symbol ?? ""));
      if (!match) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: String(symbol ?? "") });
      return miss(MISS_REASONS.NO_SOURCE, {
        term: String(symbol ?? ""),
        detail: "the edit bundle reaches into the working tree; this provider exposes no source",
      });
    },

    architecture({ package: pkg = "" } = {}) {
      const norm = String(pkg || "").trim().toLowerCase().replace(/^\.?\//, "");
      const modules = graph.individuals.filter(
        (i) => (i.class || "") === "Module" && (!norm || String(i.label || "").toLowerCase().startsWith(norm)),
      );
      const pkgCount = new Map();
      for (const m of modules) {
        const dir = m.label.includes("/") ? m.label.slice(0, m.label.lastIndexOf("/")) : "(root)";
        pkgCount.set(dir, (pkgCount.get(dir) || 0) + 1);
      }
      const modSet = new Set(modules.map((m) => m.id));
      const inDeg = new Map();
      for (const e of edgesOfKind(graph, "imports")) {
        if (modSet.has(e.object)) inDeg.set(e.object, (inDeg.get(e.object) || 0) + 1);
      }
      const hubs = [...inDeg.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({ id, label: byId.get(id)?.label || id, importers: n }));
      const packages = [...pkgCount.entries()].sort((a, b) => b[1] - a[1]);
      return hit({ modules: modules.length, packages, hubs });
    },

    untested() {
      const covered = new Set(edgesOfKind(graph, "tests").map((e) => e.object));
      const modules = graph.individuals
        .filter((i) => (i.class || "") === "Module" && !covered.has(i.id) && !/\.test\./.test(i.label || ""))
        .map(toIndividual);
      return hit({ modules });
    },

    stats() {
      const counts = new Map();
      for (const i of graph.individuals) {
        const c = i.class || "Entity";
        counts.set(c, (counts.get(c) || 0) + 1);
      }
      const classes = [...counts.entries()]
        .map(([cls, count]) => ({ class: cls, count }))
        .sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));
      return hit({ total: graph.individuals.length, classes, truncated: (graph.truncated || []).length > 0 });
    },

    history(id) {
      const ind = resolveId(id);
      if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
      const touchEdges = [
        ...edgesOfKind(graph, "touches"),
        ...edgesOfKind(graph, "touchesSymbol"),
      ].filter((e) => e.object === id);
      const seen = new Set();
      const commits = [];
      for (const e of touchEdges) {
        if (seen.has(e.subject)) continue;
        seen.add(e.subject);
        const c = byId.get(e.subject);
        commits.push({
          id: e.subject,
          label: e.subjectLabel || c?.label || e.subject,
          author: c ? attrOf(c, "author") ?? attrOf(c, "commitAuthor") : null,
          date: c ? attrOf(c, "date") ?? attrOf(c, "commitDate") : null,
          message: c ? attrOf(c, "message") ?? attrOf(c, "commitMessage") : null,
        });
      }
      return hit({ commits });
    },

    // Ranked lexical search, mirroring codegraph.mjs's renderSearch/searchSymbols semantics
    // instead of the old flat substring filter: module-mode (no kind, or kind="module") ranks
    // via searchModulesRanked/scoreModules (path + defined-symbol + import-proximity scoring),
    // symbol-mode (kind names a symbol kind) ranks via scoreSymbolsRanked. name/decorator
    // filters apply in SYMBOL mode only — module mode never supported them in codegraph.mjs
    // either (renderSearch's module branch ignores both beyond the "was anything specified"
    // check), so this does not invent a new filter semantic. Results are capped at
    // `limit` (default SEARCH_LIMIT), sliced after the full ranked array is computed.
    search(query, { kind = "", name = "", decorator = "", limit = SEARCH_LIMIT, offset = 0 } = {}) {
      const rawQuery = String(query || "");
      const k = String(kind || "").trim().toLowerCase();
      const nm = String(name || "").trim();
      const dec = String(decorator || "").trim().toLowerCase();
      let nameRe = null;
      if (nm) {
        try { nameRe = new RegExp(nm, "i"); } catch { nameRe = null; }
      }
      let rankedInds; // Individual[], highest-ranked first
      if (k && k !== "module") {
        const tokens = rawQuery.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
        rankedInds = scoreSymbolsRanked(graph, tokens, { kind: k, decFilter: dec, nameRe }).map((s) => s.ind);
      } else {
        // label→individual, scoped to this call (no persistent cache) — maps searchModulesRanked's
        // `path` labels (a copy of the label, not the live individual) back to real Individuals.
        const byLabel = new Map();
        for (const i of graph.individuals) if ((i.class || "") === "Module") byLabel.set(i.label, i);
        rankedInds = searchModulesRanked(graph, rawQuery)
          .map(({ path }) => byLabel.get(path))
          .filter(Boolean);
      }
      const results = rankedInds.slice(offset, offset + limit).map(toIndividual);
      return hit({ results });
    },

    ask(query) {
      const { content, tmct_ask } = ask(graph, String(query || ""));
      return hit({ content, tmct_ask });
    },
  };

  return svc;
}

/** The source-reaching services a graph-only provider satisfies with NO_SOURCE. */
export { SOURCE_SERVICES };
