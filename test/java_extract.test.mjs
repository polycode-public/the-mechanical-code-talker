// Java extractor tests. Both backends emit the SAME
// `{modules:[{path,dotted,imports,defines,calls,exports}]}` contract every other
// language extractor (and extract_ast.py) prints, so extract.mjs/buildEntities +
// codegraph.mjs/digest consume them unchanged.
//
//   * JavaParser + JavaSymbolSolver (PICKED): needs a `java` runtime + the vendored
//     fat-jar; resolves in-repo/JDK call targets to fully-qualified names. Skips
//     gracefully when either is absent (mirrors the C#/Roslyn test).
//   * tree-sitter-java (FALLBACK): pure-CST, no JDK; syntax-level call names. Skips
//     gracefully when the optional native grammar isn't installed.
//
// The fallback is asserted to yield the SAME module set + define names as the
// picked backend (syntax-level parity), only differing in call *resolution*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as javaJavaparser from "../src/java_javaparser.mjs";
import * as javaTree from "../src/java_treesitter.mjs";
import { buildEntities } from "../src/extract.mjs";
import { REGISTRY, LANG_EXTS, ingestRepo } from "../src/extract_lang.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures", "java");

const haveJavaparser = await javaJavaparser.toolAvailable();
const haveTree = javaTree.toolAvailable();

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
    assert.ok(["function", "method", "class", "attribute", "global"].includes(d.kind), `valid kind: ${d.kind}`);
    assert.equal(typeof d.lineno, "number");
    assert.ok(Array.isArray(d.decorators), "define.decorators is an array");
  }
}

const byPath = (mods) => Object.fromEntries(mods.map((m) => [m.path, m]));
const defName = (m, name) => m.defines.find((d) => d.name === name);

test("REGISTRY: Java is registered with the JavaParser pick + tree-sitter alt", () => {
  assert.ok(REGISTRY["java"], "java registered");
  assert.equal(REGISTRY["java"].pick, javaJavaparser, "pick is JavaParser backend");
  assert.equal(REGISTRY["java"].alt, javaTree, "alt is tree-sitter backend");
  assert.deepEqual(REGISTRY["java"].exts, [".java"]);
  assert.equal(typeof REGISTRY["java"].pick.ingest, "function");
  assert.equal(typeof REGISTRY["java"].pick.meta.lib, "string");
  assert.ok(LANG_EXTS.includes(".java"), "LANG_EXTS surfaces .java");
});

test("JavaParser: modules contract + resolved cross-file calls, bases, decorators",
  { skip: !haveJavaparser ? "needs a `java` runtime + vendored fat-jar" : false }, async () => {
    const a = await javaJavaparser.ingest(FIX);
    const b = await javaJavaparser.ingest(FIX);
    assert.deepEqual(a, b, "Java extraction is deterministic");

    assert.equal(a.fileCount, 6, "6 .java fixture files");
    assert.equal(a.failures.length, 0, "no parse failures over the fixture");
    for (const m of a.modules) assertModuleContract(m);

    const mods = byPath(a.modules);

    // class + package -> dotted
    const shape = mods["com/acme/shapes/Shape.java"];
    assert.ok(shape, "Shape.java parsed");
    assert.equal(shape.dotted, "com.acme.shapes.Shape", "package + type -> dotted");
    assert.ok(defName(shape, "Shape"), "abstract class captured");
    assert.ok(defName(shape, "Shape.describe"), "method captured (Class.method form)");
    assert.ok(defName(shape, "Shape.name"), "field captured as attribute");
    assert.equal(defName(shape, "Shape.name").visibility, "protected", "field visibility captured");

    // subclass: extends base + implemented interface + @Override decorator
    const circle = mods["com/acme/shapes/Circle.java"];
    assert.ok((defName(circle, "Circle").bases || []).includes("Shape"), "extends base captured");
    assert.ok((defName(circle, "Circle").bases || []).includes("Drawable"), "implements base captured");
    assert.deepEqual(defName(circle, "Circle.area").decorators, ["@Override"], "@Override -> decorator");

    // interface: kind stays class, flavour goes to subkind; javadoc surfaces as doc
    const drawable = mods["com/acme/shapes/Drawable.java"];
    assert.equal(defName(drawable, "Drawable").kind, "class", "interface keeps kind class");
    assert.equal(defName(drawable, "Drawable").subkind, "interface", "interface flavour -> subkind");
    assert.equal(defName(drawable, "Drawable").doc, "Something that can be drawn onto a canvas.", "javadoc captured");
    assert.ok(defName(drawable, "Drawable.label"), "default method captured");

    // CROSS-FILE resolved call: Renderer.render -> Shape.describe (SymbolSolver)
    const renderer = mods["com/acme/shapes/Renderer.java"];
    const render = defName(renderer, "Renderer.render");
    assert.ok(render.calls.includes("com.acme.shapes.Shape.describe"),
      `resolved in-repo call target: ${render.calls.join(", ")}`);
    assert.ok(renderer.imports.includes("java.util.List"), "import captured");

    // nested type: Outer.Inner qualification + members under the qualified name
    const frame = defName(renderer, "Renderer.Frame");
    assert.ok(frame && frame.kind === "class", "nested class captured as Renderer.Frame");
    assert.equal(frame.subkind, undefined, "plain nested class carries no subkind");
    assert.ok(defName(renderer, "Renderer.Frame.content"), "nested class field qualified");
    // object creation resolves to the created type: `new Frame(...)` in snapshot
    assert.ok(defName(renderer, "Renderer.snapshot").calls.includes("com.acme.shapes.Renderer.Frame"),
      `resolved object-creation target: ${defName(renderer, "Renderer.snapshot").calls.join(", ")}`);

    // record: components -> attributes, JDK call resolved
    const point = mods["com/acme/shapes/Point.java"];
    assert.ok(defName(point, "Point"), "record captured as class");
    assert.ok(defName(point, "Point.x") && defName(point, "Point.y"), "record components -> attributes");
    assert.ok(defName(point, "Point.distanceTo").calls.includes("java.lang.Math.sqrt"), "JDK call resolved");

    // enum: kind class + subkind enum; constants surface as is_constant attributes
    const status = mods["com/acme/shapes/Status.java"];
    assert.ok(defName(status, "Status"), "enum captured as class");
    assert.equal(defName(status, "Status").subkind, "enum", "enum flavour -> subkind");
    assert.equal(defName(status, "Status.ACTIVE")?.is_constant, true, "enum constant -> is_constant attribute");
    assert.ok(status.exports.includes("Status"), "public type exported");
  });

