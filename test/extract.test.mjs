// Extractor tests: buildEntities() is pure (no fs/process) and tested directly;
// indexRepository() is exercised end-to-end on a tiny temp git repo (gated on
// python3 + git being present — the deterministic toolchain the indexer needs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntities, indexRepository, GIT_LOG_EXCLUDE } from "../src/extract.mjs";

const MODULES = [
  { path: "pkg/a.py", dotted: "pkg.a", imports: [], calls: [],
    defines: [{ name: "helper", kind: "function", lineno: 3, decorators: [] }] },
  { path: "pkg/b.py", dotted: "pkg.b", imports: ["pkg.a"], calls: ["helper"],
    defines: [{ name: "do_b", kind: "function", lineno: 5, decorators: ["register.filter"] }] },
  { path: "tests/test_b.py", dotted: "tests.test_b", imports: ["pkg.b"], calls: [], defines: [] },
];
const COMMITS = [{ sha: "abcdef1234567890", files: ["pkg/a.py"] }];

function rel(entities, prop) {
  return entities.objectProperties.find((g) => g.prop === prop);
}

test("buildEntities: typed edges, provenance, individuals", () => {
  const e = buildEntities(MODULES, COMMITS, { generatedAt: "t" });

  // imports: pkg/b imports pkg/a (test module's import is NOT an import edge)
  const imports = rel(e, "mgx:importsNamespace");
  assert.deepEqual(imports.examples.map((x) => [x.subject, x.object]), [["mod:pkg/b.py", "mod:pkg/a.py"]]);

  // tests: the test module → the internal module it imports
  const tests = rel(e, "mgx:testsCoverage");
  assert.deepEqual(tests.examples.map((x) => [x.subject, x.object]), [["mod:tests/test_b.py", "mod:pkg/b.py"]]);

  // defines: both top-level functions
  assert.equal(rel(e, "seon:declaresMethod").count, 2);

  // calls: b calls helper, defined in exactly one IMPORTED module (pkg/a) → edge b→a
  const calls = rel(e, "mgx:callsCoarse");
  assert.deepEqual(calls.examples.map((x) => [x.subject, x.object]), [["mod:pkg/b.py", "mod:pkg/a.py"]]);

  // touches: commit → pkg/a; module carries git provenance
  const touches = rel(e, "mgx:touchedByCommit");
  assert.deepEqual(touches.examples.map((x) => x.object), ["mod:pkg/a.py"]);
  const modA = e.individuals.find((i) => i.id === "mod:pkg/a.py");
  assert.deepEqual(modA.derived_from, ["git:abcdef123456"]);

  // function individuals carry file:line provenance + decorators
  const helper = e.individuals.find((i) => i.id === "fn:pkg/a.py#helper");
  assert.equal(helper.class, "Function");
  assert.ok(helper.attributes.some((a) => a.value === "pkg/a.py:3"));
  const doB = e.individuals.find((i) => i.id === "fn:pkg/b.py#do_b");
  assert.ok(doB.attributes.some((a) => a.key === "decorators" && a.value.includes("register.filter")));
});

test("buildEntities: ambiguous call names are dropped (honest, no wrong edge)", () => {
  const mods = [
    { path: "x.py", dotted: "x", imports: ["y", "z"], calls: ["dup"], defines: [] },
    { path: "y.py", dotted: "y", imports: [], calls: [], defines: [{ name: "dup", kind: "function", lineno: 1, decorators: [] }] },
    { path: "z.py", dotted: "z", imports: [], calls: [], defines: [{ name: "dup", kind: "function", lineno: 1, decorators: [] }] },
  ];
  // "dup" defined in TWO modules → ambiguous → no call edge emitted.
  assert.equal(rel(buildEntities(mods, []), "mgx:callsCoarse").count, 0);
});

