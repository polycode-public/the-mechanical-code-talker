(() => {
  // src/prose.mjs
  var STOPWORDS = new Set(
    "a an and or but the of to in on at for with from by as is are was were be been being it its this that these those i you he she they we me my your our do does did not no yes if then else than so such can will would should could may might about into over under out up down off again more most some any all what which who whom whose when where why how".split(/\s+/)
  );
  var MAX_TOKEN_LEN = 40;
  var MAX_TOKENS_PER_DOC = 120;
  function splitIdentifierWords(raw) {
    if (!raw) return [];
    let s = String(raw).replace(/\.[A-Za-z0-9]+$/, "");
    s = s.replace(/[/\\]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").replace(/[_\-.]+/g, " ");
    return s.split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length > 1 && w.length <= MAX_TOKEN_LEN);
  }
  function tokenizeProse(text) {
    if (!text) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 2 || raw.length > MAX_TOKEN_LEN || STOPWORDS.has(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
      if (out.length >= MAX_TOKENS_PER_DOC) break;
    }
    return out;
  }
  function lookupByProseTokens(proseIndex, query, { limit = 10 } = {}) {
    const queryTokens = [.../* @__PURE__ */ new Set([...splitIdentifierWords(query), ...tokenizeProse(query)])];
    if (!queryTokens.length) return [];
    const scoreById = /* @__PURE__ */ new Map();
    for (const word of queryTokens) {
      for (const id of proseIndex?.[word] || []) {
        scoreById.set(id, (scoreById.get(id) || 0) + 1);
      }
    }
    return [...scoreById.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])).slice(0, limit).map(([id, score]) => ({ id, score }));
  }

  // node-stub:node:fs
  var unavailable = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire = unavailable("createRequire");
  var readFileSync = unavailable("readFileSync");
  var writeFileSync = unavailable("writeFileSync");
  var readFile = unavailable("readFile");
  var writeFile = unavailable("writeFile");
  var appendFile = unavailable("appendFile");
  var mkdir = unavailable("mkdir");
  var mkdtemp = unavailable("mkdtemp");
  var rename = unavailable("rename");
  var unlink = unavailable("unlink");
  var rm = unavailable("rm");
  var stat = unavailable("stat");
  var access = unavailable("access");
  var copyFile = unavailable("copyFile");
  var readdir = unavailable("readdir");
  var createReadStream = unavailable("createReadStream");
  var createWriteStream = unavailable("createWriteStream");
  var randomBytes = unavailable("randomBytes");
  var createHash = unavailable("createHash");
  var createRequireFromPath = unavailable("createRequireFromPath");
  var spawnSync = unavailable("spawnSync");
  var createInterface = unavailable("createInterface");
  var createServer = unavailable("createServer");
  var DatabaseSync = unavailable("DatabaseSync");

  // node-stub:node:path
  var unavailable2 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire2 = unavailable2("createRequire");
  var readFileSync2 = unavailable2("readFileSync");
  var writeFileSync2 = unavailable2("writeFileSync");
  var readFile2 = unavailable2("readFile");
  var writeFile2 = unavailable2("writeFile");
  var appendFile2 = unavailable2("appendFile");
  var mkdir2 = unavailable2("mkdir");
  var mkdtemp2 = unavailable2("mkdtemp");
  var rename2 = unavailable2("rename");
  var unlink2 = unavailable2("unlink");
  var rm2 = unavailable2("rm");
  var stat2 = unavailable2("stat");
  var access2 = unavailable2("access");
  var copyFile2 = unavailable2("copyFile");
  var readdir2 = unavailable2("readdir");
  var createReadStream2 = unavailable2("createReadStream");
  var createWriteStream2 = unavailable2("createWriteStream");
  var join = (...a) => a.join("/");
  var dirname = (p) => String(p).replace(/\/[^/]*$/, "");
  var randomBytes2 = unavailable2("randomBytes");
  var createHash2 = unavailable2("createHash");
  var createRequireFromPath2 = unavailable2("createRequireFromPath");
  var spawnSync2 = unavailable2("spawnSync");
  var createInterface2 = unavailable2("createInterface");
  var createServer2 = unavailable2("createServer");
  var DatabaseSync2 = unavailable2("DatabaseSync");

  // node-stub:node:url
  var unavailable3 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire3 = unavailable3("createRequire");
  var readFileSync3 = unavailable3("readFileSync");
  var writeFileSync3 = unavailable3("writeFileSync");
  var readFile3 = unavailable3("readFile");
  var writeFile3 = unavailable3("writeFile");
  var appendFile3 = unavailable3("appendFile");
  var mkdir3 = unavailable3("mkdir");
  var mkdtemp3 = unavailable3("mkdtemp");
  var rename3 = unavailable3("rename");
  var unlink3 = unavailable3("unlink");
  var rm3 = unavailable3("rm");
  var stat3 = unavailable3("stat");
  var access3 = unavailable3("access");
  var copyFile3 = unavailable3("copyFile");
  var readdir3 = unavailable3("readdir");
  var createReadStream3 = unavailable3("createReadStream");
  var createWriteStream3 = unavailable3("createWriteStream");
  var fileURLToPath = (u) => String(u);
  var randomBytes3 = unavailable3("randomBytes");
  var createHash3 = unavailable3("createHash");
  var createRequireFromPath3 = unavailable3("createRequireFromPath");
  var spawnSync3 = unavailable3("spawnSync");
  var createInterface3 = unavailable3("createInterface");
  var createServer3 = unavailable3("createServer");
  var DatabaseSync3 = unavailable3("DatabaseSync");

  // node-stub:node:fs/promises
  var unavailable4 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire4 = unavailable4("createRequire");
  var readFileSync4 = unavailable4("readFileSync");
  var writeFileSync4 = unavailable4("writeFileSync");
  var readFile4 = unavailable4("readFile");
  var writeFile4 = unavailable4("writeFile");
  var appendFile4 = unavailable4("appendFile");
  var mkdir4 = unavailable4("mkdir");
  var mkdtemp4 = unavailable4("mkdtemp");
  var rename4 = unavailable4("rename");
  var unlink4 = unavailable4("unlink");
  var rm4 = unavailable4("rm");
  var stat4 = unavailable4("stat");
  var access4 = unavailable4("access");
  var copyFile4 = unavailable4("copyFile");
  var readdir4 = unavailable4("readdir");
  var createReadStream4 = unavailable4("createReadStream");
  var createWriteStream4 = unavailable4("createWriteStream");
  var randomBytes4 = unavailable4("randomBytes");
  var createHash4 = unavailable4("createHash");
  var createRequireFromPath4 = unavailable4("createRequireFromPath");
  var spawnSync4 = unavailable4("spawnSync");
  var createInterface4 = unavailable4("createInterface");
  var createServer4 = unavailable4("createServer");
  var DatabaseSync4 = unavailable4("DatabaseSync");

  // src/memory/trust.mjs
  var SOURCE_PRIOR = Object.freeze({
    operator: 1,
    teach: 0.95,
    provider: 0.9,
    corpus: 0.7,
    corpusWeak: 0.55,
    web: 0.4,
    extracted: 0.45,
    entailed: 0.3
  });
  var RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1e3;

  // src/memory/core.mjs
  var MEMORY_DIR_REL = join(".tmct", "memory");
  var MEMORY_GRAPH_REL = join(MEMORY_DIR_REL, "graph.json");
  var CREATED_AT_PROP = "mgx:createdAt";
  var UPDATED_AT_PROP = "mgx:updatedAt";
  var MEMORY_MANIFEST_REL = join(MEMORY_DIR_REL, "manifest.json");
  function parseChatTagRest(rest) {
    const at = rest.indexOf("@");
    const beforeAt = at >= 0 ? rest.slice(0, at) : rest;
    const createdAt = at >= 0 ? rest.slice(at + 1) : "";
    const colon = beforeAt.indexOf(":");
    const sessionId = colon >= 0 ? beforeAt.slice(colon + 1) : "";
    return { createdAt, ...sessionId ? { sessionId } : {} };
  }
  function provenanceTagToSource(tag) {
    const t = String(tag || "").trim();
    if (!t) return null;
    const head = t.split(/\s+/)[0];
    if (head.startsWith("corpus-weak:")) return { kind: "corpusWeak", name: head.slice("corpus-weak:".length) || "unknown" };
    if (head.startsWith("corpus:")) return { kind: "corpus", name: head.slice("corpus:".length) || "unknown" };
    if (head.startsWith("ace:")) return { kind: "operator", ...parseChatTagRest(head.slice("ace:".length)) };
    if (head.startsWith("teach:")) {
      return { kind: "teach", ...parseChatTagRest(head.slice("teach:".length)) };
    }
    if (head.startsWith("web:")) return { kind: "web", url: head.slice("web:".length) };
    if (head.startsWith("url:")) return { kind: "web", url: head.slice("url:".length) };
    if (head.startsWith("extracted:")) return { kind: "extracted", name: head.slice("extracted:".length) || "unknown" };
    if (head.startsWith("entailed:")) return { kind: "entailed", rule: head.slice("entailed:".length) };
    if (head.startsWith("chat:") || head.startsWith("session:") || head.startsWith("operator")) return { kind: "operator" };
    return null;
  }
  var RULE_KIND_COMPOSE2 = "compose2";
  var RULE_KIND_FILTER = "filter";
  var RULE_KIND_RECURSIVE = "recursive";
  var RULE_KIND_ACTION_SIGNATURE = "action-signature";
  var RULE_KIND_ACTION_PRECOND = "action-precond";
  var RULE_KIND_ACTION_EFFECT = "action-effect";
  var RULE_KIND_ACTION_CONSTRAINT = "action-constraint";
  var RULE_KINDS = Object.freeze([
    RULE_KIND_COMPOSE2,
    RULE_KIND_FILTER,
    RULE_KIND_RECURSIVE,
    RULE_KIND_ACTION_SIGNATURE,
    RULE_KIND_ACTION_PRECOND,
    RULE_KIND_ACTION_EFFECT,
    RULE_KIND_ACTION_CONSTRAINT
  ]);
  var RULE_SLOT_SPEC = {
    [RULE_KIND_COMPOSE2]: [["base1", "mgx:ruleBase1"], ["base2", "mgx:ruleBase2"]],
    [RULE_KIND_FILTER]: [["base", "mgx:ruleBase1"], ["property", "mgx:ruleFilterProperty"]],
    [RULE_KIND_RECURSIVE]: [["baseCase", "mgx:ruleBaseCase"], ["recStep", "mgx:ruleRecStep"]],
    [RULE_KIND_ACTION_SIGNATURE]: [
      ["subjectClass", "mgx:ruleActionSubjectClass"],
      ["targetClass", "mgx:ruleActionTargetClass"]
    ],
    [RULE_KIND_ACTION_PRECOND]: [
      ["shape", "mgx:ruleActionPrecondShape"],
      ["predicate", "mgx:ruleActionPrecondPredicate"],
      ["role", "mgx:ruleActionPrecondRole"],
      ["scope", "mgx:ruleActionPrecondScope"]
    ],
    [RULE_KIND_ACTION_EFFECT]: [
      ["predicate", "mgx:ruleActionEffectPredicate"],
      ["subjectRole", "mgx:ruleActionEffectSubject"],
      ["objectRole", "mgx:ruleActionEffectObject"]
    ],
    // "the <left> may not be with the <right> without the <guard>" — each slot
    // names a class whose sole member src/domain.mjs resolves at compile time.
    [RULE_KIND_ACTION_CONSTRAINT]: [
      ["left", "mgx:ruleActionConstraintLeft"],
      ["right", "mgx:ruleActionConstraintRight"],
      ["guard", "mgx:ruleActionConstraintGuard"]
    ]
  };

  // src/codegraph.mjs
  function parseEntities(payload) {
    const individuals = Array.isArray(payload?.individuals) ? payload.individuals : [];
    const byId = /* @__PURE__ */ new Map();
    for (const ind of individuals) {
      if (ind && ind.id) byId.set(ind.id, ind);
    }
    const relations = (Array.isArray(payload?.objectProperties) ? payload.objectProperties : []).filter((g) => g && (g.predicate || g.prop)).map((g) => {
      const edges = (Array.isArray(g.examples) ? g.examples : []).filter((e) => e && e.subject && e.object);
      return {
        predicate: String(g.predicate || ""),
        prop: g.prop || null,
        count: Number(g.count) || edges.length,
        edges
      };
    });
    const truncated = relations.filter((g) => g.count > g.edges.length).map((g) => ({ predicate: g.predicate, count: g.count, shown: g.edges.length }));
    return {
      individuals,
      byId,
      relations,
      truncated,
      generatedAt: payload?.generated_at || null,
      // word -> [individual ids]; {} when prose was disabled at build time
      proseIndex: payload?.proseIndex || {}
    };
  }
  var PROP_KIND = {
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
    // structural links deriveFactTermGraph synthesizes on every Fact (Fact -> its own subject/object Term)
    "mgx:factsubjectterm": "factSubjectTerm",
    "mgx:factobjectterm": "factObjectTerm"
  };
  function relationKind(group) {
    const prop = String(group?.prop || "").toLowerCase();
    if (PROP_KIND[prop]) return PROP_KIND[prop];
    if (prop.startsWith("factrel:")) return group.predicate || null;
    const pred = String(group?.predicate || "").toLowerCase();
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
  function normPath(s) {
    return String(s || "").trim().toLowerCase().replace(/^\.\//, "").replace(/^\//, "");
  }
  function siteOf(ind) {
    const a = (ind?.attributes || []).find((x) => x.key === "site");
    if (!a) return null;
    const m = String(a.value).match(/^(.*):(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    return { path: m[1], start: Number(m[2]), end: m[3] ? Number(m[3]) : Number(m[2]) };
  }
  function impactClosure(graph, ind, { maxDepth = 8 } = {}) {
    const dependents = /* @__PURE__ */ new Map();
    const coveredBy = /* @__PURE__ */ new Map();
    const addDependent = (objectId, subjectId, subjectLabel, via) => {
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
    const levels = [];
    const visited = /* @__PURE__ */ new Set([ind.id]);
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
  function definesIndex(graph) {
    const idx = /* @__PURE__ */ new Map();
    for (const g of graph.relations) {
      if (relationKind(g) !== "defines") continue;
      for (const e of g.edges) {
        if (!idx.has(e.subject)) idx.set(e.subject, []);
        idx.get(e.subject).push(e.objectLabel || e.object);
      }
    }
    return idx;
  }
  var SPIRAL_DEPTH_DEFAULT = 3;
  var SPIRAL_NODE_LIMIT_DEFAULT = 12;
  var SPIRAL_Q_DEFAULT = 0.9;
  var SPIRAL_EXPAND_KINDS = ["imports", "calls", "callsSymbol", "inherits"];
  var MEMORY_SPIRAL_EXPAND_KINDS = ["saidInSession", "inReplyTo", "statedBy", "canonicalisedFrom"];
  var SPIRAL_EMIT_FRAC = 0.5;
  var SPIRAL_HOP_DECAY = 0.6;
  var SPIRAL_PROX_FRAC = 0.2;
  var SPIRAL_PROX_CAP_FRAC = 0.35;
  function adjacencyForKinds(graph, kinds, idNormalizer = null) {
    const norm = idNormalizer || ((id) => moduleIdOfId(graph, id));
    const adj = /* @__PURE__ */ new Map();
    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!adj.has(a)) adj.set(a, /* @__PURE__ */ new Set());
      if (!adj.has(b)) adj.set(b, /* @__PURE__ */ new Set());
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
  function spiralExpand(graph, scored = [], {
    depth = SPIRAL_DEPTH_DEFAULT,
    q = SPIRAL_Q_DEFAULT,
    nodeLimit = SPIRAL_NODE_LIMIT_DEFAULT,
    kinds = SPIRAL_EXPAND_KINDS,
    classPredicate = (ind) => (ind.class || "") === "Module",
    idNormalizer = null,
    seeds: seedsOpt = null,
    hubDegree = Infinity
  } = {}) {
    const byId = new Map(scored.map((s) => [s.ind.id, s]));
    let maxSeed = 0;
    for (const s of scored) maxSeed = Math.max(maxSeed, s.score);
    const nudgeActive = scored.length > 0 && maxSeed > 0;
    const seeds = new Set(seedsOpt != null ? seedsOpt : byId.keys());
    if (!seeds.size) return [];
    const adj = adjacencyForKinds(graph, kinds, idNormalizer);
    const degree = (id) => adj.get(id)?.size || 0;
    const heap = [];
    const less = (a, b) => a.hop !== b.hop ? a.hop < b.hop : a.deg !== b.deg ? a.deg < b.deg : a.id < b.id;
    const swap = (i, j) => {
      const t = heap[i];
      heap[i] = heap[j];
      heap[j] = t;
    };
    const push = (node) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = i - 1 >> 1;
        if (less(heap[i], heap[p])) {
          swap(i, p);
          i = p;
        } else break;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (; ; ) {
          const l = 2 * i + 1, r = 2 * i + 2;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    };
    const visited = new Set(seeds);
    for (const id of seeds) push({ id, hop: 0, deg: degree(id) });
    let defIdx = null;
    let emitted = 0;
    const results = [];
    while (heap.length && emitted < nodeLimit) {
      const node = pop();
      results.push({ id: node.id, hop: node.hop });
      if (!seeds.has(node.id)) {
        if (nudgeActive) {
          const emitScore = maxSeed * SPIRAL_EMIT_FRAC * Math.pow(SPIRAL_HOP_DECAY, node.hop - 1);
          const existing = byId.get(node.id);
          if (existing) {
            existing.score += Math.min(emitScore * SPIRAL_PROX_FRAC, existing.score * SPIRAL_PROX_CAP_FRAC);
          } else {
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
      if (node.hop > 0 && degree(node.id) > hubDegree) continue;
      const cands = [];
      for (const nid of adj.get(node.id) || []) {
        if (visited.has(nid)) continue;
        const ind = graph.byId?.get?.(nid);
        if (!ind || !classPredicate(ind)) continue;
        cands.push({ id: nid, deg: degree(nid) });
      }
      if (!cands.length) continue;
      cands.sort((a, b) => a.deg - b.deg || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const keep = Math.max(1, Math.floor(q * cands.length));
      for (let i = 0; i < keep; i++) {
        const c = cands[i];
        visited.add(c.id);
        push({ id: c.id, hop: node.hop + 1, deg: c.deg });
      }
    }
    return results;
  }
  function mostRecentIndividual(graph, createdAtProp = CREATED_AT_PROP) {
    let best = null;
    for (const ind of graph?.individuals || []) {
      const v = (ind?.attributes || []).find((a) => a?.prop === createdAtProp)?.value;
      if (!v) continue;
      if (!best || v > best.v || v === best.v && String(ind.id) < String(best.ind.id)) best = { ind, v };
    }
    return best ? best.ind : null;
  }
  var edgesOfKindCache = /* @__PURE__ */ new WeakMap();
  function edgesOfKind(graph, kind) {
    let byKind = edgesOfKindCache.get(graph);
    if (!byKind) {
      byKind = /* @__PURE__ */ new Map();
      edgesOfKindCache.set(graph, byKind);
    }
    const cached = byKind.get(kind);
    if (cached) return cached;
    const out = [];
    for (const g of graph.relations) {
      if (relationKind(g) !== kind) continue;
      for (const e of g.edges) out.push(e);
    }
    byKind.set(kind, out);
    return out;
  }
  function derivedUpdatedAt(graph, ind, { createdAtProp = CREATED_AT_PROP, updatedAtProp = UPDATED_AT_PROP } = {}) {
    if (!ind) return "";
    const attrs = ind.attributes || [];
    const own = attrs.find((a) => a?.prop === updatedAtProp)?.value || attrs.find((a) => a?.prop === createdAtProp)?.value || "";
    let best = own || "";
    for (const g of graph?.relations || []) {
      for (const e of g.edges || []) {
        if (!e || e.subject !== ind.id && e.object !== ind.id) continue;
        const c = e.createdAt;
        if (!c) continue;
        if (!best || c > best) best = c;
      }
    }
    return best;
  }
  function buildVizNodesAndEdges(graph, walked, { createdAtProp = CREATED_AT_PROP, updatedAtProp = UPDATED_AT_PROP } = {}) {
    const nodeIds = new Set(walked.map((w) => w.id));
    const nodes = walked.map(({ id, hop }) => {
      const ind = graph.byId.get(id) || null;
      const attrs = ind?.attributes || [];
      const createdAt = attrs.find((a) => a?.prop === createdAtProp)?.value || "";
      return {
        id,
        hop,
        label: ind?.label || id,
        class: ind?.class || "",
        createdAt,
        updatedAt: derivedUpdatedAt(graph, ind, { createdAtProp, updatedAtProp })
      };
    });
    const edges = [];
    const seen = /* @__PURE__ */ new Set();
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
  var MEMORY_FACT_CLASS = "Fact";
  var MEMORY_TERM_CLASS = "Term";
  function deriveFactTermGraph(graph) {
    const termById = /* @__PURE__ */ new Map();
    const groupByPredicate = /* @__PURE__ */ new Map();
    const subjectLinks = [];
    const objectLinks = [];
    const termId = (t) => `term:${t}`;
    const ensureTerm = (t) => {
      const id = termId(t);
      if (!termById.has(id)) termById.set(id, { id, label: t, class: MEMORY_TERM_CLASS, attributes: [] });
      return id;
    };
    for (const ind of graph?.individuals || []) {
      if ((ind?.class || "") !== MEMORY_FACT_CLASS) continue;
      const attrs = ind.attributes || [];
      const s = attrs.find((a) => a?.prop === "rdf:subject")?.value;
      const p = attrs.find((a) => a?.prop === "rdf:predicate")?.value;
      const o = attrs.find((a) => a?.prop === "rdf:object")?.value;
      if (!s || !p || !o) continue;
      const subjectTermId = ensureTerm(s);
      const objectTermId = ensureTerm(o);
      let group = groupByPredicate.get(p);
      if (!group) {
        group = { predicate: p, prop: `factrel:${p}`, count: 0, edges: [] };
        groupByPredicate.set(p, group);
      }
      group.edges.push({ subject: subjectTermId, object: objectTermId, subjectLabel: s, objectLabel: o });
      group.count = group.edges.length;
      subjectLinks.push({ subject: ind.id, object: subjectTermId, subjectLabel: ind.label, objectLabel: s });
      objectLinks.push({ subject: ind.id, object: objectTermId, subjectLabel: ind.label, objectLabel: o });
    }
    if (!termById.size) return { graph, factRelationKinds: [] };
    const individuals = [...graph.individuals || [], ...termById.values()];
    const byId = new Map(graph.byId);
    for (const term of termById.values()) byId.set(term.id, term);
    const relations = [
      ...graph.relations || [],
      ...groupByPredicate.values(),
      { predicate: "factSubjectTerm", prop: "mgx:factSubjectTerm", count: subjectLinks.length, edges: subjectLinks },
      { predicate: "factObjectTerm", prop: "mgx:factObjectTerm", count: objectLinks.length, edges: objectLinks }
    ];
    return {
      graph: { ...graph, individuals, byId, relations },
      factRelationKinds: [...groupByPredicate.keys()]
    };
  }
  var MEMORY_FACT_LINK_KINDS = ["factSubjectTerm", "factObjectTerm"];
  function edgeKindsFor(mode, factRelationKinds) {
    const relationKinds = [...factRelationKinds, ...MEMORY_FACT_LINK_KINDS];
    if (mode === "meta") return [...MEMORY_SPIRAL_EXPAND_KINDS];
    if (mode === "relation") return relationKinds;
    return [...MEMORY_SPIRAL_EXPAND_KINDS, ...relationKinds];
  }
  var LEGEND_MAX_BUCKETS = 20;
  var LEGEND_MIN_BUCKETS = 2;
  var LEGEND_COLLAPSE_TOP_N = 15;
  function normalizedEntropy(buckets) {
    const k = buckets.length;
    if (k < 2) return 0;
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    if (!total) return 0;
    let h = 0;
    for (const b of buckets) {
      if (!b.count) continue;
      const p = b.count / total;
      h -= p * Math.log2(p);
    }
    return h / Math.log2(k);
  }
  function collapseToTopN(buckets) {
    if (buckets.length <= LEGEND_MAX_BUCKETS) return buckets;
    const sorted = [...buckets].sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
    const kept = sorted.slice(0, LEGEND_COLLAPSE_TOP_N);
    const restCount = sorted.slice(LEGEND_COLLAPSE_TOP_N).reduce((sum, b) => sum + b.count, 0);
    return restCount ? [...kept, { value: "Other", count: restCount }] : kept;
  }
  function bucketCounts(values) {
    const counts = /* @__PURE__ */ new Map();
    for (const v of values) {
      if (v == null || v === "") continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  }
  function provenanceBucketLabel(rawTag) {
    const tag = String(rawTag || "").split(" | ")[0].trim();
    if (!tag) return null;
    const src = provenanceTagToSource(tag);
    if (!src) return null;
    if (src.kind === "corpus" || src.kind === "corpusWeak") {
      return `${src.kind === "corpusWeak" ? "corpus-weak" : "corpus"}:${src.name || "unknown"}`;
    }
    if (src.kind === "extracted") return `extracted:${src.name || "unknown"}`;
    if (src.kind === "entailed") return `entailed:${src.rule || "unknown"}`;
    if (src.kind === "operator") return "ace:chat";
    if (src.kind === "teach") return "teach:chat";
    if (src.kind === "web") return "web";
    return src.kind;
  }
  function legendValueFor(graph, node, dimension) {
    if (dimension === "class") return node?.class || "(none)";
    if (!node || node.class !== MEMORY_FACT_CLASS) return null;
    const attrs = graph?.byId?.get?.(node.id)?.attributes || [];
    if (dimension === "predicate") return attrs.find((a) => a?.prop === "rdf:predicate")?.value || null;
    if (dimension === "provenance") return provenanceBucketLabel(attrs.find((a) => a?.prop === "mgx:factProvenance")?.value);
    return null;
  }
  function pickLegendDimension(graph, nodes) {
    const classBuckets = bucketCounts((nodes || []).map((n) => legendValueFor(graph, n, "class")));
    const predicateBuckets = bucketCounts((nodes || []).map((n) => legendValueFor(graph, n, "predicate")));
    const provenanceBuckets = bucketCounts((nodes || []).map((n) => legendValueFor(graph, n, "provenance")));
    const score = (rawBuckets) => {
      const buckets = collapseToTopN(rawBuckets);
      const qualifies = buckets.length >= LEGEND_MIN_BUCKETS && buckets.length <= LEGEND_MAX_BUCKETS;
      return { score: normalizedEntropy(buckets), qualifies, buckets };
    };
    const dimensions = {
      class: score(classBuckets),
      predicate: score(predicateBuckets),
      provenance: score(provenanceBuckets)
    };
    let primary = "class";
    let bestScore = -1;
    for (const [name, d] of Object.entries(dimensions)) {
      if (!d.qualifies) continue;
      if (d.score > bestScore) {
        bestScore = d.score;
        primary = name;
      }
    }
    return { primary, dimensions };
  }
  function moduleIdOfId(graph, id) {
    const ind = graph.byId?.get?.(id);
    if (ind) return moduleIdOf(graph, ind);
    const m = String(id || "").match(/^fn:(.+)#/);
    return m ? `mod:${m[1]}` : null;
  }
  function moduleIdOf(graph, ind) {
    if ((ind?.class || "") === "Module") return ind.id;
    const site = siteOf(ind);
    if (site) return `mod:${site.path}`;
    const m = String(ind?.id || "").match(/^fn:(.+)#/);
    return m ? `mod:${m[1]}` : null;
  }
  var HISTORY_CAP = 15;

  // src/ask-vocab.mjs
  var INHERITS_REVERSE_VERB_LIST = [
    "is a superclass of",
    "are a superclass of",
    "is a parent class of",
    "are a parent class of",
    "superclass",
    "superclasses"
  ];
  var RELATIONS = {
    imports: {
      comment: "Module -> Module: subject's import graph references object (usesComplexType).",
      verbs: [
        // formal/neutral ("uses code from" stays here: its phrasing is
        // specifically import-flavored)
        "couples to",
        "couple to",
        "depends on",
        "imports",
        "import",
        "relies on",
        "rely on",
        "requires",
        "require",
        "references",
        "reference",
        "pulls in",
        "pull in",
        "built on",
        "builds on",
        "build on",
        "uses code from",
        // casual/colloquial
        "grabs",
        "grab",
        "pulls from",
        "pull from",
        "leans on",
        "lean on",
        "is wired to",
        "are wired to",
        "is hooked up to",
        "are hooked up to",
        // gerund (g-drop normalization turns dialectal "importin'" into this)
        "importing"
      ]
    },
    // query-side union, not a stored predicate: ask.mjs traverses "uses" as
    // imports + calls + callsSymbol together (KIND_UNIONS).
    uses: {
      comment: "query-side union: imports (Module->Module) + calls (Module->Module) + callsSymbol (fn->fn).",
      verbs: [
        "uses",
        "use",
        "used by",
        "makes use of",
        "make use of",
        // gerund (g-drop normalization)
        "using"
      ]
    },
    calls: {
      comment: "Function/Method -> Function/Class (symbol-grain) or Module -> Module (coarse): subject invokes object.",
      verbs: [
        // formal
        "invokes",
        "invoke",
        // neutral
        "calls",
        "call",
        "runs",
        "run",
        "executes",
        "execute",
        // casual/colloquial
        "hits",
        "hit",
        "triggers",
        "trigger",
        "fires",
        "fire",
        "kicks off",
        "kick off",
        // gerund (g-drop normalization turns dialectal "callin'" into this)
        "calling"
      ]
    },
    defines: {
      comment: "Module -> top-level Function/Class/Method/Attribute: subject declares object.",
      verbs: [
        "defines",
        "define",
        "declares",
        "declare",
        "has",
        "have",
        "holds",
        "hold",
        // gerund (g-drop normalization)
        "defining"
      ]
    },
    contains: {
      comment: "Class -> Method/Attribute: subject's membership includes object.",
      verbs: [
        "contains",
        "contain",
        "lives in",
        "live in",
        "is defined in",
        "are defined in",
        "is part of",
        "are part of",
        "sits in",
        "sit in",
        "sits inside",
        "sit inside",
        // gerund (g-drop normalization)
        "containing"
      ]
    },
    tests: {
      comment: "Module -> Module: subject is a test module importing/covering object.",
      verbs: [
        "tests",
        "test",
        "covers",
        "cover",
        "verifies",
        "verify",
        "exercises",
        "exercise",
        "checks",
        "check",
        "makes sure of",
        "make sure of",
        // gerund (g-drop normalization)
        "testing"
      ]
    },
    inherits: {
      comment: "Class -> Class: subject's declared base resolves to object (subclassOf).",
      verbs: [
        "inherits from",
        "inherit from",
        "inherits",
        "inherit",
        "extends",
        "extend",
        "subclasses",
        "subclass",
        "derives from",
        "derive from",
        "is a subclass of",
        "are a subclass of",
        "is a kind of",
        "are a kind of",
        "is built off",
        "are built off",
        "is built on top of",
        "are built on top of",
        // gerund, incl. compositional grammar's gerund-led boolean gate
        // ("classes inheriting from Base but not tested")
        "extending",
        "inheriting from",
        "inheriting",
        "subclassing",
        "extends from",
        ...INHERITS_REVERSE_VERB_LIST
      ]
    },
    touches: {
      comment: "Commit -> Module (coarse) or Commit -> symbol (fine, touchesSymbol): a commit's changed-line-range intersects object.",
      verbs: [
        "touched",
        "touches",
        "changed",
        "change",
        "modified",
        "modifies",
        "was changed in",
        "were changed in",
        "was edited in",
        "were edited in",
        "was modified by",
        "were modified by",
        "was tweaked in",
        "were tweaked in",
        "got changed in",
        "got edited in",
        // the same touch relation asked from the commit's side ("what did
        // commit <sha> touch")
        "touch",
        "touched by",
        "modified by",
        "changed by",
        "changed in",
        "landed in",
        "land in",
        // "was in"/"went into" only read as touch questions against a
        // sha-shaped object
        "was in",
        "were in",
        "went into",
        "included in",
        "updated",
        "edited",
        // gerund (g-drop normalization)
        "touching"
      ]
    },
    cochange: {
      comment: "Module -> Module: subject and object are frequently committed together (changeCoupledWith).",
      verbs: [
        "changed with",
        "co-changes with",
        "co-change with",
        "changes alongside",
        "change alongside",
        "shares commits with",
        "share commits with",
        "tends to change together with",
        "tend to change together with",
        "moves together with",
        "move together with",
        "changed together with",
        "change together with",
        "changes together with",
        "changes with",
        "change with",
        "tends to change with",
        "tend to change with",
        "usually changes with"
      ]
    },
    reexports: {
      comment: "Module -> exported symbol: subject's public API surface (__all__/export list).",
      verbs: [
        "exports",
        "export",
        "re-exports",
        "re-export",
        "passes through",
        "pass through",
        "exposes",
        "expose",
        // gerund (g-drop normalization)
        "exporting"
      ]
    }
  };
  var INHERITS_REVERSE_VERBS = Object.freeze([
    ...INHERITS_REVERSE_VERB_LIST,
    "is the superclass of",
    "are the superclass of",
    "is the parent class of"
  ]);
  var WHERE_MARKERS = Object.freeze(["defined", "declared", "located", "implemented"]);
  var MENTION_MARKERS = Object.freeze(["mentioned", "referenced"]);
  var TRAILING_SCOPE_FILLER = Object.freeze([
    "in this graph",
    "in the graph",
    "in this codebase",
    "in the codebase",
    "in this repo",
    "in the repo",
    "here"
  ]);
  var TRAILING_SCOPE_FILLER_RE = new RegExp(
    `\\s+(?:${TRAILING_SCOPE_FILLER.join("|")})\\s*[?.!]*$`,
    "i"
  );
  function stripTrailingScopeFiller(text) {
    return text.replace(TRAILING_SCOPE_FILLER_RE, "").trim();
  }
  var TRAILING_DISCOURSE_TAG = Object.freeze(["then", "though", "too"]);
  var TRAILING_DISCOURSE_TAG_RE = new RegExp(
    `\\s+(?:${TRAILING_DISCOURSE_TAG.join("|")})\\s*[?.!]*$`,
    "i"
  );
  var TRAILING_DISCOURSE_CLAUSE = Object.freeze(["please explain", "explain"]);
  var TRAILING_DISCOURSE_CLAUSE_RE = new RegExp(
    `,\\s*(?:${TRAILING_DISCOURSE_CLAUSE.join("|")})\\s*[?.!]*$`,
    "i"
  );
  function stripTrailingDiscourseTag(text) {
    let out = text;
    for (let pass = 0; pass < 2; pass += 1) {
      let next = out.replace(TRAILING_DISCOURSE_TAG_RE, "").trim();
      next = next.replace(TRAILING_DISCOURSE_CLAUSE_RE, "").trim();
      if (next === out) break;
      out = next;
    }
    return out;
  }
  var VERB_TO_KIND = Object.freeze(
    Object.fromEntries(
      Object.entries(RELATIONS).flatMap(([kind, { verbs }]) => verbs.map((v) => [v, kind]))
    )
  );
  var NON_REVERSE_VERB = (v) => !INHERITS_REVERSE_VERBS.includes(v);
  var ARTICLE_RELATION_CONTINUATIONS = Object.freeze([
    ...new Set(
      Object.keys(VERB_TO_KIND).filter(NON_REVERSE_VERB).map((v) => v.match(/^(?:is|are)\s+an?\s+(.+)$/i)).filter(Boolean).map((m) => m[1].toLowerCase())
    )
  ]);
  var ENTITY_TO_TYPE = Object.freeze({
    function: "Function",
    functions: "Function",
    method: "Method",
    methods: "Method",
    class: "Class",
    classes: "Class",
    module: "Module",
    modules: "Module",
    mod: "Module",
    mods: "Module",
    file: "Module",
    files: "Module",
    attribute: "Attribute",
    attributes: "Attribute",
    field: "Attribute",
    fields: "Attribute",
    variable: "GlobalVariable",
    variables: "GlobalVariable",
    global: "GlobalVariable",
    globals: "GlobalVariable",
    // "Change" is a pseudo-type, not a node class: ask.mjs's traverse() reads it
    // as a wildcard over touch-traversal results (module or symbol grain).
    // Listed before commit/commits since findPhrase takes the first
    // same-length match in table order.
    change: "Change",
    changes: "Change",
    commit: "Commit",
    commits: "Commit"
  });
  var MODIFIER_TO_KIND = Object.freeze({
    explicitly: "direct",
    directly: "direct",
    transitively: "transitive",
    indirectly: "transitive"
  });
  var PASSIVE_PARTICIPLE_TO_KIND = Object.freeze({
    imported: "imports",
    called: "calls",
    used: "uses",
    tested: "tests",
    covered: "tests",
    verified: "tests",
    exercised: "tests",
    checked: "tests",
    defined: "defines",
    declared: "defines",
    inherited: "inherits",
    extended: "inherits",
    subclassed: "inherits",
    contained: "contains",
    exported: "reexports",
    "re-exported": "reexports",
    exposed: "reexports",
    touched: "touches",
    changed: "touches",
    modified: "touches",
    edited: "touches",
    updated: "touches"
  });
  var CONTRACTIONS = Object.freeze({
    "ain't": "is not",
    "aint": "is not",
    "isn't": "is not",
    "isnt": "is not",
    "aren't": "are not",
    "arent": "are not",
    "doesn't": "does not",
    "doesnt": "does not",
    "don't": "do not",
    "dont": "do not",
    "didn't": "did not",
    "didnt": "did not",
    "there's": "there is",
    "theres": "there is",
    "what's": "what is",
    "whats": "what is",
    "who's": "who is",
    "whos": "who is",
    "gonna": "going to",
    "wanna": "want to",
    "gotta": "got to",
    "yer": "your",
    "ur": "your",
    "gimme": "give me"
  });
  var MISSPELLINGS = Object.freeze({
    // entity nouns
    "funtion": "function",
    "funtions": "functions",
    "fucntion": "function",
    "fucntions": "functions",
    "functoin": "function",
    "functoins": "functions",
    "calss": "class",
    "calsses": "classes",
    "classs": "class",
    "clases": "classes",
    "modul": "module",
    "moduls": "modules",
    "moduel": "module",
    "moduels": "modules",
    "moudle": "module",
    "moudles": "modules",
    "methdo": "method",
    "methdos": "methods",
    "mehtod": "method",
    "mehtods": "methods",
    "comit": "commit",
    "comits": "commits",
    "commmit": "commit",
    "commmits": "commits",
    "varaible": "variable",
    "varaibles": "variables",
    "varibale": "variable",
    "varibales": "variables",
    "atribute": "attribute",
    "atributes": "attributes",
    // relation verbs
    "improt": "import",
    "improts": "imports",
    "imoprt": "import",
    "imoprts": "imports",
    "inherts": "inherits",
    "inheirts": "inherits",
    "extands": "extends",
    "extneds": "extends",
    "depnds": "depends",
    "touchs": "touches",
    "tuoches": "touches",
    "touhced": "touched",
    "touchd": "touched",
    "defned": "defined",
    "chagned": "changed",
    "chnaged": "changed",
    "chagnes": "changes",
    "chnages": "changes",
    "calles": "calls",
    "exprot": "export",
    "exprots": "exports",
    "tets": "tests",
    // grammar anchor words
    "whcih": "which",
    "wich": "which",
    "whihc": "which",
    // "were" (the missing-h homophone slip of "where") is NOT curated here —
    // it's a load-bearing TEMPORAL_AUX word ("when were the modules touched").
    "wehre": "where",
    "whre": "where",
    "waht": "what",
    "wat": "what",
    "dat": "that",
    "dose": "does",
    "doess": "does",
    "teh": "the",
    "manyn": "many",
    "mnay": "many",
    "amny": "many",
    "mnany": "many",
    "hwo": "how",
    "coutn": "count",
    "conut": "count",
    "cuont": "count",
    "ocunt": "count",
    "numer": "number",
    "nubmer": "number",
    "numbr": "number",
    "nmuber": "number",
    "lst": "list",
    "lsit": "list",
    "ilst": "list",
    "shwo": "show",
    "hsow": "show",
    "dispaly": "display",
    "dsiplay": "display",
    "funtcions": "functions",
    "funciton": "function",
    "funcitons": "functions"
  });
  var WRONG_WORDS = Object.freeze({
    // neither a folder nor a directory grain exists in this graph — in "which
    // folders import X" the only honest referent is the module/file grain.
    "folder": "module",
    "folders": "modules",
    "directory": "module",
    "directories": "modules",
    // unambiguous abbreviation of an entity noun this grammar owns
    "func": "function",
    "funcs": "functions",
    // VCS terms whose canonical schema class here is Commit
    "changeset": "commit",
    "changesets": "commits",
    "revision": "commit",
    "revisions": "commits",
    // code-graph "property" is the Attribute grain in this schema
    "property": "attribute",
    "properties": "attributes"
  });
  var G_DROP = /\b([a-z]{3,})in'/gi;
  var FILLER_WORDS = Object.freeze([
    "um",
    "uh",
    "erm",
    "so",
    "like",
    "yo",
    "hey",
    "bru",
    "bro",
    "fam",
    "mate",
    "please",
    "could you",
    "can you",
    "would you",
    "tell me",
    "i wonder",
    "just wondering",
    "quickly",
    "real quick",
    "kinda",
    "sorta",
    "btw",
    "by the way",
    "you",
    "quick q"
  ]);
  var CONTEXT_PRONOUNS = Object.freeze(["this", "it", "that", "here", "this one", "that one"]);
  var NEGATION_FRAMES = Object.freeze([
    // "there ain't nothin' calling it" / "there isn't nothing that calls it"
    //   -> "what calls it"
    { re: /\bthere\s+is\s+not\s+(?:anything|nothing)\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
    // "there's no module that imports auth" -> "what imports auth"
    { re: /\bthere\s+is\s+no\s+\S+\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
    // "isn't there anything calling it" -> "what calls it" (question-inverted form)
    { re: /\bis\s+not\s+there\s+(?:anything|nothing)\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
    // "nobody/nothing calls it, does it" (tag-question double-negative) -> "what calls it"
    { re: /\b(?:nobody|nothing|no one)\s+(\S.*?)(?:,?\s+does\s+it\??|,?\s+do\s+they\??)?$/i, to: (m) => `what ${m[1]}` }
  ]);
  var COMMIT_CONTENT_FRAMES = Object.freeze([
    // "what was in commit ef74e44e25c8" / "what is in ef74e44e" / "what's in commit <sha>"
    { re: /^what\s+(?:is|was|were|are)\s+in\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
    // "what went into commit ef74e44e25c8" / casual "what got into <sha>"
    { re: /^what\s+(?:went|got)\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
    // "what made it into commit ef74e44e25c8"
    { re: /^what\s+made\s+it\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` }
  ]);
  var META_MEANING_VERBS = Object.freeze([
    "mean",
    "means",
    "stand for",
    "stands for",
    "signify",
    "signifies",
    "represent",
    "represents",
    "refer to",
    "refers to"
  ]);
  var RELATIVE_PRONOUNS = Object.freeze(["that", "which", "who"]);
  var PLACEHOLDER_NOUNS = Object.freeze([
    "something",
    "anything",
    "everything",
    "somethings",
    "things",
    "thing",
    "entities",
    "entity",
    "nodes",
    "node",
    "stuff",
    "code",
    "symbol",
    "symbols"
  ]);
  var BOOLEAN_CONNECTIVES = Object.freeze({
    "but not": "difference",
    "and not": "difference",
    "except": "difference",
    "without": "difference",
    "and": "intersection",
    "plus": "intersection",
    "or": "union"
  });
  var QUALIFIERS = Object.freeze({
    public: { via: "visibility", value: "public" },
    private: { via: "visibility", value: "private" },
    protected: { via: "visibility", value: "protected" },
    static: { via: "attr", attr: "isStatic" },
    abstract: { via: "attr", attr: "isAbstract" },
    constant: { via: "attr", attr: "isConstant" },
    exported: { via: "exported" },
    "re-exported": { via: "exported" },
    tested: { via: "tested", value: true },
    covered: { via: "tested", value: true },
    untested: { via: "tested", value: false },
    uncovered: { via: "tested", value: false }
  });
  var AGGREGATE_TRIGGERS = Object.freeze([
    "how many",
    "how much",
    "how many of",
    "number of",
    "total number of",
    "quantity of",
    "tally of",
    "sum of",
    "total of",
    "amount of",
    "count",
    "count up",
    "count of",
    "tot up"
  ]);
  var LIST_TRIGGERS = Object.freeze([
    "list",
    "show",
    "show me",
    "show us",
    "display",
    "print",
    "print out",
    "dump",
    "enumerate",
    "name",
    "give me",
    "get me",
    "spit out",
    "rattle off",
    "run down",
    "run through",
    "ls",
    "what are",
    "which are"
  ]);
  var SUPERLATIVE_EXTREMES = Object.freeze({
    most: "most",
    greatest: "most",
    highest: "most",
    biggest: "most",
    largest: "most",
    "most-connected": "most",
    "most connected": "most",
    fewest: "fewest",
    least: "fewest",
    smallest: "fewest",
    lowest: "fewest"
  });
  var EDGE_NOUN_TO_METRIC = Object.freeze({
    imports: { kind: "imports", dir: "out" },
    dependencies: { kind: "imports", dir: "out" },
    importers: { kind: "imports", dir: "in" },
    dependents: { kind: "imports", dir: "in" },
    callers: { kind: "calls", dir: "in", sibling: "callsSymbol" },
    callees: { kind: "calls", dir: "out", sibling: "callsSymbol" },
    calls: { kind: "calls", dir: "out", sibling: "callsSymbol" },
    methods: { kind: "contains", dir: "out", filter: "Method" },
    members: { kind: "contains", dir: "out" },
    tests: { kind: "tests", dir: "in" },
    test: { kind: "tests", dir: "in" },
    // singular ("needs a test") — same edge as plural "tests"
    subclasses: { kind: "inherits", dir: "in" },
    connections: { kind: "*", dir: "both" },
    edges: { kind: "*", dir: "both" },
    connected: { kind: "*", dir: "both" },
    // participle degree-nouns rank by in-degree, same intent as "importers" etc
    imported: { kind: "imports", dir: "in" },
    "depended-on": { kind: "imports", dir: "in" },
    depended: { kind: "imports", dir: "in" },
    used: { kind: "imports", dir: "in", sibling: "callsSymbol" },
    called: { kind: "calls", dir: "in", sibling: "callsSymbol" }
  });
  var METRIC_IMPLIES_ENTITY = Object.freeze({
    tests: "Module",
    test: "Module"
  });
  var ANAPHORA_TRIGGERS = Object.freeze(["those", "them", "these"]);
  var MEMBERSHIP_KINDS = Object.freeze(["contains", "defines"]);
  var CASCADE_NOISE = Object.freeze([
    "the",
    "a",
    "an",
    "some",
    "other",
    "about",
    "please",
    "pls",
    "plz",
    "kindly",
    "just",
    "simply",
    "maybe",
    "perhaps",
    "thanks",
    "thank",
    "ta",
    "cheers",
    "hi",
    "hello",
    "hey",
    "yo",
    "hiya",
    "howdy",
    "ok",
    "okay",
    "matey",
    "mate",
    "buddy",
    "pal",
    "dude",
    "man",
    "bro",
    "bru",
    "fam",
    "friend",
    "sir",
    "maam",
    "folks",
    "guys",
    "everyone",
    "dear",
    "tmct",
    "show",
    "tell",
    "give",
    "list",
    "find",
    "me",
    "us",
    "lemme"
  ]);
  var CASCADE_SYNONYMS = Object.freeze({
    tally: "count",
    tallies: "count",
    sum: "count",
    total: "count",
    totals: "count"
  });
  var HELP_TRIGGERS = Object.freeze([
    "help",
    "help me",
    "how do i ask",
    "how do i use this",
    "what can i ask",
    "what can you ask",
    "usage",
    "commands",
    "examples",
    "syntax",
    "options"
  ]);

  // src/interpret/normalize.mjs
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  var tableRe = (table) => new RegExp(
    "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
    "gi"
  );
  var CONTRACTION_RE = tableRe(CONTRACTIONS);
  var correctionRe = (table) => new RegExp(
    "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b(?!\\.[a-z0-9])",
    "gi"
  );
  var MISSPELLING_RE = correctionRe(MISSPELLINGS);
  var WRONG_WORD_RE = correctionRe(WRONG_WORDS);
  var W_SLASH_RE = /(?<=^|\s)w\/(?=\s|$)/gi;
  var FOR_DIGIT_THANKS_RE = /\b(thx|thanks|thank\s+you|many\s+thanks|ty|cheers)\s+4\b/gi;
  var FOR_DIGIT_EXAMPLE_RE = /\b4\s+(example|instance)\b(?!\s*[a-z])/gi;
  var KIND_NOUN_ANAPHORA_RE = /\b(this|that)\s+(class|module|function|method|attribute|variable|file|commit)\b/gi;
  var VERB_ALTERNATION = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  var FILLER_RE = FILLER_WORDS.length ? new RegExp(
    "\\b(" + [...FILLER_WORDS].sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b\\s*,?",
    "gi"
  ) : null;
  function stripFillerWords(text) {
    let q = String(text || "");
    if (FILLER_RE) q = q.replace(FILLER_RE, " ");
    return q.replace(/\s+/g, " ").trim();
  }
  var RELATION_VERB_RE = new RegExp(
    "\\b(?:" + Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
    "i"
  );
  var INTERROGATIVE_LEAD_RE = /^(?:which|what|who|whose|where|when|why|how)\b/i;
  var LISTING_TAIL_KINDS = /* @__PURE__ */ new Set([
    "modules",
    "files",
    "functions",
    "methods",
    "classes",
    "attributes",
    "fields",
    "properties",
    "variables",
    "globals",
    "commits",
    "changes",
    "tests",
    "members"
  ]);
  var BARE_KIND_RE = /^(?:all\s+|the\s+)?(?:module|file|function|method|class|attribute|field|property|variable|global|commit|change|test|member)\??$/i;
  var isListingRemainder = (rest) => {
    if (BARE_KIND_RE.test(rest)) return true;
    const words = rest.replace(/\?+\s*$/, "").trim().split(/\s+/);
    return LISTING_TAIL_KINDS.has((words[words.length - 1] || "").toLowerCase());
  };
  var GREETING_PREAMBLE_RE = /^(?:hi|hiya|hello|hey|yo|howdy|g'?day|yeah\s+nah|good\s+(?:morning|afternoon|evening|day)|greetings|salutations)(?:\s+(?:there|pardner|folks|friend|mate))?\s*[,.—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
  var THANKS_PREAMBLE_RE = /^(?:thanks|thank\s+you|many\s+thanks|thx|ty|cheers)(?:\s+(?:so\s+much|a\s+lot|very\s+much|a\s+bunch))?\s*[,—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
  var ACK_PREAMBLE_RE = /^(?:(?:ok(?:ay)?|aight|cool|alright|sure|right|fine|great|nice|got it|gotcha|sounds good|no worries|no problem)[\s,]+)+(.+)$/i;
  var BROWSING_PREAMBLE_RE = /^(?:just\s+(?:poking\s+around|looking\s+around|browsing|exploring|checking\s+(?:this|it)\s+out)|first\s+time\s+(?:trying\s+this\s+out|using\s+this|here))\s*[,.—–-]\s*(.+)$/i;
  var HEDGE_ADVERB_PREAMBLE_RE = /^(?:(?:maybe|possibly|perhaps)\s+)+(.+)$/i;
  var TROUBLE_ASIDE_RE = /,?\s*if\s+(?:it'?s|it\s+is|that'?s|that\s+is)\s+not\s+too\s+much\s+(?:trouble|bother|hassle)\s*,?\s*/i;
  var MODAL_WRAPPER_RE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+?)(?:[,\s]+please)?\??$/i;
  var EXPLAIN_WRAPPER_RE = /^explain\s+(?:to\s+me\s+|please\s+)*(.+?)\??$/i;
  var TELL_ME_WRAPPER_RE = /^tell\s+me\s+(.+?)\??$/i;
  var KNOW_WRAPPER_RE = /^do\s+you\s+know\s+(.+?)\??$/i;
  var WANT_KNOW_WRAPPER_RE = /^i(?:'d|\s+would)?\s+(?:like|want|need)\s+to\s+know\s+(.+?)\??$/i;
  var EMBEDDED_WHATIS_RE = /^what\s+((?:an?\s+|the\s+)?[\w'-]+(?:\s+[\w'-]+){0,2})\s+(is|are)\??$/i;
  var EMBEDDED_MEANS_RE = /^what\s+((?:an?\s+|the\s+)?[\w'-]+(?:\s+[\w'-]+){0,2})\s+means\??$/i;
  var SHOW_GIVE_ME_RE = /^(?:show|give)\s+me\s+(?:the\s+)?(.+?)\??$/i;
  var LEADING_CONNECTIVE_RE = /^(?:and|also|so|then|now|but)\s+(.+)$/i;
  var QUESTION_AUX_LEAD_RE = /^(?:does|do|did|is|are|was|were|has|have|had|can|could|will|would|should)\b/i;
  var TOPIC_SWITCH_PREAMBLE_RE = /^(?:(?:actually|no\s+wait|wait|hold\s+on|never\s+mind|scratch\s+that|on\s+second\s+thought|i\s+mean(?:t)?)[\s,.]+)+(.+)$/i;
  function applyPreambleFrames(text) {
    let q = String(text || "");
    q = q.replace(TROUBLE_ASIDE_RE, " ").replace(/\s+/g, " ").trim();
    for (let pass = 0; pass < 3; pass++) {
      const before = q;
      let m = q.match(GREETING_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(THANKS_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(ACK_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(BROWSING_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(HEDGE_ADVERB_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(TOPIC_SWITCH_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(MODAL_WRAPPER_RE);
      if (m) q = m[1].trim();
      m = q.match(EXPLAIN_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(TELL_ME_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(KNOW_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(WANT_KNOW_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(EMBEDDED_WHATIS_RE);
      if (m) q = `what ${m[2].toLowerCase()} ${m[1].trim()}`;
      m = q.match(EMBEDDED_MEANS_RE);
      if (m) q = `what does ${m[1].trim()} mean`;
      m = q.match(SHOW_GIVE_ME_RE);
      if (m) {
        const rest = m[1].trim();
        if (!isListingRemainder(rest)) {
          q = RELATION_VERB_RE.test(rest) || INTERROGATIVE_LEAD_RE.test(rest) ? rest : `describe ${rest}`;
        }
      }
      m = q.match(LEADING_CONNECTIVE_RE);
      if (m) {
        const rest = m[1].trim();
        if (INTERROGATIVE_LEAD_RE.test(rest) || QUESTION_AUX_LEAD_RE.test(rest) || TOPIC_SWITCH_PREAMBLE_RE.test(rest) || ACK_PREAMBLE_RE.test(rest) || HEDGE_ADVERB_PREAMBLE_RE.test(rest) || BROWSING_PREAMBLE_RE.test(rest)) q = rest;
      }
      if (q === before) break;
    }
    return q;
  }
  var SUBORDINATION_FRAMES_RE = /^(?:since|although|though|while|because|whereas|given\s+that|now\s+that)\s+.+?,\s*(.+)$/i;
  function applySubordinationFrames(text) {
    let q = String(text || "");
    for (let pass = 0; pass < 3; pass++) {
      const m = q.match(SUBORDINATION_FRAMES_RE);
      if (!m) break;
      q = m[1].trim();
    }
    return q;
  }
  var SELF_CORRECTION_RE = /^.+?(?:\s*(?:--|—|-)\s*)?\b(?:sorry|i\s+mean)\b\s*(?:--|—|-|,|:)\s*(.+)$/i;
  function applySelfCorrectionFrames(text) {
    let q = String(text || "");
    for (let pass = 0; pass < 3; pass++) {
      const m = q.match(SELF_CORRECTION_RE);
      if (!m) break;
      const next = m[1].trim();
      if (!next || next === q) break;
      q = next;
    }
    return q;
  }
  var CONDITIONAL_VERB_GERUND = Object.freeze({
    imports: "importing",
    calls: "calling",
    touches: "touching",
    tests: "testing",
    exports: "exporting",
    contains: "containing",
    defines: "defining",
    uses: "using",
    "inherits from": "inheriting from"
  });
  var CONDITIONAL_KIND_PLURAL = Object.freeze({
    module: "modules",
    class: "classes",
    function: "functions",
    method: "methods",
    attribute: "attributes",
    variable: "variables",
    commit: "commits",
    file: "files"
  });
  var CONDITIONAL_QUALIFIER_SRC = "public|private|protected|static|abstract|constant|re-?exported|exported|tested|covered|untested|uncovered";
  var CONDITIONAL_QUALIFIER_RE = new RegExp(
    "^if\\s+(?:a|an|the)?\\s*(" + Object.keys(CONDITIONAL_KIND_PLURAL).join("|") + ")\\s+(" + Object.keys(CONDITIONAL_VERB_GERUND).join("|") + ")\\s+(.+?),\\s*(?:is|are)\\s+(?:it|that|they|this)\\s+(" + CONDITIONAL_QUALIFIER_SRC + ")\\??$",
    "i"
  );
  var COUNTERFACTUAL_RE = /^if\s+(.+?)\s+(?:were|was)\s+(?:deleted|removed),?\s*what\s+(?:would|might|could)\s+(?:break|fail|be\s+affected)\??$/i;
  function applyConditionalFrames(text) {
    const q = String(text || "");
    const qual = q.match(CONDITIONAL_QUALIFIER_RE);
    if (qual) {
      const kind = CONDITIONAL_KIND_PLURAL[qual[1].toLowerCase()];
      const gerund = CONDITIONAL_VERB_GERUND[qual[2].toLowerCase()];
      return `${kind} ${gerund} ${qual[3].trim()} and ${qual[4].toLowerCase()}`;
    }
    const cf = q.match(COUNTERFACTUAL_RE);
    if (cf) return `which modules transitively import ${cf[1].trim()}`;
    return q;
  }
  function normalizeQuery(text) {
    let q = String(text || "");
    q = q.replace(CONTRACTION_RE, (m) => CONTRACTIONS[m.toLowerCase()]);
    q = q.replace(MISSPELLING_RE, (m) => MISSPELLINGS[m.toLowerCase()]);
    q = q.replace(WRONG_WORD_RE, (m) => WRONG_WORDS[m.toLowerCase()]);
    q = q.replace(W_SLASH_RE, "with");
    q = q.replace(FOR_DIGIT_THANKS_RE, (_, w) => `${w} for`);
    q = q.replace(FOR_DIGIT_EXAMPLE_RE, (_, w) => `for ${w}`);
    q = q.replace(KIND_NOUN_ANAPHORA_RE, (_, pron) => pron);
    q = q.replace(G_DROP, "$1ing");
    q = applyPreambleFrames(q);
    q = applySelfCorrectionFrames(q);
    q = applySubordinationFrames(q);
    q = applyConditionalFrames(q);
    q = stripFillerWords(q);
    q = q.replace(/\?{2,}\s*$/, "?");
    return q.replace(/\s+/g, " ").trim();
  }
  function applyNegationFrames(text) {
    for (const frame of [...COMMIT_CONTENT_FRAMES, ...NEGATION_FRAMES]) {
      const m = text.match(frame.re);
      if (m) return frame.to(m).replace(/\s+/g, " ").trim();
    }
    return text;
  }
  var PHRASING_FRAMES = Object.freeze([
    // MEMBERS-of-class → "what does X contain".
    { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:are|is)\s+(?:in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
    { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:does|do)\s+(.+?)\s+have\??$/i, to: (m) => `what does ${m[1]} contain` },
    { re: /^what\s+are\s+(?:the\s+)?(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:of|in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
    { re: /^(?:the\s+)?(?:members?|methods?|attributes?|contents)\s+of\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
    { re: /^what\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
    // "what else is in X" drill-down after a members-of-class answer.
    { re: /^what\s+else\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
    // WHERE-DEFINED → "where is X defined". PAST TENSE ONLY ("what defined X", "what
    // declared X"): the PRESENT "what defines X" already parses as a reverse-defines
    // query (the module defining symbol X), so rewriting it would change that
    // receipt. The past-tense form is the one that hit the wall.
    { re: /^what\s+(?:defined|declared)\s+(?:the\s+)?(?:function\s+|method\s+|class\s+|module\s+|variable\s+|constant\s+)?(.+?)\??$/i, to: (m) => `where is ${m[1]} defined` },
    //   "where's X defined" (the "where's" contraction is not in the contraction table)
    { re: /^where'?s\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
    //   "were is X defined" (the missing-h typo of "where").
    //   NOT curated as a blanket MISSPELLINGS entry — "were" is a real word already
    //   load-bearing as the TEMPORAL_AUX auxiliary ("when were the modules last
    //   touched"), so a global word-boundary rewrite would clobber that reading.
    //   This frame is anchored to the WHERE-DEFINED shape specifically ("were is
    //   … defined/declared/located/implemented"), a construction no legitimate
    //   temporal query produces ("were" as an auxiliary never leads directly into
    //   a bare "is").
    { re: /^were\s+is\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
    // DESCRIBE PARAPHRASES ("what is the purpose of X", "what does X do in
    // this codebase") → the meta/whatis shape ("what is a <term>"), which
    // already answers a unique code entity via metaFallbackEntityAnswer. The
    // term slot refuses an a/an article or a pronoun lead so the vocabulary
    // phrasings ("what is the purpose of a horse", "what does it do here")
    // pass through untouched to their own memory-facts and context readers,
    // which read the raw text and must keep their turn. A leading "the" is
    // entity-term noise (mirrors resolveObject's own article strip). The
    // sibling "what is X for" paraphrase is deliberately NOT a frame: chat's
    // module-overview lane owns that phrasing and gates on an ask() miss, so
    // it lives as ask()'s own miss-gated fallback (WHATIS_FOR_FALLBACK_RE)
    // instead, adopted only when the meta reading actually answers.
    { re: /^what\s+is\s+the\s+purpose\s+of\s+(?:the\s+)?(?!(?:an?|it|this|that|these|those)\s)(.+?)\??$/i, to: (m) => `what is a ${m[1]}` },
    // Scoped form only: bare "what does X do" stays unrewritten — the chat
    // surface's module-grain overview lane owns it and only gets its turn when
    // ask() misses, so claiming it here would swap that richer answer for the
    // one-line meta fallback.
    {
      re: new RegExp(`^what\\s+does\\s+(?:the\\s+)?(?!(?:an?|it|this|that|these|those)\\s)(.+?)\\s+do\\s+(?:${TRAILING_SCOPE_FILLER.map(escapeRegex).join("|")})\\??$`, "i"),
      to: (m) => `what is a ${m[1]}`
    },
    // PREDICATIVE QUALIFIER ("which modules are untested") → the ATTRIBUTIVE form
    // ("untested modules") the grammar already answers. The QUALIFIER must sit
    // immediately after are/is, so "…are NOT tested" keeps its own set-complement handler.
    {
      re: /^(?:which|what)\s+(?:the\s+|all\s+)?([a-z][a-z-]*?)\s+(?:are|is)\s+(public|private|protected|static|abstract|constant|exported|re-?exported|tested|covered|untested|uncovered)\??$/i,
      to: (m) => `${m[2].toLowerCase()} ${m[1].toLowerCase()}`
    },
    // BARE COVERAGE SURVEY, no entity kind ("what is untested") → defaults the
    // surveyed kind to modules and folds the negation into the qualifier.
    {
      re: /^what\s+(?:is|are)\s+(not\s+)?(tested|untested|covered|uncovered)\??$/i,
      to: (m) => {
        const q = m[2].toLowerCase();
        const flipped = m[1] ? q === "tested" ? "untested" : q === "covered" ? "uncovered" : q : q;
        return `${flipped} modules`;
      }
    },
    // CO-CHANGE → "what co-changes with X" (the plainest phrasing a developer types).
    { re: /^what\s+does\s+(.+?)\s+changes?\s+together\s+with\??$/i, to: (m) => `what co-changes with ${m[1]}` },
    { re: /^what\s+changes?\s+together\s+with\s+(.+?)\??$/i, to: (m) => `what co-changes with ${m[1]}` },
    // AUTHORSHIP → "who touched X" (tmct's touch edge IS the authorship signal).
    // A commit sha object is excluded — that dumps the commit's touch-set, not its author.
    { re: /^who\s+(?:wrote|authored)\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
    { re: /^who\s+is\s+the\s+authors?\s+of\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
    // HAS-TESTS → "what tests X" (the coverage question). Refuses "not" in the
    // subject so set-complement negations keep their own downstream handler.
    { re: /^(?:does|do)\s+(?!.*\bnot\b)(.+?)\s+have\s+(?:any\s+)?(?:tests?|test\s+coverage|coverage)\??$/i, to: (m) => `what tests ${m[1]}` },
    { re: /^(?:is|are)\s+(?!.*\bnot\b)(.+?)\s+tested\??$/i, to: (m) => `what tests ${m[1]}` },
    // NEEDS-TESTS → the untested-module survey.
    { re: /^what\s+needs\s+(?:to\s+be\s+)?(?:a\s+)?(?:tested|tests?|testing|coverage|covering)\??$/i, to: () => "untested modules" },
    // DOES-X-VERB-ANYTHING-ELSE → "what does X <verb>" (drops the placeholder
    // "anything/something else" object, which otherwise made the two parse
    // strategies disagree on the span). Anchored to VERB_TO_KIND so it can't
    // swallow a real object that happens to start with "any"/"some".
    {
      re: new RegExp(`^(?:do|does)\\s+(.+?)\\s+(${VERB_ALTERNATION})\\s+(?:anything|something)(?:\\s+else)?\\??$`, "i"),
      to: (m) => `what does ${m[1]} ${m[2]}`
    }
  ]);
  function applyPhrasingFrames(text) {
    for (const frame of PHRASING_FRAMES) {
      const m = text.match(frame.re);
      if (m) return frame.to(m).replace(/\s+/g, " ").trim();
    }
    return text;
  }
  var NEGATION_SET_RE = new RegExp(
    "^(?:which|what|who|list|show(?:\\s+me)?|find|give\\s+me)?\\s*(?:the\\s+|all\\s+)?([a-z][a-z-]*)\\s+(?:(?:that|which|who)\\s+)?(?:(?:do|does|did|are|is|was|were|have|has)\\s+)?not\\s+(.+)$",
    "i"
  );
  function matchNegationSet(text) {
    const m = String(text || "").match(NEGATION_SET_RE);
    if (!m) return null;
    const entWord = m[1].toLowerCase();
    const predicate = m[2].trim();
    if (!predicate) return null;
    return { entWord, predicate };
  }
  var STOPWORDS2 = /* @__PURE__ */ new Set([
    "what",
    "who",
    "which",
    "where",
    "when",
    "why",
    "how",
    "does",
    "do",
    "did",
    "is",
    "are",
    "was",
    "were",
    "the",
    "a",
    "an",
    "of",
    "to",
    "from",
    "at",
    "in",
    "on",
    "there",
    "something",
    "anything",
    "nothing",
    "one",
    "any",
    "last",
    // temporal filler ("when was X last touched")
    "usually",
    "typically",
    "generally",
    "normally",
    "often",
    "commonly",
    "mostly",
    // frequency-adverb filler
    "should",
    "would",
    "could",
    "can",
    "will",
    "shall",
    "might",
    "must"
    // modal auxiliaries
  ]);
  var splitWords = (text) => String(text).replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  var wordsOf = (arr) => arr.flatMap((p) => String(p).toLowerCase().split(" "));

  // src/interpret/fuzzy.mjs
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + cost);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }
  var fuzzyBound = (s) => s.length <= 5 ? 1 : 2;
  var VOCAB_WORDS = new Set(
    [...Object.keys(VERB_TO_KIND), ...Object.keys(ENTITY_TO_TYPE), ...Object.keys(MODIFIER_TO_KIND)].flatMap((p) => p.split(" "))
  );
  var FUZZY_TARGET_WORDS = [...new Set(
    [...Object.keys(VERB_TO_KIND), ...Object.keys(MODIFIER_TO_KIND)].flatMap((p) => p.split(" ")).filter((w) => w.length >= 4)
  )];
  function eligibleForCanon(w) {
    return /^[a-z]+$/.test(w) && !STOPWORDS2.has(w) && !VOCAB_WORDS.has(w);
  }
  function fuzzyVocabWord(w) {
    return fuzzyMatchInSet(w, FUZZY_TARGET_WORDS, fuzzyBound(w));
  }
  function fuzzyMatchInSet(w, candidates, bound = fuzzyBound(w)) {
    let best = bound + 1;
    let hit = null;
    let tied = false;
    for (const target of candidates) {
      const d = editDistance(w, target, Math.min(best, bound));
      if (d < best) {
        best = d;
        hit = target;
        tied = false;
      } else if (d === best && d <= bound && target !== hit) tied = true;
    }
    return best <= bound && !tied ? hit : null;
  }

  // src/interpret/strategies/grammar.mjs
  var VERB_ALT = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  var ENTITY_ALT = Object.keys(ENTITY_TO_TYPE).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  var MODIFIER_ALT = Object.keys(MODIFIER_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  var META_ALT = META_MEANING_VERBS.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  var TEMPLATES = [
    // T1 ASK: "does X import Y" -> Yes/No. REVERSE VERB SWAP: a semantically-reverse
    // verb ("superclass of") means the opposite of its forward counterpart, so
    // INHERITS_REVERSE_VERBS (ask-vocab.mjs) swaps subject/object here at parse time.
    {
      name: "ask",
      re: new RegExp(`^(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
      build: (m) => {
        const verb = m[2].toLowerCase();
        const kind = VERB_TO_KIND[verb];
        let subject = m[1].trim();
        let object = m[3].trim();
        if (INHERITS_REVERSE_VERBS.includes(verb)) [subject, object] = [object, subject];
        return { shape: "ask", entityType: null, modifier: "direct", kind, subject, object };
      }
    },
    // T2 reverse: "which <entity> [<modifier>] <verb> <object>".
    {
      name: "reverse",
      re: new RegExp(`^which\\s+(${ENTITY_ALT})\\s+(?:(${MODIFIER_ALT})\\s+)?(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
      build: (m) => ({
        shape: "reverse",
        entityType: ENTITY_TO_TYPE[m[1].toLowerCase()],
        modifier: m[2] ? MODIFIER_TO_KIND[m[2].toLowerCase()] : "direct",
        kind: VERB_TO_KIND[m[3].toLowerCase()],
        object: m[4].trim()
      })
    },
    // T3 forward: "what does <object> <verb>" — X is given, list its R-related things.
    // "did" joins does/do for the past-tense commit forms ("what did commit <sha> touch").
    {
      name: "forward",
      re: new RegExp(`^what\\s+(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\??$`, "i"),
      build: (m) => ({
        shape: "forward",
        entityType: null,
        modifier: "direct",
        kind: VERB_TO_KIND[m[2].toLowerCase()],
        object: m[1].trim()
      })
    },
    // T4 meta: "what does <term> mean" — a question about the graph's own vocabulary,
    // not a graph traversal. VERB_ALT and META_ALT are disjoint tables, so this never
    // competes with T3 for the same input.
    {
      name: "meta-mean",
      re: new RegExp(`^what\\s+(?:does|do|is|are)\\s+(.+?)\\s+(?:${META_ALT})\\??$`, "i"),
      build: (m) => ({ shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: m[1].trim() })
    },
    // T5 meta: "what is a/an <term>" — the bare (no-article) form is restricted to
    // the closed ENTITY_TO_TYPE vocabulary (build() -> null otherwise, falling
    // through); the WITH-article form is unrestricted.
    {
      name: "meta-whatis",
      re: new RegExp(`^what\\s+(?:is|are)\\s+(?:(an?)\\s+)?(.+?)\\??$`, "i"),
      build: (m) => {
        const object = stripTrailingDiscourseTag(m[2].trim());
        if (!m[1] && !ENTITY_TO_TYPE[object.toLowerCase()]) return null;
        const objLower = object.toLowerCase();
        if (m[1] && ARTICLE_RELATION_CONTINUATIONS.some(
          (c) => objLower === c || objLower.startsWith(`${c} `)
        )) return null;
        return { shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: stripTrailingScopeFiller(object) };
      }
    },
    // T6 mention: "where is <term> mentioned/referenced" — the prose/mentions surface.
    // Tried BEFORE T7: T7's trailing marker is optional,
    // so without this ordering it would swallow the mention question and lose the
    // marker that distinguishes "locate the definition" from "list the prose mentions".
    {
      name: "mention",
      re: new RegExp(`^where\\s+(?:is|are|was|were)\\s+(.+?)\\s+(?:${MENTION_MARKERS.map(escapeRegex).join("|")})\\??$`, "i"),
      build: (m) => ({ shape: "mentions", entityType: null, modifier: "direct", kind: "mentions", object: m[1].trim() })
    },
    // T7 where: "where is <term> [defined|declared|located|implemented]" — definition
    // location off the site attribute / defining module. "where" starts no other
    // template, so precedence against T1-T5 is structural.
    {
      name: "where",
      re: new RegExp(`^where\\s+(?:is|are|was|were)\\s+(.+?)(?:\\s+(?:${WHERE_MARKERS.map(escapeRegex).join("|")}))?\\??$`, "i"),
      build: (m) => ({ shape: "where", entityType: null, modifier: "direct", kind: "where", object: m[1].trim() })
    },
    // T8 when: "when did <term> [last] change/touched/updated…" — temporal shape over
    // the touches edges + commit date attributes. The verb slot reuses VERB_ALT, but
    // only the touches family carries dates to answer with, so build() rejects any
    // other kind (returning null falls through — parseAnchored tolerates it) rather
    // than pretending "when did X import Y" has a temporal answer.
    {
      name: "when",
      re: new RegExp(`^when\\s+(?:did|does|do|was|were|is)\\s+(.+?)\\s+(?:last\\s+)?(${VERB_ALT})\\??$`, "i"),
      build: (m) => VERB_TO_KIND[m[2].toLowerCase()] === "touches" ? { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() } : null
    },
    // T9 commit-history NP: "the commit history of X" / "commit history for X" —
    // an NP form of T8's SAME "when did X change" intent; reuses shape="when"
    // verbatim so evaluation/rendering are byte-identical, only the recognizer
    // surface differs.
    {
      name: "commit-history",
      re: /^(?:the\s+)?commit\s+history\s+(?:of|for)\s+(.+?)\??$/i,
      build: (m) => ({ shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() })
    },
    // T10 cochange-partners NP: "cochange partners of X" — an NP form of the
    // existing "which modules cochange with X" verb-phrase shape (ask-vocab.mjs's
    // cochange verb table); reuses shape="reverse"/kind="cochange" so evaluation
    // is byte-identical.
    {
      name: "cochange-partners",
      re: /^co-?change\s+partners\s+(?:of|for|with)\s+(.+?)\??$/i,
      build: (m) => ({ shape: "reverse", entityType: "Module", modifier: "direct", kind: "cochange", object: m[1].trim() })
    }
  ];
  function parseAnchored(text) {
    for (const t of TEMPLATES) {
      const m = text.match(t.re);
      if (m) {
        const parsed = t.build(m);
        if (parsed) return parsed;
      }
    }
    return null;
  }
  var grammarStrategy = {
    id: "grammar",
    class: "graph-query",
    run(text) {
      const parsed = parseAnchored(text);
      return parsed ? { strategyId: "grammar", class: "graph-query", candidates: [{ parsed, confidence: 0.9 }] } : null;
    }
  };

  // src/interpret/strategies/keywords.mjs
  var PASSIVE_AUX = /* @__PURE__ */ new Set(["is", "are", "was", "were", "be", "been", "being", "get", "gets", "got"]);
  var WH_WORDS = /* @__PURE__ */ new Set(["which", "what", "who", "whom", "whose"]);
  var PLACEHOLDER_SET = new Set(PLACEHOLDER_NOUNS.map((w) => w.toLowerCase()));
  function findPhrase(lcWords, table, consumed = null) {
    const phrases = Object.keys(table).sort((a, b) => b.split(" ").length - a.split(" ").length);
    for (const p of phrases) {
      const pWords = p.split(" ");
      for (let i = 0; i <= lcWords.length - pWords.length; i += 1) {
        if (consumed && pWords.some((_, j) => consumed.has(i + j))) continue;
        if (pWords.every((w, j) => lcWords[i + j] === w)) return { kind: table[p], start: i, end: i + pWords.length };
      }
    }
    return null;
  }
  function parseKeywordSpot(text, nlp = null) {
    const words = text.replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
    const lcWords = words.map((w) => w.toLowerCase());
    if (lcWords.includes("where") && !findPhrase(lcWords, VERB_TO_KIND)) {
      const mention = lcWords.some((w) => MENTION_MARKERS.includes(w));
      const markers = /* @__PURE__ */ new Set([...WHERE_MARKERS, ...MENTION_MARKERS]);
      const objText = words.filter((w, i) => !STOPWORDS2.has(lcWords[i]) && !markers.has(lcWords[i])).join(" ").trim();
      if (objText) {
        const kind2 = mention ? "mentions" : "where";
        return { shape: kind2, entityType: null, modifier: "direct", kind: kind2, object: objText };
      }
    }
    const PERFECT_AUX = /* @__PURE__ */ new Set(["has", "have", "had"]);
    if (PERFECT_AUX.has(lcWords[0])) {
      let end = lcWords.length;
      while (end > 1 && (lcWords[end - 1] === "ever" || lcWords[end - 1] === "been")) end -= 1;
      const tailVerb = end > 1 ? VERB_TO_KIND[lcWords[end - 1]] : null;
      if (tailVerb === "touches") {
        const objText = words.slice(1, end - 1).filter((_, j) => !STOPWORDS2.has(lcWords[1 + j])).join(" ").trim();
        if (objText) return { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText };
      }
    }
    let canonWords = lcWords;
    let verbHit = findPhrase(lcWords, VERB_TO_KIND);
    if (!verbHit && nlp) {
      const lemmaWords = lcWords.map((w) => {
        if (!eligibleForCanon(w)) return w;
        const l = nlp.lemma(w);
        return VOCAB_WORDS.has(l) ? l : w;
      });
      verbHit = findPhrase(lemmaWords, VERB_TO_KIND);
      if (verbHit) canonWords = lemmaWords;
    }
    if (!verbHit) {
      const fuzzyWords = lcWords.map((w) => w.length >= 4 && eligibleForCanon(w) ? fuzzyVocabWord(w) || w : w);
      verbHit = findPhrase(fuzzyWords, VERB_TO_KIND);
      if (verbHit) canonWords = fuzzyWords;
    }
    if (!verbHit && lcWords.includes("by")) {
      for (let i = 0; i < lcWords.length; i += 1) {
        const k = PASSIVE_PARTICIPLE_TO_KIND[lcWords[i]];
        if (k && lcWords.slice(0, i).some((w) => PASSIVE_AUX.has(w))) {
          verbHit = { kind: k, start: i, end: i + 1 };
          break;
        }
      }
    }
    if (!verbHit) return null;
    if (nlp && verbHit.end - verbHit.start === 1) {
      const i = verbHit.start;
      const det = lcWords[i - 1];
      if ((det === "the" || det === "these" || det === "those") && lcWords[i + 1] === "of") {
        const tags = nlp.posTags(words);
        if (tags[i] === "NOUN") {
          const objText = words.slice(i + 2).filter((w, j) => !STOPWORDS2.has(lcWords[i + 2 + j])).join(" ").trim();
          if (objText) return { shape: "forward", entityType: null, modifier: "direct", kind: verbHit.kind, object: objText };
        }
      }
    }
    const consumed = /* @__PURE__ */ new Set();
    const mark = (hit) => {
      if (hit) for (let i = hit.start; i < hit.end; i += 1) consumed.add(i);
    };
    mark(verbHit);
    for (const [phrase, kind2] of Object.entries(VERB_TO_KIND)) {
      if (kind2 !== verbHit.kind) continue;
      const pWords = phrase.split(" ");
      const start = verbHit.end;
      if (pWords.every((w, j) => canonWords[start + j] === w)) {
        mark({ start, end: start + pWords.length });
        break;
      }
    }
    const entityHit = findPhrase(canonWords, ENTITY_TO_TYPE, consumed);
    mark(entityHit);
    const modifierHit = findPhrase(canonWords, MODIFIER_TO_KIND, consumed);
    mark(modifierHit);
    const sideText = (from, to) => words.slice(from, to).filter((_, j) => !consumed.has(from + j) && !STOPWORDS2.has(lcWords[from + j])).join(" ").trim();
    const beforeText = sideText(0, verbHit.start);
    const afterText = sideText(verbHit.end, words.length);
    const kind = verbHit.kind;
    const entityType = entityHit ? ENTITY_TO_TYPE[canonWords.slice(entityHit.start, entityHit.end).join(" ")] : null;
    const modifier = modifierHit ? MODIFIER_TO_KIND[canonWords.slice(modifierHit.start, modifierHit.end).join(" ")] : "direct";
    if (kind === "touches" && lcWords.includes("when")) {
      const objText = beforeText || afterText;
      if (objText) return { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText };
    }
    if (kind === "touches" && lcWords.includes("who") && lcWords.includes("last")) {
      const objText = beforeText || afterText;
      if (objText) return { shape: "whoLast", entityType: null, modifier: "direct", kind: "touches", object: objText };
    }
    const byIdx = lcWords.indexOf("by");
    const hasPassiveAux = lcWords.slice(0, verbHit.start).some((w) => PASSIVE_AUX.has(w));
    if (byIdx >= 0 && !consumed.has(byIdx) && hasPassiveAux) {
      const roleWords = [];
      for (let i = 0; i < words.length; i += 1) {
        const w = lcWords[i];
        if (consumed.has(i) || STOPWORDS2.has(w) || w === "by" || PASSIVE_AUX.has(w) || WH_WORDS.has(w) || PLACEHOLDER_SET.has(w)) continue;
        roleWords.push(words[i]);
      }
      const object = roleWords.join(" ").trim();
      if (object) {
        let nextAfterBy = null;
        for (let i = byIdx + 1; i < lcWords.length; i += 1) {
          if (lcWords[i] === "the" || lcWords[i] === "a" || lcWords[i] === "an") continue;
          nextAfterBy = lcWords[i];
          break;
        }
        const agentNamed = nextAfterBy != null && !WH_WORDS.has(nextAfterBy) && !ENTITY_TO_TYPE[nextAfterBy];
        return { shape: agentNamed ? "forward" : "reverse", entityType, modifier, kind, object };
      }
    }
    if (beforeText && afterText) {
      const verbPhrase = canonWords.slice(verbHit.start, verbHit.end).join(" ");
      let subject = beforeText;
      let object = afterText;
      if (INHERITS_REVERSE_VERBS.includes(verbPhrase)) [subject, object] = [object, subject];
      return { shape: "ask", entityType: null, modifier: "direct", kind, subject, object };
    }
    if (afterText) return { shape: "reverse", entityType, modifier, kind, object: afterText };
    if (kind === "inherits" && !beforeText && entityHit && entityHit.start === verbHit.end) {
      const entityText = canonWords.slice(entityHit.start, entityHit.end).join(" ");
      if (entityText) return { shape: "reverse", entityType: null, modifier, kind, object: entityText };
    }
    if (beforeText) return { shape: "forward", entityType, modifier: "direct", kind, object: beforeText };
    return null;
  }
  var keywordSpotStrategy = {
    id: "keyword-spot",
    class: "graph-query",
    run(text, ctx = {}) {
      const parsed = parseKeywordSpot(text, ctx.nlp || null);
      return parsed ? { strategyId: "keyword-spot", class: "graph-query", candidates: [{ parsed, confidence: 0.7 }] } : null;
    }
  };

  // src/interpret/strategies/noise-strip.mjs
  var KEEP = /* @__PURE__ */ new Set([
    ...STOPWORDS2,
    ...wordsOf(CONTEXT_PRONOUNS),
    ...wordsOf(Object.keys(VERB_TO_KIND)),
    ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
    ...wordsOf(Object.keys(MODIFIER_TO_KIND)),
    ...wordsOf(Object.keys(QUALIFIERS)),
    ...wordsOf(AGGREGATE_TRIGGERS),
    ...wordsOf(LIST_TRIGGERS),
    ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)),
    ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)),
    ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)),
    ...wordsOf(PLACEHOLDER_NOUNS),
    ...wordsOf(ANAPHORA_TRIGGERS),
    ...wordsOf(META_MEANING_VERBS),
    ...wordsOf(WHERE_MARKERS),
    ...wordsOf(MENTION_MARKERS),
    ...wordsOf(RELATIVE_PRONOUNS),
    ...wordsOf(Object.keys(CASCADE_SYNONYMS))
  ]);
  var CURATED_NOISE = /* @__PURE__ */ new Set([...wordsOf(FILLER_WORDS), ...wordsOf(CASCADE_NOISE)]);
  function maybeVerbNoiseWords(words, kept, nlp) {
    if (!nlp || typeof nlp.posTags !== "function" || !kept.length) return [];
    const keptSet = new Set(kept.map((w) => w.toLowerCase()));
    let tags;
    try {
      tags = nlp.posTags(words);
    } catch {
      return [];
    }
    const out = [];
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      const lc = w.toLowerCase();
      if (!/^[a-z]+$/.test(w) || KEEP.has(lc) || !keptSet.has(lc)) continue;
      if (tags[i] === "VERB") out.push(lc);
    }
    return out;
  }
  function stripNoise(text, nlp = null) {
    const words = splitWords(text);
    const kept = [];
    const dropped = [];
    for (const w of words) {
      const lc = w.toLowerCase();
      const strippable = /^[a-z]+$/.test(w) && !KEEP.has(lc) && (CURATED_NOISE.has(lc) || nlp && typeof nlp.isStopWord === "function" && nlp.isStopWord(lc));
      if (strippable) dropped.push(w);
      else kept.push(w);
    }
    const maybeNoise = maybeVerbNoiseWords(words, kept, nlp);
    return { text: kept.join(" "), dropped, maybeNoise };
  }
  var noiseStripStrategy = {
    id: "noise-strip",
    class: "noise-stripped",
    run(text, ctx = {}) {
      if (parseAnchored(text)) return null;
      const { text: stripped, dropped, maybeNoise } = stripNoise(text, ctx.nlp || null);
      if (!dropped.length || !stripped) return null;
      const parsed = parseAnchored(stripped) || parseKeywordSpot(stripped, ctx.nlp || null);
      if (!parsed) return null;
      if (maybeNoise.length && (parsed.shape === "where" || parsed.shape === "mentions") && parsed.object) {
        const altObject = parsed.object.split(/\s+/).filter((w) => !maybeNoise.includes(w.toLowerCase())).join(" ").trim();
        if (altObject && altObject !== parsed.object) parsed.altObject = altObject;
      }
      return {
        strategyId: "noise-strip",
        class: "noise-stripped",
        candidates: [{ parsed, confidence: 0.75, note: `noise-stripped to "${stripped}"` }]
      };
    }
  };

  // adapter-stub-strategies/ace.mjs:./strategies/ace.mjs
  var aceStrategy = void 0;

  // adapter-stub-strategies/constructions.mjs:./strategies/constructions.mjs
  var constructionsStrategy = void 0;

  // src/interpret/merge.mjs
  var DEFAULT_CONFIDENCE = 0.5;
  var cmpTerm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^(?:the|a|an)\s+/, "").replace(/^commit\s+(?=[0-9a-f]{7,40}$)/, "");
  var LEADING_DET_RE = /^\s*(?:the|a|an)\s+/i;
  var detCount = (p) => [p?.subject, p?.object].filter((t) => LEADING_DET_RE.test(String(t || ""))).length;
  function sameParse(p, q) {
    if (p.shape !== q.shape || p.kind !== q.kind) return false;
    if (p.shape === "ask") return cmpTerm(p.subject) === cmpTerm(q.subject) && cmpTerm(p.object) === cmpTerm(q.object);
    return cmpTerm(p.object) === cmpTerm(q.object);
  }
  var APPROXIMATE_VIAS = /* @__PURE__ */ new Set(["fuzzy", "lemma", "spell"]);
  var isApproximate = (c) => APPROXIMATE_VIAS.has(c.via);
  function mergeStrategyResults(results) {
    const valid = (results || []).filter((r) => r && Array.isArray(r.candidates) && r.candidates.length);
    if (!valid.length) return null;
    let flat = [];
    for (const r of valid) {
      for (const c of r.candidates) {
        if (!c || !c.parsed) continue;
        flat.push({
          parsed: c.parsed,
          confidence: typeof c.confidence === "number" ? c.confidence : DEFAULT_CONFIDENCE,
          note: c.note || null,
          via: c.via || null,
          strategyId: r.strategyId,
          class: r.class
        });
      }
    }
    if (flat.some((c) => !isApproximate(c))) flat = flat.filter((c) => !isApproximate(c));
    if (!flat.length) return null;
    const groups = /* @__PURE__ */ new Map();
    for (const c of flat) {
      if (!groups.has(c.class)) groups.set(c.class, []);
      groups.get(c.class).push(c);
    }
    const merged = [];
    for (const [cls, cands] of groups) {
      const distinct = [];
      for (const c of cands) {
        const dup = distinct.find((d) => sameParse(d.parsed, c.parsed) && d.via === c.via);
        if (dup) {
          dup.agreed += 1;
          dup.confidence = Math.max(dup.confidence, c.confidence);
          if (detCount(c.parsed) < detCount(dup.parsed)) dup.parsed = c.parsed;
          continue;
        }
        distinct.push({ ...c, agreed: 1 });
      }
      if (distinct.length) merged.push({ class: cls, candidates: distinct });
    }
    if (!merged.length) return null;
    const top = (g) => Math.max(...g.candidates.map((c) => c.confidence));
    let winner = merged[0];
    for (const g of merged) if (top(g) > top(winner)) winner = g;
    const parsed = winner.candidates.length === 1 ? winner.candidates[0].parsed : { ambiguousParse: true, candidates: winner.candidates.map((c) => c.parsed) };
    const alternates = merged.filter((g) => g !== winner).map((g) => g.candidates[0]).filter((a) => !winner.candidates.some((w) => sameParse(w.parsed, a.parsed)));
    return { class: winner.class, parsed, winner: winner.candidates[0], alternates };
  }
  function describeAlternate(p) {
    if (!p) return "something else";
    if (p.ambiguousParse) return "one of several readings";
    const obj = p.object ?? p.subject ?? "?";
    return `${p.kind} "${obj}"`;
  }
  function alternateLines(alternates, { describe = describeAlternate, answerFor = null } = {}) {
    return (alternates || []).map((a) => {
      const meaning = a.note || describe(a.parsed);
      const tail = answerFor && answerFor(a) || "ask it that way";
      return `if you mean ${meaning} then ${tail}`;
    });
  }

  // src/interpret/pipeline.mjs
  var OPTIONAL_STRATEGIES = [
    ...typeof aceStrategy !== "undefined" ? [aceStrategy] : [],
    // eslint-disable-next-line no-undef
    ...typeof constructionsStrategy !== "undefined" ? [constructionsStrategy] : []
  ];
  var STRATEGIES = [grammarStrategy, keywordSpotStrategy, noiseStripStrategy, ...OPTIONAL_STRATEGIES];
  function runStrategiesSync(text, ctx = {}, strategies = STRATEGIES) {
    const results = [];
    for (const s of strategies) {
      try {
        const r = s.run(text, ctx);
        if (r && typeof r.then !== "function") results.push(r);
      } catch {
      }
    }
    return results;
  }

  // node-stub:node:crypto
  var unavailable5 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire5 = unavailable5("createRequire");
  var readFileSync5 = unavailable5("readFileSync");
  var writeFileSync5 = unavailable5("writeFileSync");
  var readFile5 = unavailable5("readFile");
  var writeFile5 = unavailable5("writeFile");
  var appendFile5 = unavailable5("appendFile");
  var mkdir5 = unavailable5("mkdir");
  var mkdtemp5 = unavailable5("mkdtemp");
  var rename5 = unavailable5("rename");
  var unlink5 = unavailable5("unlink");
  var rm5 = unavailable5("rm");
  var stat5 = unavailable5("stat");
  var access5 = unavailable5("access");
  var copyFile5 = unavailable5("copyFile");
  var readdir5 = unavailable5("readdir");
  var createReadStream5 = unavailable5("createReadStream");
  var createWriteStream5 = unavailable5("createWriteStream");
  var randomBytes5 = unavailable5("randomBytes");
  var createHash5 = unavailable5("createHash");
  var createRequireFromPath5 = unavailable5("createRequireFromPath");
  var spawnSync5 = unavailable5("spawnSync");
  var createInterface5 = unavailable5("createInterface");
  var createServer5 = unavailable5("createServer");
  var DatabaseSync5 = unavailable5("DatabaseSync");

  // src/answer-variants.mjs
  var import_meta = {};
  var DATA_FILE = join(dirname(fileURLToPath(import_meta.url)), "answer-variants.json");
  var dataCache;
  function loadData() {
    if (dataCache !== void 0) return dataCache;
    try {
      dataCache = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    } catch {
      dataCache = null;
    }
    return dataCache;
  }
  function pickPhrase(poolId, key, base) {
    if (!key) return base;
    const data = loadData();
    const variants = data?.pools?.[poolId]?.variants;
    if (!Array.isArray(variants) || !variants.length) return base;
    const forms = [base, ...variants];
    const digest = createHash5("sha256").update(`${poolId}:${String(key)}`).digest();
    const idx = digest[0] % forms.length;
    return forms[idx];
  }

  // adapter-stub-ask-nlp.mjs:./ask-nlp.mjs
  var nlpAdapter2 = void 0;

  // src/ask.mjs
  var askEdgesOfKindCache = /* @__PURE__ */ new WeakMap();
  function edgesOfKind2(graph, kind) {
    let byKind = askEdgesOfKindCache.get(graph);
    if (!byKind) {
      byKind = /* @__PURE__ */ new Map();
      askEdgesOfKindCache.set(graph, byKind);
    }
    const cached = byKind.get(kind);
    if (cached) return cached;
    const out = [];
    for (const g of graph.relations) {
      if (relationKind(g) !== kind) continue;
      for (const e of g.edges) out.push(e);
    }
    byKind.set(kind, out);
    return out;
  }
  var SYMBOL_GRAIN_SIBLING = { calls: "callsSymbol", touches: "touchesSymbol" };
  var FINE_ENTITY_TYPES = /* @__PURE__ */ new Set(["Function", "Method", "Class", "Attribute", "GlobalVariable"]);
  var FINE_CLASS_SIBLING = { Function: "Method", Method: "Function" };
  var KIND_UNIONS = { uses: ["imports", "calls", "callsSymbol"] };
  var kindsFor = (kind) => KIND_UNIONS[kind] || [kind];
  var OVERFLOW_CAP = 12;
  var PLURAL_FORMS = {
    Function: ["function", "functions"],
    Method: ["method", "methods"],
    Class: ["class", "classes"],
    Module: ["module", "modules"],
    Attribute: ["attribute", "attributes"],
    GlobalVariable: ["variable", "variables"],
    Commit: ["commit", "commits"],
    Change: ["change", "changes"],
    Fact: ["fact", "facts"],
    Utterance: ["utterance", "utterances"],
    Session: ["session", "sessions"],
    Source: ["source", "sources"],
    Rule: ["rule", "rules"]
  };
  function nounFor(entityType, n) {
    const [s, p] = PLURAL_FORMS[entityType] || ["result", "results"];
    return n === 1 ? s : p;
  }
  function classDisplayName(cls) {
    const s = String(cls || "");
    if (typeof splitIdentifierWords === "function") {
      const words = splitIdentifierWords(s).join(" ");
      if (words) return words;
    }
    return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  }
  var REVERSE_MISS_VERB = { cochange: "cochanges", reexports: "export" };
  function verbFor(kind) {
    return REVERSE_MISS_VERB[kind] || kind;
  }
  var LEADING_RELATION_VERB_RE = new RegExp(
    `^(?:${Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:s|ing|ed)?\\s+`,
    "i"
  );
  function defaultNlp() {
    return typeof nlpAdapter2 === "function" ? nlpAdapter2() : null;
  }
  var FROZEN_META_AMBIGUOUS_TERMS = /* @__PURE__ */ new Set(["imports"]);
  function pruneSpuriousMeaningAmbiguity(parsed) {
    if (!parsed?.ambiguousParse || !Array.isArray(parsed.candidates) || parsed.candidates.length !== 2) return parsed;
    const metaC = parsed.candidates.find((c) => c?.shape === "meta");
    const other = parsed.candidates.find((c) => c !== metaC);
    if (!metaC || !other) return parsed;
    const term = String(metaC.object || "").trim().toLowerCase();
    if (!term || FROZEN_META_AMBIGUOUS_TERMS.has(term)) return parsed;
    const otherObject = String(other.object || "").trim().toLowerCase();
    if (!wordsOf(META_MEANING_VERBS).includes(otherObject)) return parsed;
    return metaC;
  }
  function parseQuery(query, { nlp = void 0 } = {}) {
    return parseQueryFull(query, { nlp }).parsed;
  }
  function parseQueryFull(query, { nlp = void 0 } = {}) {
    const adapter = nlp === void 0 ? defaultNlp() : nlp;
    const raw = String(query || "").trim().replace(/\s+/g, " ");
    if (!raw) return { parsed: null, alternates: [], class: null };
    const text = applyPhrasingFrames(applyNegationFrames(normalizeQuery(raw)));
    if (!text) return { parsed: null, alternates: [], class: null };
    const composite = parseComposite(text, adapter);
    if (composite) return { parsed: composite, alternates: [], class: null };
    const merged = mergeStrategyResults(runStrategiesSync(text, { nlp: adapter, raw }));
    if (!merged) return { parsed: null, alternates: [], class: null };
    return {
      parsed: pruneSpuriousMeaningAmbiguity(merged.parsed),
      alternates: merged.alternates || [],
      class: merged.class || null
    };
  }
  var MAX_COMPOSE_DEPTH = 4;
  var NEST_SENTINEL = "zzinnerset";
  var PRED_LEAD_SKIP = /* @__PURE__ */ new Set(["that", "which", "who", "are", "is", "was", "were", "do", "does", "also", "still", "both", "and", "then", "though"]);
  var FRAME_WORDS = /* @__PURE__ */ new Set(["which", "what", "who", "list", "show", "find", "give", "me", "us", "all"]);
  var COPULA_WORDS = /* @__PURE__ */ new Set(["are", "is", "was", "were"]);
  function dropLeadCopula(bw, blc) {
    return blc.length && COPULA_WORDS.has(blc[0]) ? { bw: bw.slice(1), blc: blc.slice(1) } : { bw, blc };
  }
  var entityNoun = (w) => ENTITY_TO_TYPE[w] ? { entityType: ENTITY_TO_TYPE[w], placeholder: false } : PLACEHOLDER_NOUNS.includes(w) ? { entityType: null, placeholder: true } : null;
  var isGerundVerb = (w) => !!VERB_TO_KIND[w] && w.endsWith("ing");
  function parseSimpleClause(text, nlp) {
    return parseAnchored(text) || parseKeywordSpot(text, nlp);
  }
  function parseComposite(text, nlp) {
    const w = splitWords(text);
    const lc = w.map((x) => x.toLowerCase());
    return parseExistence(w, lc) || parseQualifierCheck(w, lc) || parseNegation(text, nlp, 0) || parseForwardNegation(w, lc, nlp) || parseTemporal(w, lc, nlp, 0) || parseCommitFilter(w, lc) || parseAnaphora(w, lc, nlp) || parseAggregate(w, lc, nlp) || parseSuperlative(w, lc, nlp) || parseFind(w, lc, nlp, 0) || parseList(w, lc, nlp, 0) || parseNested(w, lc, nlp, 0) || parsePluralAnaphoraObject(w, lc, nlp) || parseRelationalOrQualified(w, lc, nlp, 0);
  }
  function complementAst(entityType, diffAtom) {
    return {
      node: "boolean",
      entityType,
      atoms: [
        { op: "seed", kind: "set", ast: { node: "allOfClass", entityType } },
        diffAtom
      ]
    };
  }
  function parseNegation(text, nlp, depth = 0) {
    const neg = matchNegationSet(text);
    if (!neg) return null;
    const noun = entityNoun(neg.entWord);
    if (!noun || noun.placeholder || !noun.entityType) return null;
    const entityType = noun.entityType;
    if (entityType === "Change") {
      return { node: "miss", reason: `"${neg.entWord}" isn't an enumerable kind \u2014 a set complement needs a concrete kind (functions, classes, modules, \u2026)` };
    }
    const predWords = splitWords(neg.predicate);
    const predLc = predWords.map((x) => x.toLowerCase());
    if (predLc.length && predLc.every((x) => QUALIFIERS[x])) {
      return complementAst(entityType, { op: "difference", kind: "qual", filters: predLc });
    }
    const vh = findPhrase(predLc, VERB_TO_KIND);
    if (!vh) return { node: "miss", reason: "a negated set query needs a known relation verb (import, call, inherit from, test, \u2026)" };
    const objWords = predWords.filter((_, i) => (i < vh.start || i >= vh.end) && !STOPWORDS2.has(predLc[i]) && predLc[i] !== "from");
    if (!objWords.length) {
      return complementAst(entityType, { op: "difference", kind: "set", ast: { node: "existsEdge", entityType, kind: vh.kind } });
    }
    const positive = parseSetPhrase(`which ${neg.entWord} ${neg.predicate}`, nlp, depth + 1);
    if (!positive || positive.node === "miss") {
      return { node: "miss", reason: positive && positive.reason || "the negated clause didn't parse" };
    }
    return complementAst(entityType, { op: "difference", kind: "set", ast: positive });
  }
  var FWD_NEG_FRAME = /* @__PURE__ */ new Set(["what", "which", "thing", "things", "one", "ones", "stuff"]);
  function parseForwardNegation(w, lc, nlp) {
    let i = 0;
    while (i < lc.length && FWD_NEG_FRAME.has(lc[i])) i += 1;
    if (!["do", "does", "did"].includes(lc[i])) return null;
    i += 1;
    const rest = w.slice(i);
    const restLc = lc.slice(i);
    const notIdx = restLc.indexOf("not");
    if (notIdx < 0) return null;
    const vh = findPhrase(restLc, VERB_TO_KIND);
    if (!vh) return null;
    const subjTokens = rest.filter((_, j) => j !== notIdx && (j < vh.start || j >= vh.end) && restLc[j] !== "from" && !STOPWORDS2.has(restLc[j]));
    const subjectTerm = subjTokens.join(" ").trim();
    if (!subjectTerm) return null;
    return { node: "forwardComplement", kind: vh.kind, subjectTerm };
  }
  function classesForKinds(graph, kinds) {
    const classes = /* @__PURE__ */ new Set();
    for (const k of kinds) {
      for (const e of edgesOfKind2(graph, k)) {
        const o = graph.byId.get(e.object);
        if (o && o.class) classes.add(o.class);
      }
    }
    return classes;
  }
  function kindObjectClass(graph, kind) {
    const classes = classesForKinds(graph, kindsFor(kind));
    return classes.size === 1 ? [...classes][0] : null;
  }
  function parseSetPhrase(text, nlp, depth) {
    if (depth > MAX_COMPOSE_DEPTH) return { node: "miss", reason: "too deep to resolve" };
    const negated = parseNegation(text, nlp, depth);
    if (negated) return negated;
    const w = splitWords(text);
    const lc = w.map((x) => x.toLowerCase());
    const nested = parseNested(w, lc, nlp, depth);
    if (nested) return nested;
    const rel = parseRelationalOrQualified(w, lc, nlp, depth);
    if (rel) return rel;
    const clause = parseSimpleClause(text, nlp);
    if (clause) return { node: "clause", clause };
    return null;
  }
  function parseNested(w, lc, nlp, depth) {
    for (let r = 1; r < lc.length; r += 1) {
      const isPronoun = RELATIVE_PRONOUNS.includes(lc[r]);
      const isGerundMarker = !isPronoun && isGerundVerb(lc[r]);
      if (!isPronoun && !isGerundMarker) continue;
      if (isPronoun && r + 1 >= lc.length) continue;
      const noun = entityNoun(lc[r - 1]);
      if (!noun) continue;
      const head = w.slice(0, r - 1);
      if (!head.length) continue;
      const outer = parseSimpleClause([...head, NEST_SENTINEL].join(" "), nlp);
      if (!outer || outer.shape !== "reverse" && outer.shape !== "forward") continue;
      if (outer.modifier && outer.modifier !== "direct") continue;
      const innerText = `which ${lc[r - 1]} ${w.slice(isPronoun ? r + 1 : r).join(" ")}`;
      const inner = parseSetPhrase(innerText, nlp, depth + 1);
      if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "inner clause didn't parse" } : { node: "miss", reason: "inner clause didn't parse" };
      return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner };
    }
    return null;
  }
  var PLURAL_ANAPHORA_OBJECT = /* @__PURE__ */ new Set(["those", "them"]);
  function parsePluralAnaphoraObject(w, lc, nlp) {
    for (let i = 0; i < lc.length; i += 1) {
      if (!PLURAL_ANAPHORA_OBJECT.has(lc[i])) continue;
      if (lc[i - 1] === "of") continue;
      const isTerminal = i === lc.length - 1;
      const leadsAVerb = i + 1 < lc.length && !!VERB_TO_KIND[lc[i + 1]];
      if (!isTerminal && !leadsAVerb) continue;
      const head = [...w.slice(0, i), NEST_SENTINEL, ...w.slice(i + 1)];
      const outer = parseSimpleClause(head.join(" "), nlp);
      if (!outer || outer.shape !== "reverse" && outer.shape !== "forward") continue;
      if (outer.object !== NEST_SENTINEL) continue;
      if (outer.modifier && outer.modifier !== "direct") continue;
      return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner: { node: "prevSet" } };
    }
    return null;
  }
  var TEMPORAL_AUX = /* @__PURE__ */ new Set(["did", "was", "were", "do", "does", "has", "have", "had"]);
  var TEMPORAL_TAIL = /* @__PURE__ */ new Set([
    "change",
    "changed",
    "changes",
    "update",
    "updated",
    "updates",
    "modify",
    "modified",
    "modifies",
    "touch",
    "touched",
    "touches",
    "edit",
    "edited",
    "revise",
    "revised"
  ]);
  var TEMPORAL_TRAIL_FILLER = /* @__PURE__ */ new Set(["last", "recently", "ever", "get", "got", "been", "then", "now", "already"]);
  var TEMPORAL_DET = /* @__PURE__ */ new Set(["the", "a", "an", "all", "those", "these", "any"]);
  function parseTemporal(w, lc, nlp, depth = 0) {
    if (lc[0] !== "when") return null;
    let i = 1;
    if (!TEMPORAL_AUX.has(lc[i])) return null;
    i += 1;
    let t = -1;
    for (let k = lc.length - 1; k >= i; k -= 1) {
      if (TEMPORAL_TAIL.has(lc[k])) {
        t = k;
        break;
      }
    }
    if (t < 0) return null;
    let subjWords = w.slice(i, t);
    let subjLc = lc.slice(i, t);
    while (subjLc.length && TEMPORAL_TRAIL_FILLER.has(subjLc[subjLc.length - 1])) {
      subjWords = subjWords.slice(0, -1);
      subjLc = subjLc.slice(0, -1);
    }
    while (subjLc.length && TEMPORAL_DET.has(subjLc[0])) {
      subjWords = subjWords.slice(1);
      subjLc = subjLc.slice(1);
    }
    if (!subjWords.length) return null;
    if (!subjLc.some((x) => RELATIVE_PRONOUNS.includes(x))) return null;
    const framed = FRAME_WORDS.has(subjLc[0]) ? subjWords.join(" ") : `which ${subjWords.join(" ")}`;
    const inner = parseSetPhrase(framed, nlp, depth + 1);
    if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "the inner set of the temporal query didn't parse" } : { node: "miss", reason: "the inner set of the temporal query didn't parse" };
    const noun = entityNoun(subjLc[0]);
    return { node: "temporal", inner, entityType: noun && noun.entityType || null };
  }
  var COMMIT_FILTER_OPS = /* @__PURE__ */ new Set(["since", "before", "after", "on"]);
  function parseCommitFilter(w, lc) {
    if (lc[0] !== "what" || lc[1] !== "changed") return null;
    let i = 2;
    if (lc[i] === "ever") i += 1;
    if (!COMMIT_FILTER_OPS.has(lc[i])) return null;
    const op = lc[i];
    const pivotRaw = w.slice(i + 1).join(" ").trim();
    if (!pivotRaw) return { node: "miss", reason: `"what changed ${op}" needs a date or commit afterward` };
    return { node: "commitFilter", op, pivotRaw };
  }
  var ANAPHORA_NAME_TOKEN_RE = /\b[\w-]+(?:[/.][\w-]+)+\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/;
  function inSentenceNameTokens(words) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of words) {
      if (!raw || !ANAPHORA_NAME_TOKEN_RE.test(raw)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
    }
    return out;
  }
  function parseAnaphora(w, lc, nlp) {
    if (lc.length === 2 && lc[0] === "which" && (lc[1] === "ones" || lc[1] === "one")) {
      return { node: "anaphora", mode: "list", filter: { type: "all" } };
    }
    let p = -1;
    let viaOf = false;
    for (let i = 1; i < lc.length; i += 1) {
      if (!ANAPHORA_TRIGGERS.includes(lc[i])) continue;
      if (lc[i - 1] === "of") {
        p = i;
        viaOf = true;
        break;
      }
      const headSoFar = lc.slice(0, i).join(" ");
      if (i === lc.length - 1 && (AGGREGATE_TRIGGERS.includes(headSoFar) || LIST_TRIGGERS.includes(headSoFar))) {
        p = i;
        break;
      }
    }
    if (p < 0) return null;
    const head = (viaOf ? lc.slice(0, p - 1) : lc.slice(0, p)).join(" ");
    const mode = AGGREGATE_TRIGGERS.includes(head) || /^(how many|how much|count|number|quantity|total)\b/.test(head) ? "count" : "list";
    const filter = parsePredicateFilter(w.slice(p + 1), nlp);
    if (filter === void 0) return { node: "miss", reason: "the follow-up filter didn't parse" };
    const cutIdx = viaOf ? p - 1 : p;
    const candidateTerms = inSentenceNameTokens(w.slice(0, cutIdx));
    const ast = { node: "anaphora", mode, filter };
    if (candidateTerms.length >= 2) ast.candidateTerms = candidateTerms;
    return ast;
  }
  function parsePredicateFilter(words, nlp) {
    let i = 0;
    const lc = words.map((x) => x.toLowerCase());
    while (i < lc.length && PRED_LEAD_SKIP.has(lc[i])) i += 1;
    const rest = words.slice(i);
    const restLc = lc.slice(i);
    if (!rest.length) return { type: "all" };
    if (restLc.every((x) => QUALIFIERS[x])) return { type: "qual", filters: restLc };
    const clause = parseSimpleClause(`what ${rest.join(" ")}`, nlp);
    if (clause && (clause.shape === "reverse" || clause.shape === "forward") && clause.object) {
      return { type: "clause", clause };
    }
    return void 0;
  }
  function parseExistence(w, lc) {
    let i;
    if (lc[0] === "is" && lc[1] === "there") i = 2;
    else if (lc[0] === "are" && lc[1] === "there") i = 2;
    else return null;
    const article = lc[i];
    if (article === "a" || article === "an" || article === "any") i += 1;
    else return null;
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun || noun.placeholder || !noun.entityType) return null;
    const entityType = noun.entityType;
    i += 1;
    let rest = lc.slice(i);
    let restW = w.slice(i);
    if (rest.length && rest[rest.length - 1] === "anywhere") {
      rest = rest.slice(0, -1);
      restW = restW.slice(0, -1);
    } else if (rest.length >= 2 && rest[rest.length - 2] === "at" && rest[rest.length - 1] === "all") {
      rest = rest.slice(0, -2);
      restW = restW.slice(0, -2);
    }
    if (!rest.length) return { node: "exists", entityType, term: null, scopeModule: null };
    if (rest[0] === "called" || rest[0] === "named") {
      if (rest.length < 2) return { node: "miss", reason: `"${rest[0]}" needs a name afterward` };
      const inIdx = rest.indexOf("in", 1);
      if (inIdx > 0) {
        const term2 = restW.slice(1, inIdx).join(" ").trim();
        const scopeModule = restW.slice(inIdx + 1).join(" ").trim();
        if (!term2 || !scopeModule) return { node: "miss", reason: `a named existence check needs both a name and a module after "in"` };
        return { node: "exists", entityType, term: term2, scopeModule };
      }
      const term = restW.slice(1).join(" ").trim();
      return term ? { node: "exists", entityType, term, scopeModule: null } : { node: "miss", reason: `"${rest[0]}" needs a name afterward` };
    }
    if (rest[0] === "in") {
      const scopeModule = restW.slice(1).join(" ").trim();
      return scopeModule ? { node: "exists", entityType, term: null, scopeModule } : { node: "miss", reason: `"in" needs a module afterward` };
    }
    return null;
  }
  function parseQualifierCheck(w, lc) {
    if (lc[0] !== "is" && lc[0] !== "are") return null;
    if (lc[1] === "there") return null;
    let qualIdx = -1;
    let negated = false;
    for (let i = 1; i < lc.length; i += 1) {
      if (QUALIFIERS[lc[i]]) {
        qualIdx = i;
        negated = lc[i - 1] === "not";
        break;
      }
    }
    if (qualIdx < 0) return null;
    let termStart = 1;
    if (lc[termStart] === "the") termStart += 1;
    let termEnd = negated ? qualIdx - 1 : qualIdx;
    if (termEnd > termStart && (lc[termEnd - 1] === "a" || lc[termEnd - 1] === "an")) termEnd -= 1;
    const term = termEnd > termStart ? w.slice(termStart, termEnd).join(" ").trim() : "";
    if (!term) return { node: "miss", reason: `"is/are <qualifier>" needs a named thing to check first` };
    return { node: "qualCheck", term, qualifier: lc[qualIdx], negated };
  }
  var AGG_TAIL_FILLER = /* @__PURE__ */ new Set([
    "total",
    "altogether",
    "overall",
    "exist",
    "exists",
    "existing",
    "present",
    "here",
    "now",
    "currently",
    "graph",
    "index",
    "codebase",
    "repo",
    "repository",
    "this",
    "that"
  ]);
  function parseAggregate(w, lc, nlp) {
    const trig = AGGREGATE_TRIGGERS.find((t) => lc.slice(0, t.split(" ").length).join(" ") === t);
    if (!trig) return null;
    let i = trig.split(" ").length;
    while (i < lc.length && (lc[i] === "the" || lc[i] === "a" || lc[i] === "all")) i += 1;
    const quals = [];
    while (i < lc.length && QUALIFIERS[lc[i]]) {
      quals.push(lc[i]);
      i += 1;
    }
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun) return { node: "miss", reason: "count needs a known entity kind (functions, classes, modules, \u2026)" };
    const entWord = lc[i];
    i += 1;
    const tail = w.slice(i);
    const tailMeaningful = lc.slice(i).some((t) => !STOPWORDS2.has(t) && !AGG_TAIL_FILLER.has(t));
    let base;
    if (tailMeaningful) {
      const setAst = parseSetPhrase(`which ${entWord} ${tail.join(" ")}`, nlp, 1);
      if (!setAst || setAst.node === "miss") return { node: "miss", reason: "the count restrictor didn't parse" };
      base = setAst;
    } else {
      base = { node: "allOfClass", entityType: noun.entityType };
    }
    if (quals.length) base = { node: "qualifier", filters: quals, inner: base };
    return { node: "count", entityType: noun.entityType, base };
  }
  var LIST_SKIP = /* @__PURE__ */ new Set(["the", "a", "an", "all", "me", "us"]);
  var LIST_TRIGGERS_SORTED = [...LIST_TRIGGERS].sort((a, b) => b.split(" ").length - a.split(" ").length);
  var LISTABLE_KINDS = "functions, classes, methods, modules, attributes, variables, or commits";
  var SCOPE_PREPOSITIONS = /* @__PURE__ */ new Set(["in", "inside", "under"]);
  function parseList(w, lc, nlp, depth) {
    let i = 0;
    let interrogative = false;
    let matched = null;
    for (const t of LIST_TRIGGERS_SORTED) {
      const tw = t.split(" ");
      if (lc.slice(0, tw.length).join(" ") === t) {
        matched = t;
        i = tw.length;
        break;
      }
    }
    if (!matched) {
      if (lc[0] === "what" || lc[0] === "which") {
        interrogative = true;
        i = 1;
      } else return null;
    }
    while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
    const quals = [];
    while (i < lc.length && QUALIFIERS[lc[i]]) {
      quals.push(lc[i]);
      i += 1;
    }
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun || noun.placeholder || noun.entityType === "Change") {
      if (!interrogative && i < lc.length && i === lc.length - 1 && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
        return { node: "miss", reason: `"${lc[i]}" isn't a listable kind \u2014 try ${LISTABLE_KINDS}` };
      }
      return null;
    }
    const entityType = noun.entityType;
    const entWord = lc[i];
    i += 1;
    const tail = w.slice(i);
    const tailMeaningful = lc.slice(i).some((t) => !STOPWORDS2.has(t) && !AGG_TAIL_FILLER.has(t));
    let scopeTailLc = lc.slice(i);
    let scopeTailWords = tail;
    if (scopeTailLc[0] === "is" || scopeTailLc[0] === "are") {
      scopeTailLc = scopeTailLc.slice(1);
      scopeTailWords = scopeTailWords.slice(1);
    }
    const scopedException = interrogative && SCOPE_PREPOSITIONS.has(scopeTailLc[0]);
    if (interrogative && (tailMeaningful && !scopedException || tail.length === 0)) return null;
    let base;
    let scoped = false;
    if (tailMeaningful) {
      const useTail = scopedException ? scopeTailWords : tail;
      const setAst = parseSetPhrase(`which ${[...quals, entWord, ...useTail].join(" ")}`, nlp, (depth || 0) + 1);
      if (!setAst || setAst.node === "miss") return { node: "miss", reason: setAst && setAst.reason || "the list filter didn't parse" };
      base = setAst;
      scoped = true;
    } else {
      base = { node: "allOfClass", entityType };
      if (quals.length) base = { node: "qualifier", filters: quals, inner: base };
    }
    return { node: "list", entityType, base, scoped };
  }
  function parseSuperlative(w, lc, nlp) {
    let ext = null;
    let extIdx = -1;
    for (let i = 0; i < lc.length; i += 1) {
      const two = lc.slice(i, i + 2).join(" ");
      if (SUPERLATIVE_EXTREMES[two]) {
        ext = SUPERLATIVE_EXTREMES[two];
        extIdx = i;
        break;
      }
      if (SUPERLATIVE_EXTREMES[lc[i]]) {
        ext = SUPERLATIVE_EXTREMES[lc[i]];
        extIdx = i;
        break;
      }
    }
    if (!ext) return null;
    let metric = null;
    let metricNoun = null;
    for (let i = extIdx; i < lc.length; i += 1) {
      if (EDGE_NOUN_TO_METRIC[lc[i]]) {
        metric = EDGE_NOUN_TO_METRIC[lc[i]];
        metricNoun = lc[i];
        break;
      }
    }
    if (!metric) {
      for (let i = extIdx - 1; i >= 0; i -= 1) {
        if (EDGE_NOUN_TO_METRIC[lc[i]]) {
          metric = EDGE_NOUN_TO_METRIC[lc[i]];
          metricNoun = lc[i];
          break;
        }
      }
    }
    const connectivity = lc.includes("connected") || lc.slice(extIdx, extIdx + 2).join(" ") === "most connected" || ["largest", "biggest", "smallest"].includes(lc[extIdx]);
    if (!metric && connectivity) {
      metric = EDGE_NOUN_TO_METRIC.connections;
      metricNoun = "connections";
    }
    let entityType;
    let entWord = null;
    for (const x of lc) {
      const n = entityNoun(x);
      if (n && !n.placeholder) {
        entityType = n.entityType;
        entWord = x;
        break;
      }
    }
    if (!entWord) {
      entityType = metricNoun ? METRIC_IMPLIES_ENTITY[metricNoun] : void 0;
      if (!entityType) return { node: "miss", reason: "a superlative needs an entity kind (module, class, function, \u2026)" };
    }
    if (!metric) return { node: "miss", reason: "name what to rank by (imports, callers, methods, tests, or connections)" };
    return { node: "superlative", entityType, metric, metricNoun, extreme: ext };
  }
  var FIND_LINKERS = /* @__PURE__ */ new Set(["called", "named", "about", "like", "containing", "matching", "with"]);
  function parseFind(w, lc, nlp, depth) {
    if (lc[0] !== "find") return null;
    let i = 1;
    while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
    if (i >= lc.length) return null;
    const leadNoun = entityNoun(lc[i]);
    if (leadNoun && !leadNoun.placeholder && leadNoun.entityType !== "Change" && i + 1 < lc.length && FIND_LINKERS.has(lc[i + 1])) {
      const term = w.slice(i + 2).join(" ").trim();
      if (term) return { node: "find", entityType: leadNoun.entityType, term };
    }
    const lastNoun = entityNoun(lc[lc.length - 1]);
    if (lastNoun && !lastNoun.placeholder && lastNoun.entityType !== "Change") {
      const term = w.slice(i, lc.length - 1).join(" ").trim();
      if (term) return { node: "find", entityType: lastNoun.entityType, term };
    }
    if (lc.some((t) => RELATIVE_PRONOUNS.includes(t))) return null;
    if (i === lc.length - 1 && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
      return { node: "miss", reason: `"${lc[i]}" isn't a listable kind \u2014 try ${LISTABLE_KINDS}` };
    }
    return null;
  }
  function parseFindPredicateHead(w, lc) {
    if (lc[0] !== "find") return null;
    let i = 1;
    while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
    let r = -1;
    for (let k = i + 1; k < lc.length; k += 1) {
      if (RELATIVE_PRONOUNS.includes(lc[k])) {
        r = k;
        break;
      }
    }
    if (r < 0) return null;
    const noun = entityNoun(lc[r - 1]);
    if (!noun || noun.placeholder || noun.entityType === "Change") return null;
    const term = w.slice(i, r - 1).join(" ").trim();
    if (!term) return null;
    return { entityType: noun.entityType, term, relIdx: r };
  }
  function buildPredicateAtoms(entityType, subjPrefix, predLc, predWords, nlp, depth) {
    const { branches, ops } = splitBoolean(predLc, predWords);
    let prevVerb = null;
    const atoms = [];
    for (let b = 0; b < branches.length; b += 1) {
      const bw = branches[b];
      const blc = bw.map((x) => x.toLowerCase());
      const op = b === 0 ? "intersection" : ops[b - 1];
      const qc = dropLeadCopula(bw, blc);
      if (qc.blc.length && qc.blc.every((x) => QUALIFIERS[x])) {
        atoms.push({ op, kind: "qual", filters: qc.blc });
        continue;
      }
      if (blc[0] === "of" || blc[0] === "in") {
        atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
        continue;
      }
      let phrase = bw;
      const vh = findPhrase(blc, VERB_TO_KIND);
      if (vh) prevVerb = bw.slice(vh.start, vh.end);
      else if (prevVerb) phrase = [...prevVerb, ...bw];
      const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth);
      if (!ast || ast.node === "miss") return { miss: ast && ast.reason || "a clause in the combination didn't parse" };
      atoms.push({ op, kind: "set", ast });
    }
    return { atoms };
  }
  var RECENT_COMMIT_LEAD = /* @__PURE__ */ new Set(["recent", "latest", "newest"]);
  function parseRelationalOrQualified(w, lc, nlp, depth) {
    const findHead = parseFindPredicateHead(w, lc);
    if (findHead) {
      const { entityType: entityType2, term, relIdx } = findHead;
      const predLc2 = lc.slice(relIdx + 1);
      const predWords2 = w.slice(relIdx + 1);
      if (!predLc2.length) return { node: "miss", reason: `a relative clause needs a predicate after "${lc[relIdx]}"` };
      const built = buildPredicateAtoms(entityType2, `which ${lc[relIdx - 1]}`, predLc2, predWords2, nlp, depth + 1);
      if (built.miss) return { node: "miss", reason: built.miss };
      const atoms2 = [{ op: "seed", kind: "set", ast: { node: "find", entityType: entityType2, term } }, ...built.atoms];
      return atoms2.length === 1 ? atoms2[0].ast : { node: "boolean", entityType: entityType2, atoms: atoms2 };
    }
    let i = 0;
    while (i < lc.length && FRAME_WORDS.has(lc[i])) i += 1;
    const framed = i > 0;
    const quals = [];
    while (i < lc.length && QUALIFIERS[lc[i]]) {
      quals.push(lc[i]);
      i += 1;
    }
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun) {
      const nextNoun = i + 1 < lc.length ? entityNoun(lc[i + 1]) : null;
      if (RECENT_COMMIT_LEAD.has(lc[i]) && nextNoun && nextNoun.entityType === "Commit" && i + 2 === lc.length) {
        return { node: "recentCommits" };
      }
      if (COPULA_WORDS.has(lc[i])) {
        let j = i + 1;
        if (j < lc.length && (lc[j] === "the" || lc[j] === "a" || lc[j] === "an")) j += 1;
        const leadNoun = j + 1 < lc.length ? entityNoun(lc[j + 1]) : null;
        if (RECENT_COMMIT_LEAD.has(lc[j]) && leadNoun && leadNoun.entityType === "Commit" && j + 2 === lc.length) {
          return { node: "recentCommits" };
        }
      }
      if ((framed || quals.length) && nextNoun && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !STOPWORDS2.has(lc[i]) && !CASCADE_NOISE_SET.has(lc[i])) {
        return { node: "find", entityType: nextNoun.entityType, term: w[i] };
      }
      return null;
    }
    const entityType = noun.entityType;
    const entWord = lc[i];
    i += 1;
    let predLc = lc.slice(i);
    let predWords = w.slice(i);
    let relFlag = false;
    if (predLc.length && RELATIVE_PRONOUNS.includes(predLc[0])) {
      relFlag = true;
      predLc = predLc.slice(1);
      predWords = predWords.slice(1);
    }
    const membershipLed = predLc[0] === "of" || predLc[0] === "in";
    const gerundLed = predLc.length > 0 && isGerundVerb(predLc[0]);
    const boolQualLed = predWords.length > 0 && splitBoolean(predLc, predWords).branches.some((bw) => {
      const { blc } = dropLeadCopula(bw, bw.map((x) => x.toLowerCase()));
      return blc.length && blc.every((x) => QUALIFIERS[x]);
    });
    const sameVerbBranches = predWords.length > 0 ? splitBoolean(predLc, predWords).branches : [];
    let sameVerbLed = false;
    if (sameVerbBranches.length > 1) {
      const firstBlc = sameVerbBranches[0].map((x) => x.toLowerCase());
      const firstVh = findPhrase(firstBlc, VERB_TO_KIND);
      if (firstVh && firstVh.start === 0) {
        sameVerbLed = sameVerbBranches.slice(1).every((bw) => {
          const blc = bw.map((x) => x.toLowerCase());
          const vh = findPhrase(blc, VERB_TO_KIND);
          return vh && vh.start === 0 ? vh.kind === firstVh.kind : !vh;
        });
      }
    }
    let differentVerbLed = false;
    if (sameVerbBranches.length > 1) {
      const firstBlc = sameVerbBranches[0].map((x) => x.toLowerCase());
      const firstVh = findPhrase(firstBlc, VERB_TO_KIND);
      if (firstVh && firstVh.start === 0) {
        differentVerbLed = sameVerbBranches.slice(1).every((bw) => {
          const blc = bw.map((x) => x.toLowerCase());
          const vh = findPhrase(blc, VERB_TO_KIND);
          return !!vh && vh.start === 0 && vh.end - vh.start === 1;
        });
      }
    }
    if (!(quals.length || relFlag || membershipLed || gerundLed || boolQualLed || sameVerbLed || differentVerbLed)) return null;
    if (!predWords.length) {
      let base = { node: "allOfClass", entityType };
      if (!quals.length) return { node: "miss", reason: "nothing to filter or traverse" };
      return { node: "qualifier", filters: quals, inner: base, entityType };
    }
    const subjPrefix = noun.placeholder ? "what" : `which ${entWord}`;
    const { branches, ops } = splitBoolean(predLc, predWords);
    let prevVerb = null;
    const atoms = [];
    for (let b = 0; b < branches.length; b += 1) {
      const bw = branches[b];
      const blc = bw.map((x) => x.toLowerCase());
      const op = b === 0 ? "seed" : ops[b - 1];
      const qc = dropLeadCopula(bw, blc);
      if (qc.blc.length && qc.blc.every((x) => QUALIFIERS[x])) {
        atoms.push({ op, kind: "qual", filters: qc.blc });
        continue;
      }
      if (blc[0] === "of" || blc[0] === "in") {
        atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
        continue;
      }
      let phrase = bw;
      const vh = findPhrase(blc, VERB_TO_KIND);
      if (vh) prevVerb = bw.slice(vh.start, vh.end);
      else if (prevVerb) phrase = [...prevVerb, ...bw];
      const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth + 1);
      if (!ast || ast.node === "miss") return { node: "miss", reason: ast && ast.reason || "a clause in the combination didn't parse" };
      atoms.push({ op, kind: "set", ast });
    }
    if (atoms[0].kind !== "set") return { node: "miss", reason: "start with a clause, then combine with and/or/but-not" };
    let result;
    if (atoms.length === 1) {
      result = atoms[0].ast;
    } else {
      result = { node: "boolean", entityType, atoms };
    }
    if (quals.length) result = { node: "qualifier", filters: quals, inner: result, entityType };
    return result;
  }
  function parseBranchAst(text, nlp, depth) {
    if (depth > MAX_COMPOSE_DEPTH) return { node: "miss", reason: "too deep to resolve" };
    const w = splitWords(text);
    const lc = w.map((x) => x.toLowerCase());
    const nested = parseNested(w, lc, nlp, depth);
    if (nested) return nested;
    const clause = parseSimpleClause(text, nlp);
    return clause ? { node: "clause", clause } : null;
  }
  function splitBoolean(predLc, predWords) {
    const conns = Object.keys(BOOLEAN_CONNECTIVES).sort((a, z) => z.split(" ").length - a.split(" ").length);
    const branches = [];
    const ops = [];
    let start = 0;
    let i = 0;
    while (i < predLc.length) {
      let hit = null;
      for (const c of conns) {
        const cw = c.split(" ");
        if (predLc.slice(i, i + cw.length).join(" ") === c) {
          hit = { c, len: cw.length };
          break;
        }
      }
      if (hit && i > start) {
        branches.push(predWords.slice(start, i));
        ops.push(BOOLEAN_CONNECTIVES[hit.c]);
        i += hit.len;
        start = i;
      } else if (hit) {
        i += hit.len;
        start = i;
      } else i += 1;
    }
    branches.push(predWords.slice(start));
    return { branches, ops };
  }
  function reverseOverSet(graph, kind, entityType, objectIds) {
    const symbolKind = SYMBOL_GRAIN_SIBLING[kind];
    if (symbolKind && FINE_ENTITY_TYPES.has(entityType)) {
      const edges2 = edgesOfKind2(graph, symbolKind).filter((e) => objectIds.has(e.object));
      return uniqueById(edges2.map((e) => graph.byId.get(e.subject)).filter((s) => s && s.class === entityType));
    }
    const objHasFine = !!symbolKind && [...objectIds].some((id) => FINE_ENTITY_TYPES.has(graph.byId.get(id)?.class));
    const scanKinds = objHasFine ? [...kindsFor(kind), symbolKind] : kindsFor(kind);
    const edges = scanKinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => objectIds.has(e.object));
    const subjects = uniqueById(edges.map((e) => graph.byId.get(e.subject)).filter(Boolean));
    if (!entityType || entityType === "Change") return subjects;
    const direct = subjects.filter((s) => s.class === entityType);
    if (direct.length) return direct;
    if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
      return refineToEntities(graph, new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id)), entityType);
    }
    return [];
  }
  function forwardOverSet(graph, kind, subjectIds) {
    const edges = kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => subjectIds.has(e.subject));
    return uniqueById(edges.map((e) => graph.byId.get(e.object)).filter(Boolean));
  }
  function uniqueById(inds) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const x of inds) if (x && !seen.has(x.id)) {
      seen.add(x.id);
      out.push(x);
    }
    return out;
  }
  function directoryScopeModules(graph, term) {
    const norm = normPath(term);
    if (!norm) return [];
    const prefix = `${norm}/`;
    return graph.individuals.filter((i) => i.class === "Module" && normPath(i.label).startsWith(prefix));
  }
  var qualCache = /* @__PURE__ */ new WeakMap();
  function qualSets(graph) {
    let c = qualCache.get(graph);
    if (c) return c;
    const exported = /* @__PURE__ */ new Set();
    for (const e of edgesOfKind2(graph, "reexports")) {
      exported.add(String(e.object).toLowerCase());
      const ind = graph.byId.get(e.object);
      if (ind) exported.add(String(ind.label).toLowerCase());
    }
    const testedModules = new Set(edgesOfKind2(graph, "tests").map((e) => e.object));
    const moduleOfSymbol = /* @__PURE__ */ new Map();
    for (const e of edgesOfKind2(graph, "defines")) moduleOfSymbol.set(e.object, e.subject);
    c = { exported, testedModules, moduleOfSymbol };
    qualCache.set(graph, c);
    return c;
  }
  function moduleIdOf2(graph, ind) {
    if (!ind) return null;
    if (ind.class === "Module") return ind.id;
    return qualSets(graph).moduleOfSymbol.get(ind.id) || null;
  }
  var META_FALLBACK_CLASSES = /* @__PURE__ */ new Set(["Class", "Function", "Method", "GlobalVariable", "Attribute"]);
  function metaFallbackEntityAnswer(graph, term) {
    const termLc = String(term || "").trim().toLowerCase();
    if (!termLc) return null;
    const hits = (graph?.individuals || []).filter((i) => META_FALLBACK_CLASSES.has(i.class) && String(i.label).toLowerCase() === termLc);
    if (hits.length !== 1) return null;
    const hit = hits[0];
    const mid = moduleIdOf2(graph, hit);
    const modLabel = mid && graph.byId.get(mid)?.label || String((hit.attributes || []).find((a) => a.key === "site")?.value || "").split(":")[0] || null;
    const noun = nounFor(hit.class, 1);
    const article = noun === "attribute" ? "an" : "a";
    const definedIn = modLabel ? `, ${pickPhrase("defined-in", hit.id, "defined in")} ${modLabel}` : "";
    const followUp = hit.class === "Class" ? ` or "which classes inherit from ${hit.label}"` : "";
    return {
      text: `${hit.label} is ${article} ${noun} in this codebase${definedIn} \u2014 try "describe ${hit.label}"${followUp}.`,
      hit,
      modLabel
    };
  }
  function membershipOwnSet(graph, id, entityType) {
    const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, /* @__PURE__ */ new Set([id]))));
    return entityType ? objs.filter((o) => o.class === entityType) : objs;
  }
  function resolveMembershipOwner(graph, term, contextId = null) {
    const r = resolveTermOrContext(graph, term, contextId);
    if (!(r.match && r.tier === 1)) {
      const dirMods = directoryScopeModules(graph, term);
      if (dirMods.length) return { kind: "dir", mods: dirMods };
    }
    if (!r.match) return { kind: "miss" };
    return { kind: "single", id: r.match.id, entityClass: r.match.class, label: r.match.label };
  }
  function computeMembership(graph, ownerId, ownerClass, entityType, filterFn) {
    const pass = filterFn || (() => true);
    const own = membershipOwnSet(graph, ownerId, entityType).filter(pass);
    if (own.length || !inheritsApplicable(graph, ownerClass)) {
      return { own, inherited: [], viaId: null, viaLabel: null };
    }
    for (const ancId of ancestorsOf(graph, ownerId)) {
      const anc = graph.byId.get(ancId);
      if (!anc) continue;
      const ancOwn = membershipOwnSet(graph, ancId, entityType).filter(pass);
      if (ancOwn.length) return { own, inherited: ancOwn, viaId: ancId, viaLabel: anc.label };
    }
    return { own, inherited: [], viaId: null, viaLabel: null };
  }
  function qualHolds(graph, ind, spec) {
    if (!spec) return false;
    switch (spec.via) {
      case "visibility": {
        const v = String((ind.attributes || []).find((a) => a.key === "visibility")?.value || "public").toLowerCase();
        return v === spec.value;
      }
      case "attr":
        return !!(ind.attributes || []).find((a) => a.key === spec.attr)?.value;
      case "exported": {
        const ex = qualSets(graph).exported;
        return ex.has(String(ind.label).toLowerCase()) || ex.has(String(ind.id).toLowerCase());
      }
      case "tested": {
        const mid = moduleIdOf2(graph, ind);
        return (!!mid && qualSets(graph).testedModules.has(mid)) === spec.value;
      }
      default:
        return false;
    }
  }
  function inheritsEdges(graph) {
    return edgesOfKind2(graph, "inherits");
  }
  function directChildrenOf(graph, id) {
    return inheritsEdges(graph).filter((e) => e.object === id).map((e) => e.subject);
  }
  function directParentsOf(graph, id) {
    return inheritsEdges(graph).filter((e) => e.subject === id).map((e) => e.object);
  }
  function descendantsOf(graph, id) {
    const out = /* @__PURE__ */ new Set();
    const queue = [...directChildrenOf(graph, id)];
    while (queue.length) {
      const next = queue.shift();
      if (out.has(next)) continue;
      out.add(next);
      for (const c of directChildrenOf(graph, next)) if (!out.has(c)) queue.push(c);
    }
    return out;
  }
  function ancestorsOf(graph, id) {
    const out = /* @__PURE__ */ new Set();
    const queue = [...directParentsOf(graph, id)];
    while (queue.length) {
      const next = queue.shift();
      if (out.has(next)) continue;
      out.add(next);
      for (const p of directParentsOf(graph, next)) if (!out.has(p)) queue.push(p);
    }
    return out;
  }
  var inheritsApplicableCache = /* @__PURE__ */ new WeakMap();
  function inheritsApplicable(graph, entityType) {
    let byType = inheritsApplicableCache.get(graph);
    if (!byType) {
      byType = /* @__PURE__ */ new Map();
      inheritsApplicableCache.set(graph, byType);
    }
    if (byType.has(entityType)) return byType.get(entityType);
    const ok = inheritsEdges(graph).some((e) => {
      const s = graph.byId.get(e.subject);
      const o = graph.byId.get(e.object);
      return !!s && !!o && s.class === entityType && o.class === entityType;
    });
    byType.set(entityType, ok);
    return ok;
  }
  function ownSurfaceHit(ind, termTokens) {
    const labelLc = String(ind.label || "").toLowerCase();
    if (termTokens.every((tok) => labelLc.includes(tok))) return "label";
    const attrs = (ind.attributes || []).map((a) => String(a.value ?? "").toLowerCase());
    if (termTokens.every((tok) => attrs.some((v) => v.includes(tok)))) return "attr";
    return null;
  }
  var FIND_TIER = { label: 3, chain: 2, attr: 1 };
  function sortFindHits(hits) {
    return hits.slice().sort((a, b) => FIND_TIER[b.via] - FIND_TIER[a.via] || String(a.ind.label).length - String(b.ind.label).length).map((h) => h.ind);
  }
  function fuzzyFindHit(ind, term) {
    const tLc = String(term || "").trim().toLowerCase();
    if (tLc.length < 4) return false;
    const bound = fuzzyBound(tLc);
    if (editDistance(String(ind.label || "").toLowerCase(), tLc, bound) <= bound) return true;
    for (const comp of componentSet(ind.label)) {
      if (editDistance(comp, tLc, bound) <= bound) return true;
    }
    return false;
  }
  function computeFind(graph, entityType, term) {
    const pool = graph.individuals.filter((i) => i.class === entityType);
    const termTokens = [...componentSet(term)];
    if (!termTokens.length || !pool.length) return { narrow: [], broad: [] };
    const cascade = inheritsApplicable(graph, entityType);
    const narrowHits = [];
    for (const ind of pool) {
      const own = ownSurfaceHit(ind, termTokens);
      if (own) {
        narrowHits.push({ ind, via: own });
        continue;
      }
      if (!cascade) continue;
      const viaChain = [...descendantsOf(graph, ind.id)].some((did) => {
        const d = graph.byId.get(did);
        return !!d && !!ownSurfaceHit(d, termTokens);
      });
      if (viaChain) narrowHits.push({ ind, via: "chain" });
    }
    if (narrowHits.length || !cascade) return { narrow: sortFindHits(narrowHits), broad: [] };
    const broadHits = /* @__PURE__ */ new Map();
    for (const ind of pool) {
      for (const ancId of ancestorsOf(graph, ind.id)) {
        if (!broadHits.has(ancId)) {
          const anc = graph.byId.get(ancId);
          if (anc && anc.class === entityType && fuzzyFindHit(anc, term)) {
            broadHits.set(ancId, { ind: anc, via: "chain" });
          }
        }
        for (const sibId of directChildrenOf(graph, ancId)) {
          if (sibId === ind.id || broadHits.has(sibId)) continue;
          const sib = graph.byId.get(sibId);
          if (sib && sib.class === entityType && fuzzyFindHit(sib, term)) broadHits.set(sibId, { ind: sib, via: "chain" });
        }
      }
    }
    return { narrow: [], broad: sortFindHits([...broadHits.values()]) };
  }
  function evalSet(graph, ast, opts) {
    switch (ast.node) {
      case "clause":
        return traverse(graph, ast.clause, opts).matches || [];
      case "allOfClass":
        return graph.individuals.filter((i) => i.class === ast.entityType);
      // Predicate-find as a set atom: the narrow-then-broaden cascade's result,
      // transparently flattened ("related, not exact" is a render concern).
      case "find": {
        const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
        return narrow.length ? narrow : broad;
      }
      // Subjects with any edge of a kind; an existential negation differences
      // this off allOfClass to yield "modules that import nothing".
      case "existsEdge": {
        const subs = new Set(kindsFor(ast.kind).flatMap((k) => edgesOfKind2(graph, k)).map((e) => e.subject));
        return graph.individuals.filter((i) => subs.has(i.id) && (!ast.entityType || i.class === ast.entityType));
      }
      // Forward complement: the verb's object-grain universe minus what the
      // subject reaches via that verb ("what doesn't it import").
      case "forwardComplement": {
        const r = resolveTermOrContext(graph, ast.subjectTerm, opts && opts.contextId);
        if (!r.match) return [];
        const universeType = kindObjectClass(graph, ast.kind);
        if (!universeType) return [];
        const positive = new Set(forwardOverSet(graph, ast.kind, /* @__PURE__ */ new Set([r.match.id])).map((x) => x.id));
        return graph.individuals.filter((i) => i.class === universeType && !positive.has(i.id));
      }
      case "reverseSet": {
        const ids = new Set(evalSet(graph, ast.inner, opts).map((i) => i.id));
        return reverseOverSet(graph, ast.kind, ast.entityType, ids);
      }
      case "forwardSet": {
        const ids = new Set(evalSet(graph, ast.inner, opts).map((i) => i.id));
        return forwardOverSet(graph, ast.kind, ids);
      }
      // The previous list-shaped answer's own id set. Only reached with a real,
      // non-empty `prev` — the no-`prev` case is intercepted earlier as an
      // honest "needs a previous answer" miss.
      case "prevSet": {
        const prev = opts && opts.prev;
        return Array.isArray(prev) ? prev.map((id) => graph.byId.get(id)).filter(Boolean) : [];
      }
      case "membership": {
        const owner = resolveMembershipOwner(graph, ast.term, opts && opts.contextId);
        if (owner.kind === "dir") {
          if (!ast.entityType || ast.entityType === "Module") return owner.mods;
          const ids = new Set(owner.mods.map((m) => m.id));
          const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids)));
          return objs.filter((o) => o.class === ast.entityType);
        }
        if (owner.kind === "miss") return [];
        const { own, inherited } = computeMembership(graph, owner.id, owner.entityClass, ast.entityType);
        return own.length ? own : inherited;
      }
      case "qualifier": {
        if (ast.inner.node === "membership") return evalMembershipComposite(graph, ast, opts).matches;
        const base = evalSet(graph, ast.inner, opts);
        return base.filter((ind) => ast.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f])));
      }
      case "boolean":
        return evalBoolean(graph, ast, opts);
      case "anaphora":
        return evalAnaphora(graph, ast, opts).matches;
      default:
        return [];
    }
  }
  function evalBoolean(graph, ast, opts) {
    let acc = [];
    for (const atom of ast.atoms) {
      if (atom.op === "seed") {
        acc = evalSet(graph, atom.ast, opts);
        continue;
      }
      if (atom.kind === "qual") {
        const holds = (ind) => atom.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f]));
        acc = atom.op === "difference" ? acc.filter((i) => !holds(i)) : acc.filter((i) => holds(i));
        continue;
      }
      const oids = new Set(evalSet(graph, atom.ast, opts).map((i) => i.id));
      if (atom.op === "intersection") acc = acc.filter((i) => oids.has(i.id));
      else if (atom.op === "difference") acc = acc.filter((i) => !oids.has(i.id));
      else if (atom.op === "union") {
        const seen = new Set(acc.map((i) => i.id));
        for (const other of evalSet(graph, atom.ast, opts)) if (!seen.has(other.id)) {
          seen.add(other.id);
          acc.push(other);
        }
      }
    }
    return acc;
  }
  function resolveInSentenceCandidates(graph, terms) {
    if (!Array.isArray(terms) || terms.length < 2) return null;
    const seen = /* @__PURE__ */ new Set();
    const resolved = [];
    for (const term of terms) {
      const r = resolveObject(graph, term);
      if (r && r.match && !seen.has(r.match.id)) {
        seen.add(r.match.id);
        resolved.push(r.match);
      }
    }
    return resolved.length >= 2 ? resolved : null;
  }
  function evalAnaphora(graph, ast, opts) {
    const inSentence = resolveInSentenceCandidates(graph, ast.candidateTerms);
    let baseItems = inSentence;
    if (!baseItems) {
      const prev = opts && opts.prev;
      if (!Array.isArray(prev) || !prev.length) return { compositeMiss: true, reason: "no-prev", matches: [] };
      baseItems = prev.map((id) => graph.byId.get(id)).filter(Boolean);
    }
    let items = baseItems;
    const f = ast.filter;
    if (f && f.type === "qual") {
      items = items.filter((ind) => f.filters.every((q) => qualHolds(graph, ind, QUALIFIERS[q])));
    } else if (f && f.type === "clause") {
      const r = resolveObject(graph, f.clause.object);
      if (!r.match) items = [];
      else {
        const sib = SYMBOL_GRAIN_SIBLING[f.clause.kind];
        const kinds = [...kindsFor(f.clause.kind), ...sib ? [sib] : []];
        const ok = new Set(kinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === r.match.id).map((e) => e.subject));
        items = items.filter((ind) => ok.has(ind.id));
      }
    }
    const sameClass = (list) => list.length && list.every((x) => x.class === list[0].class) ? list[0].class : null;
    const common = items.length ? sameClass(items) : sameClass(baseItems);
    if (ast.mode === "count") return { compositeKind: "count", count: items.length, entityType: common, matches: [] };
    return { compositeKind: "set", matches: items, entityType: common };
  }
  var DEGREE_KINDS = ["imports", "calls", "callsSymbol", "inherits", "contains", "tests"];
  function degreeMetric(graph, ind, metric) {
    const kinds = metric.kind === "*" ? DEGREE_KINDS : [metric.kind, ...metric.sibling ? [metric.sibling] : []];
    let n = 0;
    for (const k of kinds) for (const e of edgesOfKind2(graph, k)) {
      const out = e.subject === ind.id;
      const inc = e.object === ind.id;
      if (metric.dir === "out" && out) {
        if (metric.filter) {
          const o = graph.byId.get(e.object);
          if (!o || o.class !== metric.filter) continue;
        }
        n += 1;
      } else if (metric.dir === "in" && inc) n += 1;
      else if (metric.dir === "both" && (out || inc)) n += 1;
    }
    return n;
  }
  function evalRecentCommits(graph) {
    const commits = graph.individuals.filter((i) => i.class === "Commit");
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return { compositeKind: "recentCommits", matches: commits };
  }
  var COMMIT_FILTER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function evalCommitFilter(graph, ast) {
    const { op, pivotRaw } = ast;
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "").slice(0, 10);
    let pivotDate = null;
    let pivotId = null;
    if (COMMIT_FILTER_DATE_RE.test(pivotRaw)) {
      pivotDate = pivotRaw;
    } else {
      const { match, ambiguous } = resolveObject(graph, pivotRaw, { expectedClass: "Commit" });
      if (match && !ambiguous && match.class === "Commit" && dateOf(match)) {
        pivotId = match.id;
        pivotDate = dateOf(match);
      }
    }
    if (!pivotDate) return { compositeKind: "commitFilter", op, pivotRaw, pivotResolved: false, matches: [] };
    const matches = graph.individuals.filter((i) => i.class === "Commit" && i.id !== pivotId && dateOf(i)).filter((c) => {
      const d = dateOf(c);
      if (op === "since") return d >= pivotDate;
      if (op === "before") return d < pivotDate;
      if (op === "after") return d > pivotDate;
      return d === pivotDate;
    }).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return { compositeKind: "commitFilter", op, pivotRaw, pivotDate, pivotResolved: true, matches };
  }
  function evalTemporal(graph, ast, opts) {
    const inner = evalSet(graph, ast.inner, opts);
    const ids = new Set(inner.map((i) => i.id));
    if (!ids.size) return { compositeKind: "temporal", matches: [], entityType: ast.entityType, innerCount: 0 };
    const commits = reverseOverSet(graph, "touches", "Commit", ids);
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return { compositeKind: "temporal", matches: commits, entityType: ast.entityType, innerCount: inner.length };
  }
  function evalSuperlative(graph, ast) {
    const pool = graph.individuals.filter((i) => i.class === ast.entityType);
    const scored = pool.map((ind) => ({ ind, score: degreeMetric(graph, ind, ast.metric) })).sort((a, z) => ast.extreme === "most" ? z.score - a.score : a.score - z.score);
    if (!scored.length) return { compositeKind: "superlative", entityType: ast.entityType, matches: [] };
    const best = scored[0].score;
    const winners = scored.filter((s) => s.score === best).map((s) => s.ind);
    return { compositeKind: "superlative", entityType: ast.entityType, metricNoun: ast.metricNoun, extreme: ast.extreme, score: best, matches: winners };
  }
  function evalMembershipComposite(graph, ast, opts) {
    const qualNode = ast.node === "qualifier" && ast.inner.node === "membership" ? ast : null;
    const memNode = qualNode ? qualNode.inner : ast;
    const entityType = memNode.entityType;
    const filterFn = qualNode ? (ind) => qualNode.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f])) : null;
    const owner = resolveMembershipOwner(graph, memNode.term, opts && opts.contextId);
    if (owner.kind === "dir") {
      let objs;
      if (!entityType || entityType === "Module") objs = owner.mods;
      else {
        const ids = new Set(owner.mods.map((m) => m.id));
        objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids))).filter((o) => o.class === entityType);
      }
      if (filterFn) objs = objs.filter(filterFn);
      return { compositeKind: "set", matches: objs, entityType };
    }
    if (owner.kind === "miss") return { compositeKind: "set", matches: [], entityType };
    const { own, inherited, viaLabel } = computeMembership(graph, owner.id, owner.entityClass, entityType, filterFn);
    const inheritedNotOwn = !own.length && inherited.length > 0;
    return {
      compositeKind: "membership",
      entityType,
      matches: inheritedNotOwn ? inherited : own,
      inheritedNotOwn,
      viaLabel,
      ownerLabel: owner.label
    };
  }
  function evalExists(graph, ast) {
    const { entityType, term, scopeModule } = ast;
    let scopeMatch = null;
    if (scopeModule) {
      const r = resolveObject(graph, scopeModule, { expectedClass: "Module" });
      if (!r.match) return { compositeKind: "exists", entityType, term, scopeModule, scopeMiss: true, matches: [] };
      scopeMatch = r.match;
    }
    if (term) {
      const r = resolveObject(graph, term, { expectedClass: entityType });
      const inScope = !scopeMatch || r.match && moduleIdOf2(graph, r.match) === scopeMatch.id;
      const hit = r.match && inScope;
      return {
        compositeKind: "exists",
        entityType,
        term,
        scopeModule,
        scopeMatch,
        matches: hit ? [r.match] : []
      };
    }
    const pool = scopeMatch ? refineToEntities(graph, /* @__PURE__ */ new Set([scopeMatch.id]), entityType) : graph.individuals.filter((i) => i.class === entityType);
    return { compositeKind: "exists", entityType, term: null, scopeModule, scopeMatch, matches: pool };
  }
  function evalQualCheck(graph, ast, opts) {
    const { term, qualifier, negated } = ast;
    const r = resolveTermOrContext(graph, term, opts.contextId);
    if (r.unresolvedPronoun) return { compositeKind: "qualCheck", qualCheckMiss: "pronoun", term, matches: [] };
    if (!r.match) return { compositeKind: "qualCheck", qualCheckMiss: "unresolved", term, matches: [] };
    const rawHolds = qualHolds(graph, r.match, QUALIFIERS[qualifier]);
    const holds = negated ? !rawHolds : rawHolds;
    return { compositeKind: "qualCheck", subject: r.match, qualifier, negated, holds, matches: [r.match] };
  }
  function evalComposite(graph, ast, opts = {}) {
    if (ast.node === "miss") return { compositeMiss: true, reason: ast.reason || null, matches: [] };
    if (ast.node === "exists") return evalExists(graph, ast);
    if (ast.node === "qualCheck") return evalQualCheck(graph, ast, opts);
    if (ast.node === "count") return { compositeKind: "count", count: evalSet(graph, ast.base, opts).length, entityType: ast.entityType, matches: [] };
    if (ast.node === "list") return { compositeKind: "list", matches: evalSet(graph, ast.base, opts), entityType: ast.entityType, scoped: ast.scoped };
    if (ast.node === "superlative") return evalSuperlative(graph, ast);
    if (ast.node === "temporal") return evalTemporal(graph, ast, opts);
    if (ast.node === "recentCommits") return evalRecentCommits(graph);
    if (ast.node === "commitFilter") return evalCommitFilter(graph, ast);
    if (ast.node === "anaphora") return evalAnaphora(graph, ast, opts);
    if (ast.node === "membership" || ast.node === "qualifier" && ast.inner.node === "membership") {
      return evalMembershipComposite(graph, ast, opts);
    }
    if (ast.node === "find") {
      const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
      return {
        compositeKind: "find",
        entityType: ast.entityType,
        term: ast.term,
        matches: narrow.length ? narrow : broad,
        broad: !narrow.length && broad.length > 0
      };
    }
    if ((ast.node === "reverseSet" || ast.node === "forwardSet") && ast.inner.node === "prevSet" && !(Array.isArray(opts.prev) && opts.prev.length)) {
      return { compositeMiss: true, reason: "no-prev", matches: [] };
    }
    return { compositeKind: "set", matches: evalSet(graph, ast, opts), entityType: ast.entityType || null };
  }
  var compositeList = (matches) => listJoin(matches.slice(0, OVERFLOW_CAP).map((m) => ["Function", "Method"].includes(m.class) ? `${m.label}()` : m.label)) + (matches.length > OVERFLOW_CAP ? `, \u2026and ${matches.length - OVERFLOW_CAP} more` : "");
  function compositionalHint() {
    return 'compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", "find me the payment class", or (after a listing) "which of those are tested"';
  }
  function describeFindHit(ind) {
    const label = ["Function", "Method"].includes(ind.class) ? `${ind.label}()` : ind.label;
    if (ind.class === "Module") return label;
    const mod = moduleLabelOf(ind);
    return mod && mod !== "(unknown module)" ? `${label} in ${mod}` : label;
  }
  function renderComposite(parsed, result) {
    if (result.compositeMiss) {
      if (result.reason === "no-prev") {
        return { content: `"those"/"them" needs a previous answer to refer to \u2014 ask a listing question first, then follow up.`, miss: true, ambiguous: false };
      }
      return { content: `couldn't compile this compositional question${result.reason ? ` (${result.reason})` : ""}. ${compositionalHint()}.`, miss: true, ambiguous: false };
    }
    if (result.compositeKind === "exists") {
      if (result.scopeMiss) {
        return { content: `no module matching "${result.scopeModule}" found in the index.`, miss: true, ambiguous: false };
      }
      const kindSingular = nounFor(result.entityType, 1);
      const kindPlural = nounFor(result.entityType, 2);
      const scopeSuffix = result.scopeMatch ? ` in ${result.scopeMatch.label}` : "";
      if (result.term) {
        if (!result.matches.length) {
          return { content: `No \u2014 no ${kindSingular} named "${result.term}" found${scopeSuffix}.`, miss: true, ambiguous: false };
        }
        const hit = result.matches[0];
        const modLabel = moduleLabelOf(hit);
        const definedIn = hit.class === "Module" ? "" : modLabel && modLabel !== "(unknown module)" ? `, ${pickPhrase("defined-in", hit.id, "defined in")} ${modLabel}` : "";
        return { content: `Yes \u2014 ${hit.label} is a ${kindSingular}${definedIn}.`, miss: false, ambiguous: false, matches: result.matches };
      }
      if (!result.matches.length) {
        return { content: `No \u2014 no ${kindPlural} found${scopeSuffix}.`, miss: true, ambiguous: false };
      }
      return { content: `Yes \u2014 ${compositeList(result.matches)}${scopeSuffix}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "qualCheck") {
      if (result.qualCheckMiss === "pronoun") {
        return { content: `"${result.term}" needs a selected node to refer to \u2014 click a node first, or name it directly.`, miss: true, ambiguous: false };
      }
      if (result.qualCheckMiss === "unresolved") {
        return { content: `couldn't find "${result.term}" in the index to check.`, miss: true, ambiguous: false };
      }
      const label = result.subject.label;
      const truePhrase = result.negated ? `not ${result.qualifier}` : result.qualifier;
      const falsePhrase = result.negated ? result.qualifier : `not ${result.qualifier}`;
      return {
        content: `${result.holds ? "Yes" : "No"} \u2014 ${label} is ${result.holds ? truePhrase : falsePhrase}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "count") {
      const noun = result.entityType ? nounFor(result.entityType, result.count) : result.count === 1 ? "result" : "results";
      return { content: `${result.count} ${noun}.`, miss: false, ambiguous: false, matches: [] };
    }
    if (result.compositeKind === "list") {
      if (!result.matches.length) {
        return { content: `no ${nounFor(result.entityType, 2)} in this index.`, miss: true, ambiguous: false, matches: [] };
      }
      const scopeable = !["Module", "Commit", "Fact", "Utterance", "Session", "Source", "Rule"].includes(result.entityType);
      const hint = !result.scoped && scopeable && result.matches.length > OVERFLOW_CAP ? ` \u2014 narrow with "${nounFor(result.entityType, 2)} in <module>"` : "";
      return { content: `${compositeList(result.matches)}${hint}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "membership") {
      if (!result.matches.length) {
        return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}. ${touchesRephraseHint()}`, miss: true, ambiguous: false, matches: [] };
      }
      if (result.inheritedNotOwn) {
        const kindPlural = nounFor(result.entityType, 2);
        const ownerPhrase = result.ownerLabel ? `${result.ownerLabel} has no own ${kindPlural}` : `no own ${kindPlural}`;
        return {
          content: `${ownerPhrase} \u2014 inherited from ${result.viaLabel}: ${compositeList(result.matches)}.`,
          miss: false,
          ambiguous: false,
          matches: result.matches,
          inheritedNotOwn: true
        };
      }
      return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "find") {
      const typeNoun = nounFor(result.entityType, 1);
      if (!result.matches.length) {
        return { content: `no ${nounFor(result.entityType, 2)} found matching "${result.term}".`, miss: true, ambiguous: false, matches: [] };
      }
      const cited = result.matches.length === 1 ? describeFindHit(result.matches[0]) : compositeList(result.matches);
      if (result.broad) {
        return {
          content: `no exact ${typeNoun} named "${result.term}", but found a related ${result.matches.length === 1 ? typeNoun : nounFor(result.entityType, 2)}: ${cited}.`,
          miss: false,
          ambiguous: false,
          matches: result.matches,
          relatedNotExact: true
        };
      }
      return { content: `${cited}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "recentCommits") {
      if (!result.matches.length) return { content: `no commits recorded in this index.`, miss: true, ambiguous: false, matches: [] };
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      const shown = result.matches.slice(0, HISTORY_CAP).map((c) => {
        const day = dateOf(c).slice(0, 10);
        const msg = (c.attributes || []).find((a) => a.key === "message")?.value || "";
        return `${c.label}${day ? ` (${day})` : ""}${msg ? ` \u2014 ${msg}` : ""}`;
      });
      const tail = result.matches.length > HISTORY_CAP ? ` \u2026+${result.matches.length - HISTORY_CAP} more` : "";
      return {
        content: `${result.matches.length} recent commit(s): ${shown.join(", ")}${tail}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "commitFilter") {
      if (!result.pivotResolved) {
        return {
          content: `"${result.pivotRaw}" isn't a recognized date (yyyy-mm-dd) or a known commit \u2014 try "what changed since 2026-06-01" or "what changed before <commit>".`,
          miss: true,
          ambiguous: false,
          matches: []
        };
      }
      if (!result.matches.length) {
        return { content: `no commits recorded ${result.op} ${result.pivotRaw}.`, miss: true, ambiguous: false, matches: [] };
      }
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      const shown = result.matches.slice(0, HISTORY_CAP).map((c) => {
        const day = dateOf(c).slice(0, 10);
        const msg = (c.attributes || []).find((a) => a.key === "message")?.value || "";
        return `${c.label}${day ? ` (${day})` : ""}${msg ? ` \u2014 ${msg}` : ""}`;
      });
      const tail = result.matches.length > HISTORY_CAP ? ` \u2026+${result.matches.length - HISTORY_CAP} more` : "";
      return {
        content: `${result.matches.length} commit(s) changed ${result.op} ${result.pivotRaw}: ${shown.join(", ")}${tail}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "superlative") {
      if (!result.matches.length) return { content: `no ${nounFor(result.entityType, 2)} to rank in this index.`, miss: true, ambiguous: false };
      const lead = result.extreme === "most" ? "the most" : "the fewest";
      const tie = result.matches.length > 1 ? ` (${result.matches.length}-way tie)` : "";
      return {
        content: `${compositeList(result.matches)} \u2014 ${lead} ${result.metricNoun} (${result.score})${tie}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "temporal") {
      const n = result.innerCount || 0;
      const setNoun = result.entityType ? nounFor(result.entityType, n || 2) : n === 1 ? "entity" : "entities";
      const wasWere = n === 1 ? "was" : "were";
      if (!n) {
        return { content: `nothing in the index matches the inner set, so there is no change history to date. ${touchesRephraseHint()}`, miss: true, ambiguous: false, matches: [] };
      }
      if (!result.matches.length) {
        return { content: `no recorded commit touched the ${n} ${setNoun} in that set in this index. ${touchesRephraseHint()}`, miss: true, ambiguous: false, matches: [] };
      }
      const newest = result.matches[0];
      const date = (newest.attributes || []).find((a) => a.key === "date")?.value || "";
      if (!date) {
        return { content: `the ${setNoun} in that set ${wasWere} last touched by commit ${newest.label}, but this index records no commit dates \u2014 regenerate the graph to attach mgx:commitDate.`, miss: true, ambiguous: false, matches: result.matches };
      }
      const msg = (newest.attributes || []).find((a) => a.key === "message")?.value || "";
      const day = String(date).slice(0, 10);
      const more = result.matches.length - 1;
      return {
        content: `the ${setNoun} in that set ${wasWere} last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (!result.matches.length) {
      return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}. ${touchesRephraseHint()}`, miss: true, ambiguous: false, matches: [] };
    }
    return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  function rephraseHint() {
    return `"which <functions|classes|modules> <imports|calls|uses|inherits from|tests> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which commits touched <name>" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). ` + compositionalHint();
  }
  function touchesRephraseHint() {
    return `Try "who touched <a module that actually has commits>" or "/describe <module>" to see what's in the index.`;
  }
  function componentSet(s) {
    return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  }
  function derivationalStem(w) {
    if (w.length < 5) return w;
    const stripped = w.replace(/(ing|ers|ors|er|or)$/, "");
    if (stripped === w) return w;
    return stripped.length >= 3 && stripped[stripped.length - 1] === stripped[stripped.length - 2] ? stripped.slice(0, -1) : stripped;
  }
  function joinedForm(label) {
    return String(label || "").replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[/\-_.]+/g, "");
  }
  function joinedQueryForm(term) {
    return String(term || "").trim().replace(/^(?:the|a|an)\s+/i, "").toLowerCase().replace(/[\s\-_]+/g, "");
  }
  function resolveObjectCore(graph, term, { expectedClass = null } = {}) {
    const t = String(term || "").trim();
    if (!t) return { match: null, candidates: [], tier: null, ambiguous: false };
    const tLc = t.toLowerCase();
    const pool = expectedClass ? graph.individuals.filter((i) => i.class === expectedClass) : graph.individuals;
    const shaTerm = tLc.match(/^(commit[:\s])?([0-9a-f]{7,40})$/);
    if (shaTerm) {
      const sha = shaTerm[2];
      const hits = pool.filter((i) => i.class === "Commit" && (String(i.id).toLowerCase().startsWith(`commit:${sha}`) || String(i.label).toLowerCase().startsWith(sha)));
      if (hits.length === 1) return { match: hits[0], candidates: [], tier: 1, ambiguous: false };
      if (hits.length > 1) return { match: hits[0], candidates: hits.slice(1, 5), tier: 1, ambiguous: true };
      if (shaTerm[1]) return { match: null, candidates: [], tier: null, ambiguous: false };
    }
    const exact = pool.find((i) => String(i.label).toLowerCase() === tLc || String(i.id).toLowerCase() === tLc);
    if (exact) return { match: exact, candidates: [], tier: 1, ambiguous: false };
    const extLc = `ext:${tLc}`;
    let extId = null;
    outer: for (const g of graph.relations) {
      for (const e of g.edges) {
        if (String(e.object).toLowerCase() === extLc) {
          extId = e.object;
          break outer;
        }
      }
    }
    if (extId && !expectedClass) return { match: { id: extId, label: t, class: null }, candidates: [], tier: 2, ambiguous: false };
    const scored = [];
    const dotted = !tLc.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(tLc);
    if (dotted) {
      const lastSeg = tLc.split(".").pop();
      for (const m of pool) {
        const label = String(m.label || "").toLowerCase();
        if (m.class === "Module") {
          if (label.split("/").pop() === tLc) scored.push({ ind: m, score: 1e3 - Math.abs(label.length - tLc.length) });
        } else if (label.includes(tLc)) {
          scored.push({ ind: m, score: 2e3 - Math.abs(label.length - tLc.length) });
        } else if (label.endsWith(`.${lastSeg}`)) {
          scored.push({ ind: m, score: 1500 - Math.abs(label.length - tLc.length) });
        }
      }
    } else {
      const termComps = [...componentSet(t)];
      const pathToken = tLc.split(/\s+/).find((tok) => tok.includes("/"));
      const slashStem = pathToken ? pathToken.split("/").pop().replace(/\.[a-z0-9]+$/, "") : null;
      const qWords = t.trim().replace(/^(?:the|a|an)\s+/i, "").trim().split(/\s+/).filter(Boolean);
      const isMultiWord = qWords.length >= 2;
      const qJoined = isMultiWord ? joinedQueryForm(t) : null;
      for (const m of pool) {
        const label = String(m.label || "").toLowerCase();
        const stem = label.split("/").pop().replace(/\.[a-z0-9]+$/, "");
        if (stem === tLc) {
          scored.push({ ind: m, score: 5e3 });
          continue;
        }
        if (tLc.length >= 4 && (stem.startsWith(tLc) || stem.endsWith(tLc))) {
          scored.push({ ind: m, score: 4e3 - Math.abs(stem.length - tLc.length) });
          continue;
        }
        if (isMultiWord) {
          const candJoined = joinedForm(m.label);
          if (candJoined && candJoined === qJoined) {
            scored.push({ ind: m, score: 5e3 });
            continue;
          }
          const hasExplicitSeparator = /[/_-]/.test(m.label) || /\.[a-z0-9]+$/i.test(String(m.label || ""));
          if (candJoined && hasExplicitSeparator && qJoined.length >= 4 && candJoined.includes(qJoined)) {
            scored.push({ ind: m, score: 2e3 - Math.abs(candJoined.length - qJoined.length) });
            continue;
          }
        }
        if (m.class === "Module") {
          const termRoot = derivationalStem(tLc);
          if (termRoot !== tLc && termRoot === derivationalStem(stem)) {
            const bound = fuzzyBound(tLc);
            if (editDistance(stem, tLc, bound) > bound) {
              scored.push({ ind: m, score: 3e3 - Math.abs(stem.length - tLc.length) });
              continue;
            }
          }
        }
        if (tLc.length >= 4 && label.includes(tLc)) {
          scored.push({ ind: m, score: 1e3 - Math.abs(label.length - tLc.length) });
          continue;
        }
        const labelComps = componentSet(m.label);
        const overlap = termComps.filter((c) => labelComps.has(c)).length;
        if (overlap > 0 && (!slashStem || labelComps.has(slashStem))) {
          scored.push({ ind: m, score: overlap / termComps.length * 10 });
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length) {
      const [best, ...rest] = scored;
      const tied = rest.filter((x) => x.score === best.score);
      return {
        match: best.ind,
        candidates: rest.slice(0, 4).map((x) => x.ind),
        tier: 3,
        ambiguous: tied.length > 0
      };
    }
    const pathShaped = dotted || tLc.includes("/");
    let proseResult = null;
    const proseHits = !pathShaped && typeof lookupByProseTokens === "function" ? lookupByProseTokens(graph.proseIndex, t).filter((h) => !expectedClass || graph.byId.get(h.id)?.class === expectedClass) : [];
    if (proseHits.length) {
      const [best, ...rest] = proseHits;
      const bestInd = graph.byId.get(best.id);
      if (bestInd) {
        const tied = rest.filter((h) => h.score === best.score);
        proseResult = {
          match: bestInd,
          candidates: rest.slice(0, 4).map((h) => graph.byId.get(h.id)).filter(Boolean),
          tier: 4,
          ambiguous: tied.length > 0,
          matchedVia: "prose"
        };
        if (!proseResult.ambiguous && best.via !== "spell") return proseResult;
      }
    }
    if (!shaTerm && tLc.length >= 4) {
      const bound = fuzzyBound(tLc);
      let best = bound + 1;
      let hits = [];
      for (const m of pool) {
        let d = editDistance(String(m.label || "").toLowerCase(), tLc, bound);
        if (d > 0) {
          for (const comp of componentSet(m.label)) {
            if (d <= 0) break;
            d = Math.min(d, editDistance(comp, tLc, bound));
          }
        }
        if (d < best) {
          best = d;
          hits = [m];
        } else if (d === best && d <= bound) hits.push(m);
      }
      if (best <= bound && hits.length === 1) {
        return { match: hits[0], candidates: [], tier: 5, ambiguous: false, matchedVia: "fuzzy" };
      }
      if (best <= bound && hits.length > 1 && !proseResult) {
        const [bestInd, ...rest] = hits;
        return { match: bestInd, candidates: rest.slice(0, 4), tier: 5, ambiguous: true, matchedVia: "fuzzy" };
      }
    }
    return proseResult || { match: null, candidates: [], tier: null, ambiguous: false };
  }
  var LEADING_ARTICLE_RE = /^(?:the|a|an)\s+/i;
  var TRAILING_GRAIN_WORD_RE = new RegExp(`\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`, "i");
  function resolveObject(graph, term, opts = {}) {
    const { expectedClass = null } = opts;
    if (!expectedClass) {
      const raw = String(term || "").trim();
      const stripped = raw.replace(LEADING_ARTICLE_RE, "").trim();
      const grainMatch = stripped.match(TRAILING_GRAIN_WORD_RE);
      if (grainMatch) {
        const head = stripped.slice(0, grainMatch.index).trim();
        const grainClass = ENTITY_TO_TYPE[grainMatch[1].toLowerCase()];
        if (head && grainClass) {
          const rGrain = resolveObjectCore(graph, head, { expectedClass: grainClass });
          if (rGrain?.match?.id && !rGrain.ambiguous) return rGrain;
        }
      }
      if (stripped && stripped !== raw) {
        const rStripped = resolveObjectCore(graph, stripped, opts);
        if (rStripped?.match?.id && !rStripped.ambiguous) return rStripped;
      }
    }
    return resolveObjectCore(graph, term, opts);
  }
  function resolveTermOrContext(graph, term, contextId) {
    if (CONTEXT_PRONOUNS.includes(String(term || "").trim().toLowerCase())) {
      if (!contextId) return { match: null, candidates: [], tier: null, ambiguous: false, unresolvedPronoun: true };
      const ind = graph.byId.get(contextId);
      return ind ? { match: ind, candidates: [], tier: 1, ambiguous: false } : { match: null, candidates: [], tier: null, ambiguous: false, unresolvedPronoun: true };
    }
    return resolveObject(graph, term);
  }
  function refineToEntities(graph, moduleIds, entityType) {
    const out = [];
    for (const e of edgesOfKind2(graph, "defines")) {
      if (!moduleIds.has(e.subject)) continue;
      const ind = graph.byId.get(e.object);
      if (ind && ind.class === entityType) out.push(ind);
    }
    return out;
  }
  function commitTouches(graph, commit, entityType, extra = {}) {
    const wildcard = !entityType || entityType === "Change" || entityType === "Commit";
    const wantCoarse = wildcard || entityType === "Module";
    const wantFine = wildcard || FINE_ENTITY_TYPES.has(entityType);
    const kinds = [...wantCoarse ? ["touches"] : [], ...wantFine ? ["touchesSymbol"] : []];
    let matches = kinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === commit.id).map((e) => graph.byId.get(e.object)).filter(Boolean);
    if (entityType && FINE_ENTITY_TYPES.has(entityType)) matches = matches.filter((m) => m.class === entityType);
    return {
      matches,
      objMatch: commit,
      commitSubject: true,
      ambiguous: false,
      candidates: [],
      traversal: `${kinds.join("+")} edges where subject = commit ${commit.label}`,
      ...extra
    };
  }
  var ENTRY_POINT_QUERY_RE = /^(?:the\s+)?(?:main\s+|primary\s+)?entry[\s-]?points?(?:\s+(?:of|to|for)\s+(?:this|the)\s+(?:codebase|code|repo|repository|project|app))?$/i;
  var ENTRY_POINT_BASENAMES = /* @__PURE__ */ new Set(["index", "main", "app", "server", "cli", "__main__"]);
  var TEST_FIXTURE_PATH_SEGMENTS = /* @__PURE__ */ new Set(["test", "tests", "__tests__", "fixture", "fixtures", "spec", "specs", "testdata"]);
  var moduleStemOf = (label) => String(label).toLowerCase().split("/").pop().replace(/\.[a-z0-9]+$/, "");
  var isTestFixturePath = (label) => String(label).toLowerCase().split("/").slice(0, -1).some((seg) => TEST_FIXTURE_PATH_SEGMENTS.has(seg));
  function rankEntryPointModules(graph, term) {
    const queryWords = new Set(String(term || "").toLowerCase().split(/[\s-]+/).filter(Boolean));
    return (graph.individuals || []).filter((i) => i.class === "Module" && ENTRY_POINT_BASENAMES.has(moduleStemOf(i.label))).map((ind) => ({
      ind,
      named: queryWords.has(moduleStemOf(ind.label)) ? 1 : 0,
      depth: String(ind.label).split("/").length,
      fixture: isTestFixturePath(ind.label) ? 1 : 0
    })).sort((a, b) => b.named - a.named || a.depth - b.depth || a.fixture - b.fixture || String(a.ind.label).localeCompare(String(b.ind.label))).map((x) => x.ind);
  }
  function modifierIsWired(shape, kind, entityType) {
    return shape === "reverse" && (kind === "imports" || kind === "calls") && (!entityType || entityType === "Module");
  }
  var TRANSITIVE_MAX_DEPTH = 8;
  function traverse(graph, parsed, { contextId = null, prev = null, pinnedObjMatch = null } = {}) {
    if (!parsed) return { matches: [], objMatch: null, candidates: [], traversal: null, ambiguous: false };
    if (parsed.node) return evalComposite(graph, parsed, { contextId, prev });
    if (parsed.ambiguousParse) {
      const branches = parsed.candidates.map((c) => {
        const branchResult = traverse(graph, c, { contextId, prev });
        return { parsed: c, result: branchResult, rendered: render(c, branchResult) };
      });
      return { matches: [], objMatch: null, candidates: parsed.candidates, traversal: null, ambiguous: true, branches };
    }
    const { shape, kind, entityType } = parsed;
    if (shape === "meta") {
      const term = String(parsed.object || "").trim();
      const termLc = term.toLowerCase();
      const match = (graph.individuals || []).find((i) => {
        if (i.class !== "SchemaClass" && i.class !== "SchemaPredicate") return false;
        if (String(i.label).toLowerCase() === termLc) return true;
        const token = (i.attributes || []).find((a) => a.key === "token")?.value;
        return token && String(token).toLowerCase() === termLc;
      });
      if (!match) {
        const fallback = metaFallbackEntityAnswer(graph, term);
        if (fallback) {
          return {
            matches: [fallback.hit],
            objMatch: fallback.hit,
            candidates: [],
            ambiguous: false,
            metaCodeClass: true,
            metaFallbackText: fallback.text,
            traversal: `schema lookup for "${term}" (miss), then unique code-entity individual by label`
          };
        }
        return { matches: [], objMatch: null, candidates: [], traversal: `schema lookup for "${term}"`, ambiguous: false };
      }
      return {
        matches: [match],
        objMatch: match,
        candidates: [],
        traversal: `schema lookup for "${term}"`,
        ambiguous: false
      };
    }
    if (shape === "mentions") {
      const term = String(parsed.object || "").trim();
      const hits = typeof lookupByProseTokens === "function" ? lookupByProseTokens(graph.proseIndex, term) : [];
      const matches2 = hits.map((h) => graph.byId.get(h.id)).filter(Boolean);
      return {
        matches: matches2,
        objMatch: null,
        candidates: [],
        ambiguous: false,
        mentionsShape: true,
        traversal: `proseIndex word lookup for "${term}"`
      };
    }
    if (shape === "where" && ENTRY_POINT_QUERY_RE.test(String(parsed.object || "").trim())) {
      const ranked = rankEntryPointModules(graph, parsed.object);
      return {
        matches: ranked,
        objMatch: ranked[0] || null,
        candidates: ranked.slice(1, 5),
        ambiguous: false,
        entryPointShape: true,
        traversal: `Module individuals with an entry-point basename (${[...ENTRY_POINT_BASENAMES].join("/")}), ranked query-named basename first, then shallower path, then non-test path`
      };
    }
    if (parsed.modifier && parsed.modifier !== "direct" && !modifierIsWired(shape, kind, entityType)) {
      return {
        matches: [],
        objMatch: null,
        candidates: [],
        ambiguous: false,
        unsupportedModifier: true,
        traversal: `modifier "${parsed.modifier}" requested for a "${kind}" query \u2014 no closure traversal exists for this combination yet`
      };
    }
    if (shape === "ask") {
      const subj = resolveTermOrContext(graph, parsed.subject, contextId);
      const obj = resolveTermOrContext(graph, parsed.object, contextId);
      if (!subj.match || !obj.match || subj.ambiguous || obj.ambiguous) {
        return {
          matches: [],
          objMatch: obj.match,
          candidates: obj.candidates,
          traversal: null,
          ambiguous: false,
          answer: null,
          unresolvedPronoun: !!(subj.unresolvedPronoun || obj.unresolvedPronoun)
        };
      }
      let [from, to] = [subj.match, obj.match];
      let kinds = kindsFor(kind);
      if (kind === "touches") {
        if (to.class === "Commit" && from.class !== "Commit") [from, to] = [to, from];
        if (from.class === "Commit") kinds = ["touches", "touchesSymbol"];
      }
      const edges2 = kinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === from.id && e.object === to.id);
      return {
        matches: edges2,
        answer: edges2.length > 0,
        objMatch: obj.match,
        subjMatch: subj.match,
        candidates: [],
        traversal: `${kinds.join("+")} edge from ${from.label} to ${to.label}`,
        ambiguous: false
      };
    }
    let objRes;
    if (pinnedObjMatch) {
      objRes = { match: pinnedObjMatch, candidates: [], ambiguous: false, matchedVia: null };
    } else {
      objRes = resolveTermOrContext(graph, parsed.object, contextId);
      if (parsed.altObject && parsed.altObject !== parsed.object) {
        const altRes = resolveTermOrContext(graph, parsed.altObject, contextId);
        const primaryClean = !!objRes.match && !objRes.ambiguous;
        const altClean = !!altRes.match && !altRes.ambiguous;
        if (!primaryClean && altClean) {
          objRes = altRes;
        } else if (primaryClean && altClean && objRes.match.id !== altRes.match.id) {
          objRes = { ...objRes, ambiguous: true, candidates: [altRes.match, ...objRes.candidates || []] };
        }
      }
      if (parsed.kind === "tests" && objRes.match && !objRes.ambiguous && !String(parsed.object || "").includes("/")) {
        const stripTestInfix = (base) => base.replace(/\.(?:test|spec|tests)(?=\.[^.]+$)/, "");
        const termBase = stripTestInfix(String(parsed.object || "").trim().toLowerCase());
        const collision = (graph.individuals || []).find((i) => {
          if (i.class !== "Module" || i.id === objRes.match.id) return false;
          const base = String(i.label || "").toLowerCase().split("/").pop();
          return base !== stripTestInfix(base) && stripTestInfix(base) === termBase;
        });
        if (collision) objRes = { ...objRes, ambiguous: true, candidates: [collision, ...objRes.candidates || []] };
      }
    }
    const { match: objMatch, candidates, ambiguous, unresolvedPronoun, matchedVia } = objRes;
    if (!objMatch) return { matches: [], objMatch: null, candidates, traversal: null, ambiguous: false, unresolvedPronoun };
    if (ambiguous) {
      const pool = uniqueById([objMatch, ...candidates || []]).slice(0, OVERFLOW_CAP);
      const branches = pool.map((c) => {
        const branchResult = traverse(graph, parsed, { contextId, prev, pinnedObjMatch: c });
        return { candidate: c, result: branchResult, rendered: render(parsed, branchResult) };
      });
      return { matches: [], objMatch, candidates, traversal: null, ambiguous: true, branches };
    }
    if (shape === "where") {
      const site = (objMatch.attributes || []).find((a) => a.key === "site")?.value || null;
      return {
        matches: [objMatch],
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        whereShape: true,
        site,
        traversal: site ? `site attribute of ${objMatch.label}` : `class + defining module of ${objMatch.label}`
      };
    }
    if (shape === "when") {
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      let commits;
      if (objMatch.class === "Commit") {
        commits = [objMatch];
      } else {
        const edges2 = ["touches", "touchesSymbol"].flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === objMatch.id);
        const seen = /* @__PURE__ */ new Set();
        commits = [];
        for (const e of edges2) {
          if (seen.has(e.subject)) continue;
          seen.add(e.subject);
          const c = graph.byId.get(e.subject);
          if (c && c.class === "Commit") commits.push(c);
        }
        commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      }
      return {
        matches: commits,
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        whenShape: true,
        traversal: `touches+touchesSymbol edges where object = ${objMatch.label}, newest commit date first`
      };
    }
    if (shape === "whoLast") {
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      const edges2 = ["touches", "touchesSymbol"].flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === objMatch.id);
      const seen = /* @__PURE__ */ new Set();
      const commits = [];
      for (const e of edges2) {
        if (seen.has(e.subject)) continue;
        seen.add(e.subject);
        const c = graph.byId.get(e.subject);
        if (c && c.class === "Commit") commits.push(c);
      }
      commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      return {
        matches: commits,
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        whoLastShape: true,
        traversal: `touches+touchesSymbol edges where object = ${objMatch.label}, newest commit's author`
      };
    }
    if (kind === "touches" && objMatch.class === "Commit") {
      return commitTouches(graph, objMatch, entityType, { candidates, ambiguous, matchedVia });
    }
    if (shape === "forward") {
      const fwdSibling = SYMBOL_GRAIN_SIBLING[kind];
      const subjIsFineSymbol = !!(fwdSibling && objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
      const fwdKinds = subjIsFineSymbol ? [.../* @__PURE__ */ new Set([...kindsFor(kind), fwdSibling])] : kindsFor(kind);
      if (entityType && entityType !== "Change") {
        const wantClasses = classesForKinds(graph, fwdKinds);
        const siblingClass = FINE_CLASS_SIBLING[entityType];
        if (!wantClasses.has(entityType) && !(siblingClass && wantClasses.has(siblingClass))) {
          return {
            matches: [],
            objMatch,
            candidates,
            ambiguous,
            matchedVia,
            forwardGrainMiss: true,
            wantClasses: [...wantClasses],
            traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label} (grain mismatch: this "${kind}" relation never targets a ${classDisplayName(entityType)})`
          };
        }
      }
      const edges2 = fwdKinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === objMatch.id);
      const targets = edges2.map((e) => graph.byId.get(e.object)).filter(Boolean);
      const deduped = subjIsFineSymbol ? uniqueById(targets) : targets;
      let matches2 = deduped;
      let filterNote = "";
      if (entityType && entityType !== "Change") {
        matches2 = deduped.filter((m) => m.class === entityType);
        const siblingClass = FINE_CLASS_SIBLING[entityType];
        if (!matches2.length && siblingClass) {
          const widened = deduped.filter((m) => m.class === siblingClass);
          if (widened.length) {
            matches2 = widened;
            filterNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
          }
        }
      }
      return { matches: matches2, objMatch, candidates, traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label}${filterNote}`, ambiguous, matchedVia };
    }
    if (parsed.modifier === "transitive") {
      const levels = impactClosure(graph, objMatch, { maxDepth: TRANSITIVE_MAX_DEPTH });
      const matches2 = levels.flat().map((d) => graph.byId.get(d.id)).filter(Boolean);
      return {
        matches: matches2,
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        traversal: `reverse dependency closure over imports+calls edges from ${objMatch.label} (impactClosure, maxDepth=${TRANSITIVE_MAX_DEPTH})`
      };
    }
    const symbolKind = SYMBOL_GRAIN_SIBLING[kind];
    const objIsFineSymbol = !!(objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
    if (symbolKind && (FINE_ENTITY_TYPES.has(entityType) || objIsFineSymbol)) {
      const edges2 = edgesOfKind2(graph, symbolKind).filter((e) => e.object === objMatch.id);
      const subjects2 = uniqueById(edges2.map((e) => graph.byId.get(e.subject)).filter(Boolean));
      let matches2 = !entityType || entityType === "Change" ? subjects2 : subjects2.filter((i) => i.class === entityType);
      let widenNote = "";
      const siblingClass = FINE_CLASS_SIBLING[entityType];
      if (!matches2.length && siblingClass) {
        const widened = subjects2.filter((i) => i.class === siblingClass);
        if (widened.length) {
          matches2 = widened;
          widenNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
        }
      }
      const upRefineEligible = (kind === "touches" || kind === "calls") && objMatch.class === "Class" && !edgesOfKind2(graph, "contains").some((e) => e.subject === objMatch.id);
      const upRefineModule = upRefineEligible ? graph.byId.get(moduleIdOf2(graph, objMatch) || "") : null;
      if (matches2.length || !(upRefineEligible && upRefineModule)) {
        return { matches: matches2, objMatch, candidates, traversal: `${symbolKind} edges where object = ${objMatch.label}${widenNote}`, ambiguous, matchedVia };
      }
    }
    let gObjMatch = objMatch;
    let gCandidates = candidates;
    let gAmbiguous = ambiguous;
    let gMatchedVia = matchedVia;
    let grainRefinedNote = "";
    const wantClass = kindObjectClass(graph, kind);
    if (wantClass && gObjMatch.class && gObjMatch.class !== wantClass) {
      const retry = resolveObject(graph, parsed.object, { expectedClass: wantClass });
      if (retry.match && !retry.ambiguous) {
        gObjMatch = retry.match;
        gCandidates = retry.candidates;
        gAmbiguous = retry.ambiguous;
        gMatchedVia = retry.matchedVia;
      } else if (wantClass === "Module") {
        const mid = moduleIdOf2(graph, gObjMatch);
        const mod = mid && graph.byId.get(mid);
        if (mod) {
          grainRefinedNote = `, refined from ${gObjMatch.label} to its containing module`;
          gObjMatch = mod;
        } else {
          return {
            matches: [],
            objMatch: gObjMatch,
            candidates: gCandidates,
            ambiguous: gAmbiguous,
            matchedVia: gMatchedVia,
            wrongGrainMiss: true,
            wantClass,
            traversal: `"${parsed.object}" resolved to ${classDisplayName(gObjMatch.class)} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${classDisplayName(wantClass)}, and no containing module could be found to refine to)`
          };
        }
      } else {
        return {
          matches: [],
          objMatch: gObjMatch,
          candidates: gCandidates,
          ambiguous: gAmbiguous,
          matchedVia: gMatchedVia,
          wrongGrainMiss: true,
          wantClass,
          traversal: `"${parsed.object}" resolved to ${classDisplayName(gObjMatch.class)} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${classDisplayName(wantClass)})`
        };
      }
    }
    let edges = kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === gObjMatch.id);
    if (kind === "cochange") {
      edges = edges.concat(
        kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === gObjMatch.id).map((e) => ({ ...e, subject: e.object, object: e.subject }))
      );
    }
    let extNote = "";
    if (!edges.length && gObjMatch.class) {
      const extId = `ext:${String(gObjMatch.label).toLowerCase()}`;
      edges = kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => String(e.object).toLowerCase() === extId);
      if (edges.length) extNote = ` (by name, via unresolved ${extId} references)`;
    }
    const subjects = [];
    const seenSubjects = /* @__PURE__ */ new Set();
    for (const e of edges) {
      const s = graph.byId.get(e.subject);
      if (s && !seenSubjects.has(s.id)) {
        seenSubjects.add(s.id);
        subjects.push(s);
      }
    }
    let matches, grainNote = "";
    if (!entityType || entityType === "Change") {
      matches = subjects;
    } else {
      const direct = subjects.filter((s) => s.class === entityType);
      if (direct.length) {
        matches = direct;
      } else if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
        const moduleIds = new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id));
        matches = refineToEntities(graph, moduleIds, entityType);
        grainNote = `, then ${classDisplayName(entityType)} defined in the matched module(s)`;
      } else {
        matches = [];
      }
    }
    return {
      matches,
      objMatch: gObjMatch,
      candidates: gCandidates,
      traversal: `${kindsFor(kind).join("+")} edges where object = ${gObjMatch.label}${extNote}${grainNote}${grainRefinedNote}`,
      ambiguous: gAmbiguous,
      matchedVia: gMatchedVia
    };
  }
  function moduleLabelOf(ind) {
    if (ind.class === "Module") return ind.label;
    const site = (ind.attributes || []).find((a) => a.key === "site")?.value;
    if (site) return String(site).split(":")[0];
    const m = String(ind.id || "").match(/^fn:(.+)#/);
    return m ? m[1] : "(unknown module)";
  }
  function symbolLabelOf(ind) {
    const label = String(ind.label || ind.id || "");
    return ["Function", "Method"].includes(ind.class) ? `function ${label}()` : label;
  }
  function commitRefOf(ind) {
    const sha = String(ind.label || ind.id || "");
    const author = (ind.attributes || []).find((a) => a.key === "author")?.value;
    return author ? `${sha} (${author})` : sha;
  }
  function listJoin(syms) {
    return syms.length > 1 ? `${syms.slice(0, -1).join(", ")} and ${syms[syms.length - 1]}` : syms[0];
  }
  function describeParse(p) {
    const obj = p.object ?? p.subject ?? "?";
    const ent = p.entityType ? nounFor(p.entityType, 2) + " that " : "";
    return `${ent}${p.kind} "${obj}"`;
  }
  function canonicalOf(parsed) {
    if (!parsed) return null;
    if (parsed.ambiguousParse) {
      return {
        english: `ambiguous: ${parsed.candidates.map(describeParse).join(" \u2014 or \u2014 ")}`,
        machine: `ambiguousParse(${parsed.candidates.map((c) => canonicalOf(c)?.machine).join(", ")})`
      };
    }
    if (parsed.node) {
      return { english: `a compositional query (${parsed.node})`, machine: `composite(${parsed.node})` };
    }
    const q = (s) => JSON.stringify(String(s ?? ""));
    const args = [];
    if (parsed.kind) args.push(parsed.kind);
    if (parsed.entityType) args.push(`entityType=${parsed.entityType}`);
    if (parsed.modifier && parsed.modifier !== "direct") args.push(`modifier=${parsed.modifier}`);
    if (parsed.subject != null) args.push(`subject=${q(parsed.subject)}`);
    if (parsed.object != null) args.push(q(parsed.object));
    const machine = `${parsed.shape}(${args.join(", ")})`;
    let english;
    if (parsed.shape === "ask") {
      english = `does "${parsed.subject}" ${verbFor(parsed.kind)} "${parsed.object}"?`;
    } else if (parsed.shape === "meta") {
      english = `what does "${parsed.object}" mean, in this graph's own vocabulary?`;
    } else if (parsed.shape === "mentions") {
      english = `where is "${parsed.object}" mentioned?`;
    } else if (parsed.shape === "where") {
      english = `where is "${parsed.object}" defined?`;
    } else {
      const ent = parsed.entityType ? nounFor(parsed.entityType, 2) + " that " : "";
      english = parsed.shape === "forward" ? `what "${parsed.object}" itself ${verbFor(parsed.kind)}` : `${ent}${verbFor(parsed.kind)} "${parsed.object}"`;
    }
    return { english, machine };
  }
  function render(parsed, result) {
    const r = renderCore(parsed, result);
    if (result && result.matchedVia === "fuzzy" && result.objMatch && !r.ambiguous) {
      r.content = `assuming you meant ${result.objMatch.label}: ${r.content}`;
    }
    return r;
  }
  function renderCore(parsed, result) {
    if (!parsed) {
      return { content: `couldn't parse this as a graph question. Try: ${rephraseHint()}`, miss: true, ambiguous: false };
    }
    if (parsed.node) return renderComposite(parsed, result);
    if (parsed.ambiguousParse) {
      if (result.branches && result.branches.length) {
        const options2 = result.branches.map((b, i) => `${i + 1}) as ${describeParse(b.parsed)}: ${b.rendered.content}`).join("\n");
        return {
          content: `this could mean more than one thing:
${options2}
(ask one of these directly, or try rephrasing more specifically, to get just that reading)`,
          miss: false,
          ambiguous: true,
          candidates: parsed.candidates.map(describeParse),
          candidateParses: parsed.candidates
        };
      }
      const options = parsed.candidates.map((p, i) => `${i + 1}) ${describeParse(p)}`).join(" or ");
      return {
        content: `this could mean more than one thing: ${options} \u2014 try rephrasing more specifically.`,
        miss: false,
        ambiguous: true,
        candidates: parsed.candidates.map(describeParse),
        candidateParses: parsed.candidates
      };
    }
    if (result.unresolvedPronoun) {
      return {
        content: `"${parsed.object ?? parsed.subject}" needs a selected node to refer to \u2014 click a node first, or name it directly.`,
        miss: true,
        ambiguous: false
      };
    }
    if (result.unsupportedModifier) {
      return {
        content: `the "${parsed.modifier}" modifier isn't supported for "${parsed.kind}" queries yet \u2014 only imports/calls (module-level) have a transitive closure today.`,
        miss: true,
        ambiguous: false
      };
    }
    if (result.wrongGrainMiss) {
      const gotNoun = result.objMatch.class ? nounFor(result.objMatch.class, 1) : "term";
      const wantNoun = nounFor(result.wantClass, 1);
      return {
        content: `"${parsed.object}" resolved to the ${gotNoun} ${result.objMatch.label}, but this question needs a ${wantNoun} \u2014 no ${wantNoun} named "${parsed.object}" was found in the index.`,
        miss: true,
        ambiguous: false
      };
    }
    if (result.forwardGrainMiss) {
      const wantNouns = result.wantClasses.map((c) => nounFor(c, 2));
      return {
        content: `${result.objMatch.label}'s "${verbFor(parsed.kind)}" relation in this index never produces ${nounFor(parsed.entityType, 2)} \u2014 only ${listJoin(wantNouns)}.`,
        miss: true,
        ambiguous: false
      };
    }
    if (parsed.shape === "meta") {
      if (!result.objMatch) {
        return {
          content: `"${parsed.object}" isn't a term in this graph's own vocabulary (no matching class or predicate).`,
          miss: true,
          ambiguous: false
        };
      }
      if (result.metaCodeClass) {
        return { content: result.metaFallbackText, miss: false, ambiguous: false, matches: result.matches };
      }
      const doc = (result.objMatch.attributes || []).find((a) => a.key === "doc")?.value || "";
      const kindWord = result.objMatch.class === "SchemaClass" ? "a class in the graph's schema" : "a predicate (relation) in the graph's schema";
      return { content: `${result.objMatch.label} is ${kindWord}: ${doc}`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.mentionsShape) {
      if (!result.matches.length) {
        return {
          content: `"${parsed.object}" is not mentioned in any indexed identifier or doc-comment prose.`,
          miss: true,
          ambiguous: false
        };
      }
      const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => `${m.label} (${nounFor(m.class, 1)})`);
      const extra2 = result.matches.length > OVERFLOW_CAP ? `, \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
      return {
        content: `"${parsed.object}" is mentioned in the prose tokens of ${listJoin(shown)}${extra2}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.entryPointShape) {
      if (!result.matches.length) {
        return {
          content: `no entry-point module found in the index \u2014 no module basename matches ${listJoin([...ENTRY_POINT_BASENAMES])}.`,
          miss: true,
          ambiguous: false,
          candidates: []
        };
      }
      const [top, ...rest] = result.matches;
      const shownRest = rest.slice(0, OVERFLOW_CAP).map((i) => i.label);
      const extra2 = rest.length > OVERFLOW_CAP ? `, \u2026and ${rest.length - OVERFLOW_CAP} more` : "";
      const also = rest.length ? ` \u2014 also matched: ${listJoin(shownRest)}${extra2}` : "";
      return {
        content: `ranked ${result.matches.length} entry-point match${result.matches.length === 1 ? "" : "es"}; top: ${top.label}${also}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (!result.objMatch && (!result.candidates || result.candidates.length === 0) && parsed.shape !== "ask") {
      const objText = String(parsed.object || "").trim();
      const fallback = parsed.entityType && PLURAL_FORMS[parsed.entityType] ? nounFor(parsed.entityType, 1) : "module";
      const what = /^(?:commit[:\s])?[0-9a-f]{7,40}$/i.test(objText) ? "commit" : !objText.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(objText) ? "symbol" : fallback;
      return {
        content: `no ${what} matching "${parsed.object}" found in the index. ${touchesRephraseHint()}`,
        miss: true,
        ambiguous: false,
        candidates: []
      };
    }
    if (result.ambiguous) {
      const pool = [result.objMatch, ...result.candidates || []].filter(Boolean);
      const noun = pool.length && pool.every((i) => i.class === "Commit") ? "commit" : "module";
      const shown = pool.slice(0, OVERFLOW_CAP).map((i) => i.label);
      const extra2 = pool.length > OVERFLOW_CAP ? `, \u2026and ${pool.length - OVERFLOW_CAP} more` : "";
      const lead = `"${parsed.object}" matches more than one ${noun} ambiguously \u2014 did you mean ${listJoin(shown)}${extra2}? Try one of those. If you're not sure, narrow it to one name.`;
      const content = result.branches && result.branches.length ? `${lead}
${result.branches.map((b, i) => `${i + 1}) ${b.candidate.label}: ${b.rendered.content}`).join("\n")}` : lead;
      return {
        content,
        miss: false,
        ambiguous: true,
        candidates: pool.map((i) => i.label)
      };
    }
    if (result.whereShape) {
      const ind = result.objMatch;
      if (ind.class === "Module") {
        return { content: `${ind.label} is a module \u2014 the label is its repo path.`, miss: false, ambiguous: false, matches: result.matches };
      }
      if (ind.class === "Commit") {
        return { content: `${ind.label} is a commit, not a code location \u2014 try "what did commit ${ind.label} touch".`, miss: true, ambiguous: false };
      }
      const m = String(result.site || "").match(/^(.*):(\d+)(?:-(\d+))?$/);
      if (m) {
        const lines = m[3] && m[3] !== m[2] ? `lines ${m[2]}-${m[3]}` : `line ${m[2]}`;
        return { content: `${symbolLabelOf(ind)} is defined in ${m[1]} at ${lines}.`, miss: false, ambiguous: false, matches: result.matches };
      }
      return {
        content: `${symbolLabelOf(ind)} is defined in ${moduleLabelOf(ind)} (no line span recorded in this index).`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.whenShape) {
      const subject = result.objMatch.label;
      if (!result.matches.length) {
        return { content: `no recorded commit touches ${subject} in this index. ${touchesRephraseHint()}`, miss: true, ambiguous: false };
      }
      const newest = result.matches[0];
      const date = (newest.attributes || []).find((a) => a.key === "date")?.value || "";
      if (!date) {
        return {
          content: `commit ${newest.label} touched ${subject}, but this index records no commit dates \u2014 regenerate the graph to attach mgx:commitDate.`,
          miss: true,
          ambiguous: false
        };
      }
      const msg = (newest.attributes || []).find((a) => a.key === "message")?.value || "";
      const day = String(date).slice(0, 10);
      if (newest.id === result.objMatch.id) {
        return { content: `commit ${newest.label} ${pickPhrase("is-dated", newest.id, "is dated")} ${day}${msg ? ` ("${msg}")` : ""}.`, miss: false, ambiguous: false, matches: result.matches };
      }
      const more = result.matches.length - 1;
      return {
        content: `${subject} was last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.whoLastShape) {
      const subject = result.objMatch.label;
      if (!result.matches.length) {
        return { content: `no recorded commit touches ${subject} in this index. ${touchesRephraseHint()}`, miss: true, ambiguous: false };
      }
      const newest = result.matches[0];
      const author = (newest.attributes || []).find((a) => a.key === "author")?.value;
      if (!author) {
        return {
          content: `commit ${newest.label} last touched ${subject}, but this index records no commit author \u2014 regenerate the graph to attach mgx:commitAuthor.`,
          miss: true,
          ambiguous: false
        };
      }
      const more = result.matches.length - 1;
      return {
        content: `${subject} was last touched by ${author} (commit ${newest.label})${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.commitSubject) {
      const cite = `commit ${result.objMatch.label}`;
      if (!result.matches.length) {
        return {
          content: `${cite} touched nothing recorded in the index.`,
          miss: true,
          ambiguous: false
        };
      }
      const byClass = /* @__PURE__ */ new Map();
      for (const m of result.matches.slice(0, OVERFLOW_CAP)) {
        const cls = m.class || "Module";
        if (!byClass.has(cls)) byClass.set(cls, []);
        byClass.get(cls).push(["Function", "Method"].includes(cls) ? `${m.label}()` : m.label);
      }
      const clauses2 = [...byClass.entries()].map(([cls, labels]) => `${nounFor(cls, labels.length)} ${listJoin(labels)}`);
      const extra2 = result.matches.length > OVERFLOW_CAP ? `; \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
      return { content: `${cite} touched ${clauses2.join("; ")}${extra2}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (parsed.shape === "ask") {
      if (!result.objMatch || !result.subjMatch) {
        return { content: `couldn't resolve one of the terms in this question.`, miss: true, ambiguous: false };
      }
      return {
        content: result.answer ? `Yes \u2014 ${result.traversal}.` : `No \u2014 no ${parsed.kind} edge found from ${result.subjMatch.label} to ${result.objMatch.label}.`,
        miss: !result.answer,
        ambiguous: false
      };
    }
    if (!result.matches.length) {
      if (parsed.shape === "forward") {
        return {
          content: `${result.objMatch.label} has no ${verbFor(parsed.kind)} edges in the index.`,
          miss: true,
          ambiguous: false
        };
      }
      if (parsed.kind === "tests" && !parsed.entityType) {
        const stripped = String(parsed.object || "").replace(LEADING_RELATION_VERB_RE, "").trim();
        const obj = stripped || String(parsed.object || "").trim();
        return {
          content: `No tests cover ${obj}.`,
          miss: true,
          ambiguous: false
        };
      }
      const entityWord = nounFor(parsed.entityType || "Module", 2);
      return {
        content: `No ${entityWord} found whose module directly ${verbFor(parsed.kind)} ${parsed.object}. ${touchesRephraseHint()}`,
        miss: true,
        ambiguous: false
      };
    }
    if (parsed.shape === "forward" || parsed.entityType === "Module" || result.matches.every((m) => !FINE_ENTITY_TYPES.has(m.class))) {
      const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => m.class === "Commit" ? commitRefOf(m) : m.label);
      const extra2 = result.matches.length > OVERFLOW_CAP ? `, \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
      return { content: shown.join(" and ") + extra2 + ".", miss: false, ambiguous: false, matches: result.matches };
    }
    const byModule = /* @__PURE__ */ new Map();
    for (const m of result.matches.slice(0, OVERFLOW_CAP)) {
      const mod = moduleLabelOf(m);
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod).push(symbolLabelOf(m));
    }
    const clauses = [...byModule.entries()].map(([mod, syms], i) => {
      const list = listJoin(syms);
      return i === 0 ? `in ${mod} there is ${list}` : `there is ${list} in ${mod}`;
    });
    const extra = result.matches.length > OVERFLOW_CAP ? ` \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
    return { content: clauses.join(" and ") + extra + ".", miss: false, ambiguous: false, matches: result.matches };
  }
  var CONTENT_VOCAB = /* @__PURE__ */ new Set([
    ...wordsOf(Object.keys(VERB_TO_KIND)),
    ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
    ...wordsOf(Object.keys(MODIFIER_TO_KIND)),
    ...wordsOf(Object.keys(QUALIFIERS)),
    ...wordsOf(AGGREGATE_TRIGGERS),
    ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)),
    ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)),
    ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)),
    ...wordsOf(PLACEHOLDER_NOUNS),
    ...wordsOf(ANAPHORA_TRIGGERS),
    ...wordsOf(META_MEANING_VERBS),
    ...wordsOf(WHERE_MARKERS),
    ...wordsOf(MENTION_MARKERS),
    ...wordsOf(RELATIVE_PRONOUNS),
    ...wordsOf(Object.keys(CASCADE_SYNONYMS))
  ]);
  var STRUCTURAL_WORDS = /* @__PURE__ */ new Set([...STOPWORDS2, ...FRAME_WORDS, ...CONTEXT_PRONOUNS]);
  var CASCADE_NOISE_SET = new Set(wordsOf(CASCADE_NOISE));
  var NOISE_OR_SCAFFOLD = /* @__PURE__ */ new Set([...CASCADE_NOISE_SET, ...STRUCTURAL_WORDS]);
  var TRIGGER_FUZZY_WORDS = [
    "many",
    "count",
    "number",
    "quantity",
    "total",
    "tally",
    "list",
    "show",
    "display",
    "print",
    "dump",
    "enumerate",
    "name"
  ];
  var CASCADE_FUZZY_TARGETS = [.../* @__PURE__ */ new Set([
    ...wordsOf(Object.keys(VERB_TO_KIND)),
    ...Object.keys(ENTITY_TO_TYPE),
    ...TRIGGER_FUZZY_WORDS
  ])].filter((wd) => /^[a-z]+$/.test(wd) && wd.length >= 4 && !STOPWORDS2.has(wd));
  function fuzzyCascadeWord(w) {
    const bound = fuzzyBound(w);
    let best = bound + 1;
    let hit = null;
    let tied = false;
    for (const target of CASCADE_FUZZY_TARGETS) {
      const d = editDistance(w, target, Math.min(best, bound));
      if (d < best) {
        best = d;
        hit = target;
        tied = false;
      } else if (d === best && d <= bound && target !== hit) tied = true;
    }
    return best <= bound && !tied ? hit : null;
  }
  function schemaTypoTrap(resolution, term) {
    if (!resolution?.match || resolution.matchedVia !== "fuzzy" || resolution.ambiguous) return false;
    const cls = resolution.match.class;
    if (cls !== "SchemaClass" && cls !== "SchemaPredicate") return false;
    const lc = String(term || "").trim().toLowerCase();
    const kindNoun = fuzzyCascadeWord(lc);
    return !!kindNoun && kindNoun !== lc && !!ENTITY_TO_TYPE[kindNoun];
  }
  function answerable(graph, parsed, contextId) {
    if (!parsed) return false;
    if (parsed.ambiguousParse) return "ambiguous";
    if (parsed.node) return parsed.node !== "miss";
    if (parsed.shape === "meta" || parsed.shape === "mentions") return true;
    const o = resolveTermOrContext(graph, parsed.object, contextId);
    if (o.unresolvedPronoun) return "pronoun";
    if (!o.match || schemaTypoTrap(o, parsed.object)) return false;
    if (parsed.shape === "ask") {
      const s = resolveTermOrContext(graph, parsed.subject, contextId);
      if (s.unresolvedPronoun) return "pronoun";
      return s.match && !schemaTypoTrap(s, parsed.subject) ? true : false;
    }
    return true;
  }
  function isHelpRequest(query) {
    const q = String(query || "").trim().toLowerCase().replace(/[?.!\s]+$/, "");
    return HELP_TRIGGERS.includes(q);
  }
  function relaxParse(graph, query, { nlp = void 0, contextId = null, prev = null } = {}) {
    const from = applyNegationFrames(normalizeQuery(String(query || "")));
    let tokens = splitWords(from);
    if (!tokens.length) return null;
    const dropped = [];
    const steps = [];
    const resolvesExact = (t) => {
      const r = resolveObject(graph, t);
      return !!r.match && r.tier != null && r.tier <= 2;
    };
    const resolvesLiteral = (t) => {
      const r = resolveObject(graph, t);
      return !!r.match && r.tier != null && r.tier <= 3;
    };
    const hasRealTerm = (s) => {
      const whole = String(s || "").trim().toLowerCase();
      if (CONTEXT_PRONOUNS.includes(whole)) return true;
      return splitWords(whole).some((w) => {
        const lc = w.toLowerCase();
        return !CONTENT_VOCAB.has(lc) && !STRUCTURAL_WORDS.has(lc);
      });
    };
    const TERM_SHAPES = /* @__PURE__ */ new Set(["reverse", "forward", "where", "when", "ask"]);
    const attempt = (toks) => {
      const text = toks.join(" ");
      const p = parseQuery(text, { nlp });
      if (answerable(graph, p, contextId) !== true) return null;
      if (p && !p.node && TERM_SHAPES.has(p.shape)) {
        if (p.object != null && !hasRealTerm(p.object)) return null;
        if (p.shape === "ask" && p.subject != null && !hasRealTerm(p.subject)) return null;
      }
      const rendered = render(p, traverse(graph, p, { contextId, prev }));
      return rendered.miss ? null : { parsed: p, text };
    };
    const done = (hit) => ({ parsed: hit.parsed, from, to: hit.text, dropped: [...dropped], steps });
    let guard = 0;
    const hardCap = Math.max(tokens.length, 1) + 12;
    for (; guard < hardCap; guard += 1) {
      let idx = -1;
      for (let i = 0; i < tokens.length; i += 1) {
        const lc = tokens[i].toLowerCase();
        if (CASCADE_NOISE_SET.has(lc) && !CONTENT_VOCAB.has(lc) && !resolvesExact(tokens[i])) {
          idx = i;
          break;
        }
      }
      if (idx < 0) break;
      const removed = tokens[idx];
      tokens = tokens.filter((_, i) => i !== idx);
      dropped.push(removed);
      steps.push(`strip noise "${removed}" \u2192 "${tokens.join(" ")}"`);
      const hit = attempt(tokens);
      if (hit) return done(hit);
    }
    const survivors = [];
    const nowDropped = [];
    const corrected = [];
    for (const t of tokens) {
      const lc = t.toLowerCase();
      const plain = /^[a-z]+$/.test(lc);
      if (!plain || CONTENT_VOCAB.has(lc) || STRUCTURAL_WORDS.has(lc) || resolvesLiteral(t)) {
        survivors.push(t);
        continue;
      }
      const fix = fuzzyCascadeWord(lc);
      if (fix && fix !== lc) {
        survivors.push(fix);
        corrected.push(`${t}\u2192${fix}`);
        continue;
      }
      nowDropped.push(t);
    }
    if ((corrected.length || nowDropped.length) && survivors.length) {
      tokens = survivors;
      dropped.push(...nowDropped);
      if (corrected.length) steps.push(`fuzzy-correct ${JSON.stringify(corrected)} \u2192 "${tokens.join(" ")}"`);
      if (nowDropped.length) steps.push(`drop unmatched ${JSON.stringify(nowDropped)} \u2192 "${tokens.join(" ")}"`);
      const hit = attempt(tokens);
      if (hit) return done(hit);
    }
    let changed = false;
    const normed = tokens.map((t) => {
      const lc = t.toLowerCase();
      if (CASCADE_SYNONYMS[lc] && !resolvesLiteral(t)) {
        changed = true;
        return CASCADE_SYNONYMS[lc];
      }
      return t;
    });
    if (changed) {
      steps.push(`normalise synonyms \u2192 "${normed.join(" ")}"`);
      const hit = attempt(normed);
      if (hit) return done(hit);
    }
    const bareLc = splitWords(from).map((t) => t.toLowerCase());
    const kindWords = [];
    const others = [];
    for (const t of bareLc) {
      if (NOISE_OR_SCAFFOLD.has(t)) continue;
      const et = ENTITY_TO_TYPE[t];
      if (et && et !== "Change") kindWords.push(t);
      else others.push(t);
    }
    if (kindWords.length === 1 && others.length === 0) {
      const hit = attempt(["count", kindWords[0]]);
      if (hit) {
        steps.push(`bare kind "${kindWords[0]}" \u2192 count`);
        return done(hit);
      }
    }
    return null;
  }
  var LAST_COMMIT_PHRASE_RE = /\b(?:the\s+)?(?:last|latest|most\s+recent)\s+commit\b/i;
  var BARE_WHEN_COMMIT_RE = /^when\s+(?:was|were|is|did|does|do)\s+commit\s+[0-9a-fA-F:]+$/i;
  function substituteLastCommitPhrase(graph, query) {
    const q = String(query || "");
    if (!graph || !LAST_COMMIT_PHRASE_RE.test(q)) return q;
    const commits = graph.individuals.filter((i) => i.class === "Commit");
    if (!commits.length) return q;
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    const newest = [...commits].sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0];
    if (!newest) return q;
    const out = q.replace(LAST_COMMIT_PHRASE_RE, `commit ${newest.label}`);
    const bareTrimmed = out.trim().replace(/[?.!]+$/, "");
    return BARE_WHEN_COMMIT_RE.test(bareTrimmed) ? `${bareTrimmed} touched` : out;
  }
  function singularCandidates(word) {
    const w = String(word || "").toLowerCase();
    const c = /* @__PURE__ */ new Set([w]);
    if (w.endsWith("ies")) c.add(`${w.slice(0, -3)}y`);
    if (w.endsWith("ses")) c.add(w.slice(0, -2));
    else if (w.endsWith("es")) c.add(w.slice(0, -2));
    if (w.endsWith("s") && w.length > 1) c.add(w.slice(0, -1));
    return [...c];
  }
  function resolveDynamicClass(graph, word) {
    const cands = singularCandidates(word);
    for (const ind of graph?.individuals || []) {
      if (ind?.class && cands.includes(String(ind.class).toLowerCase())) return ind.class;
    }
    return null;
  }
  var DYNAMIC_LIST_TRIGGER_RE = /^(?:list|show(?:\s+me)?)\s+(?:all\s+|the\s+)?([a-z][a-z'-]*)\s*(.*)$/i;
  var DYNAMIC_COUNT_TRIGGER_RE = /^(?:how\s+many|number\s+of|count(?:\s+the)?)\s+([a-z][a-z'-]*)\s*(.*)$/i;
  var DYNAMIC_TAIL_OK_RE = /^(?:are there(?:\s+in\s+total)?|is there|do you know(?:\s+about)?|do you have|exist(?:s)?|are known|in (?:the |a )?(?:graph|memory)|you know(?:\s+about)?)?[?.!\s]*$/i;
  function dynamicClassQuery(graph, query) {
    const q = String(query || "").trim();
    const listM = q.match(DYNAMIC_LIST_TRIGGER_RE);
    const countM = !listM ? q.match(DYNAMIC_COUNT_TRIGGER_RE) : null;
    const m = listM || countM;
    if (!m || !DYNAMIC_TAIL_OK_RE.test(m[2] || "")) return null;
    if (ENTITY_TO_TYPE[m[1].toLowerCase()]) return null;
    const entityType = resolveDynamicClass(graph, m[1]);
    if (!entityType) return null;
    const base = { node: "allOfClass", entityType };
    return listM ? { node: "list", entityType, base, scoped: false } : { node: "count", entityType, base };
  }
  var BARE_META_WHATIS_RE = /^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  var WHATIS_FOR_FALLBACK_RE = /^what\s+is\s+(?:the\s+)?(?!(?:an?|it|this|that|these|those)\s)(.+?)\s+(?:used\s+)?for[?.!\s]*$/i;
  function ask(graph, query, { contextId = null, nlp = void 0, prev = null } = {}) {
    if (isHelpRequest(query)) {
      return {
        content: rephraseHint(),
        tmct_ask: {
          mechanical: true,
          parsed: null,
          canonical: null,
          matches: [],
          traversal: null,
          miss: true,
          ambiguous: false,
          matchedVia: null,
          help: true,
          relaxed: null
        }
      };
    }
    query = substituteLastCommitPhrase(graph, query);
    const directFull = parseQueryFull(query, { nlp });
    const direct = directFull.parsed;
    let parsed = direct;
    let relaxed = null;
    if (answerable(graph, direct, contextId) === false) {
      const r = relaxParse(graph, query, { nlp, contextId, prev });
      if (r) {
        parsed = r.parsed;
        relaxed = { from: r.from, to: r.to, dropped: r.dropped, steps: r.steps };
      }
    }
    let result = traverse(graph, parsed, { contextId, prev });
    let rendered = render(parsed, result);
    if (rendered.miss && !rendered.ambiguous) {
      const dyn = dynamicClassQuery(graph, query);
      if (dyn) {
        const dynResult = traverse(graph, dyn, { contextId, prev });
        const dynRendered = render(dyn, dynResult);
        if (!dynRendered.miss) {
          parsed = dyn;
          result = dynResult;
          rendered = dynRendered;
          relaxed = null;
        }
      }
    }
    if (parsed === null && rendered.miss && !rendered.ambiguous) {
      const bareM = String(query || "").trim().match(BARE_META_WHATIS_RE);
      const bareTerm = bareM?.[1]?.trim();
      if (bareTerm && !/\s+(?:for|about)$/i.test(bareTerm)) {
        const bareParsed = parseQuery(`what is a ${bareTerm}`, { nlp });
        if (bareParsed?.shape === "meta") {
          result = traverse(graph, bareParsed, { contextId, prev });
          rendered = render(bareParsed, result);
        }
      }
    }
    if (parsed === null && rendered.miss && !rendered.ambiguous) {
      const forM = normalizeQuery(String(query || "")).match(WHATIS_FOR_FALLBACK_RE);
      const forTerm = forM?.[1]?.trim();
      if (forTerm) {
        const forParsed = parseQuery(`what is a ${forTerm}`, { nlp });
        if (forParsed?.shape === "meta") {
          const forResult = traverse(graph, forParsed, { contextId, prev });
          const forRendered = render(forParsed, forResult);
          if (!forRendered.miss && !forRendered.ambiguous) {
            result = forResult;
            rendered = forRendered;
          }
        }
      }
    }
    let content = relaxed && !rendered.miss && relaxed.to !== relaxed.from ? `read as "${relaxed.to}" \u2014 ${rendered.content}` : rendered.content;
    if (!relaxed && !rendered.miss && !rendered.ambiguous && directFull.alternates.length) {
      const answered = directFull.alternates.map((a) => {
        const altResult = traverse(graph, a.parsed, { contextId, prev });
        const altRendered = render(a.parsed, altResult);
        return altRendered.miss ? null : { a, text: altRendered.content };
      }).filter(Boolean);
      if (answered.length) {
        const lines = alternateLines(answered.map((x) => x.a), {
          answerFor: (a) => answered.find((x) => x.a === a)?.text || null
        });
        content = `${content}
${lines.join("\n")}`;
      }
    }
    return {
      content,
      tmct_ask: {
        mechanical: true,
        parsed: parsed && !parsed.ambiguousParse ? parsed : null,
        canonical: canonicalOf(parsed),
        matches: (result.matches || []).map((m) => ({
          id: m.id,
          label: m.label,
          type: m.class,
          module: m.class ? moduleLabelOf(m) : void 0
        })),
        traversal: result.traversal || null,
        miss: !!rendered.miss,
        ambiguous: !!rendered.ambiguous,
        // null when the direct parse was used as-is; a caller can assert
        // relaxed===null to prove the cascade never touched a direct hit.
        relaxed,
        // "prose" (tier-4 prose-index fallback) or "fuzzy" (tier-5 bounded
        // edit-distance, announced in the content as "assuming you meant …");
        // null for every literal-identifier tier.
        matchedVia: result.matchedVia || null,
        ...rendered.ambiguous ? { candidates: rendered.candidates, candidateParses: rendered.candidateParses } : {}
      }
    };
  }

  // src/ask-browser-entry.mjs
  globalThis.tmctViz = {
    ask,
    parseQuery,
    parseEntities,
    spiralExpand,
    mostRecentIndividual,
    derivedUpdatedAt,
    MEMORY_SPIRAL_EXPAND_KINDS,
    MEMORY_FACT_LINK_KINDS,
    buildVizNodesAndEdges,
    deriveFactTermGraph,
    pickLegendDimension,
    legendValueFor,
    edgeKindsFor,
    collapseToTopN
  };
})();
