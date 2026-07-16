// graph-build.mjs  the PURE assembly of the typed `entities` payload from
// already-parsed module + commit records. No subprocesses, no filesystem, no git:
// data in, graph out  which is why tests build in-memory graphs through it, and
// why it is the write-path primitive conversation memory grows on (sessions.mjs
// folds session records into the same shape).
//
// Typed edges produced (all provenance-stamped). Prop tokens follow the SEON
// vocabulary (se-on.org, FAMIX-derived) where a term exists, with an `mgx:`
// extension namespace:
//   seon:usesComplexType    Module -> Module   (internal import targets, via registry)
//   seon:declaresMethod     Module -> CodeEntity (top-level functions/classes/methods/attrs)
//   seon:invokesMethod      Module -> Module   (coarse + import-backed)
//   mgx:testsCoverage       Module -> Module   (a test module -> the internal modules it imports)
//   seon:history            Commit -> Module   (from git log --name-only)
//   mgx:touchesSymbol       Commit -> CodeEntity (commit changed-line-range x symbol span)
//   mgx:callsSymbol         Function/Method -> Function/Class (symbol-granular, unambiguous)
//   seon:containsCodeEntity Class  -> Method/Attribute (class membership)
//   mgx:subclassOf          Class  -> Class    (inheritance)

import { attachProseTokens, buildProseIndex } from "../prose.mjs";

const isTestPath = (p) =>
  p.startsWith("tests/") || /(^|\/)tests?\//.test(p) || /(^|\/)test_[^/]*\.py$/.test(p) || /\.tests(\.|$)/.test(p);

const lastIdent = (name) => {
  const m = String(name).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  return m ? m[1] : null;
};

/** Build the `entities` payload from the parsed modules + git history.
 *  `symbolHistory` (optional) is the runGitLogHunks() output — per-commit changed
 *  line ranges, intersected with symbol spans to emit mgx:touchesSymbol edges. */