test("buildEntities: classes get Method/Attribute individuals + contains + inherits", () => {
  const mods = [
    { path: "pkg/base.py", dotted: "pkg.base", imports: [], calls: [],
      defines: [{ name: "Base", kind: "class", lineno: 1, end_lineno: 2, bases: [], decorators: [] }] },
    { path: "pkg/widget.py", dotted: "pkg.widget", imports: ["pkg.base"], calls: [],
      defines: [
        { name: "Widget", kind: "class", lineno: 1, end_lineno: 20, bases: ["Base"], decorators: [] },
        { name: "Widget.render", kind: "method", lineno: 5, end_lineno: 9, decorators: ["property"] },
        { name: "Widget.name", kind: "attribute", lineno: 2, end_lineno: 2, decorators: [] },
      ] },
  ];
  const e = buildEntities(mods, []);

  // contains: Widget → its method + attribute (class membership; module→symbol stays `defines`)
  const contains = rel(e, "seon:containsCodeEntity").examples.map((x) => [x.subject, x.object]).sort();
  assert.deepEqual(contains, [
    ["fn:pkg/widget.py#Widget", "fn:pkg/widget.py#Widget.name"],
    ["fn:pkg/widget.py#Widget", "fn:pkg/widget.py#Widget.render"],
  ]);

  // inherits: Widget → Base, resolved to the one internal class id
  const inherits = rel(e, "seon:hasSuperType").examples.map((x) => [x.subject, x.object]);
  assert.deepEqual(inherits, [["fn:pkg/widget.py#Widget", "fn:pkg/base.py#Base"]]);

  // method + attribute are first-class individuals with sites/decorators
  const render = e.individuals.find((i) => i.id === "fn:pkg/widget.py#Widget.render");
  assert.equal(render.class, "Method");
  assert.ok(render.attributes.some((a) => a.value === "pkg/widget.py:5-9"));
  assert.ok(render.attributes.some((a) => a.key === "decorators" && a.value.includes("property")));
  assert.equal(e.individuals.find((i) => i.id === "fn:pkg/widget.py#Widget.name").class, "Attribute");
});

test("buildEntities: external/unresolved base → ext: object, label kept", () => {
  const mods = [
    { path: "m.py", dotted: "m", imports: [], calls: [],
      defines: [{ name: "C", kind: "class", lineno: 1, end_lineno: 2, bases: ["models.Model"], decorators: [] }] },
  ];
  const inh = rel(buildEntities(mods, []), "seon:hasSuperType").examples;
  assert.deepEqual(inh.map((x) => [x.object, x.objectLabel]), [["ext:Model", "models.Model"]]);
});

test("buildEntities: same-module base resolves locally even if the name is globally ambiguous", () => {
  // "Field" defined in two modules → globally ambiguous; CharField(Field) in the same
  // module as one of them must still link to its own module's Field (Python scoping).
  const mods = [
    { path: "forms.py", dotted: "forms", imports: [], calls: [],
      defines: [
        { name: "Field", kind: "class", lineno: 1, end_lineno: 2, bases: [], decorators: [] },
        { name: "CharField", kind: "class", lineno: 4, end_lineno: 5, bases: ["Field"], decorators: [] },
      ] },
    { path: "db.py", dotted: "db", imports: [], calls: [],
      defines: [{ name: "Field", kind: "class", lineno: 1, end_lineno: 2, bases: [], decorators: [] }] },
  ];
  const inh = rel(buildEntities(mods, []), "seon:hasSuperType").examples;
  assert.deepEqual(inh.map((x) => [x.subject, x.object]), [["fn:forms.py#CharField", "fn:forms.py#Field"]]);
});

test("buildEntities: module-level globals become GlobalVariable individuals with value + defines edge", () => {
  const mods = [
    { path: "df.py", dotted: "df", imports: [], calls: [],
      defines: [
        { name: "register", kind: "global", lineno: 3, end_lineno: 3, decorators: [], value: "template.Library()" },
        { name: "lower", kind: "function", lineno: 5, end_lineno: 6, decorators: ["register.filter"] },
      ] },
  ];
  const e = buildEntities(mods, []);
  const reg = e.individuals.find((i) => i.id === "fn:df.py#register");
  assert.equal(reg.class, "GlobalVariable");
  assert.ok(reg.attributes.some((a) => a.key === "value" && a.value === "template.Library()"));
  // a Module→global defines edge so seonix_search / seonix_context surface it
  assert.ok(rel(e, "seon:declaresMethod").examples.some((x) => x.object === "fn:df.py#register" && x.objectLabel === "register"));
});