test("JavaParser modules round-trip through buildEntities",
  { skip: !haveJavaparser ? "needs a `java` runtime + vendored fat-jar" : false }, async () => {
    const { modules } = await javaJavaparser.ingest(FIX);
    const e = buildEntities(modules, [], { generatedAt: "t" });
    assert.ok(e.individuals.some((i) => i.class === "Class" && i.label === "Shape"));
    const contains = e.objectProperties.find((g) => g.predicate === "contains");
    assert.ok(contains.examples.some((x) => x.objectLabel === "describe"), "Shape contains describe()");
  });

test("tree-sitter fallback: same module set + define names at syntax level",
  { skip: !haveTree ? "needs optional tree-sitter-java grammar" : false }, async () => {
    const a = await javaTree.ingest(FIX);
    const b = await javaTree.ingest(FIX);
    assert.deepEqual(a, b, "tree-sitter Java extraction is deterministic");

    assert.equal(a.fileCount, 6, "6 .java fixture files");
    assert.equal(a.failures.length, 0, "no parse failures over the fixture");
    for (const m of a.modules) assertModuleContract(m);

    const mods = byPath(a.modules);
    // bases / decorators captured syntactically (no resolver needed)
    const circle = mods["com/acme/shapes/Circle.java"];
    assert.ok((defName(circle, "Circle").bases || []).includes("Shape"), "extends base captured (CST)");
    assert.deepEqual(defName(circle, "Circle.area").decorators, ["@Override"], "@Override -> decorator (CST)");
    // syntax-level (unresolved) call name only
    const renderer = mods["com/acme/shapes/Renderer.java"];
    assert.ok(defName(renderer, "Renderer.render").calls.includes("describe"), "syntax-level call name");

    // PARITY: same module paths + same define-name set as the JavaParser backend
    if (haveJavaparser) {
      const jp = byPath((await javaJavaparser.ingest(FIX)).modules);
      assert.deepEqual(Object.keys(mods).sort(), Object.keys(jp).sort(), "same module set");
      for (const p of Object.keys(mods)) {
        const treeNames = mods[p].defines.map((d) => d.name).sort();
        const jpNames = jp[p].defines.map((d) => d.name).sort();
        assert.deepEqual(treeNames, jpNames, `same define names for ${p}`);
      }
    }
  });

test("ingestRepo: Java language merges + reports per-language stats",
  { skip: (!haveJavaparser && !haveTree) ? "no Java backend available" : false }, async () => {
    const r = await ingestRepo(FIX);
    assert.ok(r.totalFiles >= 5, "java files parsed");
    for (const m of r.modules) assertModuleContract(m);
    assert.ok(r.perLang["java"], "java language stats present");
    assert.ok(r.perLang["java"].symbols > 0, "java symbols counted");
    assert.ok(r.modules.some((m) => m.path === "com/acme/shapes/Shape.java"), "Java module merged");
  });
