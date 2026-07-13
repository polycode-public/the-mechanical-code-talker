(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node-stub:node:path
  var unavailable, createRequire, readFileSync, writeFileSync, readFile, writeFile, appendFile, mkdir, mkdtemp, rename, unlink, rm, stat, access, copyFile, readdir, createReadStream, createWriteStream, join, dirname, randomBytes, createHash, createRequireFromPath, spawnSync, createInterface, DatabaseSync;
  var init_node_path = __esm({
    "node-stub:node:path"() {
      unavailable = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire = unavailable("createRequire");
      readFileSync = unavailable("readFileSync");
      writeFileSync = unavailable("writeFileSync");
      readFile = unavailable("readFile");
      writeFile = unavailable("writeFile");
      appendFile = unavailable("appendFile");
      mkdir = unavailable("mkdir");
      mkdtemp = unavailable("mkdtemp");
      rename = unavailable("rename");
      unlink = unavailable("unlink");
      rm = unavailable("rm");
      stat = unavailable("stat");
      access = unavailable("access");
      copyFile = unavailable("copyFile");
      readdir = unavailable("readdir");
      createReadStream = unavailable("createReadStream");
      createWriteStream = unavailable("createWriteStream");
      join = (...a) => a.join("/");
      dirname = (p) => String(p).replace(/\/[^/]*$/, "");
      randomBytes = unavailable("randomBytes");
      createHash = unavailable("createHash");
      createRequireFromPath = unavailable("createRequireFromPath");
      spawnSync = unavailable("spawnSync");
      createInterface = unavailable("createInterface");
      DatabaseSync = unavailable("DatabaseSync");
    }
  });

  // node-stub:node:fs
  var unavailable2, createRequire2, readFileSync2, writeFileSync2, readFile2, writeFile2, appendFile2, mkdir2, mkdtemp2, rename2, unlink2, rm2, stat2, access2, copyFile2, readdir2, createReadStream2, createWriteStream2, randomBytes2, createHash2, createRequireFromPath2, spawnSync2, createInterface2, DatabaseSync2;
  var init_node_fs = __esm({
    "node-stub:node:fs"() {
      unavailable2 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire2 = unavailable2("createRequire");
      readFileSync2 = unavailable2("readFileSync");
      writeFileSync2 = unavailable2("writeFileSync");
      readFile2 = unavailable2("readFile");
      writeFile2 = unavailable2("writeFile");
      appendFile2 = unavailable2("appendFile");
      mkdir2 = unavailable2("mkdir");
      mkdtemp2 = unavailable2("mkdtemp");
      rename2 = unavailable2("rename");
      unlink2 = unavailable2("unlink");
      rm2 = unavailable2("rm");
      stat2 = unavailable2("stat");
      access2 = unavailable2("access");
      copyFile2 = unavailable2("copyFile");
      readdir2 = unavailable2("readdir");
      createReadStream2 = unavailable2("createReadStream");
      createWriteStream2 = unavailable2("createWriteStream");
      randomBytes2 = unavailable2("randomBytes");
      createHash2 = unavailable2("createHash");
      createRequireFromPath2 = unavailable2("createRequireFromPath");
      spawnSync2 = unavailable2("spawnSync");
      createInterface2 = unavailable2("createInterface");
      DatabaseSync2 = unavailable2("DatabaseSync");
    }
  });

  // node-stub:node:fs/promises
  var unavailable3, createRequire3, readFileSync3, writeFileSync3, readFile3, writeFile3, appendFile3, mkdir3, mkdtemp3, rename3, unlink3, rm3, stat3, access3, copyFile3, readdir3, createReadStream3, createWriteStream3, randomBytes3, createHash3, createRequireFromPath3, spawnSync3, createInterface3, DatabaseSync3;
  var init_promises = __esm({
    "node-stub:node:fs/promises"() {
      unavailable3 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire3 = unavailable3("createRequire");
      readFileSync3 = unavailable3("readFileSync");
      writeFileSync3 = unavailable3("writeFileSync");
      readFile3 = unavailable3("readFile");
      writeFile3 = unavailable3("writeFile");
      appendFile3 = unavailable3("appendFile");
      mkdir3 = unavailable3("mkdir");
      mkdtemp3 = unavailable3("mkdtemp");
      rename3 = unavailable3("rename");
      unlink3 = unavailable3("unlink");
      rm3 = unavailable3("rm");
      stat3 = unavailable3("stat");
      access3 = unavailable3("access");
      copyFile3 = unavailable3("copyFile");
      readdir3 = unavailable3("readdir");
      createReadStream3 = unavailable3("createReadStream");
      createWriteStream3 = unavailable3("createWriteStream");
      randomBytes3 = unavailable3("randomBytes");
      createHash3 = unavailable3("createHash");
      createRequireFromPath3 = unavailable3("createRequireFromPath");
      spawnSync3 = unavailable3("spawnSync");
      createInterface3 = unavailable3("createInterface");
      DatabaseSync3 = unavailable3("DatabaseSync");
    }
  });

  // src/config.mjs
  var DEFAULT_GRAPH_REL;
  var init_config = __esm({
    "src/config.mjs"() {
      init_node_path();
      DEFAULT_GRAPH_REL = join(".tmct", "graph.json");
    }
  });

  // src/source-slice.mjs
  var init_source_slice = __esm({
    "src/source-slice.mjs"() {
      init_node_path();
      init_config();
    }
  });

  // src/prose.mjs
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
  function proseTokensFor({ name, doc } = {}) {
    const set = /* @__PURE__ */ new Set([...splitIdentifierWords(name), ...tokenizeProse(doc)]);
    return [...set].sort();
  }
  function buildProseIndex(individuals) {
    const index = /* @__PURE__ */ Object.create(null);
    for (const ind of individuals) {
      const tokAttr = (ind.attributes || []).find((a) => a.key === "prose_tokens");
      if (!tokAttr?.value) continue;
      for (const word of tokAttr.value.split(" ")) {
        if (!index[word]) index[word] = [];
        index[word].push(ind.id);
      }
    }
    for (const word of Object.keys(index)) index[word].sort();
    return index;
  }
  var STOPWORDS, MAX_TOKEN_LEN, MAX_TOKENS_PER_DOC;
  var init_prose = __esm({
    "src/prose.mjs"() {
      STOPWORDS = new Set(
        "a an and or but the of to in on at for with from by as is are was were be been being it its this that these those i you he she they we me my your our do does did not no yes if then else than so such can will would should could may might about into over under out up down off again more most some any all what which who whom whose when where why how".split(/\s+/)
      );
      MAX_TOKEN_LEN = 40;
      MAX_TOKENS_PER_DOC = 120;
    }
  });

  // node-stub:node:url
  var unavailable7, createRequire7, readFileSync7, writeFileSync7, readFile7, writeFile7, appendFile7, mkdir7, mkdtemp7, rename7, unlink7, rm7, stat7, access7, copyFile7, readdir7, createReadStream7, createWriteStream7, fileURLToPath, randomBytes7, createHash7, createRequireFromPath7, spawnSync7, createInterface7, DatabaseSync7;
  var init_node_url = __esm({
    "node-stub:node:url"() {
      unavailable7 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire7 = unavailable7("createRequire");
      readFileSync7 = unavailable7("readFileSync");
      writeFileSync7 = unavailable7("writeFileSync");
      readFile7 = unavailable7("readFile");
      writeFile7 = unavailable7("writeFile");
      appendFile7 = unavailable7("appendFile");
      mkdir7 = unavailable7("mkdir");
      mkdtemp7 = unavailable7("mkdtemp");
      rename7 = unavailable7("rename");
      unlink7 = unavailable7("unlink");
      rm7 = unavailable7("rm");
      stat7 = unavailable7("stat");
      access7 = unavailable7("access");
      copyFile7 = unavailable7("copyFile");
      readdir7 = unavailable7("readdir");
      createReadStream7 = unavailable7("createReadStream");
      createWriteStream7 = unavailable7("createWriteStream");
      fileURLToPath = (u) => String(u);
      randomBytes7 = unavailable7("randomBytes");
      createHash7 = unavailable7("createHash");
      createRequireFromPath7 = unavailable7("createRequireFromPath");
      spawnSync7 = unavailable7("spawnSync");
      createInterface7 = unavailable7("createInterface");
      DatabaseSync7 = unavailable7("DatabaseSync");
    }
  });

  // src/embed.mjs
  var init_embed = __esm({
    "src/embed.mjs"() {
      init_node_fs();
      init_node_path();
      init_node_url();
    }
  });

  // src/hash.mjs
  function fnv1a32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function fnv1aHex(str) {
    return fnv1a32(str).toString(16).padStart(8, "0");
  }
  var init_hash = __esm({
    "src/hash.mjs"() {
    }
  });

  // src/memory/trust.mjs
  function sourceReliabilityOf(s) {
    const raw = (s?.attributes || []).find((a) => a.prop === "mgx:sourceReliability")?.value;
    if (raw === void 0) return SOURCE_RELIABILITY_NEUTRAL;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SOURCE_RELIABILITY_NEUTRAL;
    return Math.max(SOURCE_RELIABILITY_MIN, Math.min(SOURCE_RELIABILITY_MAX, n));
  }
  function recencyNudge(createdAt, now = Date.now(), halfLifeMs = RECENCY_HALF_LIFE_MS) {
    const t = Date.parse(createdAt);
    if (!Number.isFinite(t)) return 1;
    const ageMs = Math.max(0, now - t);
    return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageMs / halfLifeMs);
  }
  function computeTrust(fact, sourcesById = {}, opts = {}) {
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    const ids = Array.isArray(fact?.sourceIds) ? fact.sourceIds : [];
    const seen = /* @__PURE__ */ new Set();
    const types = [];
    const priors = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const source = sourcesById[id];
      const t = sourceTypeOf(source);
      if (!t) continue;
      types.push(t);
      const p = (SOURCE_PRIOR[t] ?? 0) * sourceReliabilityOf(source);
      priors.push(Math.max(0, Math.min(1, p)));
    }
    let base = 0;
    let complement = 1;
    for (const p of priors) complement *= 1 - p;
    if (priors.length) base = Math.min(1, 1 - complement);
    if (types.includes("entailed") && Array.isArray(opts.premiseTrusts) && opts.premiseTrusts.length) {
      const rc = typeof opts.ruleConfidence === "number" ? opts.ruleConfidence : 1;
      base = Math.max(0, Math.min(1, Math.min(...opts.premiseTrusts) * rc));
    }
    const recency = recencyNudge(fact?.createdAt, now, opts.halfLifeMs);
    const score = round(Math.min(1, base * recency));
    const inputs = {
      sourceTypes: types.slice().sort(),
      corroboration: types.length,
      createdAt: fact?.createdAt || "",
      recency: round(recency)
    };
    return { score, inputs };
  }
  function sessionReliabilityFrom({ factsAsserted = 0, factsContradicted = 0 } = {}) {
    const asserted = Math.max(0, Number(factsAsserted) || 0);
    const contradicted = Math.max(0, Number(factsContradicted) || 0);
    const net = Math.max(-1, Math.min(1, (asserted - 2 * contradicted) / Math.max(1, asserted)));
    const confidence = asserted / (asserted + RELIABILITY_CONFIDENCE_PSEUDOCOUNT);
    const ratio = (net * confidence + 1) / 2;
    return round(SOURCE_RELIABILITY_MIN + (SOURCE_RELIABILITY_MAX - SOURCE_RELIABILITY_MIN) * ratio);
  }
  var TRUST_SCORE_PROP, TRUST_INPUTS_PROP, SOURCE_PRIOR, RECENCY_HALF_LIFE_MS, RECENCY_FLOOR, SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX, SOURCE_RELIABILITY_NEUTRAL, round, sourceTypeOf, RELIABILITY_CONFIDENCE_PSEUDOCOUNT;
  var init_trust = __esm({
    "src/memory/trust.mjs"() {
      TRUST_SCORE_PROP = "mgx:trustScore";
      TRUST_INPUTS_PROP = "mgx:trustInputs";
      SOURCE_PRIOR = Object.freeze({
        operator: 1,
        teach: 0.95,
        provider: 0.9,
        corpus: 0.7,
        corpusWeak: 0.55,
        web: 0.4,
        extracted: 0.45,
        entailed: 0.3
      });
      RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1e3;
      RECENCY_FLOOR = 0.9;
      SOURCE_RELIABILITY_MIN = 0.5;
      SOURCE_RELIABILITY_MAX = 1.5;
      SOURCE_RELIABILITY_NEUTRAL = 1;
      round = (n, p = 6) => Number(n.toFixed(p));
      sourceTypeOf = (s) => (s?.attributes || []).find((a) => a.prop === "mgx:sourceType")?.value || "";
      RELIABILITY_CONFIDENCE_PSEUDOCOUNT = 19;
    }
  });

  // src/memory/shacl.mjs
  function attrValue(ind, prop) {
    const a = (ind?.attributes || []).find((x) => x?.prop === prop);
    return a ? String(a.value ?? "") : void 0;
  }
  function checkIndividual(ind, violations) {
    if (!ind?.class || !MEMORY_CLASSES.has(ind.class)) {
      violations.push(`must have a class from the closed vocabulary Utterance | Fact | Session | Source | Rule (got ${JSON.stringify(ind?.class)})`);
    }
  }
  function checkFact(ind, violations) {
    for (const prop of ["rdf:subject", "rdf:predicate", "rdf:object"]) {
      if (!nonEmpty(attrValue(ind, prop))) violations.push(`a Fact needs a non-empty ${prop}`);
    }
    const prov = attrValue(ind, "mgx:factProvenance");
    if (prov !== void 0 && !nonEmpty(prov)) violations.push("mgx:factProvenance, when present, must be non-empty");
  }
  function checkRule(ind, violations) {
    if (!nonEmpty(attrValue(ind, "mgx:ruleName"))) violations.push("a Rule needs a non-empty mgx:ruleName");
    const kind = attrValue(ind, "mgx:ruleKind");
    if (!kind || !RULE_KINDS.has(kind)) {
      violations.push(`a Rule's mgx:ruleKind must be one of compose2 | filter | recursive (got ${JSON.stringify(kind)})`);
      return;
    }
    for (const prop of RULE_SLOT_PROPS[kind]) {
      if (!nonEmpty(attrValue(ind, prop))) violations.push(`a ${kind} Rule needs a non-empty ${prop}`);
    }
  }
  function validateIndividual(ind) {
    const violations = [];
    checkIndividual(ind, violations);
    if (ind?.class === "Fact") checkFact(ind, violations);
    if (ind?.class === "Rule") checkRule(ind, violations);
    return { ok: violations.length === 0, violations };
  }
  function assertIndividualValid(ind) {
    const r = validateIndividual(ind);
    if (!r.ok) {
      const e = new Error(`SHACL validation failed for ${ind?.class} "${ind?.id}": ${r.violations.join(" | ")}`);
      e.violations = r.violations;
      throw e;
    }
  }
  var MEMORY_CLASSES, RULE_KINDS, RULE_SLOT_PROPS, nonEmpty;
  var init_shacl = __esm({
    "src/memory/shacl.mjs"() {
      MEMORY_CLASSES = /* @__PURE__ */ new Set(["Utterance", "Fact", "Session", "Source", "Rule"]);
      RULE_KINDS = /* @__PURE__ */ new Set(["compose2", "filter", "recursive"]);
      RULE_SLOT_PROPS = {
        compose2: ["mgx:ruleBase1", "mgx:ruleBase2"],
        filter: ["mgx:ruleBase1", "mgx:ruleFilterProperty"],
        recursive: ["mgx:ruleBaseCase", "mgx:ruleRecStep"]
      };
      nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
    }
  });

  // src/planning.mjs
  function defaultStateKey(state) {
    if (state && typeof state === "object") return JSON.stringify(state);
    return String(state);
  }
  function seedFrontier(startState, applyActions) {
    const frontier = [];
    for (const { action, nextState } of applyActions(startState) || []) {
      frontier.push({ state: nextState, actions: [action], states: [startState, nextState] });
    }
    return frontier;
  }
  function findActionPath(startState, isGoal, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
    if (isGoal(startState)) return { actions: [], states: [startState] };
    let frontier = seedFrontier(startState, applyActions);
    const seen = /* @__PURE__ */ new Set([stateKey(startState)]);
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      for (const entry of frontier) if (isGoal(entry.state)) return { actions: entry.actions, states: entry.states };
      if (depth === maxDepth) break;
      const next = [];
      for (const entry of frontier) {
        const key = stateKey(entry.state);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const { action, nextState } of applyActions(entry.state) || []) {
          const nk = stateKey(nextState);
          if (seen.has(nk)) continue;
          next.push({ state: nextState, actions: [...entry.actions, action], states: [...entry.states, nextState] });
        }
      }
      frontier = next;
    }
    return null;
  }
  function findReachableSet(startState, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
    let frontier = seedFrontier(startState, applyActions);
    const seen = /* @__PURE__ */ new Set([stateKey(startState)]);
    const results = [];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      const next = [];
      for (const entry of frontier) {
        const key = stateKey(entry.state);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ node: entry.state, path: { actions: entry.actions, states: entry.states } });
        if (depth === maxDepth) continue;
        for (const { action, nextState } of applyActions(entry.state) || []) {
          const nk = stateKey(nextState);
          if (seen.has(nk)) continue;
          next.push({ state: nextState, actions: [...entry.actions, action], states: [...entry.states, nextState] });
        }
      }
      frontier = next;
    }
    return results;
  }
  var init_planning = __esm({
    "src/planning.mjs"() {
    }
  });

  // node-stub:node:sqlite
  var node_sqlite_exports = {};
  __export(node_sqlite_exports, {
    DatabaseSync: () => DatabaseSync8,
    access: () => access8,
    appendFile: () => appendFile8,
    basename: () => basename,
    copyFile: () => copyFile8,
    createHash: () => createHash8,
    createInterface: () => createInterface8,
    createReadStream: () => createReadStream8,
    createRequire: () => createRequire8,
    createRequireFromPath: () => createRequireFromPath8,
    createWriteStream: () => createWriteStream8,
    default: () => node_sqlite_default,
    dirname: () => dirname2,
    existsSync: () => existsSync2,
    extname: () => extname,
    fileURLToPath: () => fileURLToPath2,
    isAbsolute: () => isAbsolute,
    join: () => join2,
    mkdir: () => mkdir8,
    mkdtemp: () => mkdtemp8,
    pathToFileURL: () => pathToFileURL,
    randomBytes: () => randomBytes8,
    readFile: () => readFile8,
    readFileSync: () => readFileSync8,
    readdir: () => readdir8,
    rename: () => rename8,
    resolve: () => resolve2,
    rm: () => rm8,
    sep: () => sep2,
    spawnSync: () => spawnSync8,
    stat: () => stat8,
    tmpdir: () => tmpdir,
    unlink: () => unlink8,
    writeFile: () => writeFile8,
    writeFileSync: () => writeFileSync8
  });
  var unavailable8, createRequire8, readFileSync8, writeFileSync8, readFile8, writeFile8, appendFile8, mkdir8, mkdtemp8, rename8, unlink8, rm8, stat8, access8, copyFile8, readdir8, createReadStream8, createWriteStream8, existsSync2, join2, dirname2, resolve2, isAbsolute, basename, extname, sep2, fileURLToPath2, pathToFileURL, randomBytes8, createHash8, createRequireFromPath8, spawnSync8, createInterface8, tmpdir, DatabaseSync8, node_sqlite_default;
  var init_node_sqlite = __esm({
    "node-stub:node:sqlite"() {
      unavailable8 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire8 = unavailable8("createRequire");
      readFileSync8 = unavailable8("readFileSync");
      writeFileSync8 = unavailable8("writeFileSync");
      readFile8 = unavailable8("readFile");
      writeFile8 = unavailable8("writeFile");
      appendFile8 = unavailable8("appendFile");
      mkdir8 = unavailable8("mkdir");
      mkdtemp8 = unavailable8("mkdtemp");
      rename8 = unavailable8("rename");
      unlink8 = unavailable8("unlink");
      rm8 = unavailable8("rm");
      stat8 = unavailable8("stat");
      access8 = unavailable8("access");
      copyFile8 = unavailable8("copyFile");
      readdir8 = unavailable8("readdir");
      createReadStream8 = unavailable8("createReadStream");
      createWriteStream8 = unavailable8("createWriteStream");
      existsSync2 = () => false;
      join2 = (...a) => a.join("/");
      dirname2 = (p) => String(p).replace(/\/[^/]*$/, "");
      resolve2 = (...a) => a.join("/");
      isAbsolute = (p) => String(p).startsWith("/");
      basename = (p) => String(p).split("/").pop();
      extname = (p) => {
        const m = /\.[^./]+$/.exec(String(p));
        return m ? m[0] : "";
      };
      sep2 = "/";
      fileURLToPath2 = (u) => String(u);
      pathToFileURL = (p) => new URL("file://" + p);
      randomBytes8 = unavailable8("randomBytes");
      createHash8 = unavailable8("createHash");
      createRequireFromPath8 = unavailable8("createRequireFromPath");
      spawnSync8 = unavailable8("spawnSync");
      createInterface8 = unavailable8("createInterface");
      tmpdir = () => "/tmp";
      DatabaseSync8 = unavailable8("DatabaseSync");
      node_sqlite_default = {};
    }
  });

  // src/memory/core.mjs
  var core_exports = {};
  __export(core_exports, {
    CANONICALISED_FROM_PROP: () => CANONICALISED_FROM_PROP,
    CONTRADICTION_TRUST_FLOOR: () => CONTRADICTION_TRUST_FLOOR,
    CREATED_AT_PROP: () => CREATED_AT_PROP,
    DEFAULT_RETENTION: () => DEFAULT_RETENTION,
    DERIVED_FROM_PROP: () => DERIVED_FROM_PROP,
    FACT_CLASS: () => FACT_CLASS,
    IN_REPLY_TO_PROP: () => IN_REPLY_TO_PROP,
    MEMORY_DIR_REL: () => MEMORY_DIR_REL,
    MEMORY_GRAPH_REL: () => MEMORY_GRAPH_REL,
    MEMORY_MANIFEST_REL: () => MEMORY_MANIFEST_REL,
    MEMORY_SESSION_CLASS: () => MEMORY_SESSION_CLASS,
    OPERATOR_SOURCE_ID: () => OPERATOR_SOURCE_ID,
    RULE_CLASS: () => RULE_CLASS,
    RULE_KINDS: () => RULE_KINDS2,
    RULE_KIND_COMPOSE2: () => RULE_KIND_COMPOSE2,
    RULE_KIND_FILTER: () => RULE_KIND_FILTER,
    RULE_KIND_PROP: () => RULE_KIND_PROP,
    RULE_KIND_RECURSIVE: () => RULE_KIND_RECURSIVE,
    RULE_NAME_PROP: () => RULE_NAME_PROP,
    SAID_IN_SESSION_PROP: () => SAID_IN_SESSION_PROP,
    SOURCE_CLASS: () => SOURCE_CLASS,
    SOURCE_RELIABILITY_PROP: () => SOURCE_RELIABILITY_PROP,
    STATED_BY_PROP: () => STATED_BY_PROP,
    TEACH_SOURCE_ID: () => TEACH_SOURCE_ID,
    UPDATED_AT_PROP: () => UPDATED_AT_PROP,
    UTTERANCE_CLASS: () => UTTERANCE_CLASS,
    appendFact: () => appendFact,
    appendFacts: () => appendFacts,
    appendRule: () => appendRule,
    appendUtterance: () => appendUtterance,
    appendUtterances: () => appendUtterances,
    closeSqliteMemoryStore: () => closeSqliteMemoryStore,
    createInMemoryStore: () => createInMemoryStore,
    createSqliteMemoryStore: () => createSqliteMemoryStore,
    emptyMemory: () => emptyMemory,
    factIdForTriple: () => factIdForTriple,
    findContradictions: () => findContradictions,
    findRuleByName: () => findRuleByName,
    loadMemory: () => loadMemory,
    normFactTerm: () => normFactTerm,
    openMemoryBackend: () => openMemoryBackend,
    provenanceTagToSource: () => provenanceTagToSource,
    readFactRows: () => readFactRows,
    removeFacts: () => removeFacts,
    resolveMemoryGraphFile: () => resolveMemoryGraphFile,
    resolveRelationChase: () => resolveRelationChase,
    resolveRelationChaseReverse: () => resolveRelationChaseReverse,
    snapshotMemory: () => snapshotMemory
  });
  function emptyMemory() {
    return {
      generated_at: "",
      memory: true,
      prefixes: {
        owl: "http://www.w3.org/2002/07/owl#",
        rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        rdfs: "http://www.w3.org/2000/01/rdf-schema#",
        mgx: "urn:tmct:mgx#"
      },
      vocabulary: MEMORY_VOCABULARY.map((v) => ({ ...v })),
      classes: [],
      objectProperties: [],
      individuals: [],
      proseIndex: {}
    };
  }
  function resolveMemoryGraphFile(dir, version = null) {
    if (isMemoryHandle(dir) || isSqliteHandle(dir)) {
      throw new Error("resolveMemoryGraphFile: dir is a memory/sqlite handle, not a file path (Backend A only)");
    }
    if (version === null) return join(dir, MEMORY_GRAPH_REL);
    return join(dir, MEMORY_DIR_REL, `graph.v${version}.json`);
  }
  function isMemoryHandle(dir) {
    return !!dir && typeof dir === "object" && dir.backend === BACKEND_MEMORY;
  }
  function isSqliteHandle(dir) {
    return !!dir && typeof dir === "object" && dir.backend === BACKEND_SQLITE;
  }
  function isMemoryOrSqliteHandle(dir) {
    return isMemoryHandle(dir) || isSqliteHandle(dir);
  }
  function createInMemoryStore() {
    return { backend: BACKEND_MEMORY, payload: emptyMemory() };
  }
  async function createSqliteMemoryStore(dbPath) {
    const { DatabaseSync: DatabaseSync11 } = await Promise.resolve().then(() => (init_node_sqlite(), node_sqlite_exports));
    const db = new DatabaseSync11(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(SQLITE_DDL);
    return { backend: BACKEND_SQLITE, db, dbPath };
  }
  function closeSqliteMemoryStore(handle) {
    if (isSqliteHandle(handle)) handle.db.close();
  }
  async function openMemoryBackend(repoRoot, backendChoice) {
    if (backendChoice === BACKEND_MEMORY) {
      return { dir: createInMemoryStore(), close: async () => {
      } };
    }
    if (backendChoice === BACKEND_SQLITE) {
      const dbPath = join(repoRoot, ".tmct", "memory", "graph.sqlite");
      await mkdir3(dirname(dbPath), { recursive: true });
      const handle = await createSqliteMemoryStore(dbPath);
      return { dir: handle, close: async () => closeSqliteMemoryStore(handle) };
    }
    return { dir: repoRoot, close: async () => {
    } };
  }
  function readSqlitePayload(handle) {
    if (!handle.cachedPayload) handle.cachedPayload = buildSqlitePayloadFromRows(handle);
    return cloneJson(handle.cachedPayload);
  }
  function buildSqlitePayloadFromRows(handle) {
    const db = handle.db;
    const empty = emptyMemory();
    const getMeta = (k, fallback) => {
      const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
      return row ? JSON.parse(row.v) : fallback;
    };
    const individuals = db.prepare("SELECT json FROM individuals ORDER BY ord").all().map((r) => JSON.parse(r.json));
    const edgesForProp = db.prepare(
      "SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ? ORDER BY rowid"
    );
    const objectProperties = db.prepare("SELECT prop, predicate, count FROM relations ORDER BY ord").all().map((r) => ({
      predicate: r.predicate,
      prop: r.prop,
      count: r.count,
      examples: edgesForProp.all(r.prop).map((e) => {
        const edge = { subject: e.subject, object: e.object, subjectLabel: e.subject_label, objectLabel: e.object_label };
        if (e.extra) Object.assign(edge, JSON.parse(e.extra));
        return edge;
      })
    }));
    return {
      generated_at: getMeta("generated_at", empty.generated_at),
      memory: getMeta("memory", empty.memory),
      prefixes: getMeta("prefixes", empty.prefixes),
      vocabulary: getMeta("vocabulary", empty.vocabulary),
      classes: getMeta("classes", empty.classes),
      objectProperties,
      individuals,
      proseIndex: getMeta("proseIndex", empty.proseIndex)
    };
  }
  function cacheUpsertIndividual(cache, ind) {
    const clone = cloneJson(ind);
    const i = cache.individuals.findIndex((x) => x?.id === ind.id);
    if (i >= 0) cache.individuals[i] = clone;
    else cache.individuals.push(clone);
  }
  function cacheDropIndividualsExcept(cache, seenIds) {
    cache.individuals = cache.individuals.filter((i) => seenIds.has(i?.id));
  }
  function cacheGroupFor(cache, prop) {
    let g = cache.objectProperties.find((x) => x?.prop === prop);
    if (!g) {
      g = { predicate: null, prop, count: 0, examples: [] };
      cache.objectProperties.push(g);
    }
    return g;
  }
  function cacheUpsertEdge(group, edge, extraKeys) {
    const key = `${edge.subject}\0${edge.object}`;
    group.examples = group.examples.filter((e) => `${e.subject}\0${e.object}` !== key);
    const cached = {
      subject: edge.subject,
      object: edge.object,
      subjectLabel: edge.subjectLabel ?? null,
      objectLabel: edge.objectLabel ?? null
    };
    if (extraKeys.length) Object.assign(cached, cloneJson(Object.fromEntries(extraKeys.map((k) => [k, edge[k]]))));
    group.examples.push(cached);
  }
  function cacheDropEdgesExcept(group, newKeys) {
    group.examples = group.examples.filter((e) => newKeys.has(`${e.subject}\0${e.object}`));
  }
  function cacheDropGroupsExcept(cache, seenProps) {
    cache.objectProperties = cache.objectProperties.filter((g) => seenProps.has(g?.prop));
  }
  function persistSqlitePayload(handle, payload) {
    const db = handle.db;
    const empty = emptyMemory();
    const cache = handle.cachedPayload || null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const setMeta = db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)");
      setMeta.run("generated_at", JSON.stringify(payload.generated_at ?? empty.generated_at));
      setMeta.run("memory", JSON.stringify(payload.memory ?? empty.memory));
      setMeta.run("prefixes", JSON.stringify(payload.prefixes ?? empty.prefixes));
      setMeta.run("vocabulary", JSON.stringify(payload.vocabulary ?? empty.vocabulary));
      setMeta.run("classes", JSON.stringify(payload.classes ?? empty.classes));
      setMeta.run("proseIndex", JSON.stringify(payload.proseIndex ?? empty.proseIndex));
      if (cache) {
        cache.generated_at = cloneJson(payload.generated_at ?? empty.generated_at);
        cache.memory = cloneJson(payload.memory ?? empty.memory);
        cache.prefixes = cloneJson(payload.prefixes ?? empty.prefixes);
        cache.vocabulary = cloneJson(payload.vocabulary ?? empty.vocabulary);
        cache.classes = cloneJson(payload.classes ?? empty.classes);
        cache.proseIndex = cloneJson(payload.proseIndex ?? empty.proseIndex);
      }
      const getInd = db.prepare("SELECT ord, json FROM individuals WHERE id = ?");
      const maxOrd = db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM individuals").get().m;
      let nextOrd = maxOrd + 1;
      const upsertInd = db.prepare("INSERT OR REPLACE INTO individuals(id, ord, class, label, json) VALUES (?, ?, ?, ?, ?)");
      const seenIds = /* @__PURE__ */ new Set();
      for (const ind of payload.individuals || []) {
        seenIds.add(ind.id);
        const json = JSON.stringify(ind);
        const existing = getInd.get(ind.id);
        if (existing && existing.json === json) continue;
        const ord = existing ? existing.ord : nextOrd++;
        upsertInd.run(ind.id, ord, ind.class ?? null, ind.label ?? null, json);
        if (cache) cacheUpsertIndividual(cache, ind);
      }
      const deleteInd = db.prepare("DELETE FROM individuals WHERE id = ?");
      for (const row of db.prepare("SELECT id FROM individuals").all()) {
        if (!seenIds.has(row.id)) deleteInd.run(row.id);
      }
      if (cache) cacheDropIndividualsExcept(cache, seenIds);
      const getRelOrd = db.prepare("SELECT ord FROM relations WHERE prop = ?");
      const maxRelOrd = db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM relations").get().m;
      let nextRelOrd = maxRelOrd + 1;
      const upsertRel = db.prepare("INSERT OR REPLACE INTO relations(prop, ord, predicate, count) VALUES (?, ?, ?, ?)");
      const edgesForProp = db.prepare("SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ?");
      const upsertEdge2 = db.prepare("INSERT OR REPLACE INTO edges(prop, subject, object, subject_label, object_label, extra) VALUES (?, ?, ?, ?, ?, ?)");
      const deleteEdge = db.prepare("DELETE FROM edges WHERE prop = ? AND subject = ? AND object = ?");
      const seenProps = /* @__PURE__ */ new Set();
      for (const group of payload.objectProperties || []) {
        seenProps.add(group.prop);
        const existingRows = edgesForProp.all(group.prop);
        const existingByKey = new Map(existingRows.map((r) => [`${r.subject}\0${r.object}`, r]));
        const newKeys = /* @__PURE__ */ new Set();
        const cacheGroup = cache ? cacheGroupFor(cache, group.prop) : null;
        for (const e of group.examples || []) {
          const key = `${e.subject}\0${e.object}`;
          newKeys.add(key);
          const extraKeys = Object.keys(e).filter((k) => !STD_EDGE_KEYS.has(k));
          const extra = extraKeys.length ? JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, e[k]]))) : null;
          const existing = existingByKey.get(key);
          const unchanged = existing && (existing.subject_label ?? null) === (e.subjectLabel ?? null) && (existing.object_label ?? null) === (e.objectLabel ?? null) && (existing.extra ?? null) === (extra ?? null);
          if (unchanged) continue;
          upsertEdge2.run(group.prop, e.subject, e.object, e.subjectLabel ?? null, e.objectLabel ?? null, extra);
          if (cacheGroup) cacheUpsertEdge(cacheGroup, e, extraKeys);
        }
        for (const key of existingByKey.keys()) {
          if (newKeys.has(key)) continue;
          const [s, o] = key.split("\0");
          deleteEdge.run(group.prop, s, o);
        }
        if (cacheGroup) cacheDropEdgesExcept(cacheGroup, newKeys);
        const relCount = Number.isFinite(group.count) ? group.count : (group.examples || []).length;
        const relOrd = getRelOrd.get(group.prop)?.ord ?? nextRelOrd++;
        upsertRel.run(group.prop, relOrd, group.predicate ?? null, relCount);
        if (cacheGroup) {
          cacheGroup.predicate = group.predicate ?? null;
          cacheGroup.count = relCount;
        }
      }
      for (const row of db.prepare("SELECT prop FROM relations").all()) {
        if (seenProps.has(row.prop)) continue;
        db.prepare("DELETE FROM edges WHERE prop = ?").run(row.prop);
        db.prepare("DELETE FROM relations WHERE prop = ?").run(row.prop);
      }
      if (cache) cacheDropGroupsExcept(cache, seenProps);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      handle.cachedPayload = void 0;
      throw e;
    }
  }
  async function atomicWriteText(file, text) {
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    await writeFile3(tmp, text);
    await rename3(tmp, file);
  }
  async function atomicWriteJson(file, obj) {
    await atomicWriteText(file, JSON.stringify(obj));
  }
  async function snapshotMemory(dir, { retentionVersions } = {}) {
    if (isMemoryOrSqliteHandle(dir)) {
      throw new Error("snapshotMemory only supports the flat-JSON backend (Backend A) \u2014 a memory/sqlite handle has no on-disk graph.json to snapshot");
    }
    const graphFile = resolveMemoryGraphFile(dir);
    let graphText;
    try {
      graphText = await readFile3(graphFile, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return { skipped: true, version: null, prunedVersion: null };
      throw e;
    }
    const manifestFile = resolveManifestFile(dir);
    let manifest;
    try {
      manifest = JSON.parse(await readFile3(manifestFile, "utf8"));
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
      manifest = { version: 0, retentionVersions: retentionVersions ?? DEFAULT_RETENTION };
    }
    if (!Number.isInteger(manifest.version)) manifest.version = 0;
    if (!Number.isInteger(manifest.retentionVersions)) manifest.retentionVersions = retentionVersions ?? DEFAULT_RETENTION;
    const v = manifest.version;
    const versionedFile = resolveMemoryGraphFile(dir, v);
    await mkdir3(dirname(versionedFile), { recursive: true });
    await atomicWriteText(versionedFile, graphText);
    manifest.version = v + 1;
    let prunedVersion = null;
    const pruneTarget = v - manifest.retentionVersions;
    if (pruneTarget >= 0) {
      try {
        await unlink3(resolveMemoryGraphFile(dir, pruneTarget));
        prunedVersion = pruneTarget;
      } catch (e) {
        if (e?.code !== "ENOENT") throw e;
      }
    }
    await atomicWriteJson(manifestFile, manifest);
    return { skipped: false, version: v, prunedVersion };
  }
  async function loadMemory(dir) {
    if (isMemoryHandle(dir)) return dir.payload;
    if (isSqliteHandle(dir)) return readSqlitePayload(dir);
    let text;
    try {
      text = await readFile3(memoryGraphFile(dir), "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return emptyMemory();
      throw e;
    }
    return JSON.parse(text);
  }
  async function persistMemory(dir, payload) {
    if (isMemoryHandle(dir)) {
      dir.payload = payload;
      return;
    }
    if (isSqliteHandle(dir)) {
      persistSqlitePayload(dir, payload);
      return;
    }
    await mkdir3(dirname(memoryGraphFile(dir)), { recursive: true });
    await atomicWriteJson(memoryGraphFile(dir), payload);
  }
  async function mutateMemory(dir, fn) {
    const payload = await loadMemory(dir);
    const out = await fn(payload) ?? payload;
    migrateLegacyProvenance(out);
    recomputeSourceReliability(out);
    out.proseIndex = buildProseIndex(out.individuals);
    await persistMemory(dir, out);
    return out;
  }
  function firstWriteCreatedAt(prior, candidate) {
    return prior?.attributes?.find((a) => a?.prop === CREATED_AT_PROP)?.value || candidate || nowIso();
  }
  function setAttr(ind, prop, key, value) {
    ind.attributes = (ind.attributes || []).filter((a) => a?.prop !== prop);
    ind.attributes.push({ prop, key, value });
  }
  function sourceIdFor(desc) {
    switch (desc?.kind) {
      case "operator":
        return { id: desc.sessionId ? `${OPERATOR_SOURCE_ID}:${desc.sessionId}` : OPERATOR_SOURCE_ID, type: "operator" };
      case "teach":
        return { id: desc.sessionId ? `${TEACH_SOURCE_ID}:${desc.sessionId}` : TEACH_SOURCE_ID, type: "teach" };
      case "provider":
        return { id: `src:provider:${desc.name}`, type: "provider" };
      case "corpus":
        return { id: `src:corpus:${desc.name}`, type: "corpus" };
      // One Source per source-file basename (the corpus precedent above), not per
      // extraction run — re-running scripts/extract-facts-from-text.mjs over the
      // SAME file collapses onto the same Source instead of minting a new one
      // every time, matching corpus's "one Source per named dataset" idiom.
      case "extracted":
        return { id: `src:extracted:${desc.name}`, type: "extracted" };
      case "web":
        return { id: `src:learned:web:${fnv1aHex(String(desc.url || ""))}`, type: "web", url: String(desc.url || "") };
      case "entailed":
        return { id: `src:entailed:${desc.rule}`, type: "entailed", rule: String(desc.rule || "") };
      default:
        return null;
    }
  }
  function upsertSource(payload, desc, createdAtCandidate) {
    const info = sourceIdFor(desc);
    if (!info) return null;
    const prior = payload.individuals.find((i) => i?.id === info.id);
    const created = firstWriteCreatedAt(prior, desc?.createdAt || createdAtCandidate);
    upsertIndividual(payload, {
      id: info.id,
      label: sourceLabel(info.id),
      class: SOURCE_CLASS,
      derived_from: [],
      mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: "mgx:sourceType", key: "sourceType", value: info.type },
        { prop: CREATED_AT_PROP, key: "createdAt", value: created },
        ...info.url ? [{ prop: "mgx:sourceUrl", key: "sourceUrl", value: info.url }] : [],
        ...info.rule ? [{ prop: "mgx:sourceRule", key: "sourceRule", value: info.rule }] : []
      ]
    });
    return info.id;
  }
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
  function sourcesByIdMap(payload) {
    const m = {};
    for (const i of payload.individuals) if (i?.class === SOURCE_CLASS) m[i.id] = i;
    return m;
  }
  function statedByObjectsFor(payload, factId) {
    const g = payload.objectProperties.find((x) => x?.prop === STATED_BY_PROP);
    return (g?.examples || []).filter((e) => e?.subject === factId).map((e) => e.object);
  }
  function recomputeFactTrust(payload, fact, nowMs = Date.now(), trustOpts = {}) {
    const sourceIds = statedByObjectsFor(payload, fact.id);
    const createdAt = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || "";
    const { score, inputs } = computeTrust({ sourceIds, createdAt }, sourcesByIdMap(payload), {
      now: nowMs,
      ...Array.isArray(trustOpts?.premiseTrusts) ? { premiseTrusts: trustOpts.premiseTrusts } : {},
      ...typeof trustOpts?.ruleConfidence === "number" ? { ruleConfidence: trustOpts.ruleConfidence } : {}
    });
    setAttr(fact, TRUST_SCORE_PROP, "trustScore", String(score));
    setAttr(fact, TRUST_INPUTS_PROP, "trustInputs", JSON.stringify(inputs));
    setAttr(fact, UPDATED_AT_PROP, "updatedAt", new Date(nowMs).toISOString());
  }
  function syncFactSources(payload, fact, nowMs = Date.now(), trustOpts = {}) {
    const prov = (fact.attributes || []).find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    const factCreated = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || new Date(nowMs).toISOString();
    for (const tag of prov.split(" | ").filter(Boolean)) {
      const desc = provenanceTagToSource(tag);
      if (!desc) continue;
      const sid = upsertSource(payload, desc, factCreated);
      if (!sid) continue;
      upsertEdge(payload, { predicate: "statedBy", prop: STATED_BY_PROP }, {
        subject: fact.id,
        object: sid,
        subjectLabel: fact.label,
        objectLabel: sourceLabel(sid)
      });
    }
    recomputeFactTrust(payload, fact, nowMs, trustOpts);
  }
  function migrateLegacyProvenance(payload) {
    if (!Array.isArray(payload?.individuals) || !Array.isArray(payload?.objectProperties)) return;
    const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
    const haveEdge = new Set((statedGroup?.examples || []).map((e) => e.subject));
    let changed = false;
    const now = Date.now();
    for (const ind of payload.individuals) {
      if (ind?.class !== FACT_CLASS) continue;
      if (haveEdge.has(ind.id)) continue;
      const prov = (ind.attributes || []).find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      if (!prov) continue;
      syncFactSources(payload, ind, now);
      changed = true;
    }
    if (changed) recountClasses(payload);
  }
  function recomputeSourceReliability(payload) {
    if (!Array.isArray(payload?.individuals) || !Array.isArray(payload?.objectProperties)) return;
    const rows = readFactRows(payload);
    const contradictedFactIds = /* @__PURE__ */ new Set();
    for (const group of findContradictions(payload)) for (const r of group) contradictedFactIds.add(r.id);
    const bySource = /* @__PURE__ */ new Map();
    for (const row of rows) {
      for (const sid of row.sourceIds) {
        if (!isSessionScopedSourceId(sid)) continue;
        const bucket = bySource.get(sid) || { factsAsserted: 0, factsContradicted: 0 };
        bucket.factsAsserted += 1;
        if (contradictedFactIds.has(row.id)) bucket.factsContradicted += 1;
        bySource.set(sid, bucket);
      }
    }
    if (!bySource.size) return;
    for (const [sid, counts] of bySource) {
      const source = payload.individuals.find((i) => i?.id === sid);
      if (!source) continue;
      setAttr(source, SOURCE_RELIABILITY_PROP, "sourceReliability", String(sessionReliabilityFrom(counts)));
      setAttr(source, UPDATED_AT_PROP, "updatedAt", (/* @__PURE__ */ new Date()).toISOString());
    }
    const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
    const affected = /* @__PURE__ */ new Set();
    for (const e of statedGroup?.examples || []) if (bySource.has(e?.object)) affected.add(e.subject);
    for (const id of affected) {
      const ind = payload.individuals.find((i) => i?.id === id);
      if (ind) recomputeFactTrust(payload, ind);
    }
  }
  function upsertIndividual(payload, ind) {
    const i = payload.individuals.findIndex((x) => x?.id === ind.id);
    if (i >= 0) payload.individuals[i] = ind;
    else payload.individuals.push(ind);
  }
  function upsertEdge(payload, { predicate, prop }, edge) {
    let group = payload.objectProperties.find((g) => g?.prop === prop);
    if (!group) {
      group = { predicate, prop, count: 0, examples: [] };
      payload.objectProperties.push(group);
    }
    const prior = (group.examples || []).find((e) => e?.subject === edge.subject && e?.object === edge.object);
    const createdAt = prior?.createdAt || edge.createdAt || nowIso();
    group.examples = (group.examples || []).filter(
      (e) => !(e?.subject === edge.subject && e?.object === edge.object)
    );
    group.examples.push({ ...edge, createdAt });
    group.count = group.examples.length;
  }
  function recountClasses(payload) {
    const names = [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, RULE_CLASS];
    payload.classes = payload.classes.filter((c) => !names.includes(c?.name));
    for (const name of names) {
      const of = payload.individuals.filter((i) => i?.class === name);
      if (of.length) payload.classes.push({ name, count: of.length, sample: of.slice(0, 3).map((i) => i.label) });
    }
  }
  function ensureSession(payload, sessionId, started = "") {
    const sid = `session:${sessionId}`;
    if (payload.individuals.some((i) => i?.id === sid)) return sid;
    payload.individuals.push({
      id: sid,
      label: String(sessionId).slice(0, 8),
      class: MEMORY_SESSION_CLASS,
      derived_from: [],
      mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: CREATED_AT_PROP, key: "createdAt", value: started || nowIso() },
        ...started ? [{ prop: "mgx:sessionStarted", key: "started", value: started }] : []
      ]
    });
    return sid;
  }
  function putUtterance(payload, { role, text, ts, sessionId, sessionStarted = "", parsed = null, replyTo = null, createdAt = "" }) {
    if (!ROLES.has(role)) throw new Error(`utterance role must be "visitor" or "tmct", got ${JSON.stringify(role)}`);
    if (!sessionId) throw new Error("utterance needs a sessionId");
    const cleanTs = String(ts || "");
    const cleanText = normText(text);
    const id = `utt:${sessionId}#${cleanTs}#${role}`;
    const label = labelOf(cleanText) || (role === "visitor" ? "a-visitor-said" : "a-tmct-said");
    const tokens = proseTokensFor({ doc: cleanText });
    const prior = payload.individuals.find((x) => x?.id === id);
    const createdAtVal = firstWriteCreatedAt(prior, createdAt || cleanTs);
    const ind = {
      id,
      label,
      class: UTTERANCE_CLASS,
      derived_from: [],
      mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: "mgx:utteranceRole", key: "role", value: role },
        { prop: "mgx:utteranceText", key: "text", value: cleanText },
        { prop: "mgx:utteranceTs", key: "ts", value: cleanTs },
        { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
        ...parsed != null ? [{ prop: "mgx:utteranceParsed", key: "parsed", value: JSON.stringify(parsed) }] : [],
        ...tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : []
      ]
    };
    upsertIndividual(payload, ind);
    const sid = ensureSession(payload, sessionId, sessionStarted);
    upsertEdge(payload, { predicate: "saidInSession", prop: SAID_IN_SESSION_PROP }, {
      subject: id,
      object: sid,
      subjectLabel: label,
      objectLabel: String(sessionId).slice(0, 8)
    });
    if (replyTo) {
      const target = payload.individuals.find((i) => i?.id === replyTo);
      if (target) {
        upsertEdge(payload, { predicate: "inReplyTo", prop: IN_REPLY_TO_PROP }, {
          subject: id,
          object: replyTo,
          subjectLabel: label,
          objectLabel: target.label
        });
      }
    }
    if (cleanTs && cleanTs > String(payload.generated_at || "")) payload.generated_at = cleanTs;
    return id;
  }
  async function appendUtterance(dir, utterance) {
    let id;
    await mutateMemory(dir, (payload) => {
      id = putUtterance(payload, utterance);
      recountClasses(payload);
    });
    return { id };
  }
  async function appendUtterances(dir, utterances) {
    const ids = [];
    if (!utterances?.length) return { ids };
    await mutateMemory(dir, (payload) => {
      for (const u of utterances) ids.push(putUtterance(payload, u));
      recountClasses(payload);
    });
    return { ids };
  }
  function normFactTerm(t) {
    let s = normText(t);
    s = s.replace(/^\/c\/[a-z]{2,3}\//i, "");
    s = s.replace(/^[a-z][\w.-]*:/i, "");
    s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/^(?:the|an?)\s+/i, "");
    return s.toLowerCase();
  }
  function factIdForTriple(subject, predicate, object) {
    return factIdFor(normFactTerm(subject), normText(predicate), normFactTerm(object));
  }
  async function appendFact(dir, { subject, predicate, object, provenance = "", createdAt = "", quantifier = "", premiseTrusts, ruleConfidence } = {}) {
    const s = normFactTerm(subject);
    const p = normText(predicate);
    const o = normFactTerm(object);
    if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
    const id = `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;
    const text = `${s} ${p} ${o}`;
    const tokens = proseTokensFor({ doc: text });
    const q = normText(quantifier);
    await mutateMemory(dir, async (payload) => {
      const prior = payload.individuals.find((x) => x?.id === id);
      const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
      const createdAtVal = firstWriteCreatedAt(prior, createdAt);
      const priorQ = prior?.attributes?.find((a) => a?.prop === "mgx:factQuantifier")?.value || "";
      const qVal = q || priorQ;
      const candidate = {
        id,
        label: labelOf(text),
        class: FACT_CLASS,
        derived_from: [],
        mentions: [],
        attributes: [
          { prop: "rdf:type", key: "type", value: "rdf:Statement" },
          { prop: "rdf:subject", key: "subject", value: s },
          { prop: "rdf:predicate", key: "predicate", value: p },
          { prop: "rdf:object", key: "object", value: o },
          { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
          ...provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : [],
          ...tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : [],
          ...qVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: qVal }] : []
        ]
      };
      await assertIndividualValid(candidate);
      upsertIndividual(payload, candidate);
      syncFactSources(payload, payload.individuals.find((x) => x?.id === id), void 0, { premiseTrusts, ruleConfidence });
      recountClasses(payload);
    });
    return { id };
  }
  async function appendFacts(dir, facts) {
    const prepared = [];
    let skipped = 0;
    for (const f of facts || []) {
      const s = normFactTerm(f?.subject);
      const p = normText(f?.predicate);
      const o = normFactTerm(f?.object);
      if (!s || !p || !o) {
        skipped += 1;
        continue;
      }
      const text = `${s} ${p} ${o}`;
      prepared.push({
        id: factIdFor(s, p, o),
        // NUL-delimited — byte-identical to appendFact's id
        s,
        p,
        o,
        text,
        tokens: proseTokensFor({ doc: text }),
        provenance: normText(f?.provenance),
        createdAt: f?.createdAt || "",
        quantifier: normText(f?.quantifier),
        premiseTrusts: Array.isArray(f?.premiseTrusts) ? f.premiseTrusts : void 0,
        ruleConfidence: typeof f?.ruleConfidence === "number" ? f.ruleConfidence : void 0,
        justification: Array.isArray(f?.justification) ? f.justification.filter(Boolean) : void 0
      });
    }
    const ids = [];
    if (!prepared.length) return { ids, appended: 0, skipped };
    await mutateMemory(dir, (payload) => {
      const byId = new Map(payload.individuals.map((i) => [i?.id, i]));
      const touched = [];
      const seen = /* @__PURE__ */ new Set();
      const trustOptsById = /* @__PURE__ */ new Map();
      for (const f of prepared) {
        const prior = byId.get(f.id);
        const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
        const provs = [...new Set([...priorProv.split(" | "), f.provenance].filter(Boolean))];
        const createdAtVal = firstWriteCreatedAt(prior, f.createdAt);
        const priorQ = prior?.attributes?.find((a) => a?.prop === "mgx:factQuantifier")?.value || "";
        const qVal = f.quantifier || priorQ;
        const ind = {
          id: f.id,
          label: labelOf(f.text),
          class: FACT_CLASS,
          derived_from: [],
          mentions: [],
          attributes: [
            { prop: "rdf:type", key: "type", value: "rdf:Statement" },
            { prop: "rdf:subject", key: "subject", value: f.s },
            { prop: "rdf:predicate", key: "predicate", value: f.p },
            { prop: "rdf:object", key: "object", value: f.o },
            { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
            ...provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : [],
            ...f.tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: f.tokens.join(" ") }] : [],
            ...qVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: qVal }] : [],
            ...f.justification && f.justification.length ? [{ prop: "mgx:factJustification", key: "justification", value: f.justification.join(" ") }] : []
          ]
        };
        if (prior) payload.individuals[payload.individuals.indexOf(prior)] = ind;
        else payload.individuals.push(ind);
        byId.set(f.id, ind);
        ids.push(f.id);
        if (!seen.has(f.id)) {
          seen.add(f.id);
          touched.push(f.id);
        }
        if (f.premiseTrusts !== void 0 || f.ruleConfidence !== void 0) {
          trustOptsById.set(f.id, { premiseTrusts: f.premiseTrusts, ruleConfidence: f.ruleConfidence });
        }
      }
      for (const id of touched) syncFactSources(payload, byId.get(id), void 0, trustOptsById.get(id));
      recountClasses(payload);
    });
    return { ids, appended: ids.length, skipped };
  }
  async function appendRule(dir, { name, kind, slots, provenance = "", createdAt = "" } = {}) {
    const spec = RULE_SLOT_SPEC[kind];
    if (!spec) throw new Error(`a rule kind must be one of ${RULE_KINDS2.join(", ")}, got ${JSON.stringify(kind)}`);
    const n = normFactTerm(name);
    if (!n) throw new Error("a rule needs a name");
    const slotValues = spec.map(([slotKey]) => normFactTerm(slots?.[slotKey]));
    if (slotValues.some((v) => !v)) {
      throw new Error(`a ${kind} rule needs ${spec.map(([slotKey]) => slotKey).join(" + ")}`);
    }
    const id = ruleIdFor(kind, n, slotValues[0], slotValues[1]);
    const label = labelOf(`${n} = ${kind}(${slotValues.join(", ")})`);
    await mutateMemory(dir, async (payload) => {
      const prior = payload.individuals.find((x) => x?.id === id);
      const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
      const createdAtVal = firstWriteCreatedAt(prior, createdAt);
      const candidate = {
        id,
        label,
        class: RULE_CLASS,
        derived_from: [],
        mentions: [],
        attributes: [
          { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
          { prop: RULE_NAME_PROP, key: "ruleName", value: n },
          { prop: RULE_KIND_PROP, key: "ruleKind", value: kind },
          ...spec.map(([slotKey, prop], i) => ({ prop, key: slotKey, value: slotValues[i] })),
          { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
          ...provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : []
        ]
      };
      await assertIndividualValid(candidate);
      upsertIndividual(payload, candidate);
      syncFactSources(payload, payload.individuals.find((x) => x?.id === id));
      recountClasses(payload);
    });
    return { id };
  }
  function findRuleByName(memory, name) {
    const n = normFactTerm(name);
    return (memory?.individuals || []).find(
      (i) => i?.class === RULE_CLASS && (i.attributes || []).find((a) => a?.prop === RULE_NAME_PROP)?.value === n
    );
  }
  async function resolveRelationChase(memory, name, subjectTerm, objectTerm, helpers) {
    const { relationFactsFor, renderFactLine: renderFactLine2, factPhrase: factPhrase2, factTermVariants: factTermVariants2, byTrust, rows, HAS_PROPERTY_PREDICATE } = helpers;
    const target = String(name || "").trim().toLowerCase();
    const sv = factTermVariants2(normFactTerm, subjectTerm);
    const ov = factTermVariants2(normFactTerm, objectTerm);
    const pairHits = relationFactsFor(target).filter((e) => sv.has(e.fact.subject) && ov.has(e.fact.object));
    if (pairHits.length) {
      const hit2 = pairHits.slice().sort((a, b) => byTrust(a.fact, b.fact))[0];
      return { citation: [renderFactLine2(hit2.fact), ...hit2.aliasFacts.map(
        (af) => `${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`
      )] };
    }
    const rule = findRuleByName(memory, target);
    const ruleKind = rule?.attributes?.find((a) => a.prop === RULE_KIND_PROP)?.value;
    if (rule && ruleKind === RULE_KIND_COMPOSE2) {
      const base1 = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const base2 = rule.attributes.find((a) => a.prop === "mgx:ruleBase2")?.value;
      const startEntity = normFactTerm(subjectTerm);
      const targetEntity = normFactTerm(objectTerm);
      if (!base1 || !base2 || !startEntity || !targetEntity) return null;
      const applyActions = (state) => {
        if (state.hopsTaken >= 2) return [];
        const relName = state.hopsTaken === 0 ? base1 : base2;
        return relationFactsFor(relName).filter((e) => e.fact.subject === state.entity).map((e) => ({ action: e, nextState: { entity: e.fact.object, hopsTaken: state.hopsTaken + 1 } }));
      };
      const isGoal = (state) => state.hopsTaken === 2 && state.entity === targetEntity;
      const stateKey = (state) => `${state.entity}#${state.hopsTaken}`;
      const found = findActionPath({ entity: startEntity, hopsTaken: 0 }, isGoal, applyActions, { maxDepth: 2, stateKey });
      if (!found) return null;
      const seenAlias = /* @__PURE__ */ new Set();
      const parts = [];
      for (const e of found.actions) {
        parts.push(renderFactLine2(e.fact));
        for (const af of e.aliasFacts) {
          const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
          if (seenAlias.has(key)) continue;
          seenAlias.add(key);
          parts.push(`${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
        }
      }
      return { citation: parts };
    }
    if (rule && ruleKind === RULE_KIND_FILTER) {
      const base = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const property = rule.attributes.find((a) => a.prop === "mgx:ruleFilterProperty")?.value;
      if (!base || !property) return null;
      const baseHit = await resolveRelationChase(memory, base, subjectTerm, objectTerm, helpers);
      if (!baseHit) return null;
      const subjectEntity = normFactTerm(subjectTerm);
      const propertyNorm = normFactTerm(property);
      const propHit = rows.find(
        (f) => f.predicate === HAS_PROPERTY_PREDICATE && f.subject === subjectEntity && normFactTerm(f.object) === propertyNorm
      );
      if (!propHit) return null;
      return { citation: [...baseHit.citation, renderFactLine2(propHit)] };
    }
    return null;
  }
  async function resolveRelationChaseReverse(memory, name, objectTerm, helpers) {
    const { relationFactsFor, renderFactLine: renderFactLine2, factPhrase: factPhrase2, factTermVariants: factTermVariants2, byTrust, rows, HAS_PROPERTY_PREDICATE } = helpers;
    const target = String(name || "").trim().toLowerCase();
    const ov = factTermVariants2(normFactTerm, objectTerm);
    const directHits = relationFactsFor(target).filter((e) => ov.has(e.fact.object));
    if (directHits.length) {
      const bySubject = /* @__PURE__ */ new Map();
      for (const e of directHits) {
        if (!bySubject.has(e.fact.subject)) bySubject.set(e.fact.subject, []);
        bySubject.get(e.fact.subject).push(e);
      }
      return [...bySubject.entries()].map(([subj, hits]) => {
        const hit2 = hits.slice().sort((a, b) => byTrust(a.fact, b.fact))[0];
        return {
          subject: subj,
          citation: [renderFactLine2(hit2.fact), ...hit2.aliasFacts.map(
            (af) => `${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`
          )]
        };
      });
    }
    const rule = findRuleByName(memory, target);
    const ruleKind = rule?.attributes?.find((a) => a.prop === RULE_KIND_PROP)?.value;
    if (rule && ruleKind === RULE_KIND_COMPOSE2) {
      const base1 = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const base2 = rule.attributes.find((a) => a.prop === "mgx:ruleBase2")?.value;
      const targetEntity = normFactTerm(objectTerm);
      if (!base1 || !base2 || !targetEntity) return [];
      const applyActionsRev = (state) => {
        if (state.hopsTaken >= 2) return [];
        const relName = state.hopsTaken === 0 ? base2 : base1;
        return relationFactsFor(relName).filter((e) => e.fact.object === state.entity).map((e) => ({ action: e, nextState: { entity: e.fact.subject, hopsTaken: state.hopsTaken + 1 } }));
      };
      const stateKeyRev = (state) => `${state.entity}#${state.hopsTaken}`;
      const reached = findReachableSet(
        { entity: targetEntity, hopsTaken: 0 },
        applyActionsRev,
        { maxDepth: 2, stateKey: stateKeyRev }
      );
      return reached.filter((r) => r.node.hopsTaken === 2).map(({ node, path }) => {
        const seenAlias = /* @__PURE__ */ new Set();
        const parts = [];
        for (const e of path.actions.slice().reverse()) {
          parts.push(renderFactLine2(e.fact));
          for (const af of e.aliasFacts) {
            const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
            if (seenAlias.has(key)) continue;
            seenAlias.add(key);
            parts.push(`${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
          }
        }
        return { subject: node.entity, citation: parts };
      });
    }
    if (rule && ruleKind === RULE_KIND_FILTER) {
      const base = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const property = rule.attributes.find((a) => a.prop === "mgx:ruleFilterProperty")?.value;
      if (!base || !property) return [];
      const baseHits = await resolveRelationChaseReverse(memory, base, objectTerm, helpers);
      const propertyNorm = normFactTerm(property);
      const out = [];
      for (const bh of baseHits) {
        const subjectEntity = normFactTerm(bh.subject);
        const propHit = rows.find(
          (f) => f.predicate === HAS_PROPERTY_PREDICATE && f.subject === subjectEntity && normFactTerm(f.object) === propertyNorm
        );
        if (propHit) out.push({ subject: bh.subject, citation: [...bh.citation, renderFactLine2(propHit)] });
      }
      return out;
    }
    return [];
  }
  function readFactRows(memory) {
    const individuals = memory?.individuals || [];
    const sourcesById = new Map(individuals.filter((i) => i?.class === SOURCE_CLASS).map((i) => [i.id, i]));
    const statedGroup = (memory?.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
    const byFact = /* @__PURE__ */ new Map();
    for (const e of statedGroup?.examples || []) {
      if (!byFact.has(e.subject)) byFact.set(e.subject, []);
      byFact.get(e.subject).push(e.object);
    }
    const rows = [];
    for (const ind of individuals) {
      if (ind?.class !== FACT_CLASS) continue;
      const get = (k) => (ind.attributes || []).find((a) => a?.key === k)?.value || "";
      const sourceIds = byFact.get(ind.id) || [];
      const sourceTypes = sourceIds.map((id) => (sourcesById.get(id)?.attributes || []).find((a) => a?.prop === "mgx:sourceType")?.value).filter(Boolean);
      const justificationRaw = get("justification");
      rows.push({
        id: ind.id,
        subject: get("subject"),
        predicate: get("predicate"),
        object: get("object"),
        provenance: get("provenance"),
        // legacy compat string, verbatim
        quantifier: get("quantifier"),
        // "" unless a plural class-membership teach set one (Feature A pt.3)
        sourceIds,
        sourceTypes,
        trust: Number((ind.attributes || []).find((a) => a?.prop === TRUST_SCORE_PROP)?.value) || 0,
        // [] unless a rule persisted its premise fact ids (PLAN_SYLLOGIST.md §3's
        // justification-tracking step — scm-sco only, today; see syllogise.mjs).
        justification: justificationRaw ? justificationRaw.split(" ").filter(Boolean) : []
      });
    }
    return rows;
  }
  async function removeFacts(dir, ids) {
    const idSet = new Set((ids || []).filter(Boolean));
    const removed = [];
    if (!idSet.size) return { removed };
    await mutateMemory(dir, (payload) => {
      payload.individuals = (payload.individuals || []).filter((ind) => {
        if (ind?.class === FACT_CLASS && idSet.has(ind.id)) {
          removed.push(ind.id);
          return false;
        }
        return true;
      });
      if (!removed.length) return;
      const removedSet = new Set(removed);
      for (const group of payload.objectProperties || []) {
        const before = group.examples || [];
        group.examples = before.filter((e) => !removedSet.has(e?.subject) && !removedSet.has(e?.object));
        group.count = group.examples.length;
      }
      recountClasses(payload);
    });
    return { removed };
  }
  function findContradictions(memory, { floor = CONTRADICTION_TRUST_FLOOR } = {}) {
    const rows = readFactRows(memory).filter((r) => r.trust >= floor);
    const byKey = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const key = `${r.subject} ${r.predicate}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    const out = [];
    for (const group of byKey.values()) {
      if (new Set(group.map((r) => r.object)).size > 1) {
        out.push(group.slice().sort((a, b) => b.trust - a.trust || a.object.localeCompare(b.object)));
      }
    }
    return out.sort((a, b) => `${a[0].subject} ${a[0].predicate}`.localeCompare(`${b[0].subject} ${b[0].predicate}`));
  }
  var MEMORY_DIR_REL, MEMORY_GRAPH_REL, UTTERANCE_CLASS, FACT_CLASS, MEMORY_SESSION_CLASS, SOURCE_CLASS, RULE_CLASS, SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP, DERIVED_FROM_PROP, STATED_BY_PROP, CANONICALISED_FROM_PROP, CREATED_AT_PROP, UPDATED_AT_PROP, SOURCE_RELIABILITY_PROP, OPERATOR_SOURCE_ID, TEACH_SOURCE_ID, ROLES, LABEL_CAP, TEXT_CAP, MEMORY_VOCABULARY, memoryGraphFile, BACKEND_MEMORY, BACKEND_SQLITE, SQLITE_DDL, STD_EDGE_KEYS, cloneJson, MEMORY_MANIFEST_REL, DEFAULT_RETENTION, resolveManifestFile, normText, labelOf, nowIso, sourceLabel, isSessionScopedSourceId, factIdFor, RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE, RULE_KINDS2, RULE_NAME_PROP, RULE_KIND_PROP, RULE_SLOT_SPEC, ruleIdFor, CONTRADICTION_TRUST_FLOOR;
  var init_core = __esm({
    "src/memory/core.mjs"() {
      init_promises();
      init_node_path();
      init_prose();
      init_hash();
      init_trust();
      init_shacl();
      init_planning();
      MEMORY_DIR_REL = join(".tmct", "memory");
      MEMORY_GRAPH_REL = join(MEMORY_DIR_REL, "graph.json");
      UTTERANCE_CLASS = "Utterance";
      FACT_CLASS = "Fact";
      MEMORY_SESSION_CLASS = "Session";
      SOURCE_CLASS = "Source";
      RULE_CLASS = "Rule";
      SAID_IN_SESSION_PROP = "mgx:saidInSession";
      IN_REPLY_TO_PROP = "mgx:inReplyTo";
      DERIVED_FROM_PROP = "mgx:derivedFrom";
      STATED_BY_PROP = "mgx:statedBy";
      CANONICALISED_FROM_PROP = "mgx:canonicalisedFrom";
      CREATED_AT_PROP = "mgx:createdAt";
      UPDATED_AT_PROP = "mgx:updatedAt";
      SOURCE_RELIABILITY_PROP = "mgx:sourceReliability";
      OPERATOR_SOURCE_ID = "src:operator-chat";
      TEACH_SOURCE_ID = "src:teach-chat";
      ROLES = /* @__PURE__ */ new Set(["visitor", "tmct"]);
      LABEL_CAP = 48;
      TEXT_CAP = 2e3;
      MEMORY_VOCABULARY = [
        { prop: "rdf:type", note: "rdf-ish typing attribute: owl:NamedIndividual (utterances/sessions) or rdf:Statement (reified facts)" },
        { prop: "mgx:utteranceRole", note: "who said it: visitor (an a-visitor-said item) or tmct (the response alongside it)" },
        { prop: "mgx:utteranceText", note: "the utterance's normalized text (capped)" },
        { prop: "mgx:utteranceTs", note: "when it was said, ISO-8601 (the chat turn timestamp)" },
        { prop: "mgx:utteranceParsed", note: "optional JSON of the parse the interpretation pipeline produced for this request" },
        { prop: SAID_IN_SESSION_PROP, predicate: "saidInSession", note: "Utterance \u2192 Session it was said in; runtime observation, owned (no SEON term)" },
        { prop: IN_REPLY_TO_PROP, predicate: "inReplyTo", note: "tmct Utterance \u2192 the visitor Utterance it answers (the Q/A pairing)" },
        { prop: "rdf:subject", note: "reified fact: the triple's subject term" },
        { prop: "rdf:predicate", note: "reified fact: the triple's predicate term" },
        { prop: "rdf:object", note: "reified fact: the triple's object term" },
        { prop: "mgx:factProvenance", note: "LEGACY COMPAT SHIM: the ' | '-joined provenance tag string a fact came from; the source-of-truth is now the mgx:statedBy edges derived from it" },
        { prop: "mgx:factQuantifier", note: "OPTIONAL: the quantifier word a plural class-membership teach used ('every'/'some'/'a few'), for literal recall by 'how many Xs are Ys' \u2014 never real cardinality counting" },
        { prop: "mgx:ruleName", note: "a taught Rule's own name (e.g. 'grandparent') \u2014 the query-dispatcher's lookup key, PLAN_TAUGHT_RELATIONS.md \xA72/\xA73" },
        { prop: "mgx:ruleKind", note: "a taught Rule's SHAPE tag \u2014 the closed vocabulary compose2 | filter | recursive (structural, like 'Fact'/'Rule' themselves, never a domain word)" },
        { prop: "mgx:ruleBase1", note: "compose2: the first hop's base relation name; filter: the base rule/relation being filtered (same 'base relation' role in both kinds, so the name is shared)" },
        { prop: "mgx:ruleBase2", note: "compose2 only: the second hop's base relation name" },
        { prop: "mgx:ruleFilterProperty", note: "filter only: the property literal candidates are filtered by (an mgx:hasProperty-shaped Fact lookup)" },
        { prop: "mgx:ruleBaseCase", note: "recursive only: the base-case relation name (hop zero)" },
        { prop: "mgx:ruleRecStep", note: "recursive only: the self-referential recursive-step relation name" },
        { prop: CREATED_AT_PROP, note: "when an individual was FIRST written, ISO-8601 (first-write-wins on upsert); the audit 'when', the recency input to trust, the novelty signal" },
        { prop: UPDATED_AT_PROP, note: "when an individual's OWN attributes were last mutated in place (upsertSession, recomputeFactTrust, recomputeSourceReliability) \u2014 most individuals never carry this and instead derive 'updated' from codegraph.mjs's derivedUpdatedAt (max createdAt over their edges)" },
        { prop: DERIVED_FROM_PROP, predicate: "derivedFrom", note: "umbrella: a Fact derived from a Source (or another Fact). ext ref prov:wasDerivedFrom (UNVERIFIED-pending-web-check)" },
        { prop: STATED_BY_PROP, predicate: "statedBy", note: "subPropertyOf derivedFrom: a Source directly asserts this Fact (one edge per independent source \u2014 replaces the factProvenance union)" },
        { prop: CANONICALISED_FROM_PROP, predicate: "canonicalisedFrom", note: "subPropertyOf derivedFrom: a canonical Fact cleaned from a raw Block/Source, never replacing it" },
        { prop: "mgx:sourceType", note: "a Source's kind: operator | teach | provider | corpus | corpusWeak | extracted | web | entailed (the trust-prior key)" },
        { prop: "mgx:sourceUrl", note: "a web Source's URL" },
        { prop: "mgx:sourceRule", note: "an entailed Source's rule id" },
        { prop: "mgx:sourceReliability", note: "actor-level (session-scoped) trust nudge in [0.5,1.5], neutral 1.0 when absent \u2014 materialised by recomputeSourceReliability from a session's asserted-vs-contradicted track record (memory/trust.mjs's sessionReliabilityFrom); folds into computeTrust's per-source prior" },
        { prop: TRUST_SCORE_PROP, note: "materialised trust cache in [0,1] \u2014 pure function of a fact's Sources + createdAt (memory/trust.mjs); invalidated when a statedBy edge is added" },
        { prop: TRUST_INPUTS_PROP, note: "JSON of the inputs the trust score was computed from (source-type multiset, corroboration count, createdAt, recency) \u2014 makes the score auditable" },
        { prop: "mgx:hasProseTokens", note: "prose tokens (prose.mjs tokenizer) backing the payload's proseIndex" },
        { prop: "mgx:sessionStarted", note: "session anchor: when the session started, ISO-8601" }
      ];
      memoryGraphFile = (dir) => resolveMemoryGraphFile(dir);
      BACKEND_MEMORY = "memory";
      BACKEND_SQLITE = "sqlite";
      SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS individuals (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, class TEXT, label TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (prop TEXT PRIMARY KEY, ord INTEGER NOT NULL, predicate TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS edges (prop TEXT NOT NULL, subject TEXT NOT NULL, object TEXT NOT NULL, subject_label TEXT, object_label TEXT, extra TEXT, PRIMARY KEY (prop, subject, object));
CREATE INDEX IF NOT EXISTS edges_by_prop ON edges(prop);
`;
      STD_EDGE_KEYS = /* @__PURE__ */ new Set(["subject", "object", "subjectLabel", "objectLabel"]);
      cloneJson = (v) => v === void 0 ? v : structuredClone(v);
      MEMORY_MANIFEST_REL = join(MEMORY_DIR_REL, "manifest.json");
      DEFAULT_RETENTION = 5;
      resolveManifestFile = (dir) => join(dir, MEMORY_MANIFEST_REL);
      normText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);
      labelOf = (text) => text.length > LABEL_CAP ? text.slice(0, LABEL_CAP - 1) + "\u2026" : text;
      nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
      sourceLabel = (id) => String(id).replace(/^src:/, "");
      isSessionScopedSourceId = (id) => typeof id === "string" && (id.startsWith(`${OPERATOR_SOURCE_ID}:`) || id.startsWith(`${TEACH_SOURCE_ID}:`));
      factIdFor = (s, p, o) => `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;
      RULE_KIND_COMPOSE2 = "compose2";
      RULE_KIND_FILTER = "filter";
      RULE_KIND_RECURSIVE = "recursive";
      RULE_KINDS2 = Object.freeze([RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE]);
      RULE_NAME_PROP = "mgx:ruleName";
      RULE_KIND_PROP = "mgx:ruleKind";
      RULE_SLOT_SPEC = {
        [RULE_KIND_COMPOSE2]: [["base1", "mgx:ruleBase1"], ["base2", "mgx:ruleBase2"]],
        [RULE_KIND_FILTER]: [["base", "mgx:ruleBase1"], ["property", "mgx:ruleFilterProperty"]],
        [RULE_KIND_RECURSIVE]: [["baseCase", "mgx:ruleBaseCase"], ["recStep", "mgx:ruleRecStep"]]
      };
      ruleIdFor = (kind, name, slot1, slot2) => `rule:${fnv1aHex(`${kind}\0${name}\0${slot1}\0${slot2}`)}`;
      CONTRADICTION_TRUST_FLOOR = 0.5;
    }
  });

  // src/codegraph.mjs
  var init_codegraph = __esm({
    "src/codegraph.mjs"() {
      init_prose();
      init_embed();
      init_core();
    }
  });

  // src/ask-vocab.mjs
  function stripTrailingScopeFiller(text) {
    return text.replace(TRAILING_SCOPE_FILLER_RE, "").trim();
  }
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
  var INHERITS_REVERSE_VERB_LIST, RELATIONS, INHERITS_REVERSE_VERBS, WHERE_MARKERS, MENTION_MARKERS, TRAILING_SCOPE_FILLER, TRAILING_SCOPE_FILLER_RE, TRAILING_DISCOURSE_TAG, TRAILING_DISCOURSE_TAG_RE, TRAILING_DISCOURSE_CLAUSE, TRAILING_DISCOURSE_CLAUSE_RE, VERB_TO_KIND, NON_REVERSE_VERB, ARTICLE_RELATION_CONTINUATIONS, ENTITY_TO_TYPE, MODIFIER_TO_KIND, PASSIVE_PARTICIPLE_TO_KIND, CONTRACTIONS, MISSPELLINGS, WRONG_WORDS, FILLER_WORDS, CONTEXT_PRONOUNS, NEGATION_FRAMES, COMMIT_CONTENT_FRAMES, META_MEANING_VERBS, RELATIVE_PRONOUNS, PLACEHOLDER_NOUNS, BOOLEAN_CONNECTIVES, QUALIFIERS, AGGREGATE_TRIGGERS, LIST_TRIGGERS, SUPERLATIVE_EXTREMES, EDGE_NOUN_TO_METRIC, METRIC_IMPLIES_ENTITY, ANAPHORA_TRIGGERS, MEMBERSHIP_KINDS, CASCADE_NOISE, CASCADE_SYNONYMS, HELP_TRIGGERS;
  var init_ask_vocab = __esm({
    "src/ask-vocab.mjs"() {
      INHERITS_REVERSE_VERB_LIST = [
        "is a superclass of",
        "are a superclass of",
        "is a parent class of",
        "are a parent class of",
        "superclass",
        "superclasses"
      ];
      RELATIONS = {
        imports: {
          comment: "Module -> Module: subject's import graph references object (usesComplexType).",
          verbs: [
            // formal/neutral ("uses"/"use" moved to the `uses` union family, 2026-07-02 —
            // "uses code from" stays here: its phrasing is specifically import-flavored)
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
            // gerund (g-drop normalization turns dialectal "importin'" into this — §3.5)
            "importing"
          ]
        },
        // "uses" is a QUERY-side union family, not a stored predicate (2026-07-02 query
        // families): "what uses X" honestly means BOTH the import graph and the call
        // graph, so ask.mjs traverses it as imports + calls + callsSymbol together
        // (KIND_UNIONS there). The verbs moved here FROM imports — "which modules use X"
        // still answers with the importing modules (the asked Module grain filters the
        // union down to module-grain subjects), and "what uses <function>" now also
        // reaches the symbol-grain callers instead of silently ignoring them.
        uses: {
          comment: "query-side union: imports (Module->Module) + calls (Module->Module) + callsSymbol (fn->fn).",
          verbs: [
            "uses",
            "use",
            "used by",
            "makes use of",
            "make use of",
            // gerund (g-drop normalization — §3.5)
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
            // gerund (g-drop normalization turns dialectal "callin'" into this — §3.5)
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
            // gerund (g-drop normalization — §3.5)
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
            // gerund (g-drop normalization — §3.5)
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
            // gerund (g-drop normalization — §3.5)
            "testing"
          ]
        },
        inherits: {
          comment: "Class -> Class: subject's declared base resolves to object (subclassOf).",
          verbs: [
            "inherits from",
            "inherit from",
            // bare "inherits"/"inherit" (Tier 6 playtest, §3b surface-variation axis):
            // this list's own SIBLING verb "extends"/"extend" already works bare, with
            // no "from" required, but "inherits"/"inherit" — arguably the MORE common
            // everyday phrasing of the two ("TaskController inherits Controller",
            // "does TaskController inherit Controller") — had no bare form at all,
            // only the "... from" variant. VERB_ALT's longest-first sort (already
            // relied on elsewhere in this file for the same reason) means "inherits
            // from"/"inherit from" still win whenever "from" actually follows, so
            // this is purely additive.
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
            // gerund (g-drop normalization — §3.5, and the compositional grammar's
            // gerund-led boolean gate: "classes inheriting from Base but not tested").
            // Both the two-word "inheriting from" (so "from" is consumed into the verb
            // phrase, not the object term) and the bare "inheriting" (the single token
            // the gerund-lead check reads) are listed; longest-match-first prefers the
            // two-word form when "from" follows.
            "extending",
            "inheriting from",
            "inheriting",
            "subclassing",
            "extends from",
            // REVERSE phrasings (Seonix Batch 2 Fix 2, see INHERITS_REVERSE_VERB_LIST's own
            // comment above): "is/are a|the superclass/parent class of" — folded in here so
            // VERB_TO_KIND maps them to "inherits" like every other verb in this list; the
            // subject/object SWAP their direction requires is handled at parse time by the
            // strategies that build the "ask" shape, not here.
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
            // commit-question forms (2026-07-02, viewer commit-chat fix): the same touch
            // relation asked from the commit's side — "which changes touch commit <sha>",
            // "what did commit <sha> touch", "which functions changed in <sha>", "which
            // changes landed in commit <sha>", "what was touched by commit <sha>". Bare
            // "touch" completes the touched/touches pair for the "did … touch" auxiliary
            // form; the "by"/"in" phrases are the passive/locative counterparts of forms
            // already above (curated per register spread, not a thesaurus dump).
            "touch",
            "touched by",
            "modified by",
            "changed by",
            "changed in",
            "landed in",
            "land in",
            // contents-of-a-commit forms (2026-07-02, operator screenshot: "what was in
            // commit <sha>" missed on the live site). "was in"/"went into" only read as
            // touch questions when the object is a commit — the sha-shaped object keeps
            // them from firing on structural questions ("is X in the graph" has no verb
            // match anyway). Judgment call: "is in" omitted — too generic without the
            // past-tense anchor and risks matching containment phrasings.
            "was in",
            "were in",
            "went into",
            "included in",
            // when-question forms (2026-07-02 query families): "when was X last
            // updated/edited" — bare past participles that only read naturally in the
            // temporal shape; the when template routes them, but they are ordinary
            // touches verbs so "which modules were updated ..." keeps working too.
            "updated",
            "edited",
            // gerund (g-drop normalization — §3.5)
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
            // Track-1 trio (temporal lever): the bare "changed/change together with" form
            // (no "tends to"/"tend to" prefix) was missing outright — "which modules
            // changed together with X" fell through to the "touch(ed)" verb instead (a
            // Commit->Module kind, structurally unable to match a Module subject), always
            // producing a confidently-empty answer regardless of real cochange data.
            "changed together with",
            "change together with",
            "changes together with",
            // Present-tense bare form (Seonix Batch 4/5 follow-up): only the past tense
            // "changed with" existed above — "what changes with X"/"what usually changes
            // with X" fell through entirely (ENTITY_TO_TYPE's own "changes"->"Change"
            // pseudo-type noun risked consuming the word first; see parseRelationalOrQualified's
            // guard against exactly that in ask.mjs).
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
            // API-surface phrasing (2026-07-02 query families): "what does <module>
            // expose". Bare "exposed" is NOT listed — the lemma tier maps it here when
            // an adapter is present, and "how does the API get exposed" has no
            // traversal either way (pinned as an honest miss in the tests).
            "exposes",
            "expose",
            // gerund (g-drop normalization — §3.5)
            "exporting"
          ]
        }
      };
      INHERITS_REVERSE_VERBS = Object.freeze([
        ...INHERITS_REVERSE_VERB_LIST,
        "is the superclass of",
        "are the superclass of",
        "is the parent class of"
      ]);
      WHERE_MARKERS = Object.freeze(["defined", "declared", "located", "implemented"]);
      MENTION_MARKERS = Object.freeze(["mentioned", "referenced"]);
      TRAILING_SCOPE_FILLER = Object.freeze([
        "in this graph",
        "in the graph",
        "in this codebase",
        "in the codebase",
        "in this repo",
        "in the repo",
        "here"
      ]);
      TRAILING_SCOPE_FILLER_RE = new RegExp(
        `\\s+(?:${TRAILING_SCOPE_FILLER.join("|")})\\s*[?.!]*$`,
        "i"
      );
      TRAILING_DISCOURSE_TAG = Object.freeze(["then", "though", "too"]);
      TRAILING_DISCOURSE_TAG_RE = new RegExp(
        `\\s+(?:${TRAILING_DISCOURSE_TAG.join("|")})\\s*[?.!]*$`,
        "i"
      );
      TRAILING_DISCOURSE_CLAUSE = Object.freeze(["please explain", "explain"]);
      TRAILING_DISCOURSE_CLAUSE_RE = new RegExp(
        `,\\s*(?:${TRAILING_DISCOURSE_CLAUSE.join("|")})\\s*[?.!]*$`,
        "i"
      );
      VERB_TO_KIND = Object.freeze(
        Object.fromEntries(
          Object.entries(RELATIONS).flatMap(([kind, { verbs }]) => verbs.map((v) => [v, kind]))
        )
      );
      NON_REVERSE_VERB = (v) => !INHERITS_REVERSE_VERBS.includes(v);
      ARTICLE_RELATION_CONTINUATIONS = Object.freeze([
        ...new Set(
          Object.keys(VERB_TO_KIND).filter(NON_REVERSE_VERB).map((v) => v.match(/^(?:is|are)\s+an?\s+(.+)$/i)).filter(Boolean).map((m) => m[1].toLowerCase())
        )
      ]);
      ENTITY_TO_TYPE = Object.freeze({
        function: "Function",
        functions: "Function",
        method: "Method",
        methods: "Method",
        class: "Class",
        classes: "Class",
        // "mod"/"mods" (HANDOVER.md 2026-07-10 item 10): a rushed-dev abbreviation
        // prefix ("mod store.mjs imports") used to land in disambiguation instead of
        // resolving cleanly, since nothing recognized "mod" as this same Module noun
        // — same alias-of-Module trade "file"/"files" already make just above.
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
        // "changes" in a touch question ("which changes touch commit <sha>") means the
        // code entities on the other end of the touch edges, at WHATEVER grain the graph
        // recorded — module (touches) and symbol (touchesSymbol) together when the commit
        // is the given side, and the touching commits themselves when a module/symbol is
        // the given side. Mapped to the pseudo-type "Change" (not a node class): ask.mjs's
        // traverse() reads it as a wildcard over the touch traversal's results rather than
        // aliasing it to ONE real class and silently dropping the other grain of the
        // answer. Listed BEFORE commit/commits: findPhrase (ask.mjs) takes the first
        // same-length phrase in table order, so in "which changes touch commit <sha>" the
        // entity slot must consume "changes" and leave "commit <sha>" intact as the
        // object term.
        change: "Change",
        changes: "Change",
        commit: "Commit",
        commits: "Commit"
      });
      MODIFIER_TO_KIND = Object.freeze({
        explicitly: "direct",
        directly: "direct",
        transitively: "transitive",
        indirectly: "transitive"
      });
      PASSIVE_PARTICIPLE_TO_KIND = Object.freeze({
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
      CONTRACTIONS = Object.freeze({
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
      MISSPELLINGS = Object.freeze({
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
        // "touchd" (BENCHMARK_CONVERSATION_1.7.0.md routed backlog C3): the
        // dropped-vowel slip of "touched" — distinct from "touhced" above
        // (transposed letters), same curated-typo discipline.
        "touchd": "touched",
        // WHERE_MARKERS typo (0.9.13 Tier-1 playtest): "defined" itself had no typo
        // entry, so "where is it defned" fell through to the bare-object search path
        // instead of the where-shape ("no module matching 'it defned' found").
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
        // "wehre"/"whre" (0.9.13 Tier-1 playtest, "where is it defined" drill-down):
        // the WHERE-DEFINED shape's own anchor word had NO typo tolerance at all
        // (unlike which/what/does/the above), so a plain dropped/transposed letter
        // fell straight through resolveObject and hit either the grammar wall or a
        // bogus "no module matching 'it defined'" search. "were" (the missing-h
        // homophone slip) is NOT curated here — it's a real word already load-bearing
        // as the TEMPORAL_AUX auxiliary ("when were the modules last touched"), so
        // that one typo is handled by its own anchored phrasing frame instead
        // (normalize.mjs PHRASING_FRAMES) to avoid clobbering the legitimate reading.
        "wehre": "where",
        "whre": "where",
        // "wat" (chatbench cycle 2, tf-wat-calls): the internet-casual spelling of
        // "what" — neither curated noise nor a restorable trigger typo, so "wat calls
        // fnAlpha" used to die as "couldn't resolve one of the terms". Restored here
        // so BOTH parse strategies and the relaxation cascade see the canonical
        // anchor; the correction regex's dotted-extension guard keeps a module
        // literally named "wat.mjs" untouched, same residual trade as every entry.
        "waht": "what",
        "wat": "what",
        // "dat" (BENCHMARK_CONVERSATION_1.7.0.md routed backlog C3): the internet-
        // casual spelling of "that" — same register as "wat"/"waht" just above,
        // curated rather than left to the generic fuzzy tier since "that" is a
        // load-bearing anchor word throughout this grammar (TEACH_RE's own
        // "remember that X", relative-clause objects, etc).
        "dat": "that",
        "dose": "does",
        "doess": "does",
        "teh": "the",
        // aggregate/list TRIGGER words (2026-07-02, trigger-typo work) — a typo of a count
        // or list trigger used to be DROPPED as unmatched by the relaxation cascade, losing
        // the aggregate/list INTENT entirely ("how manyn classes" → the count was lost);
        // curated here so the intended trigger is restored BEFORE parsing (the general
        // bounded fuzzy path in ask.mjs's cascade is the backstop for uncurated typos).
        "manyn": "many",
        "mnay": "many",
        "amny": "many",
        "mnany": "many",
        // "hwo" (Tier 6 playtest, §3b typo axis): a transposed-letter typo of "how" —
        // "hwo many classes are there" used to lose the aggregate/list trigger
        // outright ("how many" only reads as a count trigger when both words are
        // exact), same failure class as "manyn"/"mnay" just above, one word to the
        // left of it. "how" is grammar-owned via AGGREGATE_TRIGGERS' own "how many"/
        // "how much" entries (test/ask-vocab.test.mjs's canonical-value check
        // splits those multi-word triggers into individual words).
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
      WRONG_WORDS = Object.freeze({
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
      FILLER_WORDS = Object.freeze([
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
        // "quick q" (BENCHMARK_CONVERSATION_1.8.14.md item 11): the casual abbreviated
        // sibling of GREETING_PREAMBLE_RE's own "quick question" clause (normalize.mjs)
        // — that frame requires a delimiter immediately after the greeting word
        // ("hey, quick question - …"), so it never matches "hey quick q, …" (no
        // delimiter between "hey" and "quick q"). Filler-stripping instead — this
        // list is matched word-boundary-anywhere, not anchored — closes the gap
        // without needing GREETING_PREAMBLE_RE's own stricter delimiter-position
        // shape.
        "quick q"
      ]);
      CONTEXT_PRONOUNS = Object.freeze(["this", "it", "that", "here", "this one", "that one"]);
      NEGATION_FRAMES = Object.freeze([
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
      COMMIT_CONTENT_FRAMES = Object.freeze([
        // "what was in commit ef74e44e25c8" / "what is in ef74e44e" / "what's in commit <sha>"
        { re: /^what\s+(?:is|was|were|are)\s+in\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
        // "what went into commit ef74e44e25c8" / casual "what got into <sha>"
        { re: /^what\s+(?:went|got)\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
        // "what made it into commit ef74e44e25c8"
        { re: /^what\s+made\s+it\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` }
      ]);
      META_MEANING_VERBS = Object.freeze([
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
      RELATIVE_PRONOUNS = Object.freeze(["that", "which", "who"]);
      PLACEHOLDER_NOUNS = Object.freeze([
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
        // "symbol(s)" is a grain-agnostic stand-in for any code entity — "exported
        // symbols of X" means whatever X defines, at any grain, filtered by the qualifier.
        "symbol",
        "symbols"
      ]);
      BOOLEAN_CONNECTIVES = Object.freeze({
        "but not": "difference",
        "and not": "difference",
        "except": "difference",
        "without": "difference",
        "and": "intersection",
        "plus": "intersection",
        "or": "union"
      });
      QUALIFIERS = Object.freeze({
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
      AGGREGATE_TRIGGERS = Object.freeze([
        // formal ("the number of classes" reaches "number of" once the cascade strips the
        // leading article — keeping the trigger list clear of "the" so it never enters
        // CONTENT_VOCAB and blocks the article's own noise-strip)
        "how many",
        "how much",
        "how many of",
        "number of",
        "total number of",
        "quantity of",
        // "<measure> of <kind>" cardinality forms (widened net, cycle W2P): count = sum = total
        // = tally = number of. The bare single words (sum/total/tally) stay CASCADE_SYNONYMS-
        // mapped to "count" (identifier-fragment risk without the "of" anchor — see that table's
        // note); the multi-word "of" forms are safe to promote to direct triggers because the
        // trailing "of <kind>" pins them to a cardinality question, not a stray identifier.
        "tally of",
        "sum of",
        "total of",
        "amount of",
        // neutral / imperative (bare "tally"/"sum"/"total" stay CASCADE_SYNONYMS-mapped so the
        // "tally the classes" relaxation path — pinned by a cascade test — is preserved).
        "count",
        "count up",
        "count of",
        "tot up"
      ]);
      LIST_TRIGGERS = Object.freeze([
        // imperative — "<verb> [me/us] [the] <kind>"
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
        // interrogative — "what/which are [the] <kind>"
        "what are",
        "which are"
      ]);
      SUPERLATIVE_EXTREMES = Object.freeze({
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
      EDGE_NOUN_TO_METRIC = Object.freeze({
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
        // participle degree-nouns (widened net, cycle W2P): "the most imported / most
        // depended-on / most used <module>" ranks by IN-degree — how many things import/depend
        // on/use it — the ARGMAX-by-degree intent a developer expresses with a passive
        // participle rather than the noun ("importers"). "depended" catches "depended-on" /
        // "depended on" (both tokenize to a bare "depended"); "used" folds the symbol-grain
        // callsSymbol callers in alongside importers so "most used" reads as most-relied-upon.
        imported: { kind: "imports", dir: "in" },
        "depended-on": { kind: "imports", dir: "in" },
        depended: { kind: "imports", dir: "in" },
        used: { kind: "imports", dir: "in", sibling: "callsSymbol" },
        called: { kind: "calls", dir: "in", sibling: "callsSymbol" }
      });
      METRIC_IMPLIES_ENTITY = Object.freeze({
        tests: "Module",
        test: "Module"
      });
      ANAPHORA_TRIGGERS = Object.freeze(["those", "them", "these"]);
      MEMBERSHIP_KINDS = Object.freeze(["contains", "defines"]);
      CASCADE_NOISE = Object.freeze([
        // articles / vague determiners (kept OUT of content vocab so they're strippable;
        // the aggregate/where parsers already tolerate a stray "the"/"a", so stripping is
        // belt-and-braces, not load-bearing)
        "the",
        "a",
        "an",
        "some",
        // "what OTHER classes inherit from Controller" — "other" is a vague determiner
        // like "some", not a qualifying adjective; without this it was misread as a
        // fuzzy find TERM ("no classes found matching 'other'") instead of falling
        // through to the ordinary reverse-inherits parse (fast-loop round 6 finding).
        "other",
        // topic lead-in filler — "what about the modules", "how about classes": "about"
        // carries no graph meaning here, so stripping it lets the bare kind noun surface for
        // the cascade's bare-kind-noun terminal rule (ask.mjs). ("what"/"how" are structural
        // question words the drop-pass keeps; only the "about" between them and the kind is
        // noise.) A module literally named "about" is safe-listed by relaxParse's resolvesExact
        // guard, same as every other noise token.
        "about",
        // politeness / hedges (single-token; multi-word "could you"/"please" etc. are
        // FILLER_WORDS, stripped earlier during normalization)
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
        // greetings a question sometimes opens with (chat.mjs owns standalone greetings;
        // here they're only stripped when embedded in an otherwise-real question)
        "hi",
        "hello",
        "hey",
        "yo",
        "hiya",
        "howdy",
        "ok",
        "okay",
        // vocatives / terms of address (the "matey" of the worked example, and its kin)
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
        // the product's OWN name used as an address (chatbench cycle 2, ns-hey-tmct:
        // "hey tmct, what calls fnAlpha thanks") — a vocative like "matey", stripped
        // by the same rules: relaxParse's resolvesExact guard still protects a module
        // literally named "tmct", and noise-strip's template/keyword-spot acceptance
        // bounds the cost of a mid-question strip to an honest object-miss.
        "tmct",
        // presentation frames — the keyword-spotting strategy's blind spot: the
        // compositional grammar skips these as FRAME_WORDS, but "show me what imports X"
        // otherwise decomposes (via keyword-spot) to ask{subject:"show me"}. Stripping
        // them on a miss recovers the underlying reverse/forward question. ("count" is NOT
        // here — it is an aggregate trigger; "find"/"search" are here as presentation
        // verbs, not the tmct_search tool, which ask.mjs never dispatches.)
        "show",
        "tell",
        "give",
        "list",
        "find",
        "me",
        "us",
        "lemme"
      ]);
      CASCADE_SYNONYMS = Object.freeze({
        tally: "count",
        tallies: "count",
        sum: "count",
        total: "count",
        totals: "count"
      });
      HELP_TRIGGERS = Object.freeze([
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
    }
  });

  // src/interpret/normalize.mjs
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  var tableRe, CONTRACTION_RE, correctionRe, MISSPELLING_RE, WRONG_WORD_RE, VERB_ALTERNATION, FILLER_RE, RELATION_VERB_RE, CONDITIONAL_VERB_GERUND, CONDITIONAL_KIND_PLURAL, CONDITIONAL_QUALIFIER_SRC, CONDITIONAL_QUALIFIER_RE, PHRASING_FRAMES, NEGATION_SET_RE, STOPWORDS2, splitWords, wordsOf;
  var init_normalize = __esm({
    "src/interpret/normalize.mjs"() {
      init_ask_vocab();
      tableRe = (table) => new RegExp(
        "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
        "gi"
      );
      CONTRACTION_RE = tableRe(CONTRACTIONS);
      correctionRe = (table) => new RegExp(
        "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b(?!\\.[a-z0-9])",
        "gi"
      );
      MISSPELLING_RE = correctionRe(MISSPELLINGS);
      WRONG_WORD_RE = correctionRe(WRONG_WORDS);
      VERB_ALTERNATION = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      FILLER_RE = FILLER_WORDS.length ? new RegExp(
        "\\b(" + [...FILLER_WORDS].sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b\\s*,?",
        "gi"
      ) : null;
      RELATION_VERB_RE = new RegExp(
        "\\b(?:" + Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
        "i"
      );
      CONDITIONAL_VERB_GERUND = Object.freeze({
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
      CONDITIONAL_KIND_PLURAL = Object.freeze({
        module: "modules",
        class: "classes",
        function: "functions",
        method: "methods",
        attribute: "attributes",
        variable: "variables",
        commit: "commits",
        file: "files"
      });
      CONDITIONAL_QUALIFIER_SRC = "public|private|protected|static|abstract|constant|re-?exported|exported|tested|covered|untested|uncovered";
      CONDITIONAL_QUALIFIER_RE = new RegExp(
        "^if\\s+(?:a|an|the)?\\s*(" + Object.keys(CONDITIONAL_KIND_PLURAL).join("|") + ")\\s+(" + Object.keys(CONDITIONAL_VERB_GERUND).join("|") + ")\\s+(.+?),\\s*(?:is|are)\\s+(?:it|that|they|this)\\s+(" + CONDITIONAL_QUALIFIER_SRC + ")\\??$",
        "i"
      );
      PHRASING_FRAMES = Object.freeze([
        // MEMBERS-of-class → "what does X contain".
        //   "what functions are in Task", "what methods are inside X", "what attributes are in X"
        { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:are|is)\s+(?:in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        //   "what functions does Task have", "what methods does X have"
        { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:does|do)\s+(.+?)\s+have\??$/i, to: (m) => `what does ${m[1]} contain` },
        //   "what are the members of X", "what are the methods in X"
        { re: /^what\s+are\s+(?:the\s+)?(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:of|in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        //   "members of X", "methods of X", "contents of X"
        { re: /^(?:the\s+)?(?:members?|methods?|attributes?|contents)\s+of\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        //   "what's in X" / "what is in X" (contraction already expanded; sha handled above)
        { re: /^what\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        //   "what else is in X" (0.9.15 Tier-1 single-touch playtest) — the natural
        //   "besides what I already know" drill-down after a members-of-class answer.
        //   Distinct from the "what else does X <verb>" family (which the compositional
        //   grammar already tolerates, dropping "else" as noise on its own): the "is
        //   in" idiom is NOT a compositional marker, so parseComposite never sees it and
        //   "what else is in X" fell through to the strategies with NO candidate at all
        //   (neither recognizes the bare "is in" idiom once "else" sits in front of it).
        //   The only rescue was the relaxation cascade's drop-unmatched layer — but that
        //   layer refuses to accept a relaxed reading that still renders an honest EMPTY
        //   (: relaxation must turn a miss into a real answer, never into
        //   another kind of miss), so a genuinely empty class ("what else is in
        //   Task.complete" — a method, no members) bottomed out at the bare grammar
        //   wall instead of the specific "no contains edges" receipt. Routing this
        //   frame onto the SAME direct "what does X contain" path the plain "what is
        //   in X" frame above already uses sidesteps the cascade's conservative gate
        //   entirely, so a real empty is reported honestly instead of walled.
        { re: /^what\s+else\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        // WHERE-DEFINED → "where is X defined". PAST TENSE ONLY ("what defined X", "what
        // declared X"): the PRESENT "what defines X" already parses as a reverse-defines
        // query (the module defining symbol X — test/ask.test.mjs pins that), so rewriting
        // it would change that receipt. The past-tense form is the one that hit the wall.
        { re: /^what\s+(?:defined|declared)\s+(?:the\s+)?(?:function\s+|method\s+|class\s+|module\s+|variable\s+|constant\s+)?(.+?)\??$/i, to: (m) => `where is ${m[1]} defined` },
        //   "where's X defined" (the "where's" contraction is not in the contraction table)
        { re: /^where'?s\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
        //   "were is X defined" (0.9.13 Tier-1 playtest: the missing-h typo of "where").
        //   NOT curated as a blanket MISSPELLINGS entry — "were" is a real word already
        //   load-bearing as the TEMPORAL_AUX auxiliary ("when were the modules last
        //   touched"), so a global word-boundary rewrite would clobber that reading.
        //   This frame is anchored to the WHERE-DEFINED shape specifically ("were is
        //   … defined/declared/located/implemented"), a construction no legitimate
        //   temporal query produces ("were" as an auxiliary never leads directly into
        //   a bare "is").
        { re: /^were\s+is\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
        // PREDICATIVE QUALIFIER → the ATTRIBUTIVE form the grammar already answers. The
        // adjective-qualifier post-filters (ask-vocab.mjs QUALIFIERS: tested/untested,
        // public/private, exported, static/abstract/constant, …) parse in the ATTRIBUTIVE
        // slot — "untested modules", "public methods" — but a developer just as naturally
        // asks the PREDICATIVE "which modules are untested" / "what functions are tested",
        // which hit the grammar wall (and, worse, the wall's own hint SUGGESTED "which
        // functions are tested" — a shape it could not then answer). Rewriting the
        // predicative "<which|what> <kind> are <QUALIFIER>" to "<QUALIFIER> <kind>" routes
        // it onto the working attributive filter. Closed to the known qualifier adjectives
        // (not a general "… are X" catch), and the QUALIFIER must sit immediately after
        // are/is, so "which modules are NOT tested" never matches here — that keeps its own
        // set-complement handler (matchNegationSet, downstream in ask.mjs's parseNegation).
        {
          re: /^(?:which|what)\s+(?:the\s+|all\s+)?([a-z][a-z-]*?)\s+(?:are|is)\s+(public|private|protected|static|abstract|constant|exported|re-?exported|tested|covered|untested|uncovered)\??$/i,
          to: (m) => `${m[2].toLowerCase()} ${m[1].toLowerCase()}`
        },
        // BARE COVERAGE SURVEY (no entity kind) → the attributive "<qualifier> modules"
        // the grammar already answers. Once "what is a test" opens the topic, a developer
        // asks the survey the plainest way — "what is untested", "what's not tested",
        // "what isn't covered", "what is covered" — with NO entity noun at all, so the
        // predicative-qualifier frame above (which needs a KIND between what/which and
        // are/is) can't catch it, and it fell through to a soft wall ("no module matching
        // 'not'…" / the "I answer questions…" orientation). Default the surveyed kind to
        // modules (the same set "which modules are not tested" / "untested modules" return)
        // and fold the negation into the qualifier (not tested → untested, not covered →
        // uncovered). Anchored with no object, so "what tests cover X" / "what is a test"
        // never match here.
        {
          re: /^what\s+(?:is|are)\s+(not\s+)?(tested|untested|covered|uncovered)\??$/i,
          to: (m) => {
            const q = m[2].toLowerCase();
            const flipped = m[1] ? q === "tested" ? "untested" : q === "covered" ? "uncovered" : q : q;
            return `${flipped} modules`;
          }
        },
        // CO-CHANGE → the "co-changes with" canonical the RELATIONS table answers. The
        // cochange verb synonyms (ask-vocab.mjs) include "co-changes with" / "moves
        // together with" / "tends to change together with", but NOT the plainest form a
        // developer types — the one the README itself prints and the relation renders as:
        // "what does X change together with" / "what changes together with X". Both hit a
        // dead-end ("couldn't resolve one of the terms" / the grammar wall); rewriting them
        // onto "what co-changes with X" routes them to the working change-coupling query.
        { re: /^what\s+does\s+(.+?)\s+changes?\s+together\s+with\??$/i, to: (m) => `what co-changes with ${m[1]}` },
        { re: /^what\s+changes?\s+together\s+with\s+(.+?)\??$/i, to: (m) => `what co-changes with ${m[1]}` },
        // AUTHORSHIP → the "who touched X" churn query. "who touched X" now names the
        // commit author beside the sha (the 0.8.1 commit-ref quick-win), which invites the
        // synonyms a developer reaches for next — "who wrote X", "who authored X", "who is
        // the author of X" — and every one of them hit the grammar wall. tmct has no
        // separate authorship edge; "touched" IS the authorship signal (the churn commits
        // carry the author), so these are true synonyms of "who touched X", not a new
        // capability. Anaphora rides through untouched ("who wrote it" → "who touched it").
        // SHA GUARD (0.8.2 feel wave): a COMMIT object is NOT a synonym — "who is the
        // author of abc1234" rewritten to "who touched abc1234" dumps the commit's
        // touch-SET instead of naming its author. The negative lookahead refuses the
        // rewrite when the object is a bare (optionally "commit "-prefixed) 7-40 char
        // hex sha, leaving the un-rewritten form for the author lane to consume;
        // file/symbol objects (anything non-sha, e.g. "deadbeef.mjs") keep the rewrite.
        { re: /^who\s+(?:wrote|authored)\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
        { re: /^who\s+is\s+the\s+authors?\s+of\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
        // HAS-TESTS → the coverage question the RELATIONS table answers. "does X have
        // tests" parses "have" as a defines-verb (VERB_TO_KIND), producing the garbled
        // "No — no defines edge found from X to <whatever resolves>" receipt; "is X
        // tested" traverses tests edges from the WRONG side (subject = X). Both mean
        // the coverage question "what tests X" — rewrite onto it. Closed to a
        // tests/coverage object ("does X have methods/members" stays the members
        // family) and refuses any "not" in the subject span, so the set-complement
        // negations ("is X not tested") keep their own handler downstream.
        { re: /^(?:does|do)\s+(?!.*\bnot\b)(.+?)\s+have\s+(?:any\s+)?(?:tests?|test\s+coverage|coverage)\??$/i, to: (m) => `what tests ${m[1]}` },
        { re: /^(?:is|are)\s+(?!.*\bnot\b)(.+?)\s+tested\??$/i, to: (m) => `what tests ${m[1]}` },
        // NEEDS-TESTS → the untested-module survey. "what needs tests" / "what needs
        // testing" is the plainest way to ask which modules are uncovered, and it hit the
        // grammar wall ("no module matching 'needs'…"). Route it onto the same attributive
        // survey the bare "what is untested" frame lands on. Closed to the tests/coverage
        // object, so it can't swallow a general "what needs X".
        { re: /^what\s+needs\s+(?:to\s+be\s+)?(?:a\s+)?(?:tested|tests?|testing|coverage|covering)\??$/i, to: () => "untested modules" },
        // DOES-X-VERB-ANYTHING-ELSE → the plain forward "what does X <verb>" listing
        // (0.9.15 Tier-1 single-touch playtest). A very natural drill-down follow-up
        // after a relation answer — "does listTasks call anything else", "does
        // src/handlers/tasks.mjs import something else" — used to dead-end: "anything"/
        // "something" [else] is a placeholder standing in for "the rest of the list",
        // not a real object term, but the two parse strategies disagreed on the SPAN
        // (grammar kept "anything else" whole as the object, keyword-spot dropped
        // "anything" and kept only "else"), landing on the {ambiguousParse} surface —
        // two nonsense readings offered as if one might be right. "what does X <verb>"
        // is the exact working canonical shape (see the MEMBERS-of-class frames above),
        // so rewriting the whole closed pattern onto it sidesteps the disagreement
        // instead of teaching either strategy's tokenizer to special-case "else".
        // Anchored to the closed VERB_TO_KIND vocabulary so it can never swallow a
        // genuine named object that happens to start with "any"/"some" (only the bare
        // placeholder nouns "anything"/"something", optionally trailed by "else", match).
        {
          re: new RegExp(`^(?:do|does)\\s+(.+?)\\s+(${VERB_ALTERNATION})\\s+(?:anything|something)(?:\\s+else)?\\??$`, "i"),
          to: (m) => `what does ${m[1]} ${m[2]}`
        }
      ]);
      NEGATION_SET_RE = new RegExp(
        "^(?:which|what|who|list|show(?:\\s+me)?|find|give\\s+me)?\\s*(?:the\\s+|all\\s+)?([a-z][a-z-]*)\\s+(?:(?:that|which|who)\\s+)?(?:(?:do|does|did|are|is|was|were|have|has)\\s+)?not\\s+(.+)$",
        // the negation marker + (2) the predicate
        "i"
      );
      STOPWORDS2 = /* @__PURE__ */ new Set([
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
        // temporal filler in when-questions ("when was X last touched") — a symbol
        // literally named "last" would be the accepted residual cost, same trade as
        // every other stopword.
        "last",
        // frequency-adverb filler ("what does X usually change together with", "what does
        // X typically call") — found live: "usually" glued onto the object term instead of
        // being stripped, corrupting resolution ("src/core/store.mjs usually" instead of
        // the module alone). Same trade as every other stopword: a symbol literally named
        // "usually" would be the accepted residual cost.
        "usually",
        "typically",
        "generally",
        "normally",
        "often",
        "commonly",
        "mostly",
        // modal auxiliaries ("what SHOULD i look at first") — found live: with no modal in
        // this set, "should" reached the cascade's bounded fuzzy-correction step and landed
        // within edit distance of the unrelated closed-vocab word "hold" ("defines" synonym,
        // ask-vocab.mjs), corrupting the whole query into "what hold i at". Same trade as
        // every other stopword: a symbol literally named "should" would be the accepted
        // residual cost.
        "should",
        "would",
        "could",
        "can",
        "will",
        "shall",
        "might",
        "must"
      ]);
      splitWords = (text) => String(text).replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
      wordsOf = (arr) => arr.flatMap((p) => String(p).toLowerCase().split(" "));
    }
  });

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
  function eligibleForCanon(w) {
    return /^[a-z]+$/.test(w) && !STOPWORDS2.has(w) && !VOCAB_WORDS.has(w);
  }
  function fuzzyVocabWord(w) {
    return fuzzyMatchInSet(w, FUZZY_TARGET_WORDS, fuzzyBound(w));
  }
  function fuzzyMatchInSet(w, candidates, bound = fuzzyBound(w)) {
    let best = bound + 1;
    let hit2 = null;
    let tied = false;
    for (const target of candidates) {
      const d = editDistance(w, target, Math.min(best, bound));
      if (d < best) {
        best = d;
        hit2 = target;
        tied = false;
      } else if (d === best && d <= bound && target !== hit2) tied = true;
    }
    return best <= bound && !tied ? hit2 : null;
  }
  var fuzzyBound, VOCAB_WORDS, FUZZY_TARGET_WORDS;
  var init_fuzzy = __esm({
    "src/interpret/fuzzy.mjs"() {
      init_ask_vocab();
      init_normalize();
      fuzzyBound = (s) => s.length <= 5 ? 1 : 2;
      VOCAB_WORDS = new Set(
        [...Object.keys(VERB_TO_KIND), ...Object.keys(ENTITY_TO_TYPE), ...Object.keys(MODIFIER_TO_KIND)].flatMap((p) => p.split(" "))
      );
      FUZZY_TARGET_WORDS = [...new Set(
        [...Object.keys(VERB_TO_KIND), ...Object.keys(MODIFIER_TO_KIND)].flatMap((p) => p.split(" ")).filter((w) => w.length >= 4)
      )];
    }
  });

  // src/interpret/strategies/grammar.mjs
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
  var VERB_ALT, ENTITY_ALT, MODIFIER_ALT, META_ALT, TEMPLATES, grammarStrategy;
  var init_grammar = __esm({
    "src/interpret/strategies/grammar.mjs"() {
      init_ask_vocab();
      init_normalize();
      VERB_ALT = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      ENTITY_ALT = Object.keys(ENTITY_TO_TYPE).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      MODIFIER_ALT = Object.keys(MODIFIER_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      META_ALT = META_MEANING_VERBS.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      TEMPLATES = [
        // T1 ASK: "does X import Y" / "is X a subclass of Y" -> Yes/No. Tried FIRST: it starts with
        // does/is/do/did, which the reverse/forward templates below never match (those start with
        // which/what), so precedence between T1 and the rest is structural, not a tie-break guess.
        // "did" joins does/do for the past-tense commit forms ("did commit <sha> touch X").
        // REVERSE VERB SWAP (Seonix Batch 2 Fix 2): this template fixes subject/object by regex
        // capture POSITION, not by the verb's semantic direction — fine for every forward verb
        // ("subclass of", "imports", …), but "is X a superclass of Y" MEANS the reverse of "is X
        // a subclass of Y" (Y inherits from X, not X from Y). INHERITS_REVERSE_VERBS (ask-vocab.mjs)
        // is the closed set of such reverse phrasings; when the matched verb is one of them,
        // subject/object are swapped here, once, at parse time — so downstream evaluation (ask.mjs)
        // sees "is Y a subclass of X" and needs zero changes of its own. (In practice this exact
        // regex only ever matches a does/do/did lead, so "is …" phrasings actually reach the "ask"
        // shape via keywords.mjs's decomposition strategy instead — that strategy applies the same
        // swap for the same reason; this branch is kept for any does/do/did-led phrasing that names
        // a reverse verb, and for structural symmetry with that sibling strategy.)
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
        // T2 reverse: "which <entity> [<modifier>] <verb> <object>" — the operator's own example shape.
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
        // T4 meta: "what does <term> mean" — a question about the GRAPH'S OWN VOCABULARY
        // (a SchemaClass/SchemaPredicate label, e.g. "cochange", or a raw prop token, e.g.
        // "mgx:callsSymbol"), not a graph traversal over code edges. Tried after T3: T3 also
        // starts "what does/do", but T3 only fires when the tail is a relation VERB_ALT
        // phrase ("import"/"calls"/…), which "mean"/"means"/etc never are (disjoint tables —
        // ask-vocab.mjs's file comment explains why they're kept separate), so the two never
        // actually compete for the same input.
        {
          name: "meta-mean",
          re: new RegExp(`^what\\s+(?:does|do|is|are)\\s+(.+?)\\s+(?:${META_ALT})\\??$`, "i"),
          build: (m) => ({ shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: m[1].trim() })
        },
        // T5 meta: "what is a/an <term>" — the OTHER worked phrasing ("what is a Commit").
        // Seonix Batch 2 Fix 1: the indefinite article is now OPTIONAL, but the BARE
        // (no-article) form is restricted to the CLOSED vocabulary ENTITY_TO_TYPE already
        // imported above (function/method/class/module/attribute/variable/change/commit,
        // singular and plural) — build() returns null (same "this template didn't actually
        // match, keep scanning" contract T8/"when" below already relies on — see
        // parseAnchored's own docblock) when the bare form's object isn't one of those
        // closed terms, so the scan falls through exactly as if this template had not
        // matched at all. This keeps "what is a doohickey"/"widget"/"gizmo" (still routed
        // here via the WITH-article, fully unrestricted `(.+?)` path — pinned to resolve as
        // an honest meta miss downstream, ask-combo.test.mjs/chat-readback.test.mjs) working
        // unmodified, while ALSO keeping the two pinned bare-form honest misses intact:
        // "what is the meaning of this codebase" (ask.test.mjs/ask-dual-strategy.test.mjs)
        // and "what is exposed" (ask.test.mjs:840) both have bare objects absent from
        // ENTITY_TO_TYPE, so build() still rejects them and they still fall through to null.
        // Fix 3: stripTrailingScopeFiller (ask-vocab.mjs) trims a curated trailing clause
        // ("what is a Module in this graph" -> "Module") off the object before it's
        // returned, so a scoping tail never corrupts the lookup term either the bare-form
        // check above or downstream resolution/rendering perform. HANDOVER.md 2026-07-10
        // item 8: stripTrailingDiscourseTag trims a bare trailing "then"/"though" the
        // same way ("what is a component then" -> "component") — applied first, since a
        // discourse tag sits outermost when both happen to stack.
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
        // T6 mention: "where is <term> mentioned/referenced" — the prose/mentions surface
        // (2026-07-02 query families). Tried BEFORE T7: T7's trailing marker is optional,
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
        // T9 commit-history NP (PLAN_CHAT_FEEL item 6 remainder): "the commit history of
        // X" / "commit history for X" — an NP form of T8's SAME "when did X change"
        // intent; reuses shape="when" verbatim so evaluation/rendering are byte-
        // identical, only the recognizer surface differs.
        {
          name: "commit-history",
          re: /^(?:the\s+)?commit\s+history\s+(?:of|for)\s+(.+?)\??$/i,
          build: (m) => ({ shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() })
        },
        // T10 cochange-partners NP (PLAN_CHAT_FEEL item 6 remainder): "cochange partners
        // of X" — an NP form of the existing "which modules cochange with X" verb-phrase
        // shape (ask-vocab.mjs's cochange verb table); reuses shape="reverse"/
        // kind="cochange" so evaluation is byte-identical.
        {
          name: "cochange-partners",
          re: /^co-?change\s+partners\s+(?:of|for|with)\s+(.+?)\??$/i,
          build: (m) => ({ shape: "reverse", entityType: "Module", modifier: "direct", kind: "cochange", object: m[1].trim() })
        }
      ];
      grammarStrategy = {
        id: "grammar",
        class: "graph-query",
        run(text) {
          const parsed = parseAnchored(text);
          return parsed ? { strategyId: "grammar", class: "graph-query", candidates: [{ parsed, confidence: 0.9 }] } : null;
        }
      };
    }
  });

  // src/interpret/strategies/keywords.mjs
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
    const mark = (hit2) => {
      if (hit2) for (let i = hit2.start; i < hit2.end; i += 1) consumed.add(i);
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
  var PASSIVE_AUX, WH_WORDS, PLACEHOLDER_SET, keywordSpotStrategy;
  var init_keywords = __esm({
    "src/interpret/strategies/keywords.mjs"() {
      init_ask_vocab();
      init_normalize();
      init_fuzzy();
      PASSIVE_AUX = /* @__PURE__ */ new Set(["is", "are", "was", "were", "be", "been", "being", "get", "gets", "got"]);
      WH_WORDS = /* @__PURE__ */ new Set(["which", "what", "who", "whom", "whose"]);
      PLACEHOLDER_SET = new Set(PLACEHOLDER_NOUNS.map((w) => w.toLowerCase()));
      keywordSpotStrategy = {
        id: "keyword-spot",
        class: "graph-query",
        run(text, ctx = {}) {
          const parsed = parseKeywordSpot(text, ctx.nlp || null);
          return parsed ? { strategyId: "keyword-spot", class: "graph-query", candidates: [{ parsed, confidence: 0.7 }] } : null;
        }
      };
    }
  });

  // src/interpret/strategies/noise-strip.mjs
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
  var KEEP, CURATED_NOISE, noiseStripStrategy;
  var init_noise_strip = __esm({
    "src/interpret/strategies/noise-strip.mjs"() {
      init_ask_vocab();
      init_normalize();
      init_grammar();
      init_keywords();
      KEEP = /* @__PURE__ */ new Set([
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
      CURATED_NOISE = /* @__PURE__ */ new Set([...wordsOf(FILLER_WORDS), ...wordsOf(CASCADE_NOISE)]);
      noiseStripStrategy = {
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
    }
  });

  // adapter-stub-strategies/ace.mjs:./strategies/ace.mjs
  var aceStrategy;
  var init_ace = __esm({
    "adapter-stub-strategies/ace.mjs:./strategies/ace.mjs"() {
      aceStrategy = void 0;
    }
  });

  // adapter-stub-strategies/constructions.mjs:./strategies/constructions.mjs
  var constructionsStrategy;
  var init_constructions = __esm({
    "adapter-stub-strategies/constructions.mjs:./strategies/constructions.mjs"() {
      constructionsStrategy = void 0;
    }
  });

  // src/interpret/merge.mjs
  var init_merge = __esm({
    "src/interpret/merge.mjs"() {
    }
  });

  // adapter-stub-ask-nlp.mjs:../ask-nlp.mjs
  var init_ask_nlp = __esm({
    "adapter-stub-ask-nlp.mjs:../ask-nlp.mjs"() {
    }
  });

  // src/interpret/pipeline.mjs
  var OPTIONAL_STRATEGIES, STRATEGIES;
  var init_pipeline = __esm({
    "src/interpret/pipeline.mjs"() {
      init_normalize();
      init_grammar();
      init_keywords();
      init_noise_strip();
      init_ace();
      init_constructions();
      init_merge();
      init_ask_nlp();
      OPTIONAL_STRATEGIES = [
        ...typeof aceStrategy !== "undefined" ? [aceStrategy] : [],
        // eslint-disable-next-line no-undef
        ...typeof constructionsStrategy !== "undefined" ? [constructionsStrategy] : []
      ];
      STRATEGIES = [grammarStrategy, keywordSpotStrategy, noiseStripStrategy, ...OPTIONAL_STRATEGIES];
    }
  });

  // node-stub:node:crypto
  var unavailable9, createRequire9, readFileSync9, writeFileSync9, readFile9, writeFile9, appendFile9, mkdir9, mkdtemp9, rename9, unlink9, rm9, stat9, access9, copyFile9, readdir9, createReadStream9, createWriteStream9, randomBytes9, createHash9, createRequireFromPath9, spawnSync9, createInterface9, DatabaseSync9;
  var init_node_crypto = __esm({
    "node-stub:node:crypto"() {
      unavailable9 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire9 = unavailable9("createRequire");
      readFileSync9 = unavailable9("readFileSync");
      writeFileSync9 = unavailable9("writeFileSync");
      readFile9 = unavailable9("readFile");
      writeFile9 = unavailable9("writeFile");
      appendFile9 = unavailable9("appendFile");
      mkdir9 = unavailable9("mkdir");
      mkdtemp9 = unavailable9("mkdtemp");
      rename9 = unavailable9("rename");
      unlink9 = unavailable9("unlink");
      rm9 = unavailable9("rm");
      stat9 = unavailable9("stat");
      access9 = unavailable9("access");
      copyFile9 = unavailable9("copyFile");
      readdir9 = unavailable9("readdir");
      createReadStream9 = unavailable9("createReadStream");
      createWriteStream9 = unavailable9("createWriteStream");
      randomBytes9 = unavailable9("randomBytes");
      createHash9 = unavailable9("createHash");
      createRequireFromPath9 = unavailable9("createRequireFromPath");
      spawnSync9 = unavailable9("spawnSync");
      createInterface9 = unavailable9("createInterface");
      DatabaseSync9 = unavailable9("DatabaseSync");
    }
  });

  // src/answer-variants.mjs
  var import_meta, DATA_FILE;
  var init_answer_variants = __esm({
    "src/answer-variants.mjs"() {
      init_node_fs();
      init_node_url();
      init_node_path();
      init_node_crypto();
      import_meta = {};
      DATA_FILE = join(dirname(fileURLToPath(import_meta.url)), "answer-variants.json");
    }
  });

  // adapter-stub-ask-nlp.mjs:./ask-nlp.mjs
  var init_ask_nlp2 = __esm({
    "adapter-stub-ask-nlp.mjs:./ask-nlp.mjs"() {
    }
  });

  // src/ask.mjs
  var LEADING_RELATION_VERB_RE, FRAME_WORDS, LIST_TRIGGERS_SORTED, TRAILING_GRAIN_WORD_RE, CONTENT_VOCAB, STRUCTURAL_WORDS, CASCADE_NOISE_SET, NOISE_OR_SCAFFOLD, TRIGGER_FUZZY_WORDS, CASCADE_FUZZY_TARGETS;
  var init_ask = __esm({
    "src/ask.mjs"() {
      init_codegraph();
      init_ask_vocab();
      init_normalize();
      init_fuzzy();
      init_grammar();
      init_keywords();
      init_pipeline();
      init_merge();
      init_prose();
      init_answer_variants();
      init_ask_nlp2();
      LEADING_RELATION_VERB_RE = new RegExp(
        `^(?:${Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:s|ing|ed)?\\s+`,
        "i"
      );
      FRAME_WORDS = /* @__PURE__ */ new Set(["which", "what", "who", "list", "show", "find", "give", "me", "us", "all"]);
      LIST_TRIGGERS_SORTED = [...LIST_TRIGGERS].sort((a, b) => b.split(" ").length - a.split(" ").length);
      TRAILING_GRAIN_WORD_RE = new RegExp(`\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`, "i");
      CONTENT_VOCAB = /* @__PURE__ */ new Set([
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
      STRUCTURAL_WORDS = /* @__PURE__ */ new Set([...STOPWORDS2, ...FRAME_WORDS, ...CONTEXT_PRONOUNS]);
      CASCADE_NOISE_SET = new Set(wordsOf(CASCADE_NOISE));
      NOISE_OR_SCAFFOLD = /* @__PURE__ */ new Set([...CASCADE_NOISE_SET, ...STRUCTURAL_WORDS]);
      TRIGGER_FUZZY_WORDS = [
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
      CASCADE_FUZZY_TARGETS = [.../* @__PURE__ */ new Set([
        ...wordsOf(Object.keys(VERB_TO_KIND)),
        ...Object.keys(ENTITY_TO_TYPE),
        ...TRIGGER_FUZZY_WORDS
      ])].filter((wd) => /^[a-z]+$/.test(wd) && wd.length >= 4 && !STOPWORDS2.has(wd));
    }
  });

  // src/repository-interface.mjs
  var INTERFACE_VERSION, ONTOLOGY_IRI, MISS_REASONS, EDGE_KINDS, EDGE_KIND_TO_TMCT, SERVICE_GROUPS, SERVICES, SOURCE_SERVICES, IND, EDGE, CONCURRENT_SAFE, REPOSITORY_INTERFACE;
  var init_repository_interface = __esm({
    "src/repository-interface.mjs"() {
      INTERFACE_VERSION = "1.1.0";
      ONTOLOGY_IRI = "urn:tmct:core";
      MISS_REASONS = Object.freeze({
        UNRESOLVED_TERM: "UNRESOLVED_TERM",
        CAPABILITY_ABSENT: "CAPABILITY_ABSENT",
        TRUNCATED_GRAPH: "TRUNCATED_GRAPH",
        NO_SOURCE: "NO_SOURCE"
      });
      EDGE_KINDS = Object.freeze([
        "imports",
        "calls",
        "callsSymbol",
        "defines",
        "tests",
        "touches",
        "touchesSymbol",
        "contains",
        "inherits",
        "cochange",
        "reexports"
      ]);
      EDGE_KIND_TO_TMCT = Object.freeze({
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
        reexports: "tmct:exports"
      });
      SERVICE_GROUPS = Object.freeze({
        resolution: ["resolve", "describe", "members", "subclasses", "exports", "signature"],
        traversal: ["edges", "impact"],
        source: ["snippet", "context"],
        aggregate: ["architecture", "untested", "stats"],
        temporal: ["history"],
        search: ["search", "ask"]
      });
      SERVICES = Object.freeze(
        Object.values(SERVICE_GROUPS).flat()
      );
      SOURCE_SERVICES = Object.freeze(new Set(SERVICE_GROUPS.source));
      IND = "Individual";
      EDGE = "Edge";
      CONCURRENT_SAFE = "concurrent-safe: reads immutable graph truth; no shared mutable state";
      REPOSITORY_INTERFACE = Object.freeze({
        version: INTERFACE_VERSION,
        ontology: ONTOLOGY_IRI,
        missReasons: Object.values(MISS_REASONS),
        edgeKinds: [...EDGE_KINDS],
        types: {
          Individual: {
            fields: {
              id: "string (opaque provider id)",
              label: "string (human/display name)",
              class: "string \u2014 a tmct: class token (module|class|function|method|attribute|variable|commit|test|\u2026)",
              attributes: "Array<{ key: string, value: string, prop: string|null }> \u2014 prop is the SEON/mgx token grounding the value"
            }
          },
          Edge: {
            fields: {
              subject: "string (individual id)",
              object: "string (individual id)",
              predicate: "string \u2014 the relation predicate",
              prop: "string|null \u2014 the SEON/mgx property token; see edgeKinds \u2192 tmct: mapping",
              subjectLabel: "string? (additive)",
              objectLabel: "string? (additive)",
              weight: "number? (additive; e.g. cochange coupling)"
            }
          },
          Result: { shape: "{ ok: true, value: T } | { ok: false, miss: Miss }" },
          Miss: { shape: "{ reason: MISS_REASONS, detail: string, term: string|null }" }
        },
        capabilitiesModel: "A provider advertises `capabilities: string[]` (service names it implements). A service outside the set is negotiated away to miss(CAPABILITY_ABSENT) \u2014 never an error. snippet may be advertised yet answer miss(NO_SOURCE) when no working tree exists (it has nothing useful without fs); context is graph-only-capable since INTERFACE_VERSION 1.1.0 \u2014 it returns a real hit (graph-only bundle) for any resolvable symbol even with no working tree, only escalating NO_SOURCE-style behavior to richer body text when source-capable.",
        services: {
          resolve: {
            group: "resolution",
            args: { term: "string" },
            result: `{ match: ${IND}, candidates: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The resolveSymbol seam: map a free term to an individual + runner-up candidates. Every id-taking service consumes a resolved id."
          },
          describe: {
            group: "resolution",
            args: { id: "string" },
            result: `{ individual: ${IND}, out: ${EDGE}[], incoming: ${EDGE}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "Full typed portrait of one individual: its attributes and its outgoing/incoming edges."
          },
          members: {
            group: "resolution",
            args: { classId: "string" },
            result: `{ methods: ${IND}[], attributes: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "A class's methods + attributes (via the contains relation) \u2014 replaces reading the class body."
          },
          subclasses: {
            group: "resolution",
            args: { classId: "string" },
            result: `{ bases: ${IND}[], subclasses: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "Forward bases + the transitive reverse inheritance closure (who extends this)."
          },
          exports: {
            group: "resolution",
            args: { moduleId: "string" },
            result: `{ exports: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "A module's curated public API (resolved __all__ / re-exports)."
          },
          signature: {
            group: "resolution",
            args: { id: "string" },
            result: "{ id, label, class, params, returns, raises, decorators, doc, selfFields, flags }",
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The compact API surface of a symbol without its body."
          },
          edges: {
            group: "traversal",
            args: { id: "string", kind: "EDGE_KINDS member" },
            result: `{ kind: string, edges: ${EDGE}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "Outgoing edges of one closed kind from an individual (an honest empty array is not a miss).",
            note: "An unknown kind (outside EDGE_KINDS) is a programming error and throws TypeError, not a miss."
          },
          impact: {
            group: "traversal",
            args: { moduleId: "string" },
            result: `{ total: number, levels: Array<Array<{ id, label, via, tests }>> }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The transitive dependent closure the interpreter cannot compute without provider truth."
          },
          snippet: {
            group: "source",
            args: { id: "string" },
            result: "{ path: string, span: { start, end }, body: string|null } \u2014 Promise<Result>",
            misses: ["UNRESOLVED_TERM", "NO_SOURCE"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The exact source span of a symbol. A provider with no working tree returns miss(NO_SOURCE) honestly \u2014 snippet has nothing useful without fs.",
            note: "ASYNC (returns Promise<Result>) \u2014 a real body read is inherently fs I/O; callers should always await it. A graph-only provider still resolves synchronously-in-spirit (the promise settles on the same tick) but the return type is uniformly a Promise regardless of sourceAccess."
          },
          context: {
            group: "source",
            args: { symbol: "string", depth: "min|auto|full?" },
            result: "{ text: string, tier: string } (a sized edit bundle) \u2014 Promise<Result>",
            // INTERFACE_VERSION 1.1.0 (2026-07): NARROWED miss contract — context() used to
            // unconditionally miss(NO_SOURCE) (its whole edit bundle was implemented as fs-only).
            // contextPlan/sizeBundle/renderGraphOnlyBundle are pure graph queries, so a graph-only
            // provider (sourceAccess:false) now returns a REAL HIT for any resolvable symbol —
            // siblings, registration, class members, __all__/re-exports, insertion region, covering
            // tests, co-change — everything except anchor/exemplar/inlined-callee BODY TEXT, which
            // still needs a source-capable provider. NO_SOURCE is consequently no longer a miss
            // reason context() can return (dropped from the list below) — the only remaining miss is
            // an unresolvable symbol.
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The composed edit bundle (exemplar, siblings, registration, insertion region). A graph-only provider returns the graph-only sections as a real hit; a source-capable provider (sourceAccess:true, repoRoot, readFile) additionally includes the anchor/exemplar/inlined-callee body text.",
            note: "ASYNC (returns Promise<Result>) \u2014 see snippet's note; source-capable rendering is fs I/O."
          },
          architecture: {
            group: "aggregate",
            args: { package: "string?" },
            result: "{ modules: number, packages: Array<[dir, count]>, hubs: Array<{ id, label, importers }> }",
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Package/module shape + the most-imported hub modules. Optional package prefix scopes it."
          },
          untested: {
            group: "aggregate",
            args: {},
            result: `{ modules: ${IND}[] }`,
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Modules with no covering test module (via the tests relation)."
          },
          stats: {
            group: "aggregate",
            args: {},
            result: "{ total: number, classes: Array<{ class: string, count: number }>, truncated: boolean }",
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Per-tmct:class individual counts, read straight from the payload."
          },
          history: {
            group: "temporal",
            args: { id: "string" },
            result: "{ commits: Array<{ id, label, author, date, message }> }",
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The commits that touched an individual (tmct:commit individuals via tmct:touches)."
          },
          search: {
            group: "search",
            args: { query: "string", kind: "string?", name: "string?", decorator: "string?" },
            result: `{ results: ${IND}[] }`,
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Lexical, provider-local locate. An empty result set is honest, not a miss."
          },
          ask: {
            group: "search",
            args: { query: "string" },
            result: "{ content: string, tmct_ask: object } (the composed NL round-trip envelope)",
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "The mechanical, zero-model NL query over the graph \u2014 tmct's whole reason to exist."
          }
        }
      });
    }
  });

  // src/providers/graph-service.mjs
  var init_graph_service = __esm({
    "src/providers/graph-service.mjs"() {
      init_codegraph();
      init_source_slice();
      init_ask();
      init_repository_interface();
    }
  });

  // ../../../node_modules/smol-toml/dist/date.js
  var init_date = __esm({
    "../../../node_modules/smol-toml/dist/date.js"() {
    }
  });

  // ../../../node_modules/smol-toml/dist/error.js
  var init_error = __esm({
    "../../../node_modules/smol-toml/dist/error.js"() {
    }
  });

  // ../../../node_modules/smol-toml/dist/primitive.js
  var init_primitive = __esm({
    "../../../node_modules/smol-toml/dist/primitive.js"() {
      init_date();
      init_error();
    }
  });

  // ../../../node_modules/smol-toml/dist/util.js
  var init_util = __esm({
    "../../../node_modules/smol-toml/dist/util.js"() {
      init_error();
    }
  });

  // ../../../node_modules/smol-toml/dist/extract.js
  var init_extract = __esm({
    "../../../node_modules/smol-toml/dist/extract.js"() {
      init_primitive();
      init_struct();
      init_util();
      init_error();
    }
  });

  // ../../../node_modules/smol-toml/dist/struct.js
  var init_struct = __esm({
    "../../../node_modules/smol-toml/dist/struct.js"() {
      init_primitive();
      init_extract();
      init_util();
      init_error();
    }
  });

  // ../../../node_modules/smol-toml/dist/parse.js
  var init_parse = __esm({
    "../../../node_modules/smol-toml/dist/parse.js"() {
      init_struct();
      init_extract();
      init_util();
      init_error();
    }
  });

  // ../../../node_modules/smol-toml/dist/stringify.js
  var init_stringify = __esm({
    "../../../node_modules/smol-toml/dist/stringify.js"() {
    }
  });

  // ../../../node_modules/smol-toml/dist/index.js
  var init_dist = __esm({
    "../../../node_modules/smol-toml/dist/index.js"() {
      init_parse();
      init_stringify();
      init_date();
      init_error();
    }
  });

  // src/toml-config.mjs
  var init_toml_config = __esm({
    "src/toml-config.mjs"() {
      init_promises();
      init_node_path();
      init_dist();
    }
  });

  // src/sessions.mjs
  var SESSIONS_DIR_REL;
  var init_sessions = __esm({
    "src/sessions.mjs"() {
      init_promises();
      init_node_path();
      init_core();
      SESSIONS_DIR_REL = join(".tmct", "sessions");
    }
  });

  // src/corpus/templates.mjs
  var import_meta2, PKG_ROOT, TEMPLATES_FILE, PHRASEBOOK_FILE, TECHNICAL_SLOTS;
  var init_templates = __esm({
    "src/corpus/templates.mjs"() {
      init_promises();
      init_node_url();
      init_node_path();
      import_meta2 = {};
      PKG_ROOT = join(dirname(fileURLToPath(import_meta2.url)), "..", "..");
      TEMPLATES_FILE = join(PKG_ROOT, "data", "templates", "responses.jsonl");
      PHRASEBOOK_FILE = join(PKG_ROOT, "data", "phrasebook", "software-phrases.txt");
      TECHNICAL_SLOTS = Object.freeze(/* @__PURE__ */ new Set([
        "subject",
        "count",
        "noun",
        "scope",
        "comparison",
        "metric",
        "unit",
        "superlative",
        "provenance"
      ]));
    }
  });

  // node-stub:node:readline
  var unavailable10, createRequire10, readFileSync10, writeFileSync10, readFile10, writeFile10, appendFile10, mkdir10, mkdtemp10, rename10, unlink10, rm10, stat10, access10, copyFile10, readdir10, createReadStream10, createWriteStream10, randomBytes10, createHash10, createRequireFromPath10, spawnSync10, createInterface10, DatabaseSync10;
  var init_node_readline = __esm({
    "node-stub:node:readline"() {
      unavailable10 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire10 = unavailable10("createRequire");
      readFileSync10 = unavailable10("readFileSync");
      writeFileSync10 = unavailable10("writeFileSync");
      readFile10 = unavailable10("readFile");
      writeFile10 = unavailable10("writeFile");
      appendFile10 = unavailable10("appendFile");
      mkdir10 = unavailable10("mkdir");
      mkdtemp10 = unavailable10("mkdtemp");
      rename10 = unavailable10("rename");
      unlink10 = unavailable10("unlink");
      rm10 = unavailable10("rm");
      stat10 = unavailable10("stat");
      access10 = unavailable10("access");
      copyFile10 = unavailable10("copyFile");
      readdir10 = unavailable10("readdir");
      createReadStream10 = unavailable10("createReadStream");
      createWriteStream10 = unavailable10("createWriteStream");
      randomBytes10 = unavailable10("randomBytes");
      createHash10 = unavailable10("createHash");
      createRequireFromPath10 = unavailable10("createRequireFromPath");
      spawnSync10 = unavailable10("spawnSync");
      createInterface10 = unavailable10("createInterface");
      DatabaseSync10 = unavailable10("DatabaseSync");
    }
  });

  // src/corpus/conceptnet.mjs
  var import_meta3, PKG_ROOT2, SLICE_FILE, MAP_FILE, SEON_CONCEPTS_FILE, SEON_DEFINITIONS_FILE, TIER2_DIR, TIER2_MANIFEST_FILE, WORDNET_DIR, WORDNET_MANIFEST_FILE;
  var init_conceptnet = __esm({
    "src/corpus/conceptnet.mjs"() {
      init_node_fs();
      init_promises();
      init_node_readline();
      init_node_url();
      init_node_path();
      init_dist();
      init_core();
      import_meta3 = {};
      PKG_ROOT2 = join(dirname(fileURLToPath(import_meta3.url)), "..", "..");
      SLICE_FILE = join(PKG_ROOT2, "corpus", "conceptnet", "slice.jsonl");
      MAP_FILE = join(PKG_ROOT2, "src", "corpus", "conceptnet-map.toml");
      SEON_CONCEPTS_FILE = join(PKG_ROOT2, "corpus", "seon", "concepts.jsonl");
      SEON_DEFINITIONS_FILE = join(PKG_ROOT2, "corpus", "seon", "definitions.jsonl");
      TIER2_DIR = join(PKG_ROOT2, "corpus", "tier2");
      TIER2_MANIFEST_FILE = join(TIER2_DIR, "manifest.json");
      WORDNET_DIR = join(PKG_ROOT2, "corpus", "wordnet");
      WORDNET_MANIFEST_FILE = join(WORDNET_DIR, "manifest.json");
    }
  });

  // src/extensions.mjs
  function builtinExtensions() {
    return {
      // WAS active:true (the implicit code-domain default) — now opt-in.
      // PLAN_SEED.md §2: re-activate explicitly (`tmct init --with-persona
      // code`, or `[extensions.seon] active = true`) for the old behavior.
      seon: {
        kind: "corpus",
        active: false,
        corpusPath: SEON_CONCEPTS_FILE,
        provenancePrefix: "corpus:seon"
      },
      // WAS active:true — now opt-in too, not just seon (PLAN_SEED.md §2: the
      // committed slice is itself tech-domain-filtered, equally biased).
      conceptnet: {
        kind: "corpus",
        active: false,
        corpusPath: SLICE_FILE,
        provenancePrefix: "corpus:conceptnet",
        // matches chat.mjs's seedBootstrapMemory exactly: uncapped, definitional
        // band first.
        limit: void 0,
        prefer: CONCEPTNET_PREFER
      },
      // NEW — the default active bundle (PLAN_SEED.md). Everyday-world
      // vocabulary: people, places, objects, nature, time/events, body/food,
      // mind, plus the human-base/human-bridge scaffolding connecting WordNet's
      // and Schema.org's independently-built taxonomies (PLAN_SEED.md §3, §8).
      human: {
        kind: "corpus",
        active: true,
        corpusPath: join(TIER2_DIR, "human.jsonl"),
        provenancePrefix: "corpus:human"
      },
      // NEW — Medium/Large SIZE tiers of the SAME `human` bundle (PLAN_SEED.md
      // §3), not separate personas: each file holds ONLY the facts that size
      // adds beyond the previous one (Medium beyond Small, Large beyond
      // Medium), so activating them is purely ADDITIVE alongside `human`
      // (never a replacement for it). Both ship INACTIVE — Small stays the
      // unconditional default — and are activated together via `tmct init
      // --persona-size medium|large` (bin/tmct.mjs), which resolves them
      // through this SAME BUILTIN_EXTENSIONS lookup and the ordinary
      // `--corpus <id>` activation seam (activatePluggableInput). "large"
      // activates BOTH human-medium and human-large (Large's facts are
      // Medium's plus its own — both bundles must be active to reach the
      // full ~13,600-fact total).
      "human-medium": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "human-medium.jsonl"),
        provenancePrefix: "corpus:human-medium"
      },
      "human-large": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "human-large.jsonl"),
        provenancePrefix: "corpus:human-large"
      },
      "tier2-aws": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "aws.jsonl"),
        provenancePrefix: "corpus:tier2-aws"
      },
      "tier2-python": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "python.jsonl"),
        provenancePrefix: "corpus:tier2-python"
      },
      "tier2-java": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "java.jsonl"),
        provenancePrefix: "corpus:tier2-java"
      },
      "tier2-general": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "general.jsonl"),
        provenancePrefix: "corpus:tier2-general"
      },
      // corpus/wordnet/generate.mjs's output: a mechanical ConceptNet-shape
      // conversion of Open English WordNet's structural relations, not
      // hand-curated like the tier-2 bundles above (NOT called "tier-3" —
      // corpus/README.md's tiering policy already uses that name for something
      // else, runtime-learned facts that are never committed; this bundle is
      // curated + committed, tier-2-shaped, just too large to hand-author).
      // Named directly "wordnet-xl"/"wordnet-full" so `tmct import --corpus
      // wordnet-xl` resolves straight through this BUILTIN_EXTENSIONS lookup,
      // the same seam every other recognized name already uses — no change
      // needed to bin/tmct.mjs's tier-2-manifest-id resolution path. Shipped
      // inactive, like every other opt-in bundle here.
      "wordnet-xl": {
        kind: "corpus",
        active: false,
        corpusPath: join(WORDNET_DIR, "wordnet-xl.jsonl"),
        provenancePrefix: "corpus:wordnet-xl"
      },
      "wordnet-full": {
        kind: "corpus",
        active: false,
        corpusPath: join(WORDNET_DIR, "wordnet-full.jsonl"),
        provenancePrefix: "corpus:wordnet-full"
      },
      // corpus/namenet/generate.mjs's output: species/common-name and
      // Wikidata-label/WordNet-lemma synonym pairs, mechanically derived from
      // three human-reviewed Open English Namenet linking tables. A small,
      // explicitly OPTIONAL top-up bundle (not a primary corpus) — same
      // BUILTIN_EXTENSIONS seam as wordnet-xl/wordnet-full above, so `tmct
      // import --corpus namenet` resolves directly here. Shipped inactive.
      namenet: {
        kind: "corpus",
        active: false,
        corpusPath: join(NAMENET_DIR, "namenet.jsonl"),
        provenancePrefix: "corpus:namenet"
      }
    };
  }
  var import_meta4, NAMENET_DIR, EXTENSION_KINDS, CONCEPTNET_PREFER, BUILTIN_EXTENSIONS;
  var init_extensions = __esm({
    "src/extensions.mjs"() {
      init_node_path();
      init_promises();
      init_node_url();
      init_toml_config();
      init_conceptnet();
      import_meta4 = {};
      NAMENET_DIR = join(dirname(fileURLToPath(import_meta4.url)), "..", "corpus", "namenet");
      EXTENSION_KINDS = Object.freeze(["corpus", "lexicon", "templates", "pack", "ontology"]);
      CONCEPTNET_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];
      BUILTIN_EXTENSIONS = Object.freeze(builtinExtensions());
    }
  });

  // src/finish.mjs
  var import_meta5, GRAMMAR_DIR, GRAMMAR_RULES_FILE, SEGMENT_TYPES, PROTECTED_TYPES;
  var init_finish = __esm({
    "src/finish.mjs"() {
      init_node_fs();
      init_node_url();
      init_node_path();
      init_dist();
      init_templates();
      import_meta5 = {};
      GRAMMAR_DIR = dirname(fileURLToPath(import_meta5.url));
      GRAMMAR_RULES_FILE = join(GRAMMAR_DIR, "..", "data", "templates", "grammar-rules.toml");
      SEGMENT_TYPES = Object.freeze([
        "prose",
        "entity",
        "path",
        "number",
        "code",
        "provenance",
        "receipt"
      ]);
      PROTECTED_TYPES = Object.freeze(
        new Set(SEGMENT_TYPES.filter((t) => t !== "prose"))
      );
    }
  });

  // src/syllogise.mjs
  var syllogise_exports = {};
  __export(syllogise_exports, {
    CARDINALITY_RULE_CONFIDENCE: () => CARDINALITY_RULE_CONFIDENCE,
    CAX_DW_RULE: () => CAX_DW_RULE,
    CAX_DW_RULE_CONFIDENCE: () => CAX_DW_RULE_CONFIDENCE,
    CAX_MAXC0_RULE: () => CAX_MAXC0_RULE,
    CAX_MAXC0_RULE_CONFIDENCE: () => CAX_MAXC0_RULE_CONFIDENCE,
    CAX_SCO_RULE: () => CAX_SCO_RULE,
    CLS_SVF1_RULE: () => CLS_SVF1_RULE,
    CLS_SVF1_RULE_CONFIDENCE: () => CLS_SVF1_RULE_CONFIDENCE,
    DISJOINT_PREDICATE: () => DISJOINT_PREDICATE,
    ENTAILED_DISJOINT_PROVENANCE: () => ENTAILED_DISJOINT_PROVENANCE,
    ENTAILED_PROVENANCE: () => ENTAILED_PROVENANCE,
    ENTAILED_SCM_SVF_PROVENANCE: () => ENTAILED_SCM_SVF_PROVENANCE,
    ENTAILED_SVF1_PROVENANCE: () => ENTAILED_SVF1_PROVENANCE,
    ENTAILED_TYPE_PROVENANCE: () => ENTAILED_TYPE_PROVENANCE,
    ON_CLASS_PREDICATE: () => ON_CLASS_PREDICATE,
    ON_PROPERTY_PREDICATE: () => ON_PROPERTY_PREDICATE,
    SCM_CARD_RULE: () => SCM_CARD_RULE,
    SCM_SVF_RULE: () => SCM_SVF_RULE,
    SCM_SVF_RULE_CONFIDENCE: () => SCM_SVF_RULE_CONFIDENCE,
    SOME_VALUES_FROM_PREDICATE: () => SOME_VALUES_FROM_PREDICATE,
    SUBCLASS_PREDICATE: () => SUBCLASS_PREDICATE,
    SYLLOGISE_RULE: () => SYLLOGISE_RULE,
    TYPE_PREDICATE: () => TYPE_PREDICATE,
    buildCardinalityRestrictions: () => buildCardinalityRestrictions,
    deriveDisjointViolations: () => deriveDisjointViolations,
    deriveSomeValuesFromApplication: () => deriveSomeValuesFromApplication,
    deriveSomeValuesFromSubsumption: () => deriveSomeValuesFromSubsumption,
    deriveSubClassClosure: () => deriveSubClassClosure,
    deriveTypePropagation: () => deriveTypePropagation,
    entailedTrustFrom: () => entailedTrustFrom,
    findConsistencyViolations: () => findConsistencyViolations,
    findIsaChain: () => findIsaChain,
    proveCardinalityAtLeast: () => proveCardinalityAtLeast,
    proveMaxCardinalityZeroDenial: () => proveMaxCardinalityZeroDenial,
    retractSubClassOf: () => retractSubClassOf,
    syllogise: () => syllogise
  });
  function entailedTrustFrom(premiseTrusts, ruleConfidence = 1) {
    const nums = (Array.isArray(premiseTrusts) ? premiseTrusts : []).filter((t) => typeof t === "number");
    if (!nums.length) return null;
    const clamped = Math.max(0, Math.min(1, Math.min(...nums) * ruleConfidence));
    return Number(clamped.toFixed(6));
  }
  function normalizeFocus(focus) {
    if (!focus) return null;
    const arr = focus instanceof Set ? [...focus] : Array.isArray(focus) ? focus : [];
    const out = /* @__PURE__ */ new Set();
    for (const t of arr) {
      const n = normFactTerm(t);
      if (n) out.add(n);
    }
    return out.size ? out : null;
  }
  function deriveSubClassClosure(edges, { depth = 32, budget = 50, focus = null } = {}) {
    const present = /* @__PURE__ */ new Set();
    const succ = /* @__PURE__ */ new Map();
    for (const [a, b] of edges || []) {
      if (!a || !b || a === b) continue;
      present.add(`${a}${SEP}${b}`);
      if (!succ.has(a)) succ.set(a, /* @__PURE__ */ new Set());
      succ.get(a).add(b);
    }
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (a, b, c) => !focusSet || focusSet.has(a) || focusSet.has(b) || focusSet.has(c);
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (let round2 = 0; round2 < depth; round2 += 1) {
      const additions = [];
      for (const [a, bs] of succ) {
        for (const b of bs) {
          const cs = succ.get(b);
          if (!cs) continue;
          for (const c of cs) {
            if (a === c) continue;
            const key = `${a}${SEP}${c}`;
            if (present.has(key) || derivedKeys.has(key)) continue;
            if (!inFocus(a, b, c)) continue;
            additions.push([a, b, c, key]);
          }
        }
      }
      if (!additions.length) break;
      additions.sort((x, y) => x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]) || x[1].localeCompare(y[1]));
      let progressed = false;
      for (const [a, b, c, key] of additions) {
        if (derivedKeys.has(key)) continue;
        if (derived.length >= budget) break;
        derivedKeys.add(key);
        derived.push({ subject: a, object: c, via: b });
        if (!succ.has(a)) succ.set(a, /* @__PURE__ */ new Set());
        succ.get(a).add(c);
        progressed = true;
      }
      if (derived.length >= budget || !progressed) break;
    }
    return derived;
  }
  function buildAncestorCloser(subClassEdges) {
    const succ = /* @__PURE__ */ new Map();
    for (const [a, b] of subClassEdges || []) {
      if (!a || !b || a === b) continue;
      if (!succ.has(a)) succ.set(a, /* @__PURE__ */ new Set());
      succ.get(a).add(b);
    }
    const ancestorsCache = /* @__PURE__ */ new Map();
    return (c) => {
      if (ancestorsCache.has(c)) return ancestorsCache.get(c);
      const seen = /* @__PURE__ */ new Set();
      const stack = [...succ.get(c) || []];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        for (const next of succ.get(n) || []) if (!seen.has(next)) stack.push(next);
      }
      ancestorsCache.set(c, seen);
      return seen;
    };
  }
  function deriveTypePropagation(typeEdges, subClassEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf = buildAncestorCloser(subClassEdges);
    const present = /* @__PURE__ */ new Set();
    const seenTypeEdge = /* @__PURE__ */ new Set();
    for (const [x, c] of typeEdges || []) if (x && c) present.add(`${x}${SEP}${c}`);
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x, c, d) => !focusSet || focusSet.has(x) || focusSet.has(c) || focusSet.has(d);
    const candidates = [];
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      const tk = `${x}${SEP}${c}`;
      if (seenTypeEdge.has(tk)) continue;
      seenTypeEdge.add(tk);
      for (const d of ancestorsOf(c)) {
        if (d === c || d === x) continue;
        const key = `${x}${SEP}${d}`;
        if (present.has(key)) continue;
        if (!inFocus(x, c, d)) continue;
        candidates.push([x, c, d, key]);
      }
    }
    candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[2].localeCompare(q[2]) || p[1].localeCompare(q[1]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [x, c, d, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: x, object: d, via: c });
    }
    return derived;
  }
  function deriveDisjointViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf = buildAncestorCloser(subClassEdges);
    const disjointOf = /* @__PURE__ */ new Map();
    const presentPairs = /* @__PURE__ */ new Set();
    for (const [a, b] of disjointEdges || []) {
      if (!a || !b || a === b) continue;
      presentPairs.add(`${a}${SEP}${b}`);
      presentPairs.add(`${b}${SEP}${a}`);
      if (!disjointOf.has(a)) disjointOf.set(a, /* @__PURE__ */ new Set());
      disjointOf.get(a).add(b);
      if (!disjointOf.has(b)) disjointOf.set(b, /* @__PURE__ */ new Set());
      disjointOf.get(b).add(a);
    }
    if (!disjointOf.size) return [];
    const seenTypeEdge = /* @__PURE__ */ new Set();
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x, c, e) => !focusSet || focusSet.has(x) || focusSet.has(c) || focusSet.has(e);
    const candidates = [];
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      const tk = `${x}${SEP}${c}`;
      if (seenTypeEdge.has(tk)) continue;
      seenTypeEdge.add(tk);
      for (const d of [c, ...ancestorsOf(c)]) {
        const partners = disjointOf.get(d);
        if (!partners) continue;
        for (const e of partners) {
          if (e === x) continue;
          const key = `${x}${SEP}${e}`;
          if (presentPairs.has(key)) continue;
          if (!inFocus(x, c, e)) continue;
          candidates.push([x, c, d, e, key]);
        }
      }
    }
    candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[3].localeCompare(q[3]) || p[2].localeCompare(q[2]) || p[1].localeCompare(q[1]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [x, c, d, e, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: x, object: e, viaType: c, viaClass: d });
    }
    return derived;
  }
  function deriveSomeValuesFromApplication(propertyEdges, typeEdges, subClassEdges, restrictionEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf = buildAncestorCloser(subClassEdges);
    const byPropTarget = /* @__PURE__ */ new Map();
    for (const r of restrictionEdges || []) {
      if (!r || !r.restriction || !r.property || !r.target) continue;
      const key = `${r.property}${SEP}${r.target}`;
      if (!byPropTarget.has(key)) byPropTarget.set(key, /* @__PURE__ */ new Set());
      byPropTarget.get(key).add(r.restriction);
    }
    if (!byPropTarget.size) return [];
    const present = /* @__PURE__ */ new Set();
    const typesOf = /* @__PURE__ */ new Map();
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      present.add(`${x}${SEP}${c}`);
      if (!typesOf.has(x)) typesOf.set(x, /* @__PURE__ */ new Set());
      typesOf.get(x).add(c);
    }
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x, y, r) => !focusSet || focusSet.has(x) || focusSet.has(y) || focusSet.has(r);
    const seenEdge = /* @__PURE__ */ new Set();
    const candidates = [];
    for (const [x, p, y] of propertyEdges || []) {
      if (!x || !p || !y) continue;
      const pKey = normFactTerm(p);
      const ek = `${x}${SEP}${pKey}${SEP}${y}`;
      if (seenEdge.has(ek)) continue;
      seenEdge.add(ek);
      const yTypes = typesOf.get(y);
      if (!yTypes) continue;
      for (const c of yTypes) {
        for (const target of [c, ...ancestorsOf(c)]) {
          const restrictions = byPropTarget.get(`${pKey}${SEP}${target}`);
          if (!restrictions) continue;
          for (const r of restrictions) {
            if (x === r) continue;
            const key = `${x}${SEP}${r}`;
            if (present.has(key)) continue;
            if (!inFocus(x, y, r)) continue;
            candidates.push([x, p, pKey, y, c, target, r, key]);
          }
        }
      }
    }
    candidates.sort((a, b) => a[0].localeCompare(b[0]) || a[6].localeCompare(b[6]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [x, p, pKey, y, c, target, r, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: x, object: r, viaProperty: p, viaPropertyKey: pKey, viaValue: y, viaType: c, viaTarget: target });
    }
    return derived;
  }
  function buildCardinalityRestrictions(rows) {
    const onPropertyOf = /* @__PURE__ */ new Map();
    const kindOf = /* @__PURE__ */ new Map();
    const onClassOf = /* @__PURE__ */ new Map();
    for (const r of rows || []) {
      if (!r || !r.subject || !r.predicate) continue;
      if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
      else if (isOnClass(r.predicate)) onClassOf.set(r.subject, r.object);
      else {
        const kind = CARDINALITY_KIND_OF[String(r.predicate).trim().toLowerCase()];
        if (!kind) continue;
        const n = Number(r.object);
        if (Number.isFinite(n)) kindOf.set(r.subject, { kind, n });
      }
    }
    const restrictions = [];
    for (const [restriction, { kind, n }] of kindOf) {
      if (onPropertyOf.get(restriction) !== HAS_PROPERTY_KEY) continue;
      const onClass = onClassOf.get(restriction);
      if (!onClass) continue;
      restrictions.push({ restriction, kind, n, onClass });
    }
    restrictions.sort((a, b) => a.restriction.localeCompare(b.restriction));
    return restrictions;
  }
  function deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf = buildAncestorCloser(subClassEdges);
    const byProperty = /* @__PURE__ */ new Map();
    for (const r of restrictionEdges || []) {
      if (!r || !r.restriction || !r.property || !r.target) continue;
      const pKey = normFactTerm(r.property);
      if (!byProperty.has(pKey)) byProperty.set(pKey, []);
      byProperty.get(pKey).push({ restriction: r.restriction, target: r.target });
    }
    const present = /* @__PURE__ */ new Set();
    for (const [a, b] of subClassEdges || []) if (a && b) present.add(`${a}${SEP}${b}`);
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (c1, c2) => !focusSet || focusSet.has(c1) || focusSet.has(c2);
    const candidates = [];
    for (const [, group] of byProperty) {
      if (group.length < 2) continue;
      for (const r1 of group) {
        for (const r2 of group) {
          if (r1.restriction === r2.restriction) continue;
          if (r1.target === r2.target) continue;
          if (!ancestorsOf(r1.target).has(r2.target)) continue;
          const key = `${r1.restriction}${SEP}${r2.restriction}`;
          if (present.has(key)) continue;
          if (!inFocus(r1.restriction, r2.restriction)) continue;
          candidates.push([r1.restriction, r2.restriction, r1.target, r2.target, key]);
        }
      }
    }
    candidates.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [c1, c2, y1, y2, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: c1, object: c2, viaY1: y1, viaY2: y2 });
    }
    return derived;
  }
  function findOwnCardinalityRestriction(subClassEdges, cardinalityRestrictionEdges, subject, matches, { budget = 20, focus = null } = {}) {
    if (!subject) return null;
    const ancestorsOf = buildAncestorCloser(subClassEdges);
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (c) => !focusSet || focusSet.has(subject) || focusSet.has(c);
    const classToRestrictions = /* @__PURE__ */ new Map();
    for (const [a, b] of subClassEdges || []) {
      if (!a || !b) continue;
      if (!classToRestrictions.has(a)) classToRestrictions.set(a, /* @__PURE__ */ new Set());
      classToRestrictions.get(a).add(b);
    }
    const restrictionsByRid = new Map((cardinalityRestrictionEdges || []).map((r) => [r.restriction, r]));
    let checked = 0;
    for (const c of [subject, ...ancestorsOf(subject)]) {
      if (checked >= budget) break;
      checked += 1;
      if (!inFocus(c)) continue;
      for (const rid of classToRestrictions.get(c) || []) {
        const rec = restrictionsByRid.get(rid);
        if (rec && matches(rec)) return { viaClass: c, viaRestriction: rid, record: rec };
      }
    }
    return null;
  }
  function proveCardinalityAtLeast(subClassEdges, cardinalityRestrictionEdges, subject, onClass, m, opts = {}) {
    if (!onClass || !Number.isFinite(m)) return null;
    const found = findOwnCardinalityRestriction(
      subClassEdges,
      cardinalityRestrictionEdges,
      subject,
      (rec) => rec.onClass === onClass && (rec.kind === "exactly" || rec.kind === "min") && rec.n >= m,
      opts
    );
    return found ? { subject, object: onClass, m, n: found.record.n, kind: found.record.kind, viaClass: found.viaClass, viaRestriction: found.viaRestriction } : null;
  }
  function proveMaxCardinalityZeroDenial(subClassEdges, cardinalityRestrictionEdges, subject, onClass, opts = {}) {
    if (!onClass) return null;
    const found = findOwnCardinalityRestriction(
      subClassEdges,
      cardinalityRestrictionEdges,
      subject,
      (rec) => rec.onClass === onClass && rec.kind === "max" && rec.n === 0,
      opts
    );
    return found ? { subject, object: onClass, viaClass: found.viaClass, viaRestriction: found.viaRestriction } : null;
  }
  function findConsistencyViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf = buildAncestorCloser(subClassEdges);
    const disjointOf = /* @__PURE__ */ new Map();
    for (const [a, b] of disjointEdges || []) {
      if (!a || !b || a === b) continue;
      if (!disjointOf.has(a)) disjointOf.set(a, /* @__PURE__ */ new Set());
      disjointOf.get(a).add(b);
      if (!disjointOf.has(b)) disjointOf.set(b, /* @__PURE__ */ new Set());
      disjointOf.get(b).add(a);
    }
    if (!disjointOf.size) return [];
    const typesBySubject = /* @__PURE__ */ new Map();
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      if (!typesBySubject.has(x)) typesBySubject.set(x, /* @__PURE__ */ new Set());
      typesBySubject.get(x).add(c);
    }
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x) => !focusSet || focusSet.has(x);
    const candidates = [];
    const seenPair = /* @__PURE__ */ new Set();
    for (const [x, types] of typesBySubject) {
      if (!inFocus(x)) continue;
      const typeList = [...types].sort();
      for (let i = 0; i < typeList.length; i += 1) {
        for (let j = i + 1; j < typeList.length; j += 1) {
          const [ta, tb] = [typeList[i], typeList[j]];
          const closureA = [ta, ...ancestorsOf(ta)];
          const closureB = [tb, ...ancestorsOf(tb)];
          let hit2 = null;
          for (const da of closureA) {
            const partners = disjointOf.get(da);
            if (!partners) continue;
            for (const db of closureB) {
              if (partners.has(db)) {
                hit2 = [da, db];
                break;
              }
            }
            if (hit2) break;
          }
          if (!hit2) continue;
          const pairKey = `${x}${SEP}${ta}${SEP}${tb}`;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);
          candidates.push([x, ta, tb, hit2[0], hit2[1]]);
        }
      }
    }
    candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[1].localeCompare(q[1]) || p[2].localeCompare(q[2]));
    const derived = [];
    for (const [x, ta, tb, viaA, viaB] of candidates) {
      if (derived.length >= budget) break;
      derived.push({ subject: x, classA: ta, classB: tb, viaA, viaB });
    }
    return derived;
  }
  async function syllogise(repoDir, { depth = 32, budget = 50, focus = null } = {}) {
    const memory = await loadMemory(repoDir);
    const rows = readFactRows(memory);
    const subClassEdges = rows.filter((r) => isSubClassOf(r.predicate)).map((r) => [r.subject, r.object]);
    const typeEdges = rows.filter((r) => isType(r.predicate)).map((r) => [r.subject, r.object]);
    const disjointEdges = rows.filter((r) => isDisjoint(r.predicate)).map((r) => [r.subject, r.object]);
    const onPropertyOf = /* @__PURE__ */ new Map();
    const someValuesFromOf = /* @__PURE__ */ new Map();
    const propertyEdges = [];
    for (const r of rows) {
      const pLower = String(r.predicate || "").trim().toLowerCase();
      if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
      else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
      else if (!RESERVED_PREDICATES.has(pLower)) propertyEdges.push([r.subject, r.predicate, r.object]);
    }
    const restrictionEdges = [];
    for (const [restriction, property] of onPropertyOf) {
      const target = someValuesFromOf.get(restriction);
      if (target) restrictionEdges.push({ restriction, property, target });
    }
    const normalizedFocus = normalizeFocus(focus);
    const trustByTriple = /* @__PURE__ */ new Map();
    for (const r of rows) trustByTriple.set(`${r.subject}${SEP}${r.predicate}${SEP}${r.object}`, r.trust);
    const premiseTrust = (s, p, o) => trustByTriple.get(`${s}${SEP}${p}${SEP}${o}`);
    const numericOnly = (arr) => arr.filter((t) => typeof t === "number");
    const scmDerived = deriveSubClassClosure(subClassEdges, { depth, budget, focus: normalizedFocus });
    const enlargedSubClassEdges = subClassEdges.concat(scmDerived.map((d) => [d.subject, d.object]));
    const remainingBudget = Math.max(0, budget - scmDerived.length);
    const caxDerived = remainingBudget > 0 ? deriveTypePropagation(typeEdges, enlargedSubClassEdges, { budget: remainingBudget, focus: normalizedFocus }) : [];
    const remainingBudgetDw = Math.max(0, budget - scmDerived.length - caxDerived.length);
    const dwDerived = remainingBudgetDw > 0 ? deriveDisjointViolations(typeEdges, enlargedSubClassEdges, disjointEdges, { budget: remainingBudgetDw, focus: normalizedFocus }) : [];
    const remainingBudgetSvf1 = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length);
    const svf1Derived = remainingBudgetSvf1 > 0 && restrictionEdges.length ? deriveSomeValuesFromApplication(propertyEdges, typeEdges, enlargedSubClassEdges, restrictionEdges, { budget: remainingBudgetSvf1, focus: normalizedFocus }) : [];
    const remainingBudgetScmSvf = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length - svf1Derived.length);
    const scmSvfDerived = remainingBudgetScmSvf > 0 && restrictionEdges.length > 1 ? deriveSomeValuesFromSubsumption(restrictionEdges, enlargedSubClassEdges, { budget: remainingBudgetScmSvf, focus: normalizedFocus }) : [];
    const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));
    const toWrite = [
      ...scmDerived.map((d) => ({
        subject: d.subject,
        predicate: SUBCLASS_PREDICATE,
        object: d.object,
        provenance: ENTAILED_PROVENANCE,
        // PLAN_SYLLOGIST.md §3's persisted-justification step, scm-sco only: the
        // two premise fact ids THIS conclusion actually rode (a⊑b, b⊑c) — ids
        // are content-addressed (factIdForTriple/memory/core.mjs), so this works
        // whether the premise is a stated fact or another entailment this SAME
        // pass just derived a round earlier (its id is predictable before it's
        // even written). Read back by retractSubClassOf (below) to find every
        // entailment a retracted premise could have supported, without a
        // whole-graph re-scan.
        justification: [
          factIdForTriple(d.subject, SUBCLASS_PREDICATE, d.via),
          factIdForTriple(d.via, SUBCLASS_PREDICATE, d.object)
        ]
      })),
      ...caxDerived.map((d) => ({
        subject: d.subject,
        predicate: TYPE_PREDICATE,
        object: d.object,
        provenance: ENTAILED_TYPE_PROVENANCE
      })),
      ...dwDerived.map((d) => {
        const dwTrust = premiseTrust(d.viaClass, DISJOINT_PREDICATE, d.object) ?? premiseTrust(d.object, DISJOINT_PREDICATE, d.viaClass);
        const premiseTrusts = numericOnly([
          premiseTrust(d.subject, TYPE_PREDICATE, d.viaType),
          dwTrust,
          // the ⊑-lift premise only exists when this IS a lift (viaClass !==
          // viaType) — a direct hit has no extra subClassOf premise to price in.
          ...d.viaClass !== d.viaType ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaClass)] : []
        ]);
        return {
          subject: d.subject,
          predicate: DISJOINT_PREDICATE,
          object: d.object,
          provenance: ENTAILED_DISJOINT_PROVENANCE,
          // ruleConfidence < 1 (CAX_DW_RULE_CONFIDENCE) is deliberate, not a
          // magic number: with the hook's default confidence of 1,
          // min(premiseTrusts) × 1 can EQUAL a premise's own trust (e.g. two
          // operator-taught 1.0 premises), tying/outranking the very premise it
          // came from — this module's invariant is "never outranks a stated
          // fact" (header comment), so cax-dw's conclusion is discounted
          // strictly below its weakest premise, always, while still riding
          // FAR above the bare 0.3 floor for a well-sourced premise pair.
          ...premiseTrusts.length ? { premiseTrusts, ruleConfidence: CAX_DW_RULE_CONFIDENCE } : {}
        };
      }),
      ...svf1Derived.map((d) => {
        const premiseTrusts = numericOnly([
          premiseTrust(d.subject, d.viaProperty, d.viaValue),
          premiseTrust(d.viaValue, TYPE_PREDICATE, d.viaType),
          premiseTrust(d.object, ON_PROPERTY_PREDICATE, d.viaPropertyKey),
          premiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaTarget),
          // the ⊑-lift premise only exists when this IS a lift (viaType !==
          // viaTarget) — a direct hit has no extra subClassOf premise to price in.
          ...d.viaType !== d.viaTarget ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaTarget)] : []
        ]);
        return {
          subject: d.subject,
          predicate: TYPE_PREDICATE,
          object: d.object,
          provenance: ENTAILED_SVF1_PROVENANCE,
          // same sub-1 discount as cax-dw, same reason (see CAX_DW_RULE_CONFIDENCE).
          ...premiseTrusts.length ? { premiseTrusts, ruleConfidence: CLS_SVF1_RULE_CONFIDENCE } : {}
        };
      }),
      ...scmSvfDerived.map((d) => {
        const r1 = restrictionByRid.get(d.subject);
        const r2 = restrictionByRid.get(d.object);
        const premiseTrusts = numericOnly([
          r1 && premiseTrust(d.subject, ON_PROPERTY_PREDICATE, r1.property),
          premiseTrust(d.subject, SOME_VALUES_FROM_PREDICATE, d.viaY1),
          r2 && premiseTrust(d.object, ON_PROPERTY_PREDICATE, r2.property),
          premiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaY2),
          premiseTrust(d.viaY1, SUBCLASS_PREDICATE, d.viaY2)
        ]);
        return {
          subject: d.subject,
          predicate: SUBCLASS_PREDICATE,
          object: d.object,
          provenance: ENTAILED_SCM_SVF_PROVENANCE,
          // same sub-1 discount as cax-dw/cls-svf1, same reason (see CAX_DW_RULE_CONFIDENCE).
          ...premiseTrusts.length ? { premiseTrusts, ruleConfidence: SCM_SVF_RULE_CONFIDENCE } : {}
        };
      })
    ];
    const { ids } = await appendFacts(repoDir, toWrite);
    const written = [];
    let i = 0;
    for (const d of scmDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.via, rule: SYLLOGISE_RULE });
      i += 1;
    }
    for (const d of caxDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.via, rule: CAX_SCO_RULE });
      i += 1;
    }
    for (const d of dwDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaClass, rule: CAX_DW_RULE });
      i += 1;
    }
    for (const d of svf1Derived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaValue, rule: CLS_SVF1_RULE });
      i += 1;
    }
    for (const d of scmSvfDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaY1, rule: SCM_SVF_RULE });
      i += 1;
    }
    return { derived: written, count: written.length, budget, depth, truncated: written.length >= budget };
  }
  function isPurelyEntailed(provenance) {
    const tags = String(provenance || "").split(" | ").filter(Boolean);
    return tags.length > 0 && tags.every((t) => t.startsWith("entailed:"));
  }
  async function retractSubClassOf(repoDir, subject, object, { budget = 50, depth = 32 } = {}) {
    const s = normFactTerm(subject);
    const o = normFactTerm(object);
    const targetId = factIdForTriple(s, SUBCLASS_PREDICATE, o);
    const memory = await loadMemory(repoDir);
    const rows = readFactRows(memory);
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (!byId.has(targetId)) return { retracted: [], count: 0, budget, depth, truncated: false, found: false };
    const scRows = rows.filter((r) => isSubClassOf(r.predicate));
    const edgeOf = new Map(scRows.map((r) => [r.id, [r.subject, r.object]]));
    const entailedScRows = scRows.filter((r) => r.justification.length && isPurelyEntailed(r.provenance));
    const removed = /* @__PURE__ */ new Set([targetId]);
    const order = [targetId];
    let truncated = false;
    let round2 = 0;
    for (; round2 < depth; round2 += 1) {
      const candidates = entailedScRows.filter((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j))).sort((a, b) => a.subject.localeCompare(b.subject) || a.object.localeCompare(b.object));
      if (!candidates.length) break;
      const candidateIds = new Set(candidates.map((c) => c.id));
      const survivingEdges = [...edgeOf.entries()].filter(([id]) => !removed.has(id) && !candidateIds.has(id)).map(([, e]) => e);
      const ancestorsOf = buildAncestorCloser(survivingEdges);
      let progressed = false;
      let hitBudget = false;
      for (const c of candidates) {
        if (removed.size >= budget) {
          hitBudget = true;
          break;
        }
        if (ancestorsOf(c.subject).has(c.object)) continue;
        removed.add(c.id);
        order.push(c.id);
        progressed = true;
      }
      if (hitBudget) {
        truncated = true;
        break;
      }
      if (!progressed) break;
    }
    if (!truncated && round2 >= depth) {
      truncated = entailedScRows.some((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j)));
    }
    const { removed: actuallyRemoved } = await removeFacts(repoDir, order);
    return { retracted: actuallyRemoved, count: actuallyRemoved.length, budget, depth, truncated, found: true };
  }
  function findIsaChain(subj, targets, typeEdges, subClassEdges, { maxHops = 6 } = {}) {
    const targetSet = targets instanceof Set ? targets : new Set(targets || []);
    const subSucc = /* @__PURE__ */ new Map();
    for (const [a, b] of subClassEdges || []) {
      if (!a || !b || a === b) continue;
      if (!subSucc.has(a)) subSucc.set(a, /* @__PURE__ */ new Set());
      subSucc.get(a).add(b);
    }
    let frontier = [];
    for (const [x, c] of typeEdges || []) {
      if (x === subj && c) frontier.push({ node: c, path: [{ subject: x, predicate: TYPE_PREDICATE, object: c }] });
    }
    for (const c of subSucc.get(subj) || []) {
      frontier.push({ node: c, path: [{ subject: subj, predicate: SUBCLASS_PREDICATE, object: c }] });
    }
    const seen = /* @__PURE__ */ new Set([subj]);
    for (let hop = 1; hop <= maxHops && frontier.length; hop += 1) {
      for (const { node, path } of frontier) if (targetSet.has(node)) return path;
      if (hop === maxHops) break;
      const next = [];
      for (const { node, path } of frontier) {
        if (seen.has(node)) continue;
        seen.add(node);
        for (const c of subSucc.get(node) || []) {
          if (seen.has(c)) continue;
          next.push({ node: c, path: [...path, { subject: node, predicate: SUBCLASS_PREDICATE, object: c }] });
        }
      }
      frontier = next;
    }
    return null;
  }
  var SUBCLASS_PREDICATE, SYLLOGISE_RULE, ENTAILED_PROVENANCE, TYPE_PREDICATE, CAX_SCO_RULE, ENTAILED_TYPE_PROVENANCE, DISJOINT_PREDICATE, CAX_DW_RULE, ENTAILED_DISJOINT_PROVENANCE, CAX_DW_RULE_CONFIDENCE, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE, CLS_SVF1_RULE, ENTAILED_SVF1_PROVENANCE, CLS_SVF1_RULE_CONFIDENCE, SEP, isSubClassOf, isType, isDisjoint, isOnProperty, isSomeValuesFrom, isOnClass, RESERVED_PREDICATES, HAS_PROPERTY_KEY, CARDINALITY_KIND_OF, ON_CLASS_PREDICATE, SCM_SVF_RULE, ENTAILED_SCM_SVF_PROVENANCE, SCM_SVF_RULE_CONFIDENCE, SCM_CARD_RULE, CARDINALITY_RULE_CONFIDENCE, CAX_MAXC0_RULE, CAX_MAXC0_RULE_CONFIDENCE;
  var init_syllogise = __esm({
    "src/syllogise.mjs"() {
      init_core();
      SUBCLASS_PREDICATE = "rdfs:subClassOf";
      SYLLOGISE_RULE = "subClassOf";
      ENTAILED_PROVENANCE = `entailed:${SYLLOGISE_RULE}`;
      TYPE_PREDICATE = "rdf:type";
      CAX_SCO_RULE = "type";
      ENTAILED_TYPE_PROVENANCE = `entailed:${CAX_SCO_RULE}`;
      DISJOINT_PREDICATE = "owl:disjointWith";
      CAX_DW_RULE = "disjointWith";
      ENTAILED_DISJOINT_PROVENANCE = `entailed:${CAX_DW_RULE}`;
      CAX_DW_RULE_CONFIDENCE = 0.95;
      ON_PROPERTY_PREDICATE = "owl:onProperty";
      SOME_VALUES_FROM_PREDICATE = "owl:someValuesFrom";
      CLS_SVF1_RULE = "someValuesFrom";
      ENTAILED_SVF1_PROVENANCE = `entailed:${CLS_SVF1_RULE}`;
      CLS_SVF1_RULE_CONFIDENCE = 0.95;
      SEP = "\u241F";
      isSubClassOf = (p) => String(p || "").trim().toLowerCase() === "rdfs:subclassof";
      isType = (p) => String(p || "").trim().toLowerCase() === "rdf:type";
      isDisjoint = (p) => String(p || "").trim().toLowerCase() === "owl:disjointwith";
      isOnProperty = (p) => String(p || "").trim().toLowerCase() === "owl:onproperty";
      isSomeValuesFrom = (p) => String(p || "").trim().toLowerCase() === "owl:somevaluesfrom";
      isOnClass = (p) => String(p || "").trim().toLowerCase() === "owl:onclass";
      RESERVED_PREDICATES = /* @__PURE__ */ new Set([
        "rdfs:subclassof",
        "rdf:type",
        "owl:disjointwith",
        "owl:onproperty",
        "owl:somevaluesfrom",
        "owl:intersectionof"
      ]);
      HAS_PROPERTY_KEY = "has";
      CARDINALITY_KIND_OF = { "owl:cardinality": "exactly", "owl:mincardinality": "min", "owl:maxcardinality": "max" };
      ON_CLASS_PREDICATE = "owl:onClass";
      SCM_SVF_RULE = "someValuesFromSubsumption";
      ENTAILED_SCM_SVF_PROVENANCE = `entailed:${SCM_SVF_RULE}`;
      SCM_SVF_RULE_CONFIDENCE = 0.95;
      SCM_CARD_RULE = "cardinalityMonotonicity";
      CARDINALITY_RULE_CONFIDENCE = 0.95;
      CAX_MAXC0_RULE = "maxCardinalityZero";
      CAX_MAXC0_RULE_CONFIDENCE = 0.95;
    }
  });

  // src/chat.mjs
  init_node_path();
  init_node_fs();
  init_promises();

  // node-stub:node:os
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
  var DatabaseSync4 = unavailable4("DatabaseSync");

  // node-stub:node:readline/promises
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
  var DatabaseSync5 = unavailable5("DatabaseSync");

  // node-stub:node:child_process
  var unavailable6 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire6 = unavailable6("createRequire");
  var readFileSync6 = unavailable6("readFileSync");
  var writeFileSync6 = unavailable6("writeFileSync");
  var readFile6 = unavailable6("readFile");
  var writeFile6 = unavailable6("writeFile");
  var appendFile6 = unavailable6("appendFile");
  var mkdir6 = unavailable6("mkdir");
  var mkdtemp6 = unavailable6("mkdtemp");
  var rename6 = unavailable6("rename");
  var unlink6 = unavailable6("unlink");
  var rm6 = unavailable6("rm");
  var stat6 = unavailable6("stat");
  var access6 = unavailable6("access");
  var copyFile6 = unavailable6("copyFile");
  var readdir6 = unavailable6("readdir");
  var createReadStream6 = unavailable6("createReadStream");
  var createWriteStream6 = unavailable6("createWriteStream");
  var randomBytes6 = unavailable6("randomBytes");
  var createHash6 = unavailable6("createHash");
  var createRequireFromPath6 = unavailable6("createRequireFromPath");
  var spawnSync6 = unavailable6("spawnSync");
  var createInterface6 = unavailable6("createInterface");
  var DatabaseSync6 = unavailable6("DatabaseSync");

  // src/server.mjs
  init_promises();
  init_node_path();
  init_config();
  init_source_slice();

  // src/source.mjs
  init_promises();
  init_config();

  // src/server.mjs
  init_codegraph();
  init_ask();
  init_graph_service();
  init_core();

  // src/chat.mjs
  init_config();

  // src/cli-args.mjs
  init_node_path();
  init_promises();
  init_node_path();
  init_toml_config();
  init_config();

  // src/chat.mjs
  init_codegraph();
  init_sessions();

  // src/uuid.mjs
  init_node_crypto();

  // src/telemetry.mjs
  init_promises();
  init_node_path();

  // src/chat.mjs
  init_templates();
  init_extensions();

  // src/memory/bias.mjs
  var CORPUS_SOURCE_RE = /^src:corpus:(.+)$/;
  function biasForSourceId(sourceId, biasByBundle = {}) {
    const m = CORPUS_SOURCE_RE.exec(String(sourceId || ""));
    if (!m) return 1;
    const v = biasByBundle?.[m[1]];
    return typeof v === "number" && Number.isFinite(v) ? v : 1;
  }
  function biasForRow(row, biasByBundle = {}) {
    const ids = Array.isArray(row?.sourceIds) ? row.sourceIds : [];
    if (!ids.length) return 1;
    return Math.max(...ids.map((id) => biasForSourceId(id, biasByBundle)));
  }
  function rankByBiasThenTrust(rows, biasByBundle = {}) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row, index) => ({ row, index, bias: biasForRow(row, biasByBundle) })).sort((a, b) => b.bias - a.bias || (b.row?.trust ?? 0) - (a.row?.trust ?? 0) || a.index - b.index).map((x) => x.row);
  }

  // src/chat.mjs
  init_finish();
  init_ask_vocab();
  init_normalize();
  init_fuzzy();
  init_answer_variants();
  var CONTEXT_WORDS = /* @__PURE__ */ new Set(["it", "this", "that", "here"]);
  var GOAL_BY_KIND = {
    imports: "understand a dependency/import relationship",
    uses: "understand a dependency/usage relationship (imports and/or calls)",
    calls: "understand a call relationship",
    callsSymbol: "understand a call relationship",
    defines: "locate what a module/class defines",
    contains: "understand class membership (methods/attributes)",
    tests: "assess test coverage",
    inherits: "understand a class hierarchy/inheritance relationship",
    touches: "understand commit/change history",
    touchesSymbol: "understand commit/change history",
    cochange: "understand change-coupling between modules",
    reexports: "understand a module's public exports/API surface"
  };
  var COMMANDS = {
    find: { tool: "tmct_search", arg: "query", help: "lexical search across the graph" },
    search: { tool: "tmct_search", arg: "query", help: "alias of /find" },
    context: { tool: "tmct_context", arg: "symbol", help: "the sized edit bundle for a symbol (start here to change code)" },
    snippet: { tool: "tmct_snippet", arg: "symbol", help: "exact source of one function/class/method" },
    describe: { tool: "tmct_describe", arg: "symbol", help: "a symbol's definition, kind and relations" },
    signature: { tool: "tmct_signature", arg: "symbol", help: "a symbol's signature only" },
    members: { tool: "tmct_members", arg: "class", help: "the methods/attributes of a class" },
    subclasses: { tool: "tmct_subclasses", arg: "class", help: "the subclasses of a class" },
    impact: { tool: "tmct_impact", arg: "module", help: "what a change to this module reaches (impact closure)" },
    callers: { tool: "tmct_callers", arg: "symbol", help: "functions that call this symbol" },
    callees: { tool: "tmct_callees", arg: "symbol", help: "functions this symbol calls" },
    tests: { tool: "tmct_tests_for", arg: "symbol", help: "the tests covering this symbol" },
    untested: { tool: "tmct_untested", arg: null, help: "symbols with no covering test" },
    history: { tool: "tmct_history", arg: "symbol", help: "the commit history of this symbol" },
    exports: { tool: "tmct_exports", arg: "module", help: "a module's public exports" },
    arch: { tool: "tmct_architecture", arg: "package", help: "the architecture overview (optional package filter)", optional: true }
  };
  var COMMAND_WORDS = /* @__PURE__ */ new Set(["stats", "memory", "focus", ...Object.keys(COMMANDS)]);
  var AMBIGUOUS_HAVE_VERBS = /* @__PURE__ */ new Set(["have", "has", "holds", "hold"]);
  var RESTRICTOR_VERB_RE = new RegExp(
    `\\b(?:${[...Object.keys(VERB_TO_KIND), ...Object.keys(PASSIVE_PARTICIPLE_TO_KIND)].filter((v) => !AMBIGUOUS_HAVE_VERBS.has(v)).sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "i"
  );
  var GREET = /* @__PURE__ */ new Set([
    "hi",
    "hello",
    "hey",
    "yo",
    "hiya",
    "howdy",
    "sup",
    "greetings",
    "g'day",
    "gday",
    "hey there",
    "hi there",
    "hello there",
    "good morning",
    "good afternoon",
    "good evening",
    "morning",
    // UK/AU/NZ
    "alright",
    "you alright",
    "alright mate",
    "morning all",
    "yeah nah",
    // US
    "hey y'all",
    "howdy there",
    "hiya there",
    // formal
    "good day",
    "good day to you",
    "salutations",
    "good to meet you",
    "pleased to meet you",
    // slang
    "yo yo",
    "ayy",
    "wassup",
    "sup fam",
    "heya",
    "hiya!",
    // texting abbreviation
    "gm",
    "ge"
  ]);
  var THANKS = /* @__PURE__ */ new Set([
    "thanks",
    "thank you",
    "thankyou",
    "thx",
    "ty",
    "ta",
    "cheers",
    "nice one",
    "much appreciated",
    "cool thanks",
    "many thanks",
    "much obliged",
    "ta very much",
    "cheers mate",
    "cheers for that",
    "tks",
    "sweet thanks",
    "nice",
    // "brilliant" (playtest sprint round 3, 2026-07-10): a UK-English enthusiasm
    // interjection functioning as a bare acknowledgement, the same shape as
    // "nice"/"cheers" just above — "brilliant, that's all I needed" hit the raw
    // grammar wall via item 2's own multi-clause scan (which deliberately checks
    // THANKS only, not OK_ACK — see farewellOrThanksSignal's own docblock for why
    // "ok"/"cool"/"right" stay excluded there) because "brilliant" wasn't in
    // EITHER closed set yet.
    "brilliant",
    // "ta for that" (Tier 6 playtest): "cheers for that" was already here, but
    // its "ta" sibling (both dropped-word forms of the SAME "thanks for that"
    // shape) was missing — fell to the generic orientation card via
    // isConversational's ≤3-word catch-all instead of a thanks reply.
    "ta for that",
    // Playtest sprint round 3 (2026-07-10): a natural session-closing remark
    // hit the raw grammar wall instead of a warm sign-off — the LAST turn of a
    // session is a bad place to end on a wall. Same discipline as "ta for
    // that": add the SPECIFIC found phrasing, not a general "closing remark"
    // grammar.
    "cheers, that's everything for now, thanks",
    "that's everything for now, thanks",
    "that's all for now, thanks"
  ]);
  var BYE = /* @__PURE__ */ new Set([
    "bye",
    "goodbye",
    "quit",
    "exit",
    "see ya",
    "see you",
    "cya",
    "later",
    "farewell",
    "peace",
    "peace out",
    "im off",
    "i'm off",
    "gtg",
    "gotta go",
    "catch you later",
    "farewell then"
    // "good day to you" deliberately does NOT live here (SKILL_BENCHMARK_
    // CONVERSATION.md persona-sweep, 2026-07-11, Priority 2 — severe, killed
    // the whole session): it's the formal-register GREETING §2.2 itself names
    // ("good day" — down to slang), not a farewell. It used to sit in this set
    // and won the race against GREET (foldedBye is checked first in
    // conversationalTurn), so a plain formal "good day to you" silently ended
    // the session — every turn piped after it was dropped with no log entry, a
    // worse outcome than any wall. Moved to GREET (above) instead; a genuine
    // dismissive sign-off ("farewell then", bare "farewell") stays here
    // unchanged — this is a narrowing of an over-broad match, not a new
    // farewell phrasing (§5 "farewells stay out of scope" governs ADDING
    // coverage, not fixing a phrase that was on the wrong list).
  ]);
  var OK_ACK = /* @__PURE__ */ new Set([
    "ok",
    "okay",
    "cool",
    "aight",
    "fair enough",
    "got it",
    "gotcha",
    "noted",
    "sounds good",
    "sure",
    "cool cool",
    "right"
  ]);
  var collapseRuns = (s) => s.replace(/(.)\1+/g, "$1");
  function collapsedIndex(set) {
    const idx = /* @__PURE__ */ new Map();
    for (const phrase of set) if (!idx.has(collapseRuns(phrase))) idx.set(collapseRuns(phrase), phrase);
    return idx;
  }
  var GREET_COLLAPSED = collapsedIndex(GREET);
  var THANKS_COLLAPSED = collapsedIndex(THANKS);
  var BYE_COLLAPSED = collapsedIndex(BYE);
  var ACK_LEAD_RE = new RegExp(`^(?:${[...OK_ACK].map(escapeRegex).join("|")})\\s+(.+)$`, "i");
  var CONVERSATIONAL_PHRASES = [
    ...GREET,
    ...THANKS,
    ...BYE,
    "what can you do",
    "what do you do",
    "help",
    "how do you work",
    "who are you",
    "what are you",
    "what is your name"
  ];
  var TEACH_ADVERB_SKIP_SRC = "(?:(?:usually|often|sometimes|rarely|never|always|typically|generally|occasionally|frequently|normally|regularly|commonly|mostly|currently|still|also|really|actually)\\s+)?";
  var GENERAL_VERB_TEACH_RE = new RegExp(`^([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[.!?]*$`, "i");
  var GENERAL_VERB_NOT_A_VERB_RE = new RegExp(
    "^(?:i|me|you|he|him|she|her|it|we|us|they|them|my|your|his|its|our|their|mine|yours|hers|ours|theirs|this|that|these|those|a|an|the|every|each|all|some|any|no|both|either|neither|in|on|at|to|from|by|with|for|of|about|into|onto|over|under|near|before|after|during|through|up|down|off|out|above|below|between|among|against|without|within|along|across|behind|beyond|upon|toward|towards|per|and|but|or|if|because|although|though|while|when|since|unless|until|whether|so|nor|than|as)$",
    "i"
  );
  var GENERAL_VERB_YESNO_RE = new RegExp(`^(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[?.!\\s]*$`, "i");
  var GENERAL_VERB_OPEN_RE = new RegExp(`^what\\s+(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)[?.!\\s]*$`, "i");
  var TRAILING_ADVERB_RE = "(?:\\s+(?:exactly|really|actually|anyway))?";
  var MODULE_ORIENT_RE = new RegExp(`^what\\s+does\\s+(.+?)\\s+do${TRAILING_ADVERB_RE}\\??$`, "i");
  var MODULE_ORIENT_SVO_RE = new RegExp(`^what\\s+(.+?)\\s+does${TRAILING_ADVERB_RE}\\??$`, "i");
  var AUTHOR_NAME_SRC = "([A-Za-z][\\w'.-]*(?:\\s+[A-Za-z][\\w'.-]*){0,3})";
  var AUTHOR_WHO_IS_RE = new RegExp(`^who\\s+(?:is|was)\\s+${AUTHOR_NAME_SRC}$`, "i");
  var AUTHOR_TOUCHED_RE = new RegExp(
    `^what\\s+(?:did|has)\\s+${AUTHOR_NAME_SRC}\\s+(?:touch(?:ed)?|chang(?:e|ed)|work(?:ed)?\\s+on|commit(?:ted)?)$`,
    "i"
  );
  var OPINION_ADJ_SRC = "(?:good|bad|clean|messy|ugly|nice|great|terrible|awful|solid|elegant|readable|maintainable|well[- ]written|well[- ]structured|spaghetti|ok|okay|decent|healthy)";
  var OPINION_NUDGE_RE = new RegExp(`^is\\s+(?:this|the)\\s+code(?:base)?\\s+(?:any\\s+)?${OPINION_ADJ_SRC}\\b`, "i");
  var PERSONAL_ASSISTANT_NUDGE_RE = new RegExp(
    "^(?:what\\s+time\\s+is\\s+it(?:\\s+(?:now|right\\s+now))?|what(?:'s|s|\\s+is)\\s+the\\s+time(?:\\s+(?:now|right\\s+now))?|what\\s+day\\s+is\\s+it(?:\\s+today)?|what(?:'s|s|\\s+is)\\s+(?:the\\s+)?(?:day|date)(?:\\s+today)?|what(?:'s|s|\\s+is)\\s+today'?s\\s+date|what(?:'s|s|\\s+is)\\s+the\\s+weather(?:\\s+like)?(?:\\s+(?:today|outside))?|how'?s\\s+the\\s+weather(?:\\s+like)?(?:\\s+(?:today|outside))?)\\??$",
    "i"
  );
  var PREDICATE_WORDS = new Set(
    [
      ...Object.keys(VERB_TO_KIND).flatMap((phrase) => phrase.split(/[\s-]+/)),
      ...WHERE_MARKERS,
      ...MENTION_MARKERS,
      "owns",
      "maintains"
    ].filter((w) => w.length >= 3)
  );
  var FACT_PREDICATE_PHRASES = {
    "rdfs:subClassOf": "is a kind of",
    "rdf:type": "is a",
    "owl:disjointWith": "is not a",
    "mgx:partOf": "is part of",
    "mgx:hasA": "has",
    "mgx:usedFor": "is used for",
    "mgx:capableOf": "can",
    "mgx:atLocation": "is found in",
    "mgx:causes": "causes",
    "mgx:hasProperty": "is",
    "mgx:madeOf": "is made of",
    "mgx:receivesAction": "can be",
    "mgx:createdBy": "is created by",
    "mgx:mannerOf": "is a way to",
    "mgx:desires": "wants",
    "mgx:locatedNear": "is typically near",
    "mgx:motivatedByGoal": "is motivated by",
    "mgx:obstructedBy": "can be prevented by",
    "mgx:causesDesire": "makes you want to",
    "mgx:hasSubevent": "involves",
    "mgx:hasFirstSubevent": "begins with",
    "mgx:hasLastSubevent": "ends with",
    "mgx:hasPrerequisite": "requires",
    "mgx:ownedBy": "is owned by",
    // the teach lane's ownership frame ("Priya owns tasks.mjs")
    "mgx:synonym": "means the same as",
    "mgx:antonym": "is the opposite of",
    "mgx:similarTo": "is similar to",
    "mgx:relatedTo": "is related to",
    "mgx:symbolOf": "is a symbol of"
  };
  function thirdPersonSingularSurface(lemma) {
    const w = String(lemma || "");
    if (/^have$/i.test(w)) return "has";
    if (/[a-z]y$/i.test(w) && !/[aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
    if (/(?:s|x|z|ch|sh|o)$/i.test(w)) return `${w}es`;
    return `${w}s`;
  }
  function predicatePhrase(predicate) {
    if (FACT_PREDICATE_PHRASES[predicate]) return FACT_PREDICATE_PHRASES[predicate];
    const m = /^mgx:([a-z]+)$/i.exec(String(predicate || ""));
    return m ? thirdPersonSingularSurface(m[1]) : predicate;
  }
  var factPhrase = (f) => `${f.subject} ${predicatePhrase(f.predicate)} ${f.object}`;
  var TRAILING_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES).map(([predicate, phrase]) => {
    const m = /^(?:is|are)\s+(.+)$/i.exec(phrase);
    return m ? { predicate, marker: m[1].trim().toLowerCase() } : null;
  }).filter((e) => e && e.marker.length > 1).sort((a, b) => b.marker.length - a.marker.length);
  function splitMetaPredicate(term) {
    const t = String(term || "").trim();
    const lower = t.toLowerCase();
    for (const { marker, predicate } of TRAILING_PREDICATE_MARKERS) {
      if (lower === marker) continue;
      if (lower.endsWith(` ${marker}`)) {
        const subject = t.slice(0, t.length - marker.length).trim();
        if (subject) return { subject, predicate };
      }
    }
    return { subject: t, predicate: null };
  }
  function renderFactLine(f) {
    const cite = f.provenance ? ` (source: ${f.provenance})` : "";
    if (f.provenance.includes("ace:chat") || f.provenance.includes("teach:chat")) return `you told me: ${factPhrase(f)}${cite}`;
    if (f.provenance.includes("corpus-weak:")) return `possibly: ${factPhrase(f)}${cite}`;
    if (f.provenance.includes("corpus:")) return `${factPhrase(f)}${cite}`;
    return `i learned: ${factPhrase(f)}${cite}`;
  }
  async function memoryFacts(memoryDir) {
    try {
      const { loadMemory: loadMemory2 } = await Promise.resolve().then(() => (init_core(), core_exports));
      const m = await loadMemory2(memoryDir);
      const out = [];
      for (const ind of m.individuals || []) {
        if (ind?.class !== "Fact") continue;
        const get = (k) => (ind.attributes || []).find((a) => a.key === k)?.value || "";
        out.push({ subject: get("subject"), predicate: get("predicate"), object: get("object"), provenance: get("provenance") });
      }
      return out;
    } catch {
      return [];
    }
  }
  async function factRows(memoryDir) {
    try {
      const { loadMemory: loadMemory2, readFactRows: readFactRows2 } = await Promise.resolve().then(() => (init_core(), core_exports));
      return readFactRows2(await loadMemory2(memoryDir));
    } catch {
      return [];
    }
  }
  function factTermVariants(normFactTerm2, term) {
    const t = normFactTerm2(term);
    const v = /* @__PURE__ */ new Set([t]);
    if (t.endsWith("es")) v.add(t.slice(0, -2));
    if (t.endsWith("s")) v.add(t.slice(0, -1));
    return v;
  }
  var GENERIC_ENTITY_WORDS = /* @__PURE__ */ new Set([
    "module",
    "modules",
    "class",
    "classes",
    "function",
    "functions",
    "method",
    "methods",
    "handler",
    "handlers",
    "controller",
    "controllers",
    "service",
    "services",
    "component",
    "components",
    "flow",
    "flows",
    "thing",
    "things",
    "item",
    "items",
    "object",
    "objects",
    "commit",
    "commits"
  ]);
  var SYNONYM_DENYLIST = new Set([
    ["interpreter", "compiler"],
    // different execution strategies, not synonyms
    ["string", "thread"],
    // unrelated CS concepts (text data vs. execution thread)
    ["heart", "kernel"],
    // generic-English collision on "kernel"
    ["battalion", "heap"],
    // generic-English collision on "heap" (data structure)
    ["bash", "sock"],
    // generic-English collision ("bash"/"sock" = to hit)
    ["command", "skill"],
    // too loose to be a safe query-time substitution
    ["docker", "longshoreman"],
    // proper-noun/tool name vs. unrelated profession
    ["name", "list"],
    // generic-English collision, not a domain synonym
    ["list", "number"]
    // generic-English collision, not a domain synonym
  ].map(([a, b]) => [a, b].sort().join("|")));
  var ISA_ASK_RE = /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+(?:a\s+kind\s+of|a\s+type\s+of|an?)\s+(.+?)[?.!\s]*$/i;
  var ISA_PREDICATES = /* @__PURE__ */ new Set(["rdfs:subClassOf", "rdf:type"]);
  var WHY_ISA_LEAD_RE = /^why\s+(?=(?:is|are)\b)/i;
  var EXPLAIN_HOW_YOU_KNOW_RE = /^explain\s+how\s+you\s+know\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  function matchWhyIsa(q) {
    const stripped = String(q || "").replace(WHY_ISA_LEAD_RE, "");
    if (stripped !== q) {
      const m = stripped.match(ISA_ASK_RE);
      if (m) return m;
    }
    const ehyk = String(q || "").match(EXPLAIN_HOW_YOU_KNOW_RE);
    if (ehyk) return `is ${ehyk[1].trim()} a ${ehyk[2].trim()}`.match(ISA_ASK_RE);
    return null;
  }
  var KNOW_ABOUT_RE = /^(?:what\s+do\s+you\s+know\s+about|what(?:'s|s|\s+is)\s+in\s+your\s+memory\s+about|what\s+do\s+you\s+remember\s+about)\s+(.+?)[?.!\s]*$/i;
  var FACT_ANSWER_CAP = 32;
  var CAN_ASK_RE = /^(?:can|could)\s+(?:an?\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z]+)[?.!\s]*$/i;
  var WHAT_CAN_DO_RE = /^what\s+can\s+(?:an?\s+)?(.+?)\s+do[?.!\s]*$/i;
  var WHAT_HAS_RE = /^what\s+has\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  var WHAT_USED_FOR_RE = /^what\s+(?:(?:can\s+be|is)\s+used\s+for|is\s+for)\s+(.+?)[?.!\s]*$/i;
  var REVERSE_PREDICATE_EXCLUDE = /* @__PURE__ */ new Set([
    "rdfs:subClassOf",
    "rdf:type",
    "mgx:hasA",
    "mgx:capableOf",
    "mgx:usedFor",
    "mgx:ownedBy",
    "owl:disjointWith",
    "mgx:hasProperty",
    "mgx:receivesAction"
  ]);
  var REVERSE_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES).filter(([predicate]) => !REVERSE_PREDICATE_EXCLUDE.has(predicate)).map(([predicate, phrase]) => ({
    predicate,
    re: new RegExp(`^what\\s+${escapeRegex(phrase)}\\s+(.+?)[?.!\\s]*$`, "i")
  })).sort((a, b) => b.re.source.length - a.re.source.length);
  var WHAT_INHERITS_RE = /^what\s+(?:inherits?\s+(?:from\s+)?(?:an?\s+)?|is\s+(?:an?\s+)?(?:kind|sort|type)\s+of\s+|is\s+(?:an?\s+)?subclass\s+of\s+)(.+?)[?.!\s]*$/i;
  var HAS_TEMPORAL_TAIL = /* @__PURE__ */ new Set(["changed", "change", "changes", "updated", "modified", "happened", "occurred"]);
  function uniqueFacts(rows) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const f of rows) {
      const key = `${f.subject}|${f.predicate}|${f.object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }
  async function factAnswer(memoryDir, query, envelope, miss2, biasByBundle = {}) {
    let normFactTerm2;
    try {
      ({ normFactTerm: normFactTerm2 } = await Promise.resolve().then(() => (init_core(), core_exports)));
    } catch {
      return null;
    }
    const q = String(query).trim();
    const usedForQ = q.match(WHAT_USED_FOR_RE);
    if (usedForQ) {
      const variants = factTermVariants(normFactTerm2, usedForQ[1]);
      const hits = (await factRows(memoryDir)).filter((f) => f.predicate === "mgx:usedFor" && variants.has(f.object));
      if (hits.length) {
        const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
        const lines = ranked.map(renderFactLine);
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
        return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
      }
    }
    for (const { predicate, re } of REVERSE_PREDICATE_MARKERS) {
      const m = q.match(re);
      if (!m) continue;
      const variants = factTermVariants(normFactTerm2, m[1]);
      const hits = (await factRows(memoryDir)).filter((f) => f.predicate === predicate && variants.has(f.object));
      if (!hits.length) continue;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    let metaTerm = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
    if (!metaTerm && miss2 && !envelope?.parsed && !WHAT_INHERITS_RE.test(q)) {
      const m = q.match(BARE_WHATIS_RE) || q.match(/^what\s+(?:does|do)\s+(.+?)\s+means?[?.!\s]*$/i);
      if (m) metaTerm = stripTrailingScopeFiller(m[1]);
    }
    if (metaTerm) {
      const { subject, predicate } = splitMetaPredicate(metaTerm);
      const variants = factTermVariants(normFactTerm2, subject);
      const subjectHits = (await factRows(memoryDir)).filter((f) => variants.has(f.subject));
      let hits = predicate ? subjectHits.filter((f) => f.predicate === predicate) : subjectHits;
      if (!hits.length) {
        if (predicate && subjectHits.length) {
          return {
            text: `I don't have any "${FACT_PREDICATE_PHRASES[predicate]}" facts about ${subject}.`,
            replace: miss2
          };
        }
        return null;
      }
      hits = rankByBiasThenTrust(hits, biasByBundle);
      const lines = hits.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: miss2, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    if (!miss2) return null;
    const isa = q.match(ISA_ASK_RE) || matchWhyIsa(q);
    if (isa) {
      const subj = factTermVariants(normFactTerm2, isa[1]);
      const obj = factTermVariants(normFactTerm2, isa[2]);
      const hit2 = (await memoryFacts(memoryDir)).find(
        (f) => ISA_PREDICATES.has(f.predicate) && subj.has(f.subject) && obj.has(f.object)
      );
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return null;
    }
    const can = q.match(CAN_ASK_RE);
    if (can) {
      const subj = factTermVariants(normFactTerm2, can[1]);
      const obj = factTermVariants(normFactTerm2, can[2]);
      const hit2 = (await memoryFacts(memoryDir)).find(
        (f) => f.predicate === "mgx:capableOf" && subj.has(f.subject) && obj.has(f.object)
      );
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return null;
    }
    const canDo = q.match(WHAT_CAN_DO_RE);
    if (canDo) {
      const variants = factTermVariants(normFactTerm2, canDo[1]);
      const hits = (await factRows(memoryDir)).filter((f) => f.predicate === "mgx:capableOf" && variants.has(f.subject));
      if (!hits.length) return null;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const hasQ = q.match(WHAT_HAS_RE);
    if (hasQ && !HAS_TEMPORAL_TAIL.has(hasQ[1].trim().split(/\s+/)[0]?.toLowerCase())) {
      const variants = factTermVariants(normFactTerm2, hasQ[1]);
      const hits = (await factRows(memoryDir)).filter((f) => f.predicate === "mgx:hasA" && variants.has(f.object));
      if (!hits.length) return null;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const inheritsQ = q.match(WHAT_INHERITS_RE);
    const inheritsObj = envelope?.parsed?.shape === "reverse" && envelope.parsed.kind === "inherits" ? envelope.parsed.object : inheritsQ?.[1];
    if (inheritsObj) {
      const variants = factTermVariants(normFactTerm2, inheritsObj);
      const hits = (await factRows(memoryDir)).filter((f) => ISA_PREDICATES.has(f.predicate) && variants.has(f.object));
      if (!hits.length) return null;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const know = q.match(KNOW_ABOUT_RE);
    if (know) {
      const variants = factTermVariants(normFactTerm2, know[1]);
      const rows = await factRows(memoryDir);
      const isTaughtFact = (f) => !String(f.provenance || "").includes("corpus:") && !String(f.provenance || "").includes("web:");
      const isaRows = rows.filter((f) => ISA_PREDICATES.has(f.predicate) && isTaughtFact(f));
      const subtypeSubjects = /* @__PURE__ */ new Set();
      let frontier = variants;
      for (let hop = 0; hop < 8 && frontier.size; hop += 1) {
        const nextSubjects = /* @__PURE__ */ new Set();
        for (const f of isaRows) {
          if (frontier.has(f.object) && !subtypeSubjects.has(f.subject)) nextSubjects.add(f.subject);
        }
        if (!nextSubjects.size) break;
        for (const s of nextSubjects) subtypeSubjects.add(s);
        const nextFrontier = /* @__PURE__ */ new Set();
        for (const s of nextSubjects) for (const v of factTermVariants(normFactTerm2, s)) nextFrontier.add(v);
        frontier = nextFrontier;
      }
      let hits = rows.filter((f) => variants.has(f.subject) || variants.has(f.object) || subtypeSubjects.has(f.subject));
      if (!hits.length) {
        const queryWords = normFactTerm2(know[1]).split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_ENTITY_WORDS.has(w));
        if (queryWords.length) {
          const wordsOf2 = (s) => new Set(String(s || "").split(/\s+/));
          const overlaps = (term2) => {
            const w = wordsOf2(term2);
            return queryWords.some((qw) => w.has(qw));
          };
          hits = rows.filter((f) => overlaps(f.subject) || overlaps(f.object));
        }
      }
      if (!hits.length) return null;
      const { findConsistencyViolations: findConsistencyViolations2, TYPE_PREDICATE: CONS_TYPE_PREDICATE, SUBCLASS_PREDICATE: CONS_SC_PREDICATE, DISJOINT_PREDICATE: CONS_DISJOINT_PREDICATE } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const consIsTaught = (f) => !f.provenance?.includes("corpus:") && !f.provenance?.includes("web:");
      const consTypeEdges = rows.filter((f) => f.predicate === CONS_TYPE_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
      const consSubClassEdges = rows.filter((f) => f.predicate === CONS_SC_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
      const consDisjointEdges = rows.filter((f) => f.predicate === CONS_DISJOINT_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
      if (consDisjointEdges.length) {
        const clashes = findConsistencyViolations2(consTypeEdges, consSubClassEdges, consDisjointEdges, { focus: variants, budget: 5 });
        const clash = clashes.find((c) => variants.has(c.subject));
        if (clash) {
          return {
            text: `I can't answer that \u2014 what I've been told about ${clash.subject} is inconsistent: it's taught to be both ${clash.classA} and ${clash.classB}, but ${clash.viaA} and ${clash.viaB} are disjoint (${clash.viaA} owl:disjointWith ${clash.viaB}). I'd need one of those retracted before I can answer honestly.`,
            replace: true
          };
        }
      }
      const literalHit = hits.find((f) => variants.has(f.subject) || variants.has(f.object));
      const term = literalHit ? variants.has(literalHit.subject) ? literalHit.subject : literalHit.object : know[1].trim();
      const viaSubtype = hits.some((f) => subtypeSubjects.has(f.subject) && !variants.has(f.subject) && !variants.has(f.object));
      hits = rankByBiasThenTrust(hits, biasByBundle);
      const lines = hits.map((f) => `  ${renderFactLine(f)}`);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
  \u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      const header = `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}${viaSubtype ? " (including its known subtypes)" : ""}:`;
      return { text: `${header}
${shown.join("\n")}${extra}`, replace: true, ...rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {} };
    }
    return null;
  }
  var PRONOUN_IN_QUERY_RE = new RegExp(`\\b(?:${[...CONTEXT_WORDS].join("|")})\\b`, "i");
  var BARE_WHATIS_RE = /^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  var DESCRIBE_GRAIN_WORD_RE = new RegExp(
    `^(?:(?:the|a|an)\\s+)?(.+?)\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`,
    "i"
  );
  var GOAL_BY_COMMAND = {
    find: "locate a specific named entity",
    search: "locate a specific named entity",
    context: "gather the sized edit bundle for a symbol before changing code",
    snippet: "view a symbol's exact source",
    describe: "look up a symbol's definition and relations",
    signature: "view a symbol's signature",
    members: GOAL_BY_KIND.contains,
    subclasses: GOAL_BY_KIND.inherits,
    impact: "understand what a change to this module would reach (impact closure)",
    callers: GOAL_BY_KIND.calls,
    callees: GOAL_BY_KIND.calls,
    tests: GOAL_BY_KIND.tests,
    untested: GOAL_BY_KIND.tests,
    history: GOAL_BY_KIND.touches,
    exports: GOAL_BY_KIND.reexports,
    arch: "understand the overall architecture (package/module boundaries)"
  };
  var BASE_QUALIFIER_SRC = "as\\s+(?:its|the|an?)?\\s*(?:base\\s+class|parent\\s+class|base|parent)";
  var USES_AS_BASE_WH_ASK_RE = new RegExp(
    `^(.+?)\\s+uses?\\s+(?:which\\s+[\\w'-]+|what)\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`,
    "i"
  );
  var USES_AS_BASE_WHAT_FRONT_RE = new RegExp(
    `^what\\s+(?:does|do|did)\\s+(.+?)\\s+uses?\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`,
    "i"
  );
  var USES_AS_BASE_YESNO_RE = new RegExp(
    `^(?:does|do|did)\\s+(.+?)\\s+uses?\\s+(.+?)\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`,
    "i"
  );
  var USES_AS_BASE_TEACH_RE = new RegExp(
    `^(.+?)\\s+uses?\\s+(.+?)\\s+${BASE_QUALIFIER_SRC}\\s*[.!]*$`,
    "i"
  );
  var SEED_MARKER_REL = join(".tmct", "memory", "corpus-seed.json");

  // src/memory-ask-browser-entry.mjs
  init_core();
  globalThis.tmctMemoryAsk = { factAnswer, createInMemoryStore, normFactTerm };
})();