test("buildEntities: change-coupling from co-committed modules (weighted, thresholded)", () => {
  const mods = [
    { path: "a.py", dotted: "a", imports: [], calls: [], defines: [] },
    { path: "b.py", dotted: "b", imports: [], calls: [], defines: [] },
    { path: "c.py", dotted: "c", imports: [], calls: [], defines: [] },
  ];
  const commits = [
    { sha: "1".repeat(40), files: ["a.py", "b.py"] },
    { sha: "2".repeat(40), files: ["a.py", "b.py"] }, // a,b co-change ×2 → edge
    { sha: "3".repeat(40), files: ["a.py", "c.py"] }, // a,c only ×1 → below threshold, dropped
  ];
  const cc = rel(buildEntities(mods, commits), "mgx:changeCoupledWith").examples;
  assert.deepEqual(cc.map((e) => [e.subjectLabel, e.objectLabel, e.weight]), [["a.py", "b.py", 2]]);
});

test("buildEntities: __all__ → reExports (local export + re-export from imported module)", () => {
  const mods = [
    { path: "a.py", dotted: "a", imports: [], calls: [], exports: [],
      defines: [{ name: "helper", kind: "function", lineno: 1, end_lineno: 1, decorators: [] }] },
    { path: "api.py", dotted: "api", imports: ["a"], calls: [], exports: ["local_fn", "helper"],
      defines: [{ name: "local_fn", kind: "function", lineno: 1, end_lineno: 1, decorators: [] }] },
  ];
  const re = rel(buildEntities(mods, []), "mgx:reExports").examples;
  assert.deepEqual(re.map((e) => [e.subject, e.object, e.objectLabel]), [
    ["mod:api.py", "fn:api.py#local_fn", "local_fn"], // exported a locally-defined symbol
    ["mod:api.py", "fn:a.py#helper", "helper"],        // re-exported from the imported module
  ]);
});

test("buildEntities: mechanical enrichment attributes (params/raises/catches/self_fields/flags/doc)", () => {
  const mods = [{
    path: "m.py", dotted: "m", imports: [], calls: [],
    defines: [
      { name: "C", kind: "class", lineno: 1, end_lineno: 20, bases: [], decorators: [], doc: "A thing." },
      { name: "C.run", kind: "method", lineno: 3, end_lineno: 9, decorators: ["staticmethod"],
        params: "n=0", returns: "int", raises: ["TypeError", "ValueError"], catches: ["KeyError"],
        self_fields: ["x"], is_static: true, visibility: "protected", doc: "Run it." },
      { name: "MAX", kind: "global", lineno: 22, end_lineno: 22, decorators: [], value: "10", is_constant: true },
    ],
  }];
  const e = buildEntities(mods, []);
  const run = e.individuals.find((i) => i.id === "fn:m.py#C.run");
  const av = (k) => run.attributes.find((x) => x.key === k)?.value;
  assert.equal(av("params"), "n=0");
  assert.equal(av("returns"), "int");
  assert.equal(av("raises"), "TypeError, ValueError");
  assert.equal(av("catches"), "KeyError");
  assert.equal(av("self_fields"), "x");
  assert.equal(av("isStatic"), "true");
  assert.equal(av("visibility"), "protected");
  assert.equal(av("doc"), "Run it.");
  // prop tokens are the cited SEON terms
  assert.ok(run.attributes.some((x) => x.prop === "seon:hasParameter" && x.key === "params"));
  assert.ok(run.attributes.some((x) => x.prop === "seon:throwsException"));
  // ALL_CAPS global flagged constant
  const max = e.individuals.find((i) => i.id === "fn:m.py#MAX");
  assert.ok(max.attributes.some((x) => x.key === "isConstant" && x.value === "true"));
  // class docstring surfaced
  const cls = e.individuals.find((i) => i.id === "fn:m.py#C");
  assert.ok(cls.attributes.some((x) => x.key === "doc" && x.value === "A thing."));
  // vocabulary documents the new tokens
  assert.ok(e.vocabulary.some((v) => v.prop === "seon:hasParameter"));
  assert.ok(e.vocabulary.some((v) => v.prop === "seon:hasDoc"));
});

