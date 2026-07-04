// Multi-language extractor tests. Each language extractor must emit the SAME
// `{modules:[{path,dotted,imports,defines,calls,exports}]}` contract extract_ast.py
// prints, so extract.mjs/buildEntities + codegraph.mjs/digest consume it unchanged.
// TS (the `typescript` compiler API) always runs (pure-JS dep). C# (Roslyn) needs the dotnet runtime +
// the vendored tool; it skips gracefully when either is absent (mirrors extract.test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as jstsTsc from "../src/jsts_tsc.mjs";
import * as csRoslyn from "../src/cs_roslyn.mjs";
import * as csTree from "../src/cs_treesitter.mjs";
import { buildEntities } from "../src/graph-build.mjs";
import { REGISTRY, LANG_EXTS, ingestRepo } from "../src/extract_lang.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures", "lang");

const haveDotnet = spawnSync("dotnet", ["--version"], { stdio: "ignore" }).status === 0;
const haveTree = csTree.toolAvailable();

/** Assert a module object satisfies the per-extractor contract. */
function assertModuleContract(m) {
  assert.equal(typeof m.path, "string");
  assert.ok(m.path.length > 0, "module has a path");
  assert.equal(typeof m.dotted, "string");
  assert.ok(Array.isArray(m.imports), "imports is an array");
  assert.ok(Array.isArray(m.defines), "defines is an array");
  assert.ok(Array.isArray(m.calls), "calls is an array");
  assert.ok(Array.isArray(m.exports), "exports is an array");
  for (const d of m.defines) {
    assert.equal(typeof d.name, "string");
    assert.equal(typeof d.kind, "string");
    assert.equal(typeof d.lineno, "number");
    assert.ok(Array.isArray(d.decorators), "define.decorators is an array");
  }
}

test("REGISTRY + LANG_EXTS: every registered language contributes its extensions", () => {
  assert.ok(REGISTRY["js/ts"], "js/ts registered");
  assert.ok(REGISTRY["c#"], "c# registered");
  // pick extractors expose the ingest/meta surface ingestRepo relies on
  for (const r of Object.values(REGISTRY)) {
    assert.equal(typeof r.pick.ingest, "function");
    assert.equal(typeof r.pick.meta.lib, "string");
  }
  // LANG_EXTS is the sorted union of every language's extensions (no Python here)
  const union = [...new Set(Object.values(REGISTRY).flatMap((r) => r.exts))].sort();
  assert.deepEqual(LANG_EXTS, union);
  assert.ok(LANG_EXTS.includes(".ts") && LANG_EXTS.includes(".cs"));
  assert.ok(!LANG_EXTS.includes(".py"), "Python is extract_ast.py's job, not the lang front-end");
});

test("TS extractor: emits the modules contract + key symbols (deterministic)", async () => {
  const a = await jstsTsc.ingest(FIX);
  const b = await jstsTsc.ingest(FIX);
  assert.deepEqual(a, b, "ts extraction is deterministic");

  assert.ok(a.modules.length > 0, "at least one TS module");
  assert.equal(a.failures.length, 0, "no parse failures over the fixture");
  for (const m of a.modules) assertModuleContract(m);

  const ts = a.modules.find((m) => m.path === "sample.ts");
  assert.ok(ts, "sample.ts parsed");
  const names = ts.defines.map((d) => d.name);
  assert.ok(names.includes("loadRepo"), "top-level function captured");
  assert.ok(names.includes("RepoStore"), "class captured");
  assert.ok(names.includes("RepoStore.add"), "method captured (Class.method form)");
  assert.ok(names.includes("MAX_RETRIES"), "exported const global captured");
  // interface maps to a Class node (type surface)
  assert.ok(ts.defines.some((d) => d.name === "Repo" && d.kind === "class"));
  // relative import is path-resolved; bare import kept as-is
  assert.ok(ts.imports.includes("node:fs/promises"), "external import kept");
  assert.ok(ts.imports.some((i) => i.startsWith("helpers")), "relative import resolved");
  // public surface exported
  assert.ok(ts.exports.includes("loadRepo") && ts.exports.includes("RepoStore"));
});