export function buildEntities(modules, commits, { generatedAt = "", symbolHistory = [], prose = true } = {}) {
  const modById = new Map();         // path -> module record
  const dottedToPath = new Map();    // dotted module name -> path
  const nameToPaths = new Map();     // top-level symbol name -> Set<path> (for call resolution)
  const nameToSymbolIds = new Map(); // top-level symbol name -> Set<fnId> (for symbol-granular calls)

  const modId = (p) => `mod:${p}`;
  const fnId = (p, name) => `fn:${p}#${name}`;

  for (const m of modules) {
    modById.set(m.path, m);
    if (m.dotted) dottedToPath.set(m.dotted, m.path);
  }
  // Registry of top-level functions/classes by simple name — used to resolve coarse
  // call targets AND inheritance bases to a single internal module (else dropped).
  const classToPaths = new Map();    // class name -> Set<path> (for base resolution)
  for (const m of modules) {
    for (const d of m.defines || []) {
      if (d.kind === "method" || d.kind === "attribute" || d.kind === "global") continue; // not standalone call targets
      const register = (name) => {
        if (!nameToPaths.has(name)) nameToPaths.set(name, new Set());
        nameToPaths.get(name).add(m.path);
        if (!nameToSymbolIds.has(name)) nameToSymbolIds.set(name, new Set());
        nameToSymbolIds.get(name).add(fnId(m.path, d.name));
        if (d.kind === "class") {
          if (!classToPaths.has(name)) classToPaths.set(name, new Set());
          classToPaths.get(name).add(m.path);
        }
      };
      register(d.name);
      // Nested types (Java/C#) define dotted names like Outer.Inner — ALSO register the
      // simple name so `new Inner()` / `extends Inner` still resolve. Same Set semantics:
      // a second definition of the simple name makes it ambiguous → dropped, honest.
      if (d.kind === "class" && d.name.includes(".")) {
        const simple = lastIdent(d.name);
        if (simple && simple !== d.name) register(simple);
      }
    }
  }
  // Resolve a class SIMPLE name at a path to the id of its (possibly nested, dotted)
  // define — nameToSymbolIds keeps full ids, so a unique in-path match wins; an exact
  // plain define beats a nested one; else fall back to the literal id (pre-nesting shape).
  const classIdAt = (path, ident) => {
    const pre = `fn:${path}#`;
    const exact = `${pre}${ident}`;
    const ids = [...(nameToSymbolIds.get(ident) || [])].filter((i) => i.startsWith(pre));
    if (ids.includes(exact) || ids.length !== 1) return exact;
    return ids[0];
  };

  // resolve a module's import candidates to internal module paths
  const internalImports = (m) => {
    const set = new Set();
    for (const cand of m.imports || []) {
      let path = dottedToPath.get(cand);
      if (!path) {
        // `from a.b import c` → cand "a.b.c" may be a symbol; fall back to the package "a.b".
        const parent = cand.includes(".") ? cand.slice(0, cand.lastIndexOf(".")) : "";
        path = parent && dottedToPath.get(parent);
      }
      if (path && path !== m.path) set.add(path);
    }
    return set;
  };

  const importEdges = [];
  const definesEdges = [];
  const callEdges = [];
  const testEdges = [];
  const containsEdges = [];
  const inheritsEdges = [];
  const callSymbolEdges = [];
  const fnIndividuals = [];
  const symbolSpansByPath = new Map(); // path -> [{id, label, start, end}] (for touchesSymbol)
  const seenFn = new Set();
  const seenContains = new Set();
  const seenInherits = new Set();
  const seenCallSymbol = new Set();

  const CLASS_OF = { class: "Class", method: "Method", attribute: "Attribute", function: "Function", global: "GlobalVariable" };
  const shortName = (name) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name);
  const ownerName = (name) => name.slice(0, name.lastIndexOf("."));

  for (const m of modules) {
    const imports = internalImports(m);
    for (const target of imports) {
      const edge = { subject: modId(m.path), object: modId(target), subjectLabel: m.path, objectLabel: target };
      (isTestPath(m.path) ? testEdges : importEdges).push(edge);
    }

    for (const d of m.defines || []) {
      const oid = fnId(m.path, d.name);
      definesEdges.push({ subject: modId(m.path), object: oid, subjectLabel: m.path, objectLabel: d.name });

      if (!seenFn.has(oid)) {
        seenFn.add(oid);
        const startLn = Number(d.lineno) || 0;
        const endLn = Number(d.end_lineno) > startLn ? Number(d.end_lineno) : startLn;
        const span = endLn > startLn ? `${startLn}-${endLn}` : `${startLn}`;
        if (startLn) {
          if (!symbolSpansByPath.has(m.path)) symbolSpansByPath.set(m.path, []);
          symbolSpansByPath.get(m.path).push({ id: oid, label: d.name, start: startLn, end: endLn });
        }
        const attrs = [{ prop: "seon:startsAt", key: "site", value: `${m.path}:${span}` }];
        const decs = (d.decorators || []).filter(Boolean);
        if (decs.length) attrs.push({ prop: "mgx:decorator", key: "decorators", value: decs.join(", ") });
        if (d.kind === "global" && d.value) attrs.push({ prop: "mgx:value", key: "value", value: d.value });
        // mechanical enrichments (deterministic ast facts; emitted only when present
        // so the graph stays lean) — surfaced via seon_signature, NOT the lean bundle.
        const list = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
        if (d.params) attrs.push({ prop: "seon:hasParameter", key: "params", value: String(d.params) });
        if (d.returns) attrs.push({ prop: "seon:hasReturnType", key: "returns", value: String(d.returns) });
        if (d.raises?.length) attrs.push({ prop: "seon:throwsException", key: "raises", value: list(d.raises) });
        if (d.catches?.length) attrs.push({ prop: "seon:catchesException", key: "catches", value: list(d.catches) });
        if (d.self_fields?.length) attrs.push({ prop: "seon:accessesField", key: "self_fields", value: list(d.self_fields) });
        if (d.subkind) attrs.push({ prop: "seon:subKind", key: "subkind", value: String(d.subkind) });
        if (d.is_static) attrs.push({ prop: "seon:isStatic", key: "isStatic", value: "true" });
        if (d.is_abstract) attrs.push({ prop: "seon:isAbstract", key: "isAbstract", value: "true" });
        if (d.is_constant) attrs.push({ prop: "seon:isConstant", key: "isConstant", value: "true" });
        if (d.visibility) attrs.push({ prop: "seon:hasAccessModifier", key: "visibility", value: String(d.visibility) });
        if (d.doc) attrs.push({ prop: "seon:hasDoc", key: "doc", value: String(d.doc) });
        fnIndividuals.push({
          id: oid, label: d.name, class: CLASS_OF[d.kind] || "Function",
          derived_from: [], mentions: [], attributes: attrs,
        });
      }

      // class membership: Class → Method/Attribute (the new info; module→symbol is `defines`)
      if (d.kind === "method" || d.kind === "attribute") {
        const owner = ownerName(d.name);
        if (owner) {
          const ownerId = fnId(m.path, owner);
          const ckey = `${ownerId}>${oid}`;
          if (!seenContains.has(ckey)) {
            seenContains.add(ckey);
            containsEdges.push({ subject: ownerId, object: oid, subjectLabel: owner, objectLabel: shortName(d.name) });
          }
        }
      }

      // inheritance: Class → base. Resolve to an internal Class id only when the base
      // name is defined in exactly ONE internal module AND that module is imported here
      // (mirrors the coarse-call discipline — avoids linking `argparse.Action` to an
      // unrelated internal `Action`). Otherwise keep it external as ext:<base>, honest.
      if (d.kind === "class") {
        for (const base of d.bases || []) {
          const ident = lastIdent(base);
          if (!ident) continue;
          const defs = classToPaths.get(ident);
          let object = `ext:${ident}`;
          if (defs && defs.has(m.path)) {
            object = classIdAt(m.path, ident); // same-module base wins (local name scoping), even if the name is globally ambiguous
          } else if (defs && defs.size === 1) {
            const targetPath = [...defs][0];
            if (imports.has(targetPath)) object = classIdAt(targetPath, ident);
          }
          const ikey = `${oid}>${object}`;
          if (seenInherits.has(ikey) || object === oid) continue;
          seenInherits.add(ikey);
          inheritsEdges.push({ subject: oid, object, subjectLabel: d.name, objectLabel: base });
        }
      }

      // symbol-granular calls: caller fn/method → callee fn/class, resolved ONLY when the
      // callee simple name has exactly ONE in-repo definition (same unique-name discipline
      // as the module-coarse calls). Ambiguous / receiver-typed / external names are dropped
      // (honest Group-A). Reuses the per-function call names already parsed by extract_ast.py.
      if ((d.kind === "function" || d.kind === "method") && d.calls?.length) {
        for (const callName of d.calls) {
          const ident = lastIdent(callName);
          if (!ident) continue;
          const ids = nameToSymbolIds.get(ident);
          if (!ids || ids.size !== 1) continue; // ambiguous or external → drop
          const callee = [...ids][0];
          if (callee === oid) continue; // self-recursion not an edge
          const ckey = `${oid}>${callee}`;
          if (seenCallSymbol.has(ckey)) continue;
          seenCallSymbol.add(ckey);
          callSymbolEdges.push({ subject: oid, object: callee, subjectLabel: d.name, objectLabel: ident });
        }
      }
    }

    // coarse, import-backed calls: a callee name defined in exactly one imported module.
    if (!isTestPath(m.path)) {
      const seen = new Set();
      for (const callName of m.calls || []) {
        const ident = lastIdent(callName);
        if (!ident) continue;
        const defs = nameToPaths.get(ident);
        if (!defs || defs.size !== 1) continue; // ambiguous → drop (honest)
        const target = [...defs][0];
        if (target === m.path || !imports.has(target) || seen.has(target)) continue;
        seen.add(target);
        callEdges.push({ subject: modId(m.path), object: modId(target), subjectLabel: m.path, objectLabel: target });
      }
    }
  }

  // git history → touches edges + per-module commit provenance + commit metadata
  const touchEdges = [];
  const touchedBy = new Map(); // path -> [git:<sha>]
  const commitIndividuals = [];
  const commitIds = new Set();
  const MSG_CAP = 120;
  const commitInd = (sha, short, c = null) => {
    const attrs = [];
    if (c?.author) attrs.push({ prop: "mgx:commitAuthor", key: "author", value: String(c.author) });
    if (c?.date) attrs.push({ prop: "mgx:commitDate", key: "date", value: String(c.date) });
    if (c?.subject) attrs.push({ prop: "mgx:commitMessage", key: "message", value: String(c.subject).slice(0, MSG_CAP) });
    return { id: `commit:${sha}`, label: short, class: "Commit", derived_from: [], mentions: [], attributes: attrs };
  };
  for (const c of commits) {
    const short = c.sha.slice(0, 12);
    let touchedAny = false;
    for (const f of c.files) {
      if (!modById.has(f)) continue;
      touchEdges.push({ subject: `commit:${c.sha}`, object: modId(f), subjectLabel: short, objectLabel: f });
      if (!touchedBy.has(f)) touchedBy.set(f, []);
      touchedBy.get(f).push(`git:${short}`);
      touchedAny = true;
    }
    // !commitIds.has: a merged multi-repo commit list CAN repeat a sha (two clones of
    // the same project indexed under different names) — one Commit individual per sha.
    if (touchedAny && !commitIds.has(c.sha)) {
      commitIds.add(c.sha);
      commitIndividuals.push(commitInd(c.sha, short, c));
    }
  }

  // symbol-granular history: intersect each commit's changed line ranges with the
  // (current) symbol spans in that file → mgx:touchesSymbol (Commit → CodeEntity).
  const touchSymbolEdges = [];
  const seenSymTouch = new Set();
  for (const c of symbolHistory) {
    const short = c.sha.slice(0, 12);
    for (const [path, ranges] of Object.entries(c.ranges || {})) {
      const syms = symbolSpansByPath.get(path);
      if (!syms || !ranges.length) continue;
      for (const s of syms) {
        if (!ranges.some(([a, b]) => a <= s.end && b >= s.start)) continue;
        const key = `${c.sha}>${s.id}`;
        if (seenSymTouch.has(key)) continue;
        seenSymTouch.add(key);
        touchSymbolEdges.push({ subject: `commit:${c.sha}`, object: s.id, subjectLabel: short, objectLabel: s.label });
        // make sure the commit individual exists (symbol depth may differ from module depth)
        if (!commitIds.has(c.sha)) { commitIds.add(c.sha); commitIndividuals.push(commitInd(c.sha, short, null)); }
      }
    }
  }

  // change-coupling: modules co-changed in the same commit (git co-occurrence) — the
  // "what usually changes together" signal for an editing agent. Undirected, thresholded,
  // capped per node; mega-commits skipped (noise). Each edge carries its co-change count.
  const COCHANGE_MIN = 2;        // co-occur in ≥ N commits
  const COCHANGE_MAX_COMMIT = 50; // skip sweeping refactors (O(n²) noise)
  const COCHANGE_PER_NODE = 12;  // cap neighbours per module
  const pairCount = new Map();   // "a b" (a<b lexical) -> count
  for (const c of commits) {
    const mods = [...new Set((c.files || []).filter((f) => modById.has(f)))];
    if (mods.length < 2 || mods.length > COCHANGE_MAX_COMMIT) continue;
    for (let i = 0; i < mods.length; i += 1) {
      for (let j = i + 1; j < mods.length; j += 1) {
        const [a, b] = mods[i] < mods[j] ? [mods[i], mods[j]] : [mods[j], mods[i]];
        const key = `${a} ${b}`;
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  }
  const cochangeEdges = [];
  const cochangePerNode = new Map();
  for (const [key, n] of [...pairCount.entries()].filter(([, c]) => c >= COCHANGE_MIN).sort((x, y) => y[1] - x[1])) {
    const [a, b] = key.split(" ");
    if ((cochangePerNode.get(a) || 0) >= COCHANGE_PER_NODE || (cochangePerNode.get(b) || 0) >= COCHANGE_PER_NODE) continue;
    cochangePerNode.set(a, (cochangePerNode.get(a) || 0) + 1);
    cochangePerNode.set(b, (cochangePerNode.get(b) || 0) + 1);
    cochangeEdges.push({ subject: modId(a), object: modId(b), subjectLabel: a, objectLabel: b, weight: n });
  }

  // re-exports / public API: a module's literal __all__ entries, resolved to the symbol
  // they expose — either defined locally, or re-exported from an imported internal module.
  // Answers "where is X importable from" and makes __init__ re-export hubs explicit.
  const reExportEdges = [];
  const seenReExport = new Set();
  for (const m of modules) {
    if (!m.exports || !m.exports.length) continue;
    const imports = internalImports(m);
    for (const name of m.exports) {
      let object = null;
      if (seenFn.has(fnId(m.path, name))) {
        object = fnId(m.path, name); // exported a locally-defined symbol
      } else {
        const defs = nameToPaths.get(name);
        if (defs && defs.size === 1) {
          const target = [...defs][0];
          if (imports.has(target)) object = fnId(target, name); // true re-export from an imported module
        }
      }
      if (!object) continue;
      const key = `${m.path}>${object}`;
      if (seenReExport.has(key)) continue;
      seenReExport.add(key);
      reExportEdges.push({ subject: modId(m.path), object, subjectLabel: m.path, objectLabel: name });
    }
  }

  const moduleIndividuals = modules.map((m) => ({
    id: modId(m.path), label: m.path, class: "Module",
    derived_from: touchedBy.get(m.path) || [], mentions: [],
    attributes: [
      { prop: "mgx:dotted", key: "dotted", value: m.dotted || "" },
      // Literal __all__ membership (the public-API surface a new sibling must JOIN to be
      // importable). Stored even when entries don't resolve to a symbol, so seon_context
      // can always tell the agent "this module has an __all__ — add your symbol".
      ...(m.exports?.length ? [{ prop: "mgx:exportsAll", key: "all", value: m.exports.join(", ") }] : []),
    ],
  }));

  const rel = (predicate, prop, edges) => ({ predicate, prop, count: edges.length, examples: edges });
  const countClass = (c) => fnIndividuals.filter((i) => i.class === c).length;
  const sampleClass = (c) => fnIndividuals.filter((i) => i.class === c).slice(0, 3).map((i) => i.label);

  // Second pass (PLAN_PROSE_INDEX.md) — see the returned `proseIndex` field's comment below.
  const allIndividuals = attachProseTokens(
    [...moduleIndividuals, ...fnIndividuals, ...commitIndividuals], { enabled: prose },
  );
  const proseIndex = prose ? buildProseIndex(allIndividuals) : {};

  return {
    generated_at: generatedAt,
    // SEON (se-on.org, FAMIX-derived) vocabulary + our `mgx:` extension, documented
    // for readers; the graph is JSON-label-only (no RDF store — see PLAN_SEON_RDF.md).
    prefixes: {
      seon: "http://se-on.org/ontologies/seon.owl#",
      mgx: "urn:tmct:mgx#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    },
    vocabulary: [
      { prop: "mgx:importsNamespace", predicate: "imports", note: "module→module; SEON usesComplexType is type→type, so owned (cf. main:dependsOn)" },
      { prop: "mgx:callsCoarse", predicate: "calls", note: "module→module, import-backed; NOT SEON's method→method invokesMethod" },
      { prop: "mgx:callsSymbol", predicate: "callsSymbol", note: "caller fn/method→callee fn/class; symbol-granular, unique-name-resolved (Group A); cf. seon:invokesMethod" },
      { prop: "seon:declaresMethod", predicate: "defines" },
      { prop: "seon:containsCodeEntity", predicate: "contains" },
      { prop: "mgx:touchedByCommit", predicate: "touches", note: "owned; seon:history is not a real SEON property (cf. history:isCommittedIn)" },
      { prop: "mgx:touchesSymbol", predicate: "touchesSymbol", note: "Commit→CodeEntity; changed-line-range ∩ symbol span; owned (cf. seon-hist)" },
      { prop: "mgx:commitAuthor", note: "commit author name (%an)" },
      { prop: "mgx:commitDate", note: "commit author date, ISO-8601 (%aI)" },
      { prop: "mgx:commitMessage", note: "commit subject line (%s), capped to 120 chars" },
      { prop: "mgx:testsCoverage", predicate: "tests", note: "no SEON term — our extension" },
      { prop: "seon:hasSuperType", predicate: "inherits" },
      { prop: "mgx:changeCoupledWith", predicate: "cochange", note: "git co-change; owned (no SEON term; cf. domain-spanning change-couplings.owl)" },
      { prop: "mgx:reExports", predicate: "reexports", note: "public API / re-export surface (__all__); owned, no SEON term" },
      { prop: "mgx:exportsAll", note: "literal __all__ membership list on a module (the public surface a new sibling must join)" },
      { prop: "mgx:decorator", note: "Python/framework decorators — our extension" },
      { prop: "seon:hasParameter", note: "formal parameter list (signature string, ast.unparse of the args)" },
      { prop: "seon:hasReturnType", note: "return ANNOTATION string only (not a resolved type — that is Group B)" },
      { prop: "seon:throwsException", note: "exception names from `raise` statements (literal, not resolved)" },
      { prop: "seon:catchesException", note: "exception types from `except` handlers" },
      { prop: "seon:accessesField", note: "self.<field> names a method touches (self-scoped only — honest)" },
      { prop: "seon:isStatic", note: "@staticmethod/@classmethod" },
      { prop: "seon:isAbstract", note: "@abstractmethod/@abstractproperty" },
      { prop: "seon:isConstant", note: "ALL_CAPS module global" },
      { prop: "seon:subKind", note: "type flavour on a Class define when not a plain class (interface/enum/struct/record); kind stays class" },
      { prop: "seon:hasAccessModifier", note: "visibility from leading underscore (private/protected); public omitted" },
      { prop: "seon:hasDoc", note: "first docstring line (capped) — one-line purpose without the body" },
    ],
    classes: [
      { name: "Module", count: moduleIndividuals.length, sample: moduleIndividuals.slice(0, 3).map((i) => i.label) },
      { name: "Class", count: countClass("Class"), sample: sampleClass("Class") },
      { name: "Function", count: countClass("Function"), sample: sampleClass("Function") },
      { name: "Method", count: countClass("Method"), sample: sampleClass("Method") },
      { name: "Attribute", count: countClass("Attribute"), sample: sampleClass("Attribute") },
      { name: "GlobalVariable", count: countClass("GlobalVariable"), sample: sampleClass("GlobalVariable") },
      { name: "Commit", count: commitIndividuals.length, sample: commitIndividuals.slice(0, 3).map((i) => i.label) },
    ],
    objectProperties: [
      rel("imports", "mgx:importsNamespace", importEdges),
      rel("calls", "mgx:callsCoarse", callEdges),
      rel("callsSymbol", "mgx:callsSymbol", callSymbolEdges),
      rel("tests", "mgx:testsCoverage", testEdges),
      rel("defines", "seon:declaresMethod", definesEdges),
      rel("touches", "mgx:touchedByCommit", touchEdges),
      rel("touchesSymbol", "mgx:touchesSymbol", touchSymbolEdges),
      rel("contains", "seon:containsCodeEntity", containsEdges),
      rel("inherits", "seon:hasSuperType", inheritsEdges),
      rel("cochange", "mgx:changeCoupledWith", cochangeEdges),
      rel("reexports", "mgx:reExports", reExportEdges),
    ],
    individuals: allIndividuals,
    // Second pass (PLAN_PROSE_INDEX.md): word -> [individual ids], inverted from the
    // `prose_tokens` attribute attachProseTokens just attached. Disable via
    // TMCT_PROSE_INDEX=0 (indexRepository, below) — {} when off. The typed graph above
    // (individuals' core fields, all edges) is byte-identical either way.
    proseIndex,
  };
}