test("buildEntities: subkind lands as a seon:subKind attribute; `new X()` call names resolve to callsSymbol edges", () => {
  const mods = [
    { path: "store.cs", dotted: "store", imports: [], calls: [],
      defines: [
        { name: "RepoKind", kind: "class", lineno: 1, end_lineno: 3, bases: [], decorators: [], subkind: "enum" },
        { name: "Store", kind: "class", lineno: 5, end_lineno: 20, bases: [], decorators: [] },
        // nested type: dotted define name — its SIMPLE name must still resolve callers
        { name: "Store.Entry", kind: "class", lineno: 6, end_lineno: 8, bases: [], decorators: [] },
        // object creations surface as bare type names in the calls list
        { name: "Store.load", kind: "method", lineno: 10, end_lineno: 12, decorators: [], calls: ["Widget", "Entry"] },
      ] },
    { path: "widget.cs", dotted: "widget", imports: [], calls: [],
      defines: [{ name: "Widget", kind: "class", lineno: 1, end_lineno: 4, bases: [], decorators: [] }] },
  ];
  const e = buildEntities(mods, []);
  // subkind attribute (follows the is_static/is_abstract emission pattern)
  const kind = e.individuals.find((i) => i.id === "fn:store.cs#RepoKind");
  assert.ok(kind.attributes.some((a) => a.prop === "seon:subKind" && a.key === "subkind" && a.value === "enum"));
  assert.ok(!e.individuals.find((i) => i.id === "fn:store.cs#Store").attributes.some((a) => a.key === "subkind"),
    "plain class carries no subkind attribute");
  // `new Widget()` → caller method → Widget Class edge via the unique-name registry
  const cs = rel(e, "mgx:callsSymbol").examples;
  assert.ok(cs.some((x) => x.subject === "fn:store.cs#Store.load" && x.object === "fn:widget.cs#Widget"));
  // `new Entry()` resolves through the nested type's registered simple name → dotted id
  assert.ok(cs.some((x) => x.subject === "fn:store.cs#Store.load" && x.object === "fn:store.cs#Store.Entry"));
});

test("buildEntities: symbol-granular calls — unique in-repo callee resolves, ambiguous/external dropped", () => {
  const mods = [
    { path: "a.py", dotted: "a", imports: [], calls: [],
      defines: [{ name: "helper", kind: "function", lineno: 1, end_lineno: 2, decorators: [] }] },
    { path: "b.py", dotted: "b", imports: ["a"], calls: ["helper"],
      defines: [{ name: "do_b", kind: "function", lineno: 1, end_lineno: 5, decorators: [],
        calls: ["helper", "print", "self.x"] }] }, // print/self.x are external/receiver → dropped
    { path: "dup1.py", dotted: "dup1", imports: [], calls: [],
      defines: [{ name: "dup", kind: "function", lineno: 1, end_lineno: 1, decorators: [] }] },
    { path: "dup2.py", dotted: "dup2", imports: [], calls: [],
      defines: [{ name: "dup", kind: "function", lineno: 1, end_lineno: 1, decorators: [] },
        { name: "caller", kind: "function", lineno: 3, end_lineno: 4, decorators: [], calls: ["dup"] }] },
  ];
  const e = buildEntities(mods, []);
  const cs = rel(e, "mgx:callsSymbol");
  // do_b → helper (single in-repo definition); print/self.x dropped; dup ambiguous (2 defs) → dropped
  assert.deepEqual(cs.examples.map((x) => [x.subject, x.object, x.objectLabel]), [["fn:b.py#do_b", "fn:a.py#helper", "helper"]]);
  // it has its own objectProperties group + a verb predicate
  assert.equal(cs.predicate, "callsSymbol");
});