test("CJS pass: top-level require() → imports (literal only); module.exports/exports.name → exports", async () => {
  const { modules, failures } = await jstsTsc.ingest(FIX);
  assert.equal(failures.length, 0);
  const cjs = modules.find((m) => m.path === "sample.cjs");
  assert.ok(cjs, "sample.cjs parsed");

  // require chains — bare externals kept as-is; relative specifiers resolved like ESM ones
  // (path base + the /index dir-fallback), across var/const, destructuring, member access,
  // and bare side-effect forms.
  assert.ok(cjs.imports.includes("node:fs"), "bare external require kept");
  assert.ok(cjs.imports.includes("helpers") && cjs.imports.includes("helpers/index"), "relative require resolved (+/index)");
  assert.ok(cjs.imports.includes("util/pair"), "destructuring require resolved");
  assert.ok(cjs.imports.includes("deep"), "require('./x').member resolved");
  assert.ok(cjs.imports.includes("side-effect"), "bare side-effect require resolved");
  // the non-literal require(which) must be skipped, never guessed ("no wrong edge")
  assert.ok(!cjs.imports.some((i) => /dynamic|which/.test(i)), "non-literal require skipped");

  // exports — module.exports = X (via an exports = module.exports = X chain) mirrors ESM's
  // default; module.exports.name / exports.name mirror named exports. Sorted like ESM's.
  assert.deepEqual(cjs.exports, ["default", "pairOne", "pairTwo"]);

  // ordinary defines still captured on a CJS file
  assert.ok(cjs.defines.some((d) => d.name === "combinePair" && d.kind === "function"));
});

test("CJS pass leaves ESM-only extraction unchanged (sample.ts emits no CJS artifacts)", async () => {
  const { modules } = await jstsTsc.ingest(FIX);
  const ts = modules.find((m) => m.path === "sample.ts");
  // exact pins: the full import + export surface of the ESM fixture, byte-for-byte the
  // pre-CJS-pass output (captured 2026-07-02 before the pass landed) — a CJS regression
  // that leaked anything into an ESM module would break these.
  assert.deepEqual(ts.imports, ["helpers", "helpers/index", "node:fs/promises"]);
  assert.deepEqual(ts.exports, ["MAX_RETRIES", "Repo", "RepoStore", "loadRepo"]);
});

test("TS modules round-trip through buildEntities (same graph contract)", async () => {
  const { modules } = await jstsTsc.ingest(FIX);
  const e = buildEntities(modules, [], { generatedAt: "t" });
  // defines edges for the TS symbols + a Class individual for RepoStore
  const defines = e.objectProperties.find((g) => g.predicate === "defines");
  assert.ok(defines.count > 0, "TS symbols produce defines edges");
  assert.ok(e.individuals.some((i) => i.class === "Class" && i.label === "RepoStore"));
  // containment: RepoStore contains its methods (Class → Method)
  const contains = e.objectProperties.find((g) => g.predicate === "contains");
  assert.ok(contains.examples.some((x) => x.objectLabel === "add"), "RepoStore contains add()");
});

test("C# extractor (Roslyn): modules contract + key symbols", { skip: !haveDotnet ? "needs dotnet runtime" : false }, async () => {
  if (!(await csRoslyn.toolAvailable())) { assert.ok(true, "roslyn tool not vendored — skipped"); return; }
  const a = await csRoslyn.ingest(FIX);
  const b = await csRoslyn.ingest(FIX);
  assert.deepEqual(a, b, "C# extraction is deterministic");

  assert.ok(a.modules.length > 0, "at least one C# module");
  assert.equal(a.failures.length, 0, "no parse failures over the fixture");
  for (const m of a.modules) assertModuleContract(m);

  const cs = a.modules.find((m) => m.path === "sample.cs");
  assert.ok(cs, "sample.cs parsed");
  assert.equal(cs.dotted, "Acme.Repos", "primary namespace becomes dotted");
  const names = cs.defines.map((d) => d.name);
  assert.ok(names.includes("RepoStore"), "class captured");
  assert.ok(names.includes("RepoStore.Add"), "method captured (Class.method form)");
  assert.ok(names.includes("Repo.Id"), "property captured as attribute");
  // inheritance base surfaced on the class define
  const repoStore = cs.defines.find((d) => d.name === "RepoStore" && d.kind === "class");
  assert.ok((repoStore.bases || []).includes("IRepoStore"), "base list captured");
  assert.equal(repoStore.subkind, undefined, "plain class carries no subkind");
  // using directives become imports
  assert.ok(cs.imports.includes("System"), "using directive → import");

  const def = (name) => cs.defines.find((d) => d.name === name);
  // enum: kind stays class, flavour goes to subkind; members -> is_constant attributes
  assert.equal(def("RepoKind")?.kind, "class", "enum captured as class");
  assert.equal(def("RepoKind")?.subkind, "enum", "enum flavour -> subkind");
  assert.equal(def("RepoKind.Git")?.is_constant, true, "enum member -> is_constant attribute");
  // interface flavour
  assert.equal(def("IRepoStore")?.subkind, "interface", "interface flavour -> subkind");
  // nested type: Outer.Inner qualification + members under the qualified name
  assert.ok(def("RepoStore.CacheEntry")?.kind === "class", "nested class captured as RepoStore.CacheEntry");
  assert.ok(def("RepoStore.CacheEntry.Value"), "nested class property qualified");
  // XML doc comments: first line, tags stripped
  assert.equal(def("Repo")?.doc, "A repository record.", "type XML doc captured");
  assert.equal(def("RepoStore.Add")?.doc, "Adds a repository to the store.", "method XML doc captured");
  // object creation counts as a call to the created type (`new Repo { … }` in LoadAsync)
  assert.ok(def("RepoStore.LoadAsync")?.calls.includes("Repo"), "object creation -> call to created type");
});

