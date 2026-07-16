// ask-nlp.test.mjs — the OPTIONAL wink-nlp lemma/POS tier (ask-nlp.mjs + ask.mjs's
// canonicalization tiers) and its hard boundary: everything here proves BOTH that
// the adapter improves parses Node-side AND that the inlined viewer bundle keeps
// answering with no wink present. Fixture mirrors ask.test.mjs's shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildEntities } from "../../src/graph-build.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import { parseQuery, ask } from "../../src/ask.mjs";
import { nlpAdapter } from "../../src/ask-nlp.mjs";
import { setDefaultNlpAdapter } from "../../src/interpret/nlp-registry.mjs";

// This file exercises the DEFAULT-adapter tier directly against the domain
// parser, so it wires the composition itself (chat.mjs/server.mjs/index.mjs
// do the same for the product surfaces).
setDefaultNlpAdapter(nlpAdapter);

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "src");

const MODULES = [
  { path: "src/logging.mjs", dotted: "src.logging", imports: [], calls: [],
    defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
  { path: "myFile.mjs", dotted: "myFile", imports: ["src.logging"], calls: [],
    defines: [{ name: "startup", kind: "function", lineno: 3, decorators: [] }] },
];
const rawEntities = () => buildEntities(MODULES, []);
const buildGraph = () => parseEntities(rawEntities());

test("nlpAdapter: loads in this checkout (wink deps installed) and is memoized", () => {
  const a = nlpAdapter();
  assert.ok(a, "adapter failed to load — are wink-nlp/wink-eng-lite-web-model installed?");
  assert.equal(nlpAdapter(), a);
  assert.equal(a.lemma("imported"), "import");
  assert.equal(a.lemma("myfile"), "myfile"); // unknown words pass through untouched
});

// ---- consumer 1: the LEMMA tier — inflections hit the curated vocab without
// being enumerated in it, and ONLY when the exact tier missed. ----

test("lemma tier: \"what imported walk.mjs\" parses (reverse/imports) with the adapter, and is an honest null without it", () => {
  const p = parseQuery("what imported walk.mjs");
  assert.deepEqual(p, { shape: "reverse", entityType: null, modifier: "direct", kind: "imports", object: "walk.mjs" });
  assert.equal(parseQuery("what imported walk.mjs", { nlp: null }), null);
});

test("lemma tier: e2e — \"which modules imported src/logging.mjs\" answers off the real imports edges", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which modules imported src/logging.mjs");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /myFile\.mjs/);
});

test("exact curated match always wins: an already-exact query parses IDENTICALLY with the adapter on and off", () => {
  const on = parseQuery("which modules import logging");
  const off = parseQuery("which modules import logging", { nlp: null });
  assert.deepEqual(on, off);
});

// ---- consumer 2: the POS signal, used ONLY inside the det+NOUN+"of" frame it
// provably fixes. The wink probe showed "import" is tagged NOUN even in genuine
// verb use ("which modules import walk.mjs"), so a general POS veto would break

test("POS tier: \"the imports of myFile\" is a NOUN usage — reshaped to the forward query the words mean; without the adapter it stays the documented reverse mis-parse", () => {
  const withPos = parseQuery("the imports of myFile");
  assert.deepEqual(withPos, { shape: "forward", entityType: null, modifier: "direct", kind: "imports", object: "myFile" });
  const without = parseQuery("the imports of myFile", { nlp: null });
  assert.equal(without.shape, "reverse"); // the mis-parse the POS signal exists to fix
});

test("POS tier: e2e — \"the imports of myFile\" now answers exactly like \"what does myFile import\" (junk-lead variant included)", () => {
  const graph = buildGraph();
  const forward = ask(graph, "what does myFile import");
  assert.equal(ask(graph, "the imports of myFile").content, forward.content);
  assert.equal(ask(graph, "show the imports of myFile").content, forward.content);
});

// ---- determinism: same query -> same parse/answer across two PROCESS runs with
// the adapter on (wink is a fixed model, no sampling — but prove it end-to-end). ----

