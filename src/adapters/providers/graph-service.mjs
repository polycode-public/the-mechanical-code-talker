// The reference Repository-Interface service over a parsed code graph.
//
// createGraphService(graph) returns a typed service object implementing EVERY
// service in src/adapters/repository-interface.mjs over the `{ individuals, byId,
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
  contextPlan,
  sizeBundle,
  bundleMask,
  renderGraphOnlyBundle,
} from "../../domain/codegraph.mjs";
import { readSpanSafe, sliceSpan } from "../source-slice.mjs";
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

const CONTEXT_BODY_MAX_LINES = 200; // mirrors server.mjs's SNIPPET_MAX_LINES for the source-capable body sections
const CONTEXT_INLINE_CALLEE_LOC = 120; // mirrors server.mjs's INLINE_CALLEE_LOC budget

/** The fs-dependent half of context()'s bundle — anchor/exemplar/inlined-callee body TEXT —
 *  layered on top of renderGraphOnlyBundle's pure sections when source-capable. Read
 *  failures degrade silently (an omitted section, never a throw). Returns "" when nothing
 *  could be rendered. */
async function renderSourceBodies(plan, mask, { readFile, repoRoot }) {
  if (!plan.moduleLabel) return "";
  let lines = null;
  try {
    ({ lines } = await readSpanSafe({ readFile, repoRoot, path: plan.moduleLabel }));
  } catch {
    lines = null;
  }
  if (!lines) return "";
  const out = [];
  if (mask.anchor && plan.anchor?.site) {
    const { start, end } = plan.anchor.site;
    out.push(`\n## anchor: ${plan.anchor.label} (${plan.anchor.class}) @ ${plan.moduleLabel}:${start}-${end}`);
    out.push(sliceSpan(lines, start, end, CONTEXT_BODY_MAX_LINES).text);
    if (plan.callHint) out.push(plan.callHint);
  }
  if (mask.exemplar && plan.exemplar?.site) {
    const { start, end } = plan.exemplar.site;
    const dec = plan.exemplar.decorators ? ` @${plan.exemplar.decorators}` : "";
    out.push(`\n## closest example (full body) — copy this style: ${plan.exemplar.label} (${plan.exemplar.class})${dec} @ ${plan.moduleLabel}:${start}-${end}`);
    out.push(sliceSpan(lines, start, end, CONTEXT_BODY_MAX_LINES).text);
    if (plan.callHint) out.push(plan.callHint);
  }
  if (mask.inlinedCallees && plan.calleeBodies.length) {
    let budget = CONTEXT_INLINE_CALLEE_LOC;
    for (const cb of plan.calleeBodies) {
      if (budget <= 0) break;
      const start = cb.site.start;
      const fromThisFile = cb.site.path === plan.moduleLabel;
      let bodyLines = fromThisFile ? lines : null;
      if (!bodyLines) {
        try { ({ lines: bodyLines } = await readSpanSafe({ readFile, repoRoot, path: cb.site.path })); }
        catch { bodyLines = null; }
      }
      if (!bodyLines) continue;
      const sliced = sliceSpan(bodyLines, start, cb.site.end, budget);
      out.push(`\n## inlined callee body (depth-1 in-repo call): ${cb.label} @ ${cb.site.path}:${start}-${cb.site.end}`);
      out.push(sliced.text);
      budget -= (sliced.end - start + 1);
    }
  }
  return out.join("\n");
}

/**
 * @param {object} graph  a parseEntities() result
 * @param {object} [opts]
 * @param {boolean} [opts.sourceAccess=false]  whether source services (snippet, context) read
 *   real fs bodies. When true, `repoRoot` + `readFile` are required (fs is an injected
 *   capability, never an ambient import).
 * @param {string} [opts.repoRoot]  absolute repo root; required when sourceAccess is true.
 * @param {Function} [opts.readFile]  async (path, encoding) => string; required when
 *   sourceAccess is true.
 * @param {object|null} [opts.tel]  an optional telemetry sink ({ record(fields) }). When
 *   present, every service is wrapped once to time it and record counts only, never raw
 *   text/body.
 * @param {Function} [opts.ask]  the natural-language answerer backing the `ask` service
 *   (src/domain/ask.mjs's `ask` in the live wiring) — injected at construction like fs access,
 *   never an ambient import. Constructing without it makes `.ask()` an honest
 *   CAPABILITY_ABSENT miss, the same negotiation snippet/context use for missing
 *   source access.
 * @returns the typed service object
 */