test("buildEntities: commit metadata attributes (author/date/message, message capped) + Commit individual", () => {
  const sha = "a".repeat(40);
  const commits = [{ sha, author: "Ada Lovelace", date: "2026-01-02T03:04:05+00:00", subject: "M".repeat(200), files: ["a.py"] }];
  const mods = [{ path: "a.py", dotted: "a", imports: [], calls: [],
    defines: [{ name: "foo", kind: "function", lineno: 1, end_lineno: 2, decorators: [] }] }];
  const e = buildEntities(mods, commits);
  const commit = e.individuals.find((i) => i.id === `commit:${sha}`);
  const av = (k) => commit.attributes.find((x) => x.key === k);
  assert.equal(av("author").value, "Ada Lovelace");
  assert.equal(av("author").prop, "mgx:commitAuthor");
  assert.equal(av("date").value, "2026-01-02T03:04:05+00:00");
  assert.equal(av("message").prop, "mgx:commitMessage");
  assert.equal(av("message").value.length, 120, "commit message capped to 120 chars");
});

test("buildEntities: symbol-granular history — changed line ranges ∩ symbol spans → touchesSymbol", () => {
  const sha = "b".repeat(40);
  const mods = [{ path: "a.py", dotted: "a", imports: [], calls: [],
    defines: [
      { name: "foo", kind: "function", lineno: 1, end_lineno: 5, decorators: [] },
      { name: "bar", kind: "function", lineno: 10, end_lineno: 20, decorators: [] },
    ] }];
  const commits = [{ sha, author: "t", date: "d", subject: "s", files: ["a.py"] }];
  const symbolHistory = [{ sha, ranges: { "a.py": [[12, 13]] } }]; // overlaps bar (10-20), not foo (1-5)
  const e = buildEntities(mods, commits, { symbolHistory });
  const ts = rel(e, "mgx:touchesSymbol");
  assert.equal(ts.predicate, "touchesSymbol");
  assert.deepEqual(ts.examples.map((x) => [x.subject, x.object, x.objectLabel]), [[`commit:${sha}`, "fn:a.py#bar", "bar"]]);
  // no symbolHistory → no touchesSymbol edges, but the relation group still exists (empty)
  const e2 = buildEntities(mods, commits);
  assert.equal(rel(e2, "mgx:touchesSymbol").count, 0);
});

test("buildEntities: prose second pass (PLAN_PROSE_INDEX.md) never changes the typed graph", () => {
  // { prose: false } and the default ({ prose: true }) must produce byte-identical
  // typed graphs (individuals' core fields, all edges) — only `prose_tokens`
  // attributes + the `proseIndex` field should differ. Mirrors the
  // SEONIX_HISTORY_SYMBOL_DEPTH=0 disable-flag contract above.
  const withProse = buildEntities(MODULES, COMMITS, { generatedAt: "t" });
  const withoutProse = buildEntities(MODULES, COMMITS, { generatedAt: "t", prose: false });

  assert.ok(withoutProse.individuals.length > 0);
  assert.equal(withProse.individuals.length, withoutProse.individuals.length);
  assert.deepEqual(withProse.objectProperties, withoutProse.objectProperties);
  assert.deepEqual(withProse.classes, withoutProse.classes);

  const stripProse = (individuals) => individuals.map((ind) => ({
    ...ind, attributes: (ind.attributes || []).filter((a) => a.key !== "prose_tokens"),
  }));
  assert.deepEqual(stripProse(withProse.individuals), stripProse(withoutProse.individuals));

  // the disabled pass leaves no prose_tokens attribute anywhere, and an empty index
  assert.deepEqual(withoutProse.proseIndex, {});
  assert.ok(!withoutProse.individuals.some((i) => (i.attributes || []).some((a) => a.key === "prose_tokens")));

  // the enabled pass DOES add prose_tokens + a non-empty inverted index for this fixture
  assert.ok(withProse.individuals.some((i) => (i.attributes || []).some((a) => a.key === "prose_tokens")));
  assert.ok(Object.keys(withProse.proseIndex).length > 0);
  assert.ok(withProse.proseIndex.helper?.includes("fn:pkg/a.py#helper"));
});

const have = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const toolchain = (have("python3") || have("python")) && have("git");