test("determinism: two separate node processes produce byte-identical parse+answer with the adapter on", () => {
  const script = `
    import { parseQuery, ask } from ${JSON.stringify(join(srcDir, "ask.mjs"))};
    import { setDefaultNlpAdapter } from ${JSON.stringify(join(srcDir, "interpret", "nlp-registry.mjs"))};
    import { nlpAdapter } from ${JSON.stringify(join(srcDir, "ask-nlp.mjs"))};
    setDefaultNlpAdapter(nlpAdapter);
    const a = { id: "mod:a.mjs", label: "a.mjs", class: "Module" };
    const b = { id: "mod:b.mjs", label: "b.mjs", class: "Module" };
    const graph = {
      individuals: [a, b], byId: new Map([[a.id, a], [b.id, b]]), truncated: [], proseIndex: {},
      relations: [{ predicate: "importsNamespace", prop: "mgx:importsnamespace", count: 1,
        edges: [{ subject: b.id, object: a.id, subjectLabel: "b.mjs", objectLabel: "a.mjs" }] }],
    };
    process.stdout.write(JSON.stringify({
      parse: parseQuery("what imported a.mjs"),
      pos: parseQuery("the imports of a.mjs"),
      answer: ask(graph, "what imported a.mjs").content,
    }));
  `;
  const run = () => execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const first = run();
  const second = run();
  assert.equal(first, second);
  assert.match(first, /"kind":"imports"/);
  assert.match(first, /b\.mjs/);
});

test("viewer bundle without wink: stripped codegraph+vocab+interpret+ask evaluates and answers (fuzzy + misspellings intact, lemma/POS honestly off)", async () => {
  // Bundle order mirrors the import graph: vocab feeds the interpret modules
  // (normalize -> fuzzy -> strategies, the item-13 split), which feed ask.mjs.
  const sources = await Promise.all(
    ["codegraph.mjs", "ask-vocab.mjs",
      "interpret/nlp-registry.mjs",
      "interpret/normalize.mjs", "interpret/fuzzy.mjs",
      "interpret/strategies/grammar.mjs", "interpret/strategies/keywords.mjs",
      "interpret/strategies/noise-strip.mjs",
      "interpret/merge.mjs", "interpret/pipeline.mjs",
      "ask.mjs"].map((f) => readFile(join(srcDir, f), "utf8")),
  );
  // the exact strip an inlining viewer bundle applies (kept in sync by this test:
  // if the import/export shapes in ask.mjs or interpret/* ever stop matching it,
  // this eval throws). Re-export statements ("export { a, b };") are dropped the
  // same way import statements are — the bindings are already top-level names.
  const strip = (src) => src
    .replace(/^import\s[\s\S]*?from\s+"[^"]+";\s*$/gm, "")
    .replace(/^export\s+\{[^}]*\}(\s+from\s+"[^"]+")?;\s*$/gm, "")
    .replace(/^export (?=(function|const|async function))/gm, "");
  const bundle = sources.map(strip).join("\n");
  // no FUNCTIONAL wink machinery may survive the strip (comments may mention it):
  // a live import statement, import.meta, or a createRequire call would each be a
  // hard failure in a classic inlined <script>.
  assert.doesNotMatch(bundle, /^import\s/m, "an import statement survived the strip");
  assert.doesNotMatch(bundle, /import\.meta|createRequire/, "Node-only module machinery leaked into the bundle");
  const ctx = vm.createContext({});
  vm.runInContext(bundle, ctx); // classic script, like the inlined <script> block
  ctx.__raw = JSON.parse(JSON.stringify(rawEntities()));
  const run = (q) => vm.runInContext(`ask(parseEntities(__raw), ${JSON.stringify(q)})`, ctx);
  // exact grammar — unchanged
  assert.equal(run("which modules import src/logging.mjs").tmct_ask.miss, false);
  // curated misspelling corrections — plain tables, work in the page
  assert.equal(run("whcih moduels improt src/logging.mjs").tmct_ask.miss, false);
  // bounded fuzzy keyword + object — plain JS, works in the page ("loging" is a
  // 1-edit typo of the "logging" label component; a dotted typo like "loggng.mjs"
  // would stop at tier 3 instead, its ".mjs" component matching every module)
  assert.equal(run("which modules impotr src/logging.mjs").tmct_ask.miss, false);
  assert.match(run("which modules import loging").content, /assuming you meant/);
  // lemma tier honestly OFF (no adapter): the inflected form stays a grammar miss
  assert.equal(run("what imported src/logging.mjs").tmct_ask.miss, true);
  assert.match(run("what imported src/logging.mjs").content, /couldn't parse/);
});