test("C# tree-sitter fallback: same module set + define names as Roslyn (syntax parity)",
  { skip: !haveTree ? "needs optional tree-sitter-c-sharp grammar" : false }, async () => {
    const a = await csTree.ingest(FIX);
    const b = await csTree.ingest(FIX);
    assert.deepEqual(a, b, "tree-sitter C# extraction is deterministic");
    assert.equal(a.failures.length, 0, "no parse failures over the fixture");
    for (const m of a.modules) assertModuleContract(m);

    const cs = a.modules.find((m) => m.path === "sample.cs");
    assert.ok(cs, "sample.cs parsed");
    const def = (name) => cs.defines.find((d) => d.name === name);
    assert.equal(def("RepoKind")?.subkind, "enum", "enum flavour -> subkind (CST)");
    assert.equal(def("RepoKind.Git")?.is_constant, true, "enum member -> is_constant attribute (CST)");
    assert.equal(def("IRepoStore")?.subkind, "interface", "interface flavour -> subkind (CST)");
    assert.ok(def("RepoStore.CacheEntry"), "nested class captured as RepoStore.CacheEntry (CST)");

    // PARITY: same module paths + same define-name set as the Roslyn backend
    // (mirrors the Java parity block in java_extract.test.mjs)
    if (haveDotnet && (await csRoslyn.toolAvailable())) {
      const byPath = (mods) => Object.fromEntries(mods.map((m) => [m.path, m]));
      const ts = byPath(a.modules);
      const ro = byPath((await csRoslyn.ingest(FIX)).modules);
      assert.deepEqual(Object.keys(ts).sort(), Object.keys(ro).sort(), "same module set");
      for (const p of Object.keys(ts)) {
        const treeNames = ts[p].defines.map((d) => d.name).sort();
        const roslynNames = ro[p].defines.map((d) => d.name).sort();
        assert.deepEqual(treeNames, roslynNames, `same define names for ${p}`);
      }
    }
  });

test("C# modules round-trip through buildEntities", { skip: !haveDotnet ? "needs dotnet runtime" : false }, async () => {
  if (!(await csRoslyn.toolAvailable())) { assert.ok(true, "roslyn tool not vendored — skipped"); return; }
  const { modules } = await csRoslyn.ingest(FIX);
  const e = buildEntities(modules, [], { generatedAt: "t" });
  assert.ok(e.individuals.some((i) => i.class === "Class" && i.label === "RepoStore"));
  const contains = e.objectProperties.find((g) => g.predicate === "contains");
  assert.ok(contains.examples.some((x) => x.objectLabel === "Add"), "RepoStore contains Add()");
});

test("ingestRepo: merges every present language + reports per-language stats", async () => {
  const r = await ingestRepo(FIX);
  assert.ok(r.totalFiles >= 1, "files parsed");
  for (const m of r.modules) assertModuleContract(m);
  // js/ts is always present (typescript compiler API); c# only when the dotnet+tool path is available
  assert.ok(r.perLang["js/ts"], "js/ts language stats present");
  assert.ok(r.perLang["js/ts"].symbols > 0, "js/ts symbols counted");
  assert.ok(r.modules.some((m) => m.path === "sample.ts"), "TS module merged");
  if (haveDotnet && (await csRoslyn.toolAvailable())) {
    assert.ok(r.perLang["c#"], "c# language stats present");
    assert.ok(r.modules.some((m) => m.path === "sample.cs"), "C# module merged");
  }
});