export function createGraphService(graph, { sourceAccess = false, repoRoot = null, readFile = null, tel = null, ask = null } = {}) {
  const byId = graph.byId;
  if (sourceAccess && (!repoRoot || typeof readFile !== "function")) {
    throw new TypeError(
      "createGraphService({ sourceAccess: true }) requires both repoRoot and readFile — " +
        "fs access is an injected capability, not an ambient import.",
    );
  }

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
      // transitive reverse inheritance closure
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
      // edge order is stable/memoized; an omitted `limit` leaves the full list untouched.
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

    // Async (returns Promise<Result>): callers should always await a source-reaching
    // service regardless of whether this provider happens to be source-capable.
    async snippet(id) {
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
      try {
        const sliced = await readSpanSafe({
          readFile, repoRoot, path: site.path, start: site.start, end: site.end, maxLines: CONTEXT_BODY_MAX_LINES,
        });
        return hit({ path: site.path, span: { start: site.start, end: site.end }, body: sliced.text });
      } catch (e) {
        return miss(MISS_REASONS.NO_SOURCE, { term: id, detail: `could not read ${site.path}: ${e?.message || e}` });
      }
    },

    // A graph-only HIT for any resolvable symbol (siblings/registration/globals/tests/
    // exports/insertion-region), everything except anchor/exemplar/inlined-callee body TEXT.
    // A source-capable provider layers the body sections on top via renderSourceBodies.
    async context(symbol, { depth = "auto" } = {}) {
      const { match } = resolveSymbol(graph, String(symbol ?? ""));
      if (!match) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: String(symbol ?? "") });
      const plan = contextPlan(graph, match);
      const d = String(depth || "auto").trim().toLowerCase();
      let tier, mask;
      if (d === "min") { tier = "TINY"; mask = bundleMask("TINY"); }
      else if (d === "full") { tier = "FULL"; mask = bundleMask("FULL"); }
      else ({ tier, mask } = sizeBundle(plan, graph, {}));
      const graphText = renderGraphOnlyBundle(plan, mask);
      if (!svc.sourceAccess) return hit({ text: graphText, tier });
      const bodyText = await renderSourceBodies(plan, mask, { readFile, repoRoot });
      return hit({ text: bodyText ? `${graphText}\n${bodyText}` : graphText, tier });
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

    // Ranked lexical search: module-mode (no kind, or kind="module") ranks via
    // searchModulesRanked; symbol-mode (kind names a symbol kind) ranks via
    // scoreSymbolsRanked, with name/decorator filters. Results capped at `limit`.
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
        // label -> individual, scoped to this call: maps searchModulesRanked's path labels
        // back to real Individuals.
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
      if (typeof ask !== "function") return miss(MISS_REASONS.CAPABILITY_ABSENT, "this provider was constructed without an ask answerer");
      const { content, tmct_ask } = ask(graph, String(query || ""));
      return hit({ content, tmct_ask });
    },
  };

  // Optional telemetry: wrap every RI service once here to time it and record counts only,
  // never raw text/body. `tel` null (the default) skips the wrapping loop entirely.
  if (tel) {
    for (const name of SERVICES) {
      const orig = svc[name];
      if (typeof orig !== "function") continue;
      svc[name] = (...args) => {
        const t0 = performance.now();
        const result = orig.apply(svc, args);
        // snippet/context are async; record after settling but still return a promise.
        if (result && typeof result.then === "function") {
          return result.then((r) => {
            recordTelemetry(tel, name, performance.now() - t0, r);
            return r;
          });
        }
        recordTelemetry(tel, name, performance.now() - t0, result);
        return result;
      };
    }
  }

  return svc;
}

/** tel.record({ tool: `ri.${name}`, perf: { ms_total }, response }) for one wrapped service
 *  call — swallows any error (telemetry must never break the call it's observing). */
function recordTelemetry(tel, name, ms, result) {
  try {
    tel.record({ tool: `ri.${name}`, perf: { ms_total: ms }, response: responseCounts(result) });
  } catch { /* telemetry must never break the caller's turn */ }
}

/** Counts only, never raw text/body: { ok, count } — count sums every array-valued field's
 *  length under result.value. A miss records its reason instead of a count. */
function responseCounts(result) {
  if (!result || typeof result !== "object" || result.ok !== true) {
    return { ok: false, reason: result?.miss?.reason || null };
  }
  let count = 0;
  const value = result.value;
  if (Array.isArray(value)) count = value.length;
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) if (Array.isArray(v)) count += v.length;
  }
  return { ok: true, count };
}

/** The source-reaching services a graph-only provider satisfies with NO_SOURCE. */
export { SOURCE_SERVICES };