test("indexRepository: end-to-end on a temp git repo", { skip: !toolchain ? "needs python3 + git" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "seon-extract-"));
  try {
    await mkdir(join(dir, "pkg"), { recursive: true });
    await writeFile(join(dir, "pkg", "__init__.py"), "");
    await writeFile(join(dir, "pkg", "a.py"),
      "class Base:\n    pass\n\n\ndef helper(n=0):\n    \"\"\"Return a number.\"\"\"\n    if n < 0:\n        raise ValueError(\"neg\")\n    return 1\n");
    await writeFile(join(dir, "pkg", "b.py"),
      "from pkg.a import helper, Base\n\n\nclass Widget(Base):\n    name = \"w\"\n\n    def render(self):\n        return helper()\n");
    const git = (...a) => spawnSync("git", a, { cwd: dir });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    const { graphFile, counts } = await indexRepository(dir);
    assert.ok(counts.modules >= 3, `expected ≥3 modules, got ${counts.modules}`);
    const e = JSON.parse(await readFile(graphFile, "utf8"));
    const imports = e.objectProperties.find((g) => g.prop === "mgx:importsNamespace");
    assert.ok(
      imports.examples.some((x) => x.subjectLabel === "pkg/b.py" && x.objectLabel === "pkg/a.py"),
      "pkg/b.py should import pkg/a.py",
    );
    const defines = e.objectProperties.find((g) => g.prop === "seon:declaresMethod");
    assert.ok(defines.examples.some((x) => x.objectLabel === "helper"));

    // inheritance: Widget(Base) resolves to the internal Base class id
    const inherits = e.objectProperties.find((g) => g.prop === "seon:hasSuperType");
    assert.ok(
      inherits.examples.some((x) => x.subjectLabel === "Widget" && x.object === "fn:pkg/a.py#Base"),
      "Widget should subclass pkg/a.py#Base",
    );
    // containment: Widget contains its method + attribute
    const contains = e.objectProperties.find((g) => g.prop === "seon:containsCodeEntity");
    assert.ok(contains.examples.some((x) => x.objectLabel === "render"), "Widget should contain render()");
    assert.ok(contains.examples.some((x) => x.objectLabel === "name"), "Widget should contain attribute name");
    assert.ok(e.individuals.some((i) => i.class === "Method" && i.label === "Widget.render"));
    assert.ok(e.individuals.some((i) => i.class === "Attribute" && i.label === "Widget.name"));

    // git history present → a.py carries commit provenance
    const modA = e.individuals.find((i) => i.label === "pkg/a.py");
    assert.ok(modA.derived_from.some((r) => r.startsWith("git:")), "pkg/a.py should have git provenance");

    // mechanical enrichments flow through the real python extractor: helper(n=0) raises
    // ValueError and has a docstring; the param + raise + doc attributes are present.
    const helper = e.individuals.find((i) => i.id === "fn:pkg/a.py#helper");
    const hv = (k) => helper.attributes.find((x) => x.key === k)?.value;
    assert.equal(hv("params"), "n=0");
    assert.match(hv("raises") || "", /ValueError/);
    assert.equal(hv("doc"), "Return a number.");

    // commit metadata captured on the Commit individual (author/date/message)
    const commit = e.individuals.find((i) => i.class === "Commit");
    assert.ok(commit, "a Commit individual exists");
    assert.equal(commit.attributes.find((a) => a.key === "author")?.value, "t");
    assert.ok(commit.attributes.some((a) => a.key === "message" && a.value === "base"));
    assert.ok(commit.attributes.some((a) => a.key === "date" && /^\d{4}-\d\d-\d\d/.test(a.value)));

    // symbol-granular history: the base commit created Widget.render → touchesSymbol edge to it
    const ts = e.objectProperties.find((g) => g.prop === "mgx:touchesSymbol");
    assert.ok(ts, "touchesSymbol relation group present");
    assert.ok(ts.examples.some((x) => x.objectLabel === "Widget.render" || x.object.includes("Widget.render")),
      "the initial commit should touch Widget.render's symbol span");

    // symbol-granular calls: Widget.render calls helper() (single in-repo definition)
    const cs = e.objectProperties.find((g) => g.prop === "mgx:callsSymbol");
    assert.ok(cs.examples.some((x) => x.subject === "fn:pkg/b.py#Widget.render" && x.object === "fn:pkg/a.py#helper"),
      "Widget.render should call pkg/a.py#helper");

    // budget counts surfaced + TOOLS.md catalog written
    assert.ok(Number.isFinite(counts.baseMs) && Number.isFinite(counts.historyMs), "timing counts present");
    assert.ok(counts.touchesSymbol >= 1 && counts.callsSymbol >= 1, "symbol edge counts surfaced");
    const toolsMd = await readFile(join(dir, ".seonix", "TOOLS.md"), "utf8");
    assert.match(toolsMd, /seonix_describe/);
    assert.match(toolsMd, /cli /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexRepository: SEONIX_HISTORY_SYMBOL_DEPTH=0 disables the symbol-history pass",
  { skip: !toolchain ? "needs python3 + git" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "seon-budget-"));
  const prev = process.env.SEONIX_HISTORY_SYMBOL_DEPTH;
  try {
    await writeFile(join(dir, "a.py"), "def foo():\n    return 1\n");
    const git = (...a) => spawnSync("git", a, { cwd: dir });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    git("add", "-A"); git("commit", "-q", "-m", "base");
    process.env.SEONIX_HISTORY_SYMBOL_DEPTH = "0";
    const { counts } = await indexRepository(dir);
    assert.equal(counts.historySymbolDepth, 0);
    assert.equal(counts.touchesSymbol, 0, "symbol-history pass disabled → no touchesSymbol edges");
  } finally {
    if (prev === undefined) delete process.env.SEONIX_HISTORY_SYMBOL_DEPTH;
    else process.env.SEONIX_HISTORY_SYMBOL_DEPTH = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

// 2026-07-02: git log -p over commits that add many/large files under an ignored
// directory (results/, in production) OOM'd CI — loadIgnores() only filters the
// FINAL module list, well after git has already emitted (and Node has buffered)
// the full historical patch. GIT_LOG_EXCLUDE stops git from generating that
// content at all. Empirically verified against a real --depth 20 shallow clone
// of this repo (the exact CI condition): a 343MB shallow-boundary diff collapsed
// to 15MB with these excludes applied.
// TODO(mct): irreducibly infra-coupled to the code-memory-benchmarks repo layout.
// It asserts GIT_LOG_EXCLUDE (extract.mjs) covers the directory excludes in THAT
// repo's own root `.seonixignore` (a self-index dogfooding invariant). After the
// flatten out of packages/seonix, `../../../.seonixignore` points above this repo,
// and mct keeps no self-index / root `.seonixignore`, so the fixture is absent.
// The GIT_LOG_EXCLUDE constant itself is carried verbatim and unchanged.
test("GIT_LOG_EXCLUDE stays in sync with .seonixignore's directory excludes", { skip: "mct: no self-index .seonixignore fixture after flatten (TODO(mct))" }, async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const ignoreFile = join(here, "..", "..", "..", ".seonixignore");
  const lines = (await readFile(ignoreFile, "utf8"))
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.endsWith("/"))
    .map((l) => l.replace(/\/$/, ""));
  for (const dir of lines) {
    assert.ok(GIT_LOG_EXCLUDE.includes(dir), `.seonixignore excludes "${dir}/" but GIT_LOG_EXCLUDE (extract.mjs) does not`);
  }
});

test("indexRepository: a commit under an excluded dir never reaches the git-log file lists",
  { skip: !toolchain ? "needs python3 + git" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "seon-gitignore-"));
  try {
    await writeFile(join(dir, "a.py"), "def foo():\n    return 1\n");
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(join(dir, "results", "trace.jsonl"), "x".repeat(5000) + "\n");
    const git = (...a) => spawnSync("git", a, { cwd: dir });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    git("add", "-A"); git("commit", "-q", "-m", "base + a results/ file");

    const { graphFile } = await indexRepository(dir);
    const e = JSON.parse(await readFile(graphFile, "utf8"));
    assert.ok(!e.individuals.some((i) => i.label?.includes("results/")),
      "results/ must never surface as a module even though it was committed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
