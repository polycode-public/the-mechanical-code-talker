// chatbench/generate-graded.mjs — the deterministic graded-pool generator
// (case-set v2, chatbench/GRADED.md).
//
// For every populated grade × construction cell in GRADED_MATRIX this file
// enumerates ORIGINAL candidate items (systematic surface variation over the
// committed fixture's entities — varied phrasings, synonym stems, entity
// permutations; construction TAXONOMY borrowed from TROG-2/CELF-5, item
// content authored here, never copied — the licence rule), selects the cell's
// pool with a seeded shuffle, and AUTO-AUTHORS tier-1 expectations by
// replaying each item through the CURRENT engine:
//
//   - every item carries its DESIRED expectation, computed from the fixture's
//     ground truth (never from the engine);
//   - an item the engine satisfies keeps the desired expectation as a real,
//     enforced check;
//   - an item the engine fails keeps the desired expectation but the failing
//     turns are marked expect.baselineFail:true and the CURRENT answer is
//     recorded on the turn as `observed` — the honest frontier, exactly the
//     v1 authoring discipline.
//
// Determinism: same --seed (default 20260704) → byte-identical pool (the
// engine replay is itself deterministic; nothing reads Date.now).
//
// Usage: node chatbench/generate-graded.mjs [--seed <n>] [--out <file>]

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GRADED_MATRIX, cellKey, fnv1a, mulberry32, seededShuffle } from "./graded.mjs";
import { FIXTURE, DEFAULT_POOL, createRunnerDeps, parseCases, runTurnsCase, runSessionCase } from "./run.mjs";

// ---- fixture ground truth (computed from the RAW committed fixture, never from the engine) ----

export function buildTruth(raw) {
  const byId = new Map(raw.individuals.map((i) => [i.id, i]));
  const byLabel = new Map(raw.individuals.map((i) => [i.label, i]));
  const edges = Object.fromEntries(raw.objectProperties.map((p) => [p.predicate, p.examples.map((e) => ({ s: e.subject, o: e.object }))]));
  const out = (pred, s) => (edges[pred] ?? []).filter((e) => e.s === s).map((e) => e.o);
  const inc = (pred, o) => (edges[pred] ?? []).filter((e) => e.o === o).map((e) => e.s);
  const label = (id) => byId.get(id)?.label ?? id;
  const id = (lbl) => byLabel.get(lbl)?.id ?? lbl;
  const ofClass = (cls) => raw.individuals.filter((i) => i.class === cls).map((i) => i.id);
  const site = (indId) => {
    const attr = (byId.get(indId)?.attributes ?? []).find((a) => a.key === "site");
    return attr ? attr.value.slice(0, attr.value.lastIndexOf(":")) : null;
  };
  const testedModules = new Set((edges.tests ?? []).map((e) => e.o)); // module ids with a tests in-edge
  const isTested = (indId) => {
    const ind = byId.get(indId);
    if (!ind) return false;
    if (ind.class === "Module") return testedModules.has(indId);
    const s = site(indId);
    return s ? testedModules.has(id(s)) : false;
  };
  return {
    byId, byLabel, edges, out, inc, label, id, ofClass, site, isTested,
    modules: ofClass("Module"),
    classes: ofClass("Class"),
    importersOf: (lbl) => inc("imports", id(lbl)).map(label),
    importsOf: (lbl) => out("imports", id(lbl)).map(label),
    callersOf: (lbl) => inc("calls", id(lbl)).map(label),
    callsOf: (lbl) => out("calls", id(lbl)).map(label),
    definesOf: (lbl) => out("defines", id(lbl)).map(label),
    definerOf: (lbl) => inc("defines", id(lbl)).map(label),
    testsCovering: (lbl) => inc("tests", id(lbl)).map(label),
    coveredBy: (lbl) => out("tests", id(lbl)).map(label),
    touchedBy: (lbl) => [...inc("touches", id(lbl)), ...inc("touchesSymbol", id(lbl))].map(label),
    subclassesOf: (lbl) => inc("inherits", id(lbl)).map(label),
    inheritsOf: (lbl) => out("inherits", id(lbl)).map(label),
    cochangeOf: (lbl) => [...out("cochange", id(lbl)), ...inc("cochange", id(lbl))].map(label),
    reexportsOf: (lbl) => out("reexports", id(lbl)).map(label),
    reexportersOf: (lbl) => inc("reexports", id(lbl)).map(label),
  };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Desired expectation for a set-valued answer (labels). Empty truth → an
 *  honest miss that must NOT be the generic orientation blurb (which would
 *  false-pass a bare miss check). */
function expectSet(t, labels) {
  if (!labels.length) return { miss: true, answerNotMatch: ["I answer questions about"] };
  return {
    miss: false,
    answeredIdsInclude: labels.map((l) => t.id(l)),
    answerMatch: labels.map((l) => esc(l)),
  };
}

function expectCount(n, sing, plur, { anchored = true } = {}) {
  const word = n === 1 ? sing : plur;
  return { miss: false, answerMatch: [anchored ? `^${n} ${word}\\.$` : `${n} ${word}\\.`] };
}

const ctxSet = (question, labels) =>
  labels.length
    ? `Ground truth: the correct answer to "${question}" is exactly: ${labels.join(", ")}.`
    : `Ground truth: the correct answer to "${question}" is an honest empty result — nothing in the graph satisfies it; naming any entity would be wrong.`;

// The v1 fixture vocabulary the naming cells quiz.
const SCHEMA_CLASSES = ["Module", "Class", "Function", "Method", "Attribute", "Commit", "GlobalVariable"];
const PREDICATES = ["imports", "calls", "tests", "defines", "touches", "contains", "inherits", "cochange", "reexports", "callsSymbol", "touchesSymbol"];
const KINDS = [
  { plural: "modules", sing: "module", cls: "Module" },
  { plural: "classes", sing: "class", cls: "Class" },
  { plural: "functions", sing: "function", cls: "Function" },
  { plural: "methods", sing: "method", cls: "Method" },
  { plural: "attributes", sing: "attribute", cls: "Attribute" },
  { plural: "variables", sing: "variable", cls: "GlobalVariable" },
  { plural: "commits", sing: "commit", cls: "Commit" },
];

// ---- per-cell candidate builders ----
// Each returns [{ turns: [{say, expect, session?}], mode?, graph?, context }].
// expect here is the DESIRED expectation; the replay pass marks baselineFail.

function turnsItem(context, ...turns) {
  return { mode: "turns", turns, context };
}
function sessionItem(context, ...turns) {
  return { mode: "session", graph: "fixture", turns, context };
}

function a1Naming(t) {
  const items = [];
  for (const cls of SCHEMA_CLASSES) {
    const article = /^[AEIOU]/.test(cls) ? "an" : "a";
    const ctx = `${cls} is a class in the graph's own schema vocabulary (every tmct graph documents its own vocabulary); the right answer defines the term.`;
    for (const say of [`what is ${article} ${cls}`, `what does ${cls} mean`]) {
      items.push(turnsItem(ctx, { say, expect: { miss: false, answerMatch: [`${cls} is a class in the graph's schema`] } }));
    }
  }
  for (const p of PREDICATES) {
    items.push(turnsItem(
      `${p} is a predicate (relation) in the graph's own schema vocabulary; the right answer defines the relation.`,
      { say: `what does ${p} mean`, expect: { miss: false, answerMatch: [`${p} is a predicate`] } },
    ));
  }
  return items;
}

function a2Naming(t) {
  const items = [];
  const entities = [...t.modules, ...t.classes, "fn-alpha", "m-render", "a-name", "g-register", "commit-abc"].map((i) => t.byId.get(i));
  for (const e of entities) {
    items.push(turnsItem(
      `${e.label} is a ${e.class} in the graph; /describe must render its entity card.`,
      { say: `/describe ${e.label}`, expect: { miss: false, answerMatch: [`${esc(e.label)} — ${e.class}`] } },
    ));
  }
  for (const lbl of ["Widget", "fnAlpha", "Base", "register", "abc1234"]) {
    const cls = t.byLabel.get(lbl).class;
    items.push(turnsItem(
      `${lbl} is not schema vocabulary but IS a known ${cls} in the graph; a strong answer says what kind of thing ${lbl} is (a ${cls}) rather than only reporting it is not a vocabulary term.`,
      { say: `what does ${lbl} mean`, expect: { miss: false, answerMatch: [`${cls}`] } },
    ));
  }
  for (const lbl of ["Widget", "Base", "Button", "fnAlpha"]) {
    const cls = t.byLabel.get(lbl).class;
    items.push(turnsItem(
      `${lbl} is a known ${cls} in the graph; "what is ${lbl}" should acknowledge the recognized entity (kind, defining module), never the generic orientation blurb.`,
      { say: `what is ${lbl}`, expect: { miss: false, answerMatch: [esc(lbl)], answerNotMatch: ["I answer questions about"] } },
    ));
  }
  return items;
}

function svoRelationItems(t, stems) {
  // stems: [{ make(label) -> say, truth(label) -> labels, subjects: [labels] }]
  const items = [];
  for (const stem of stems) {
    for (const subj of stem.subjects) {
      const say = stem.make(subj);
      const truth = stem.truth(subj);
      items.push(turnsItem(ctxSet(say, truth), { say, expect: expectSet(t, truth) }));
    }
  }
  return items;
}

function a1Svo(t) {
  const mods = t.modules.map((i) => t.label(i));
  const items = svoRelationItems(t, [
    { make: (l) => `which modules import ${l}`, truth: (l) => t.importersOf(l), subjects: mods },
    { make: (l) => `what imports ${l}`, truth: (l) => t.importersOf(l), subjects: mods },
    { make: (l) => `what does ${l} import`, truth: (l) => t.importsOf(l), subjects: mods },
    { make: (l) => `which module defines ${l}`, truth: (l) => t.definerOf(l), subjects: ["Widget", "register", "fnAlpha"] },
    { make: (l) => `what does ${l} define`, truth: (l) => t.definesOf(l), subjects: mods },
    { make: (l) => `which tests cover ${l}`, truth: (l) => t.testsCovering(l), subjects: mods },
    { make: (l) => `who touched ${l}`, truth: (l) => t.touchedBy(l), subjects: mods },
    { make: (l) => `which modules call ${l}`, truth: (l) => t.callersOf(l), subjects: ["app/lib/a.mjs", "app/lib/b.mjs"] },
    { make: (l) => `what does ${l} call`, truth: (l) => t.callsOf(l), subjects: ["scripts/g.mjs"] },
    { make: (l) => `which classes inherit from ${l}`, truth: (l) => t.subclassesOf(l), subjects: ["Base", "Widget", "Button"] },
  ]);
  for (const sym of ["fnAlpha", "Widget", "Base", "Button", "register", "Widget.render"]) {
    const mod = t.site(t.id(sym));
    items.push(turnsItem(
      `Ground truth: ${sym} is defined in ${mod} (per its recorded source site).`,
      { say: `where is ${sym} defined`, expect: { miss: false, answerMatch: [`is defined in ${esc(mod)}`] } },
    ));
  }
  const re = t.reexportsOf("app/functions/d/handler.mjs");
  items.push(turnsItem(ctxSet("what does app/functions/d/handler.mjs re-export", re), {
    say: "what does app/functions/d/handler.mjs re-export", expect: expectSet(t, re),
  }));
  return items;
}

function a1Count(t) {
  const items = [];
  for (const k of KINDS) {
    const n = t.ofClass(k.cls).length;
    const ctx = `Ground truth: the graph holds exactly ${n} ${n === 1 ? k.sing : k.plural} (${k.cls} individuals).`;
    for (const say of [
      `how many ${k.plural} are there`,
      `how many ${k.plural} are there in this graph`,
      `count the ${k.plural}`,
      `how many ${k.plural}`,
    ]) {
      items.push(turnsItem(ctx, { say, expect: expectCount(n, k.sing, k.plural) }));
    }
  }
  return items;
}

function a2Svo(t) {
  const mods = t.modules.map((i) => t.label(i));
  const uses = (l) => [...new Set([...t.importersOf(l), ...t.callersOf(l)])];
  const items = svoRelationItems(t, [
    { make: (l) => `what uses ${l}`, truth: uses, subjects: mods },
    { make: (l) => `which files import ${l}`, truth: (l) => t.importersOf(l), subjects: mods },
    { make: (l) => `modules importing ${l}`, truth: (l) => t.importersOf(l), subjects: mods },
    { make: (l) => `who imports ${l}`, truth: (l) => t.importersOf(l), subjects: ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"] },
    { make: (l) => `what tests touch ${l}`, truth: (l) => t.testsCovering(l), subjects: mods },
    { make: (l) => `what does ${l} export`, truth: (l) => t.reexportsOf(l), subjects: ["app/functions/d/handler.mjs", "app/lib/a.mjs", "app/lib/b.mjs"] },
    { make: (l) => `which classes does ${l} define`, truth: (l) => t.definesOf(l).filter((x) => t.byLabel.get(x)?.class === "Class"), subjects: ["app/lib/b.mjs", "app/lib/a.mjs"] },
    { make: (l) => `which module contains ${l}`, truth: (l) => [t.site(t.id(l))].filter(Boolean), subjects: ["Widget.render", "Widget.name", "register"] },
  ]);
  items.push(turnsItem(
    "Ground truth: the only recorded symbol-level caller of fnAlpha is the method Widget.render (a callsSymbol edge).",
    { say: "which method calls fnAlpha", expect: { miss: false, answeredIdsInclude: ["m-render"], answerMatch: ["Widget\\.render"] } },
  ));
  items.push(turnsItem(
    "Ground truth: the only recorded symbol-level caller of fnAlpha is the method Widget.render (a callsSymbol edge).",
    { say: "which methods call fnAlpha", expect: { miss: false, answeredIdsInclude: ["m-render"], answerMatch: ["Widget\\.render"] } },
  ));
  for (const c of ["Widget", "Base", "Button"]) {
    const truth = c === "Widget" ? ["Widget.render"] : [];
    items.push(turnsItem(ctxSet(`public methods of ${c}`, truth), {
      say: `public methods of ${c}`,
      expect: truth.length ? { miss: false, answeredIdsInclude: ["m-render"], answerMatch: ["Widget\\.render"] } : { miss: true, answerNotMatch: ["I answer questions about"] },
    }));
  }
  for (const say of ["what did commit abc1234 touch", "what did abc1234 touch"]) {
    items.push(turnsItem(
      "Ground truth: commit abc1234 touched the module app/lib/a.mjs and (at symbol grain) the method Widget.render.",
      { say, expect: { miss: false, answeredIdsInclude: ["mod-a", "m-render"], answerMatch: ["app/lib/a\\.mjs", "Widget\\.render"] } },
    ));
  }
  return items;
}

function a2Count(t) {
  const items = [];
  const methodCountByModule = (lbl) => ["m-render"].filter((m) => t.site(m) === lbl).length;
  const superlatives = [
    { x: "imports", winners: ["app/functions/d/handler.mjs", "app/lib/e.mjs"], n: 2 },
    { x: "importers", winners: ["app/lib/a.mjs"], n: 3 },
    { x: "tests", winners: ["app/lib/b.mjs", "app/functions/d/handler.mjs"], n: 1 },
    { x: "callers", winners: ["app/lib/a.mjs"], n: 1 },
    { x: "methods", winners: ["app/lib/b.mjs"], n: 1 },
  ];
  for (const s of superlatives) {
    items.push(turnsItem(
      `Ground truth: ranked by ${s.x}, the top module(s): ${s.winners.join(", ")} with ${s.n}.`,
      { say: `which module has the most ${s.x}`, expect: { miss: false, answeredIdsInclude: s.winners.map((w) => t.id(w)), answerMatch: [`the most ${s.x} \\(${s.n}\\)`] } },
    ));
  }
  items.push(turnsItem(
    "Ground truth: app/lib/a.mjs is the most connected module (3 importers + 1 caller, the highest total degree).",
    { say: "the most connected module", expect: { miss: false, answeredIdsInclude: ["mod-a"], answerMatch: ["app/lib/a\\.mjs", "the most connected"] } },
  ));
  for (const c of ["Widget", "Base", "Button"]) {
    const n = c === "Widget" ? 1 : 0;
    items.push(turnsItem(
      `Ground truth: the class ${c} has exactly ${n} method(s)${n ? " (render)" : ""}.`,
      { say: `how many methods does ${c} have`, expect: expectCount(n, "method", "methods") },
    ));
  }
  for (const m of t.modules.map((i) => t.label(i))) {
    const n = t.definesOf(m).filter((x) => t.byLabel.get(x)?.class === "Function").length;
    items.push(turnsItem(
      `Ground truth: ${m} defines exactly ${n} function(s)${n ? " (fnAlpha)" : ""}.`,
      { say: `how many functions does ${m} define`, expect: expectCount(n, "function", "functions") },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs"]) {
    const truth = ["Widget.render"].filter((x) => t.site(t.id(x)) === m);
    items.push(turnsItem(ctxSet(`list methods in ${m}`, truth), {
      say: `list methods in ${m}`, expect: expectSet(t, truth),
    }));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/f.mjs"]) {
    const n = t.importersOf(m).length;
    items.push(turnsItem(
      `Ground truth: exactly ${n} module(s) import ${m} (${t.importersOf(m).join(", ")}).`,
      { say: `how many modules import ${m}`, expect: expectCount(n, "module", "modules") },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs"]) {
    const truth = t.definesOf(m).filter((x) => t.byLabel.get(x)?.class === "Function");
    items.push(turnsItem(ctxSet(`list functions in ${m}`, truth), {
      say: `list functions in ${m}`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

const MODULE_ANCHORS = [
  (l) => `/describe ${l}`,
  (l) => `which modules import ${l}`,
  (l) => `what does ${l} import`,
];

function a2Pronoun(t) {
  const items = [];
  const followups = [
    { say: "what does it import", truth: (l) => t.importsOf(l) },
    { say: "what does it define", truth: (l) => t.definesOf(l) },
    { say: "which modules import it", truth: (l) => t.importersOf(l) },
    { say: "what calls it", truth: (l) => t.callersOf(l) },
  ];
  const mods = ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "app/functions/d/handler.mjs"];
  mods.forEach((m, mi) => {
    followups.forEach((f, fi) => {
      const anchor = MODULE_ANCHORS[(mi + fi) % MODULE_ANCHORS.length](m);
      const truth = f.truth(m);
      items.push(turnsItem(
        `Turn 2's "it" refers to ${m} (the subject of turn 1). ${ctxSet(`${f.say} (it = ${m})`, truth)}`,
        { say: anchor, expect: {} },
        { say: f.say, expect: expectSet(t, truth) },
      ));
    });
  });
  for (const c of ["Widget", "Button", "Base"]) {
    const truth = t.inheritsOf(c);
    items.push(turnsItem(
      `Turn 2's "it" refers to the class ${c}. ${ctxSet(`what does it inherit from (it = ${c})`, truth)}`,
      { say: `/describe ${c}`, expect: { miss: false } },
      { say: "what does it inherit from", expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs"]) {
    const truth = t.touchedBy(m);
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}. ${ctxSet(`who touched it (it = ${m})`, truth)}`,
      { say: `/describe ${m}`, expect: { miss: false } },
      { say: "who touched it", expect: expectSet(t, truth) },
    ));
  }
  return items;
}

function a2Negation(t) {
  const items = [];
  const untested = {
    classes: t.classes.map((i) => t.label(i)).filter((c) => !t.isTested(t.id(c))),
    modules: t.modules.map((i) => t.label(i)).filter((m) => !t.isTested(t.id(m))),
    functions: ["fnAlpha"].filter((f) => !t.isTested(t.id(f))),
    methods: ["Widget.render"].filter((m) => !t.isTested(t.id(m))),
  };
  for (const kind of Object.keys(untested)) {
    for (const stem of [`untested ${kind}`, `uncovered ${kind}`]) {
      items.push(turnsItem(ctxSet(stem, untested[kind]), { say: stem, expect: expectSet(t, untested[kind]) }));
    }
    items.push(turnsItem(ctxSet(`which ${kind} are not tested`, untested[kind]), {
      say: `which ${kind} are not tested`, expect: expectSet(t, untested[kind]),
    }));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/f.mjs", "app/lib/e.mjs"]) {
    const truth = t.importersOf(m).filter((x) => !t.isTested(t.id(x)));
    for (const stem of [`modules importing ${m} but not tested`, `modules importing ${m} but untested`]) {
      items.push(turnsItem(ctxSet(stem, truth), { say: stem, expect: expectSet(t, truth) }));
    }
  }
  for (const c of ["Base", "Widget"]) {
    const truth = t.subclassesOf(c).filter((x) => !t.isTested(t.id(x)));
    for (const stem of [`classes inheriting from ${c} but not tested`, `classes inheriting from ${c} but untested`]) {
      items.push(turnsItem(ctxSet(stem, truth), { say: stem, expect: expectSet(t, truth) }));
    }
  }
  items.push(turnsItem(ctxSet("which classes are untested", untested.classes), {
    say: "which classes are untested", expect: expectSet(t, untested.classes),
  }));
  items.push(turnsItem(ctxSet("which modules are untested", untested.modules), {
    say: "which modules are untested", expect: expectSet(t, untested.modules),
  }));
  return items;
}

function a2NoiseSvo(t) {
  const wrappers = [
    (q) => `um ${q} please`,
    (q) => `hey tmct, ${q} thanks`,
    (q) => `could you tell me ${q}`,
    (q) => `so, uh, ${q} then`,
    (q) => `i was wondering ${q}`,
  ];
  const bases = [
    { q: "which modules import app/lib/a.mjs", expect: () => expectSet(t, t.importersOf("app/lib/a.mjs")), truth: () => t.importersOf("app/lib/a.mjs") },
    { q: "what does app/lib/e.mjs import", expect: () => expectSet(t, t.importsOf("app/lib/e.mjs")), truth: () => t.importsOf("app/lib/e.mjs") },
    { q: "which classes inherit from Base", expect: () => expectSet(t, t.subclassesOf("Base")), truth: () => t.subclassesOf("Base") },
    { q: "how many classes are there", expect: () => expectCount(3, "class", "classes", { anchored: false }), truth: () => ["3 classes"] },
    { q: "where is fnAlpha defined", expect: () => ({ miss: false, answerMatch: ["is defined in app/lib/a\\.mjs"] }), truth: () => ["app/lib/a.mjs line 12"] },
  ];
  const items = [];
  for (const base of bases) {
    for (const wrap of wrappers) {
      items.push(turnsItem(
        `The visitor's question is "${base.q}" wrapped in conversational noise; the noise must not change the answer. ${ctxSet(base.q, base.truth())}`,
        { say: wrap(base.q), expect: base.expect() },
      ));
    }
  }
  return items;
}

function b1Pronoun(t) {
  const items = [];
  const mods = ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"];
  mods.forEach((m, i) => {
    const truth = t.touchedBy(m);
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}. ${ctxSet(`who touched it (it = ${m})`, truth)}`,
      { say: MODULE_ANCHORS[i % MODULE_ANCHORS.length](m), expect: {} },
      { say: "who touched it", expect: expectSet(t, truth) },
    ));
  });
  ["app/lib/b.mjs", "app/functions/d/handler.mjs", "app/lib/a.mjs", "app/lib/e.mjs", "app/lib/c.mjs"].forEach((m, i) => {
    const truth = t.testsCovering(m);
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}. ${ctxSet(`what tests cover it (it = ${m})`, truth)}`,
      { say: MODULE_ANCHORS[(i + 1) % MODULE_ANCHORS.length](m), expect: {} },
      { say: "what tests cover it", expect: expectSet(t, truth) },
    ));
  });
  for (const m of mods) {
    items.push(turnsItem(
      `In turns 2 and 3 "it" refers to ${m} throughout. ${ctxSet(`what calls it (it = ${m})`, t.callersOf(m))} ${ctxSet(`which modules import it (it = ${m})`, t.importersOf(m))}`,
      { say: `/describe ${m}`, expect: { miss: false } },
      { say: "what calls it", expect: expectSet(t, t.callersOf(m)) },
      { say: "which modules import it", expect: expectSet(t, t.importersOf(m)) },
    ));
  }
  for (const m of mods) {
    items.push(turnsItem(
      `In turns 2 and 3 the pronouns refer to ${m}. ${ctxSet(`what does it import (it = ${m})`, t.importsOf(m))} ${ctxSet(`who touched it (it = ${m})`, t.touchedBy(m))}`,
      { say: `which modules import ${m}`, expect: {} },
      { say: "what does it import", expect: expectSet(t, t.importsOf(m)) },
      { say: "who touched it", expect: expectSet(t, t.touchedBy(m)) },
    ));
  }
  for (const m of mods) {
    const truth = t.touchedBy(m);
    items.push(turnsItem(
      `Turn 2's "that" refers to ${m}, the module under discussion. ${ctxSet(`who touched that (that = ${m})`, truth)}`,
      { say: `what does ${m} import`, expect: {} },
      { say: "who touched that", expect: expectSet(t, truth) },
    ));
  }
  return items;
}

function b1Negation(t) {
  const items = [];
  const mods = t.modules.map((i) => t.label(i));
  for (const m of mods) {
    const truth = mods.filter((x) => !t.importersOf(m).includes(x));
    items.push(turnsItem(ctxSet(`which modules do not import ${m}`, truth), {
      say: `which modules do not import ${m}`, expect: expectSet(t, truth),
    }));
  }
  for (const c of ["Base", "Widget", "Button"]) {
    const truth = t.classes.map((i) => t.label(i)).filter((x) => !t.subclassesOf(c).includes(x));
    items.push(turnsItem(ctxSet(`which classes don't inherit from ${c}`, truth), {
      say: `which classes don't inherit from ${c}`, expect: expectSet(t, truth),
    }));
  }
  const notTestedCounts = { classes: ["class", "classes", 2], modules: ["module", "modules", 6], functions: ["function", "functions", 1], methods: ["method", "methods", 0] };
  for (const [kind, [sing, plur, n]] of Object.entries(notTestedCounts)) {
    items.push(turnsItem(
      `Ground truth: exactly ${n} ${n === 1 ? sing : plur} lack test coverage.`,
      { say: `how many ${kind} are not tested`, expect: expectCount(n, sing, plur) },
    ));
  }
  const noImports = mods.filter((m) => !t.importsOf(m).length);
  items.push(turnsItem(ctxSet("which modules don't import anything", noImports), {
    say: "which modules don't import anything", expect: expectSet(t, noImports),
  }));
  items.push(turnsItem(
    "Ground truth: the only exported (re-exported) function is fnAlpha, so no function is un-exported — the honest answer is an empty result.",
    { say: "which functions are not exported", expect: { miss: true, answerNotMatch: ["I answer questions about", 'matching "not"'] } },
  ));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"]) {
    const truth = mods.filter((x) => !t.importersOf(m).includes(x));
    items.push(turnsItem(ctxSet(`modules not importing ${m}`, truth), {
      say: `modules not importing ${m}`, expect: expectSet(t, truth),
    }));
  }
  const noDefines = mods.filter((m) => !t.definesOf(m).length);
  items.push(turnsItem(ctxSet("which modules do not define anything", noDefines), {
    say: "which modules do not define anything", expect: expectSet(t, noDefines),
  }));
  for (const c of ["Base", "Widget"]) {
    const truth = t.classes.map((i) => t.label(i)).filter((x) => !t.subclassesOf(c).includes(x));
    items.push(turnsItem(ctxSet(`classes that do not inherit from ${c}`, truth), {
      say: `classes that do not inherit from ${c}`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

function b1Passive(t) {
  const items = [];
  const mods = t.modules.map((i) => t.label(i));
  for (const m of mods) {
    const truth = t.importsOf(m); // PASSIVE: "imported BY m" = what m imports
    items.push(turnsItem(
      `REVERSIBLE PASSIVE: "imported by ${m}" means the modules ${m} imports (agent = ${m}), NOT the modules importing ${m}. ${ctxSet(`which modules are imported by ${m}`, truth)}`,
      { say: `which modules are imported by ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/e.mjs", "app/lib/f.mjs"]) {
    const truth = t.importersOf(m);
    items.push(turnsItem(
      `REVERSIBLE PASSIVE: "${m} is imported by X" makes ${m} the patient — the answer is the modules importing ${m}. ${ctxSet(`${m} is imported by which modules`, truth)}`,
      { say: `${m} is imported by which modules`, expect: expectSet(t, truth) },
    ));
  }
  items.push(turnsItem(
    `${ctxSet("which modules are called by scripts/g.mjs", t.callsOf("scripts/g.mjs"))}`,
    { say: "which modules are called by scripts/g.mjs", expect: expectSet(t, t.callsOf("scripts/g.mjs")) },
  ));
  const covered = t.coveredBy("app/unit-tests/b.test.mjs");
  items.push(turnsItem(ctxSet("which modules are tested by app/unit-tests/b.test.mjs", covered), {
    say: "which modules are tested by app/unit-tests/b.test.mjs", expect: expectSet(t, covered),
  }));
  items.push(turnsItem(ctxSet("which module is covered by app/unit-tests/b.test.mjs", covered), {
    say: "which module is covered by app/unit-tests/b.test.mjs", expect: expectSet(t, covered),
  }));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs"]) {
    const truth = t.touchedBy(m);
    items.push(turnsItem(ctxSet(`who was ${m} touched by`, truth), {
      say: `who was ${m} touched by`, expect: expectSet(t, truth),
    }));
  }
  items.push(turnsItem(ctxSet("Base is inherited by which classes", t.subclassesOf("Base")), {
    say: "Base is inherited by which classes", expect: expectSet(t, t.subclassesOf("Base")),
  }));
  items.push(turnsItem(ctxSet("Widget is inherited by which classes", t.subclassesOf("Widget")), {
    say: "Widget is inherited by which classes", expect: expectSet(t, t.subclassesOf("Widget")),
  }));
  items.push(turnsItem(
    `REVERSIBLE PASSIVE: "inherited from by Button" asks what Button inherits from. ${ctxSet("which classes are inherited from by Button", t.inheritsOf("Button"))}`,
    { say: "which classes are inherited from by Button", expect: expectSet(t, t.inheritsOf("Button")) },
  ));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs"]) {
    const truth = t.definesOf(m);
    items.push(turnsItem(ctxSet(`which symbols are defined by ${m}`, truth), {
      say: `which symbols are defined by ${m}`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

function b1Temporal(t) {
  const items = [];
  const commitCtx = "Ground truth: the only commit entity is abc1234 (Ada Lovelace, 2026-06-28, \"Render the widget with full mode\"), touching app/lib/a.mjs and Widget.render.";
  for (const m of t.modules.map((i) => t.label(i))) {
    const touched = t.touchedBy(m);
    items.push(turnsItem(
      touched.length ? commitCtx : `Ground truth: no recorded commit touches ${m}; the honest answer states that.`,
      { say: `when did ${m} change`, expect: touched.length ? { miss: false, answerMatch: ["abc1234", "2026-06-28"] } : { miss: true, answerMatch: ["no recorded commit touches"] } },
    ));
  }
  for (const s of ["Widget.render", "fnAlpha", "Base", "Widget"]) {
    const touched = t.touchedBy(s);
    items.push(turnsItem(
      touched.length ? commitCtx : `Ground truth: no recorded commit touches ${s}; the honest answer states that.`,
      { say: `when did ${s} change`, expect: touched.length ? { miss: false, answerMatch: ["abc1234", "2026-06-28"] } : { miss: true, answerMatch: ["no recorded commit touches"] } },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs"]) {
    const touched = t.touchedBy(m);
    items.push(turnsItem(
      touched.length ? commitCtx : `Ground truth: no recorded commit touches ${m}.`,
      { say: `when did ${m} last change`, expect: touched.length ? { miss: false, answerMatch: ["abc1234"] } : { miss: true, answerMatch: ["no recorded commit touches"] } },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs"]) {
    const truth = t.touchedBy(m).filter((x) => x === "abc1234");
    items.push(turnsItem(
      truth.length ? commitCtx : `Ground truth: no commit entity touches ${m}; honest empty.`,
      { say: `which commit touched ${m}`, expect: truth.length ? { miss: false, answeredIdsInclude: ["commit-abc"], answerMatch: ["abc1234"] } : { miss: true, answerNotMatch: ["I answer questions about"] } },
    ));
  }
  items.push(turnsItem(commitCtx, {
    say: "what did commit abc1234 touch",
    expect: { miss: false, answeredIdsInclude: ["mod-a", "m-render"], answerMatch: ["app/lib/a\\.mjs", "Widget\\.render"] },
  }));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs"]) {
    const truth = t.cochangeOf(m);
    items.push(turnsItem(
      `Ground truth: change-coupled (cochange) partners of ${m}: ${truth.join(", ") || "none"}.`,
      { say: `which modules cochange with ${m}`, expect: expectSet(t, truth) },
    ));
  }
  items.push(turnsItem(commitCtx, {
    say: "what changed on 2026-06-28",
    expect: { miss: false, answerMatch: ["abc1234"] },
  }));
  items.push(turnsItem(
    "Ground truth: abc1234 is the newest (and only) commit; nothing is recorded after it — the honest answer states that emptiness.",
    { say: "what changed after abc1234", expect: { miss: true, answerNotMatch: ["I answer questions about"] } },
  ));
  return items;
}

function b1Discourse(t) {
  const items = [];
  const listAnchors = [
    { say: "which modules import app/lib/a.mjs", set: () => t.importersOf("app/lib/a.mjs") },
    { say: "which modules import app/lib/b.mjs", set: () => t.importersOf("app/lib/b.mjs") },
    { say: "what does app/lib/e.mjs import", set: () => t.importsOf("app/lib/e.mjs") },
    { say: "which classes inherit from Base", set: () => t.subclassesOf("Base") },
    { say: "list the modules", set: () => t.modules.map((i) => t.label(i)) },
    { say: "list the classes", set: () => t.classes.map((i) => t.label(i)) },
    { say: "untested classes", set: () => t.classes.map((i) => t.label(i)).filter((c) => !t.isTested(t.id(c))) },
    { say: "what uses app/lib/a.mjs", set: () => [...new Set([...t.importersOf("app/lib/a.mjs"), ...t.callersOf("app/lib/a.mjs")])] },
  ];
  for (const a of listAnchors) {
    items.push(turnsItem(
      `"why" must re-render the previous answer verbosely with its traversal receipt.`,
      { say: a.say, expect: { miss: false } },
      { say: "why", expect: { miss: false, answerMatch: [`expanding: ${esc(a.say)}`] } },
    ));
  }
  const memberTruth = { Widget: ["render", "name"], Base: [], Button: [] };
  for (const c of ["Widget", "Base", "Button"]) {
    const truth = memberTruth[c];
    items.push(turnsItem(
      `/focus ${c} then a no-arg /members must reuse the focus. Ground truth: ${c}'s members: ${truth.join(", ") || "none"}.`,
      { say: `/focus ${c}`, expect: { miss: false, focusLabel: c } },
      { say: "/members", expect: truth.length ? { miss: false, answerMatch: truth.map(esc) } : { miss: true } },
    ));
  }
  listAnchors.slice(0, 5).forEach((a) => {
    const truth = a.set().filter((x) => t.isTested(t.id(x)));
    items.push(turnsItem(
      `Turn 2's "those" refers to turn 1's answer set (${a.set().join(", ")}). ${ctxSet("which of those are tested", truth)}`,
      { say: a.say, expect: { miss: false } },
      { say: "which of those are tested", expect: expectSet(t, truth) },
    ));
  });
  listAnchors.slice(0, 4).forEach((a) => {
    const n = a.set().filter((x) => t.isTested(t.id(x))).length;
    items.push(turnsItem(
      `Turn 2 counts the tested members of turn 1's answer set. Ground truth: ${n}.`,
      { say: a.say, expect: { miss: false } },
      { say: "how many of those are tested", expect: { miss: false, answerMatch: [`^${n} `] } },
    ));
  });
  const aboutPairs = [["app/lib/e.mjs", "app/lib/c.mjs"], ["app/lib/b.mjs", "app/lib/e.mjs"], ["app/lib/c.mjs", "app/lib/f.mjs"], ["app/lib/a.mjs", "app/lib/b.mjs"], ["app/lib/f.mjs", "app/lib/a.mjs"]];
  for (const [m1, m2] of aboutPairs) {
    const truth = t.importsOf(m2);
    items.push(turnsItem(
      `"what about ${m2}" re-asks turn 1's question shape for ${m2}. ${ctxSet(`what does ${m2} import`, truth)}`,
      { say: `what does ${m1} import`, expect: {} },
      { say: `what about ${m2}`, expect: expectSet(t, truth) },
    ));
  }
  return items;
}

function b1PronNeg(t) {
  const items = [];
  const mods = t.modules.map((i) => t.label(i));
  ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "app/functions/d/handler.mjs", "scripts/g.mjs", "app/unit-tests/b.test.mjs"].forEach((m, i) => {
    const truth = mods.filter((x) => !t.importersOf(m).includes(x));
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}; the question is negated. ${ctxSet(`which modules don't import it (it = ${m})`, truth)}`,
      { say: MODULE_ANCHORS[i % MODULE_ANCHORS.length](m), expect: {} },
      { say: "which modules don't import it", expect: expectSet(t, truth) },
    ));
  });
  ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "app/lib/c.mjs"].forEach((m, i) => {
    const truth = mods.filter((x) => !t.importersOf(m).includes(x));
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}. ${ctxSet(`which modules do not import it (it = ${m})`, truth)}`,
      { say: MODULE_ANCHORS[(i + 1) % MODULE_ANCHORS.length](m), expect: {} },
      { say: "which modules do not import it", expect: expectSet(t, truth) },
    ));
  });
  ["app/lib/e.mjs", "app/lib/b.mjs", "app/functions/d/handler.mjs", "app/lib/f.mjs"].forEach((m, i) => {
    const truth = mods.filter((x) => !t.importsOf(m).includes(x));
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}; the answer is every module ${m} does NOT import. ${ctxSet(`what doesn't it import (it = ${m})`, truth)}`,
      { say: MODULE_ANCHORS[i % MODULE_ANCHORS.length](m), expect: {} },
      { say: "what doesn't it import", expect: expectSet(t, truth) },
    ));
  });
  ["Base", "Widget", "Button"].forEach((c) => {
    const truth = t.classes.map((i) => t.label(i)).filter((x) => !t.subclassesOf(c).includes(x));
    items.push(turnsItem(
      `Turn 2's "it" refers to the class ${c}. ${ctxSet(`which classes don't inherit from it (it = ${c})`, truth)}`,
      { say: `/describe ${c}`, expect: {} },
      { say: "which classes don't inherit from it", expect: expectSet(t, truth) },
    ));
  });
  ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/functions/d/handler.mjs", "app/lib/e.mjs"].forEach((m, i) => {
    const truth = ["app/unit-tests/b.test.mjs"].filter((x) => !t.testsCovering(m).includes(x));
    items.push(turnsItem(
      `Turn 2's "it" refers to ${m}; the answer is every test module that does NOT cover it. ${ctxSet(`which tests don't cover it (it = ${m})`, truth)}`,
      { say: MODULE_ANCHORS[(i + 2) % MODULE_ANCHORS.length](m), expect: {} },
      { say: "which tests don't cover it", expect: expectSet(t, truth) },
    ));
  });
  return items;
}

function b1DiscCount(t) {
  const anchors = [
    { say: "which modules import app/lib/a.mjs", set: () => t.importersOf("app/lib/a.mjs") },
    { say: "list the modules", set: () => t.modules.map((i) => t.label(i)) },
    { say: "which classes inherit from Base", set: () => t.subclassesOf("Base") },
    { say: "untested classes", set: () => t.classes.map((i) => t.label(i)).filter((c) => !t.isTested(t.id(c))) },
    { say: "list the classes", set: () => t.classes.map((i) => t.label(i)) },
    { say: "what does app/lib/e.mjs import", set: () => t.importsOf("app/lib/e.mjs") },
    { say: "which modules import app/lib/b.mjs", set: () => t.importersOf("app/lib/b.mjs") },
    { say: "what uses app/lib/a.mjs", set: () => [...new Set([...t.importersOf("app/lib/a.mjs"), ...t.callersOf("app/lib/a.mjs")])] },
  ];
  const items = [];
  for (const a of anchors) {
    const n = a.set().filter((x) => t.isTested(t.id(x))).length;
    items.push(turnsItem(
      `Turn 2 counts the TESTED members of turn 1's answer set (${a.set().join(", ")}). Ground truth: ${n}.`,
      { say: a.say, expect: {} },
      { say: "how many of those are tested", expect: { miss: false, answerMatch: [`^${n} `] } },
    ));
  }
  for (const a of anchors.slice(0, 5)) {
    const n = a.set().length;
    items.push(turnsItem(
      `Turn 2 counts turn 1's answer set. Ground truth: ${n}.`,
      { say: a.say, expect: {} },
      { say: "how many of those", expect: { miss: false, answerMatch: [`^${n} `] } },
    ));
  }
  for (const a of anchors.slice(0, 4)) {
    const n = a.set().length;
    items.push(turnsItem(
      `Turn 2 ("count them") counts turn 1's answer set. Ground truth: ${n}.`,
      { say: a.say, expect: {} },
      { say: "count them", expect: { miss: false, answerMatch: [`^${n} `] } },
    ));
  }
  for (const a of anchors.slice(2, 6)) {
    const n = a.set().filter((x) => t.isTested(t.id(x))).length;
    items.push(turnsItem(
      `Turn 2 counts the tested members of turn 1's answer set. Ground truth: ${n}.`,
      { say: a.say, expect: {} },
      { say: "how many of them are tested", expect: { miss: false, answerMatch: [`^${n} `] } },
    ));
  }
  for (const a of anchors.slice(0, 4)) {
    const n = a.set().filter((x) => !t.isTested(t.id(x))).length;
    items.push(turnsItem(
      `Turn 2 counts the UNTESTED members of turn 1's answer set. Ground truth: ${n}.`,
      { say: a.say, expect: {} },
      { say: "how many of those are untested", expect: { miss: false, answerMatch: [`^${n} `] } },
    ));
  }
  return items;
}

function b2Passive(t) {
  const items = [];
  const relModules = [
    { phrase: "the module that defines Widget", mod: "app/lib/b.mjs" },
    { phrase: "the module that defines fnAlpha", mod: "app/lib/a.mjs" },
    { phrase: "the module that defines register", mod: "app/lib/b.mjs" },
    { phrase: "the module that imports app/lib/f.mjs", mod: "app/lib/e.mjs" },
    { phrase: "the module that tests app/lib/b.mjs", mod: "app/unit-tests/b.test.mjs" },
  ];
  for (const r of relModules) {
    const truth = t.importsOf(r.mod);
    items.push(turnsItem(
      `"${r.phrase}" is ${r.mod}; the passive asks what IT imports. ${ctxSet(`what is imported by ${r.phrase}`, truth)}`,
      { say: `what is imported by ${r.phrase}`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of ["Widget", "fnAlpha", "register"]) {
    const mod = t.definerOf(sym)[0];
    const truth = t.importsOf(mod);
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}. ${ctxSet(`which modules are imported by the module that defines ${sym}`, truth)}`,
      { say: `which modules are imported by the module that defines ${sym}`, expect: expectSet(t, truth) },
    ));
  }
  for (const say of ["fnAlpha is called by which method", "which method is fnAlpha called by"]) {
    items.push(turnsItem(
      "Ground truth: the method Widget.render calls fnAlpha (the only recorded symbol-level caller).",
      { say, expect: { miss: false, answeredIdsInclude: ["m-render"], answerMatch: ["Widget\\.render"] } },
    ));
  }
  for (const sym of ["register", "fnAlpha", "Widget"]) {
    const truth = t.definerOf(sym);
    items.push(turnsItem(ctxSet(`${sym} is defined by which module`, truth), {
      say: `${sym} is defined by which module`, expect: expectSet(t, truth),
    }));
  }
  for (const c of ["Base", "Widget", "Button"]) {
    const truth = t.subclassesOf(c);
    items.push(turnsItem(ctxSet(`${c} is inherited by which classes`, truth), {
      say: `${c} is inherited by which classes`, expect: expectSet(t, truth),
    }));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/e.mjs", "app/lib/f.mjs"]) {
    const truth = t.importersOf(m);
    items.push(turnsItem(
      `REVERSIBLE PASSIVE: the patient is ${m}. ${ctxSet(`by which modules is ${m} imported`, truth)}`,
      { say: `by which modules is ${m} imported`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/functions/d/handler.mjs", "app/lib/a.mjs"]) {
    const truth = t.reexportsOf(m);
    items.push(turnsItem(ctxSet(`which symbols are re-exported by ${m}`, truth), {
      say: `which symbols are re-exported by ${m}`, expect: expectSet(t, truth),
    }));
  }
  items.push(turnsItem(
    "Ground truth: the module that imports app/lib/b.mjs is app/functions/d/handler.mjs; nothing tests-by it (it is not a test module) — honest empty.",
    { say: "which modules are tested by the module that imports app/lib/b.mjs", expect: { miss: true, answerNotMatch: ["I answer questions about"] } },
  ));
  for (const m of ["app/lib/b.mjs", "app/lib/a.mjs"]) {
    const truth = t.testsCovering(m);
    items.push(turnsItem(ctxSet(`who is ${m} tested by`, truth), {
      say: `who is ${m} tested by`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

function b2Relative(t) {
  const items = [];
  const mods = t.modules.map((i) => t.label(i));
  const syms = ["fnAlpha", "Widget", "register"];
  for (const sym of syms) {
    const mod = t.definerOf(sym)[0];
    const truth = t.importersOf(mod);
    for (const stem of [`which modules import the module that defines ${sym}`, `what imports the module that defines ${sym}`]) {
      items.push(turnsItem(
        `The module that defines ${sym} is ${mod}. ${ctxSet(stem, truth)}`,
        { say: stem, expect: expectSet(t, truth) },
      ));
    }
  }
  for (const m of mods) {
    const truth = [...new Set(t.importersOf(m).flatMap((u) => t.importersOf(u)))];
    items.push(turnsItem(
      `Two-hop: importers of ${m} are {${t.importersOf(m).join(", ") || "none"}}; the answer is what imports THOSE. ${ctxSet(`what imports something that imports ${m}`, truth)}`,
      { say: `what imports something that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"]) {
    const truth = [...new Set(t.importersOf(m).flatMap((u) => t.testsCovering(u)))];
    items.push(turnsItem(
      `Importers of ${m}: {${t.importersOf(m).join(", ") || "none"}}. ${ctxSet(`which tests cover something that imports ${m}`, truth)}`,
      { say: `which tests cover something that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of syms) {
    const mod = t.definerOf(sym)[0];
    const truth = t.testsCovering(mod);
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}. ${ctxSet(`which tests cover the module that defines ${sym}`, truth)}`,
      { say: `which tests cover the module that defines ${sym}`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of syms) {
    const mod = t.definerOf(sym)[0];
    for (const [stem, truth] of [
      [`what calls something that defines ${sym}`, t.callersOf(mod)],
      [`what calls the module that defines ${sym}`, t.callersOf(mod)],
      [`who touched the module that defines ${sym}`, t.touchedBy(mod)],
      [`which commit touched the module that defines ${sym}`, t.touchedBy(mod).filter((x) => x === "abc1234")],
      [`which modules cochange with the module that defines ${sym}`, t.cochangeOf(mod)],
    ]) {
      items.push(turnsItem(
        `The module that defines ${sym} is ${mod}. ${ctxSet(stem, truth)}`,
        { say: stem, expect: expectSet(t, truth) },
      ));
    }
  }
  for (const c of ["Widget", "Base", "Button"]) {
    const mod = t.site(t.id(c));
    const truth = ["Widget.render"].filter((m) => t.site(t.id(m)) === mod);
    items.push(turnsItem(
      `The module that defines ${c} is ${mod}. ${ctxSet(`public methods in the module that defines ${c}`, truth)}`,
      { say: `public methods in the module that defines ${c}`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of mods) {
    const truth = [...new Set(t.importersOf(m).flatMap((u) => t.importersOf(u)))];
    items.push(turnsItem(
      `"the module that imports ${m}" resolves to {${t.importersOf(m).join(", ") || "none"}}; the answer is what imports those. ${ctxSet(`which modules import the module that imports ${m}`, truth)}`,
      { say: `which modules import the module that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of syms) {
    const mod = t.definerOf(sym)[0];
    const truth = [...new Set([...t.importersOf(mod), ...t.callersOf(mod)])];
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}; its users are importers plus callers. ${ctxSet(`what uses the module that defines ${sym}`, truth)}`,
      { say: `what uses the module that defines ${sym}`, expect: expectSet(t, truth) },
    ));
  }
  return items;
}

function b2Coordination(t) {
  const items = [];
  const pairs = [];
  const P = ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"];
  for (let i = 0; i < P.length; i += 1) for (let j = i + 1; j < P.length; j += 1) pairs.push([P[i], P[j]]);
  const inter = (x, y) => t.importersOf(x).filter((m) => t.importersOf(y).includes(m));
  const uni = (x, y) => [...new Set([...t.importersOf(x), ...t.importersOf(y)])];
  for (const [x, y] of pairs) {
    const truth = inter(x, y);
    items.push(turnsItem(ctxSet(`modules that import ${x} and import ${y}`, truth), {
      say: `modules that import ${x} and import ${y}`, expect: expectSet(t, truth),
    }));
  }
  for (const [x, y] of pairs) {
    const truth = uni(x, y);
    items.push(turnsItem(ctxSet(`modules importing ${x} or ${y}`, truth), {
      say: `modules importing ${x} or ${y}`, expect: expectSet(t, truth),
    }));
  }
  for (const [x, y] of pairs) {
    const truth = uni(x, y);
    items.push(turnsItem(ctxSet(`modules that import ${x} or import ${y}`, truth), {
      say: `modules that import ${x} or import ${y}`, expect: expectSet(t, truth),
    }));
  }
  for (const x of P) {
    const truth = t.importersOf(x).filter((m) => !t.isTested(t.id(m)));
    items.push(turnsItem(ctxSet(`modules importing ${x} but not tested`, truth), {
      say: `modules importing ${x} but not tested`, expect: expectSet(t, truth),
    }));
  }
  for (const x of P) {
    const truth = t.importersOf(x).filter((m) => t.isTested(t.id(m)));
    items.push(turnsItem(ctxSet(`modules importing ${x} and tested`, truth), {
      say: `modules importing ${x} and tested`, expect: expectSet(t, truth),
    }));
  }
  for (const c of ["Base", "Widget", "Button"]) {
    const truth = t.subclassesOf(c).filter((x) => t.isTested(t.id(x)));
    items.push(turnsItem(ctxSet(`classes inheriting from ${c} and tested`, truth), {
      say: `classes inheriting from ${c} and tested`, expect: expectSet(t, truth),
    }));
  }
  for (const [c1, c2] of [["Base", "Widget"], ["Widget", "Button"], ["Base", "Button"]]) {
    const truth = [...new Set([...t.subclassesOf(c1), ...t.subclassesOf(c2)])];
    items.push(turnsItem(ctxSet(`classes inheriting from ${c1} or inheriting from ${c2}`, truth), {
      say: `classes inheriting from ${c1} or inheriting from ${c2}`, expect: expectSet(t, truth),
    }));
  }
  for (const [x, y] of pairs.slice(0, 5)) {
    const truth = uni(x, y);
    items.push(turnsItem(ctxSet(`which modules import ${x} or ${y}`, truth), {
      say: `which modules import ${x} or ${y}`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

function b2Discourse(t) {
  const items = [];
  const mods = ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "app/functions/d/handler.mjs"];
  for (const m of mods) {
    items.push(turnsItem(
      `Turns 2-3 stay about ${m}: "it" and "that" both bind to it. ${ctxSet(`what does it import (it = ${m})`, t.importsOf(m))} ${ctxSet(`who touched that (that = ${m})`, t.touchedBy(m))}`,
      { say: `which modules import ${m}`, expect: {} },
      { say: "what does it import", expect: expectSet(t, t.importsOf(m)) },
      { say: "who touched that", expect: expectSet(t, t.touchedBy(m)) },
    ));
  }
  for (const m of mods) {
    items.push(turnsItem(
      `The classic drift trap: in turns 2 and 3 "it" refers to ${m} (the subject of turn 1) throughout. ${ctxSet(`what calls it (it = ${m})`, t.callersOf(m))} ${ctxSet(`which modules import it (it = ${m})`, t.importersOf(m))}`,
      { say: `/describe ${m}`, expect: { miss: false } },
      { say: "what calls it", expect: expectSet(t, t.callersOf(m)) },
      { say: "which modules import it", expect: expectSet(t, t.importersOf(m)) },
    ));
  }
  const anchors = [
    { say: "which modules import app/lib/a.mjs", set: () => t.importersOf("app/lib/a.mjs") },
    { say: "which classes inherit from Base", set: () => t.subclassesOf("Base") },
    { say: "list the classes", set: () => t.classes.map((i) => t.label(i)) },
    { say: "what does app/lib/e.mjs import", set: () => t.importsOf("app/lib/e.mjs") },
    { say: "list the modules", set: () => t.modules.map((i) => t.label(i)) },
  ];
  for (const a of anchors) {
    const tested = a.set().filter((x) => t.isTested(t.id(x)));
    items.push(turnsItem(
      `Turn 2 expands turn 1 ("why"); turn 3's "those" refers to turn 1's answer set. ${ctxSet("which of those are tested", tested)}`,
      { say: a.say, expect: { miss: false } },
      { say: "why", expect: { miss: false, answerMatch: [`expanding: ${esc(a.say)}`] } },
      { say: "which of those are tested", expect: expectSet(t, tested) },
    ));
  }
  const aboutTriples = [["app/lib/e.mjs", "app/lib/c.mjs", "app/lib/b.mjs"], ["app/lib/b.mjs", "app/lib/f.mjs", "app/lib/e.mjs"], ["app/lib/c.mjs", "app/lib/a.mjs", "app/lib/f.mjs"], ["app/lib/a.mjs", "app/lib/e.mjs", "app/lib/c.mjs"], ["app/lib/f.mjs", "app/lib/b.mjs", "app/lib/a.mjs"]];
  for (const [m1, m2, m3] of aboutTriples) {
    items.push(turnsItem(
      `Turns 2 and 3 re-ask turn 1's question shape for ${m2} then ${m3}. ${ctxSet(`what does ${m2} import`, t.importsOf(m2))} ${ctxSet(`what does ${m3} import`, t.importsOf(m3))}`,
      { say: `what does ${m1} import`, expect: {} },
      { say: `what about ${m2}`, expect: expectSet(t, t.importsOf(m2)) },
      { say: `and what about ${m3}`, expect: expectSet(t, t.importsOf(m3)) },
    ));
  }
  for (const a of anchors) {
    const set = a.set();
    const tested = set.filter((x) => t.isTested(t.id(x)));
    items.push(turnsItem(
      `Turn 2 filters turn 1's set by test coverage; turn 3 counts turn 2's result. Ground truth: tested subset {${tested.join(", ") || "none"}}, count ${tested.length}.`,
      { say: a.say, expect: {} },
      { say: "which of those are tested", expect: expectSet(t, tested) },
      { say: "how many of those", expect: { miss: false, answerMatch: [`^${tested.length} `] } },
    ));
  }
  return items;
}

function b2Assert(t) {
  const subjects = [
    { word: "module", plural: "modules", cls: "Module", sample: "app/lib/a.mjs" },
    { word: "class", plural: "classes", cls: "Class", sample: "Widget" },
    { word: "function", plural: "functions", cls: "Function", sample: "fnAlpha" },
    { word: "method", plural: "methods", cls: "Method", sample: "Widget.render" },
    { word: "commit", plural: "commits", cls: "Commit", sample: "abc1234" },
  ];
  const objects = ["component", "type", "unit", "artifact", "thing"];
  const items = [];
  subjects.forEach((s, si) => {
    objects.forEach((o, oi) => {
      const n = t.ofClass(s.cls).length;
      const recallKind = (si + oi) % 3;
      const assertTurn = {
        say: `every ${s.word} is a ${o}`, session: 1,
        expect: { miss: false, answerMatch: ["noted — remembered 1 fact"] },
      };
      let recallTurn;
      let recallCtx;
      if (recallKind === 0) {
        recallTurn = { say: `how many ${o}s are there`, session: 1, expect: { miss: false, answerMatch: [`^${n} (${o}s|${s.plural})\\.$`] } };
        recallCtx = `after the assertion, every ${s.word} is a ${o}, so the count of ${o}s equals the count of ${s.plural}: ${n}.`;
      } else if (recallKind === 1) {
        recallTurn = { say: `is ${s.sample} a ${o}`, session: 1, expect: { miss: false, answerMatch: ["^Yes"] } };
        recallCtx = `after the assertion, ${s.sample} (a ${s.word}) is a ${o}; the correct answer is yes.`;
      } else {
        recallTurn = { say: `what is a ${o}`, session: 1, expect: { miss: false, answerMatch: [s.word] } };
        recallCtx = `after the assertion, "${o}" is remembered vocabulary: every ${s.word} is a ${o}.`;
      }
      items.push(sessionItem(
        `Turn 1 declares "every ${s.word} is a ${o}" — the engine should store it as a fact and confirm; ${recallCtx}`,
        assertTurn, recallTurn,
      ));
    });
  });
  return items;
}

function b2CountTemp(t) {
  const items = [];
  for (const m of t.modules.map((i) => t.label(i))) {
    const n = t.touchedBy(m).filter((x) => x === "abc1234").length;
    items.push(turnsItem(
      `Ground truth: exactly ${n} commit(s) touched ${m} at module grain.`,
      { say: `how many commits touched ${m}`, expect: expectCount(n, "commit", "commits") },
    ));
  }
  for (const say of ["how many modules did abc1234 touch", "how many modules did commit abc1234 touch"]) {
    items.push(turnsItem(
      "Ground truth: commit abc1234 touched exactly 1 module (app/lib/a.mjs).",
      { say, expect: expectCount(1, "module", "modules") },
    ));
  }
  for (const s of ["Widget.render", "fnAlpha", "Base"]) {
    const n = t.touchedBy(s).length;
    items.push(turnsItem(
      `Ground truth: exactly ${n} commit(s) touched ${s} (symbol grain).`,
      { say: `how many commits touched ${s}`, expect: expectCount(n, "commit", "commits") },
    ));
  }
  items.push(turnsItem(
    "Ground truth: exactly 1 module changed on 2026-06-28 (app/lib/a.mjs, via abc1234).",
    { say: "how many modules changed on 2026-06-28", expect: expectCount(1, "module", "modules") },
  ));
  items.push(turnsItem(
    "Ground truth: nothing is recorded after abc1234 (the only commit) — 0 modules.",
    { say: "how many modules changed after abc1234", expect: expectCount(0, "module", "modules") },
  ));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs"]) {
    const n = t.touchedBy(m).length;
    items.push(turnsItem(
      `Ground truth: ${m} has ${n} recorded commit(s) at module grain.`,
      { say: `how many commits are recorded for ${m}`, expect: expectCount(n, "commit", "commits") },
    ));
  }
  items.push(turnsItem(
    "Ground truth: app/lib/a.mjs is the only module a commit touched, so it changed most recently.",
    { say: "which module changed most recently", expect: { miss: false, answeredIdsInclude: ["mod-a"], answerMatch: ["app/lib/a\\.mjs"] } },
  ));
  items.push(turnsItem(
    "Ground truth: commit abc1234 touched exactly 1 symbol (Widget.render).",
    { say: "how many symbols did abc1234 touch", expect: expectCount(1, "symbol", "symbols") },
  ));
  for (const sym of ["fnAlpha", "Widget", "register"]) {
    const mod = t.definerOf(sym)[0];
    const n = t.touchedBy(mod).filter((x) => x === "abc1234").length;
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}; ${n} commit(s) touched it.`,
      { say: `how many commits touched the module that defines ${sym}`, expect: expectCount(n, "commit", "commits") },
    ));
  }
  items.push(turnsItem(
    "Ground truth: exactly 1 module changed on 2026-06-28 (app/lib/a.mjs).",
    { say: "which modules changed on 2026-06-28", expect: { miss: false, answeredIdsInclude: ["mod-a"], answerMatch: ["app/lib/a\\.mjs"] } },
  ));
  return items;
}

function b2NoisePron(t) {
  const mods = ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"];
  const followups = [
    { say: "um so what does it import then", truth: (m) => t.importsOf(m), q: "what does it import" },
    { say: "could you tell me what it defines", truth: (m) => t.definesOf(m), q: "what does it define" },
    { say: "hey tmct, what calls it thanks", truth: (m) => t.callersOf(m), q: "what calls it" },
    { say: "so what does it import", truth: (m) => t.importsOf(m), q: "what does it import" },
    { say: "i was wondering who touched it", truth: (m) => t.touchedBy(m), q: "who touched it" },
  ];
  const items = [];
  for (const m of mods) {
    for (const f of followups) {
      const truth = f.truth(m);
      items.push(turnsItem(
        `Turn 2 wraps "${f.q}" in conversational noise; "it" refers to ${m}. ${ctxSet(`${f.q} (it = ${m})`, truth)}`,
        { say: `/describe ${m}`, expect: { miss: false } },
        { say: f.say, expect: expectSet(t, truth) },
      ));
    }
  }
  return items;
}

function c1Temporal(t) {
  const items = [];
  for (const m of ["app/lib/f.mjs", "app/lib/a.mjs", "app/lib/b.mjs", "app/lib/e.mjs", "app/lib/c.mjs"]) {
    const importers = t.importersOf(m);
    const truth = [...new Set(importers.flatMap((u) => t.touchedBy(u)))];
    items.push(turnsItem(
      `"the module that imports ${m}" = {${importers.join(", ") || "none"}}. ${ctxSet(`who touched the module that imports ${m}`, truth)}`,
      { say: `who touched the module that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of ["Widget", "fnAlpha", "register"]) {
    const mod = t.definerOf(sym)[0];
    const touched = t.touchedBy(mod);
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}; ${touched.length ? `it was touched by abc1234 on 2026-06-28` : "no commit touches it"}.`,
      { say: `when did the module that defines ${sym} change`, expect: touched.length ? { miss: false, answerMatch: ["abc1234"] } : { miss: true, answerNotMatch: ["I answer questions about"] } },
    ));
  }
  for (const m of ["app/lib/f.mjs", "app/lib/b.mjs", "app/lib/a.mjs", "app/lib/c.mjs"]) {
    const importers = t.importersOf(m);
    const truth = [...new Set(importers.flatMap((u) => t.touchedBy(u)))];
    items.push(turnsItem(
      `"the module that imports ${m}" = {${importers.join(", ") || "none"}}; the answer reports its commit history. ${ctxSet(`when did the module that imports ${m} change`, truth)}`,
      { say: `when did the module that imports ${m} change`, expect: truth.length ? { miss: false, answerMatch: truth.map(esc) } : { miss: true, answerNotMatch: ["I answer questions about"] } },
    ));
  }
  items.push(turnsItem(
    "Ground truth: the only recorded change is abc1234 on 2026-06-28, which is after 2026-06-01.",
    { say: "what changed since 2026-06-01", expect: { miss: false, answerMatch: ["abc1234"] } },
  ));
  items.push(turnsItem(
    "Ground truth: nothing is recorded before abc1234 (the only commit) — the honest answer is empty.",
    { say: "what changed before abc1234", expect: { miss: true, answerNotMatch: ["I answer questions about"] } },
  ));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs"]) {
    const touched = t.touchedBy(m);
    items.push(turnsItem(
      touched.length ? "Ground truth: the last change to app/lib/a.mjs is commit abc1234 (2026-06-28)." : `Ground truth: no recorded commit ever changed ${m} — honest empty.`,
      { say: `what was the last change to ${m}`, expect: touched.length ? { miss: false, answerMatch: ["abc1234"] } : { miss: true, answerNotMatch: ["I answer questions about"] } },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs"]) {
    const truth = t.cochangeOf(m);
    items.push(turnsItem(
      `Ground truth: change-coupled partners of ${m}: ${truth.join(", ") || "none"} (cochange edges).`,
      { say: `which modules changed together with ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of ["Widget.render", "fnAlpha"]) {
    const truth = t.touchedBy(sym).filter((x) => x === "abc1234");
    items.push(turnsItem(
      truth.length ? "Ground truth: commit abc1234 touched Widget.render (touchesSymbol)." : `Ground truth: no commit touched ${sym} — honest empty.`,
      { say: `which commit touched ${sym}`, expect: truth.length ? { miss: false, answeredIdsInclude: ["commit-abc"], answerMatch: ["abc1234"] } : { miss: true, answerNotMatch: ["I answer questions about"] } },
    ));
  }
  for (const say of ["who authored commit abc1234", "who is the author of abc1234"]) {
    items.push(turnsItem(
      "Ground truth: commit abc1234 was authored by Ada Lovelace.",
      { say, expect: { miss: false, answerMatch: ["Ada Lovelace"] } },
    ));
  }
  items.push(turnsItem(
    "Ground truth: abc1234 is the newest (and only) commit entity.",
    { say: "what is the newest commit", expect: { miss: false, answeredIdsInclude: ["commit-abc"], answerMatch: ["abc1234"] } },
  ));
  return items;
}

function c1Relative(t) {
  const items = [];
  const hop = (set) => [...new Set(set.flatMap((u) => t.importersOf(u)))];
  for (const m of t.modules.map((i) => t.label(i))) {
    const truth = hop(hop(t.importersOf(m)));
    items.push(turnsItem(
      `Three-hop import chain ending at ${m}. ${ctxSet(`what imports something that imports something that imports ${m}`, truth)}`,
      { say: `what imports something that imports something that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/lib/f.mjs", "app/lib/b.mjs", "app/lib/a.mjs", "app/lib/c.mjs"]) {
    const importers = t.importersOf(m);
    const truth = [...new Set(importers.flatMap((u) => t.definesOf(u)))].filter((x) => t.byLabel.get(x)?.class === "Function");
    items.push(turnsItem(
      `"the module that imports ${m}" = {${importers.join(", ") || "none"}}. ${ctxSet(`functions defined in the module that imports ${m}`, truth)}`,
      { say: `functions defined in the module that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/lib/f.mjs", "app/lib/b.mjs", "app/lib/a.mjs"]) {
    const importers = t.importersOf(m);
    const truth = [...new Set(importers.flatMap((u) => t.definesOf(u)))].filter((x) => t.byLabel.get(x)?.class === "Function");
    items.push(turnsItem(
      `"the module that imports ${m}" = {${importers.join(", ") || "none"}}. ${ctxSet(`list functions in the module that imports ${m}`, truth)}`,
      { say: `list functions in the module that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  items.push(turnsItem(
    "Ground truth: scripts/g.mjs calls app/lib/a.mjs, which defines fnAlpha.",
    { say: "functions defined in the module that scripts/g.mjs calls", expect: { miss: false, answeredIdsInclude: ["fn-alpha"], answerMatch: ["fnAlpha"] } },
  ));
  items.push(turnsItem(
    "Ground truth: Widget.render calls fnAlpha; fnAlpha is defined in app/lib/a.mjs; the modules importing app/lib/a.mjs are app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.",
    { say: "which modules import the module that defines the function that Widget.render calls", expect: expectSet(t, t.importersOf("app/lib/a.mjs")) },
  ));
  for (const m of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/f.mjs", "app/lib/c.mjs"]) {
    const two = hop(t.importersOf(m));
    const truth = [...new Set(two.flatMap((u) => t.testsCovering(u)))];
    items.push(turnsItem(
      `Two-hop importers of ${m}: {${two.join(", ") || "none"}}. ${ctxSet(`which tests cover something that imports something that imports ${m}`, truth)}`,
      { say: `which tests cover something that imports something that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of ["app/lib/a.mjs", "app/lib/f.mjs"]) {
    const truth = [...new Set(t.importersOf(m).flatMap((u) => t.callersOf(u)))];
    items.push(turnsItem(
      `Callers of the importers of ${m}. ${ctxSet(`what calls something that imports ${m}`, truth)}`,
      { say: `what calls something that imports ${m}`, expect: expectSet(t, truth) },
    ));
  }
  items.push(turnsItem(
    "Ground truth: app/functions/d/handler.mjs re-exports fnAlpha, which is defined in app/lib/a.mjs at line 12.",
    { say: "where is the function that app/functions/d/handler.mjs re-exports defined", expect: { miss: false, answerMatch: ["app/lib/a\\.mjs"] } },
  ));
  items.push(turnsItem(
    "Ground truth: only Widget.render is a method in the module that defines Widget (app/lib/b.mjs), and it is not static — honest empty.",
    { say: "static methods in the module that defines Widget", expect: { miss: true, answerNotMatch: ["I answer questions about"] } },
  ));
  for (const m of ["app/lib/a.mjs", "app/lib/f.mjs"]) {
    const truth = [...new Set(t.importersOf(m).flatMap((u) => t.touchedBy(u)))].filter((x) => x === "abc1234");
    items.push(turnsItem(
      `Commits touching the importers of ${m}. ${ctxSet(`which commit touched something that imports ${m}`, truth)}`,
      { say: `which commit touched something that imports ${m}`, expect: truth.length ? { miss: false, answeredIdsInclude: ["commit-abc"], answerMatch: ["abc1234"] } : { miss: true, answerNotMatch: ["I answer questions about"] } },
    ));
  }
  return items;
}

function c1Coordination(t) {
  const items = [];
  const P = ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs"];
  const uni = (x, y) => [...new Set([...t.importersOf(x), ...t.importersOf(y)])];
  for (const [c1, c2] of [["Base", "Widget"], ["Widget", "Base"], ["Base", "Button"]]) {
    // both precedence readings agree on this fixture: ((A∪B)∩tested) == (A∪(B∩tested)) is checked below
    const A = t.subclassesOf(c1);
    const B = t.subclassesOf(c2);
    const tested = (s) => s.filter((x) => t.isTested(t.id(x)));
    const r1 = tested([...new Set([...A, ...B])]);
    const r2 = [...new Set([...A, ...tested(B)])].sort();
    if (JSON.stringify([...r1].sort()) !== JSON.stringify(r2)) continue; // keep only precedence-agnostic items
    items.push(turnsItem(ctxSet(`classes inheriting from ${c1} or inheriting from ${c2} and tested`, r1), {
      say: `classes inheriting from ${c1} or inheriting from ${c2} and tested`, expect: expectSet(t, r1),
    }));
  }
  const pairs = [];
  for (let i = 0; i < P.length; i += 1) for (let j = i + 1; j < P.length; j += 1) pairs.push([P[i], P[j]]);
  for (const [x, y] of pairs) {
    const U = uni(x, y);
    const notTested = (s) => s.filter((m) => !t.isTested(t.id(m)));
    const r1 = notTested(U);
    const r2 = [...new Set([...t.importersOf(x), ...notTested(t.importersOf(y))])].sort();
    if (JSON.stringify([...r1].sort()) !== JSON.stringify(r2)) continue; // precedence-agnostic items only (fair to either reading)
    items.push(turnsItem(ctxSet(`modules importing ${x} or importing ${y} but not tested`, r1), {
      say: `modules importing ${x} or importing ${y} but not tested`, expect: expectSet(t, r1),
    }));
  }
  for (const c of ["Base", "Widget", "Button"]) {
    const truth = t.subclassesOf(c).filter((x) => !t.isTested(t.id(x)));
    items.push(turnsItem(ctxSet(`untested classes inheriting from ${c}`, truth), {
      say: `untested classes inheriting from ${c}`, expect: expectSet(t, truth),
    }));
  }
  for (const [x, y] of pairs.slice(0, 4)) {
    const truth = t.importersOf(x).filter((m) => t.importersOf(y).includes(m) && t.isTested(t.id(m)));
    items.push(turnsItem(ctxSet(`modules importing ${x} and importing ${y} and tested`, truth), {
      say: `modules importing ${x} and importing ${y} and tested`, expect: expectSet(t, truth),
    }));
  }
  for (const x of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/f.mjs", "app/lib/e.mjs"]) {
    const truth = t.importersOf(x).filter((m) => !t.isTested(t.id(m)));
    items.push(turnsItem(ctxSet(`untested modules importing ${x}`, truth), {
      say: `untested modules importing ${x}`, expect: expectSet(t, truth),
    }));
  }
  items.push(turnsItem(
    "Ground truth: no class directly inherits from both Base and Widget — honest empty (Button's direct base is Widget only).",
    { say: "classes inheriting from Base and inheriting from Widget", expect: { miss: true, answerNotMatch: ["I answer questions about"] } },
  ));
  for (const x of ["app/lib/a.mjs", "app/lib/b.mjs", "app/lib/f.mjs"]) {
    const truth = t.importersOf(x).filter((m) => t.isTested(t.id(m)));
    items.push(turnsItem(ctxSet(`tested modules importing ${x}`, truth), {
      say: `tested modules importing ${x}`, expect: expectSet(t, truth),
    }));
  }
  for (const [x, y] of [["app/lib/a.mjs", "app/lib/f.mjs"], ["app/lib/b.mjs", "app/lib/c.mjs"], ["app/lib/a.mjs", "app/lib/b.mjs"], ["app/lib/e.mjs", "app/lib/a.mjs"], ["app/lib/f.mjs", "app/lib/a.mjs"], ["app/lib/c.mjs", "app/lib/b.mjs"], ["app/lib/a.mjs", "app/lib/c.mjs"], ["app/lib/b.mjs", "app/lib/a.mjs"]]) {
    const truth = t.importersOf(x).filter((m) => !t.importersOf(y).includes(m));
    items.push(turnsItem(ctxSet(`modules that import ${x} but do not import ${y}`, truth), {
      say: `modules that import ${x} but do not import ${y}`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

function c1Assert(t) {
  const items = [];
  const pairs = [
    ["module", "modules", "component", 8], ["class", "classes", "type", 3], ["module", "modules", "unit", 8],
    ["class", "classes", "category", 3], ["module", "modules", "artifact", 8],
  ];
  // cross-session recall — three recall surfaces per assert pair
  for (const [sing, plur, obj, n] of pairs) {
    items.push(sessionItem(
      `Session 1 asserted "every ${sing} is a ${obj}"; session 2 asks what was said. The correct recall names the fact.`,
      { say: `every ${sing} is a ${obj}`, session: 1, expect: { miss: false, answerMatch: ["noted — remembered 1 fact"] } },
      { say: "what did i tell you last time", session: 2, expect: { miss: false, answerMatch: [obj] } },
    ));
    items.push(sessionItem(
      `Session 1 asserted "every ${sing} is a ${obj}"; the fact is durable memory, so session 2's count of ${obj}s equals the count of ${plur} (${n}).`,
      { say: `every ${sing} is a ${obj}`, session: 1, expect: { miss: false, answerMatch: ["noted — remembered 1 fact"] } },
      { say: `how many ${obj}s are there`, session: 2, expect: { miss: false, answerMatch: [`^${n} (${obj}s|${plur})\\.$`] } },
    ));
    items.push(sessionItem(
      `Session 1 asserted "every ${sing} is a ${obj}"; session 2 asks for known facts — the correct answer recalls it.`,
      { say: `every ${sing} is a ${obj}`, session: 1, expect: { miss: false, answerMatch: ["noted — remembered 1 fact"] } },
      { say: "what facts do you know", session: 2, expect: { miss: false, answerMatch: [obj] } },
    ));
  }
  // two-fact single-session with a definitional recall
  const duos = [
    ["module", "component", "class", "type"], ["class", "type", "module", "component"],
    ["module", "unit", "class", "kind"], ["class", "category", "module", "part"],
    ["function", "routine", "module", "component"], ["module", "component", "commit", "change"],
    ["class", "type", "function", "helper"], ["module", "artifact", "class", "type"],
    ["method", "operation", "module", "component"], ["module", "component", "class", "category"],
  ];
  for (const [s1, o1, s2, o2] of duos) {
    items.push(sessionItem(
      `Two facts are asserted; "what is a ${o1}" should recall that every ${s1} is a ${o1}.`,
      { say: `every ${s1} is a ${o1}`, session: 1, expect: { miss: false, answerMatch: ["noted — remembered 1 fact"] } },
      { say: `every ${s2} is a ${o2}`, session: 1, expect: { miss: false, answerMatch: ["noted — remembered 1 fact"] } },
      { say: `what is a ${o1}`, session: 1, expect: { miss: false, answerMatch: [s1] } },
    ));
  }
  return items;
}

function c1NegRel(t) {
  const items = [];
  for (const sym of ["fnAlpha", "Widget", "register"]) {
    const mod = t.definerOf(sym)[0];
    const truth = t.importersOf(mod).filter((m) => !t.isTested(t.id(m)));
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}; the tested importer(s) must be EXCLUDED. ${ctxSet(`modules importing the module that defines ${sym} but not tested`, truth)}`,
      { say: `modules importing the module that defines ${sym} but not tested`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of ["fnAlpha", "Widget", "register"]) {
    const mod = t.definerOf(sym)[0];
    const truth = t.importersOf(mod).filter((m) => t.isTested(t.id(m)));
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}. ${ctxSet(`modules that import the module that defines ${sym} and tested`, truth)}`,
      { say: `modules that import the module that defines ${sym} and tested`, expect: expectSet(t, truth) },
    ));
  }
  for (const m of t.modules.map((i) => t.label(i))) {
    const two = [...new Set(t.importersOf(m).flatMap((u) => t.importersOf(u)))];
    const truth = two.filter((x) => !t.isTested(t.id(x)));
    items.push(turnsItem(
      `Two-hop importers of ${m}: {${two.join(", ") || "none"}}; tested ones excluded. ${ctxSet(`modules importing something that imports ${m} but not tested`, truth)}`,
      { say: `modules importing something that imports ${m} but not tested`, expect: expectSet(t, truth) },
    ));
  }
  for (const sym of ["fnAlpha", "Widget", "register"]) {
    const mod = t.definerOf(sym)[0];
    const truth = t.importersOf(mod).filter((m) => !t.isTested(t.id(m)));
    items.push(turnsItem(
      `The module that defines ${sym} is ${mod}. ${ctxSet(`untested modules that import the module that defines ${sym}`, truth)}`,
      { say: `untested modules that import the module that defines ${sym}`, expect: expectSet(t, truth) },
    ));
  }
  for (const [x, y] of [["app/lib/a.mjs", "app/lib/f.mjs"], ["app/lib/b.mjs", "app/lib/c.mjs"], ["app/lib/a.mjs", "app/lib/b.mjs"], ["app/lib/e.mjs", "app/lib/a.mjs"], ["app/lib/f.mjs", "app/lib/e.mjs"], ["app/lib/c.mjs", "app/lib/a.mjs"], ["app/lib/a.mjs", "app/lib/e.mjs"], ["app/lib/b.mjs", "app/lib/a.mjs"]]) {
    const truth = t.importersOf(x).filter((m) => !t.importersOf(y).includes(m));
    items.push(turnsItem(ctxSet(`modules that import ${x} but don't import ${y}`, truth), {
      say: `modules that import ${x} but don't import ${y}`, expect: expectSet(t, truth),
    }));
  }
  return items;
}

/** C2 Winograd-STYLE items: ORIGINAL schemas over the code domain (never
 *  instrument content) — the final question is answerable only by binding the
 *  pronoun, and the desired answer is the bare entity, never a yes/no. */
function c2Winograd(t) {
  const items = [];
  const wgExpect = (winner) => ({ miss: false, answerMatch: [`${esc(winner)}`], answerNotMatch: ["^Yes\\.", "^No\\b"] });
  const importEdges = [["app/lib/b.mjs", "app/lib/a.mjs", "fnAlpha"], ["app/lib/c.mjs", "app/lib/a.mjs", "fnAlpha"], ["app/lib/e.mjs", "app/lib/a.mjs", "fnAlpha"], ["app/functions/d/handler.mjs", "app/lib/b.mjs", "Widget"]];
  for (const [X, Y, sym] of importEdges) {
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to ${Y} (the module that defines ${sym}); the answer is ${Y}, stated as the module itself.`,
      { say: `${X} imports ${Y} because it defines ${sym} — which of them defines ${sym}`, expect: wgExpect(Y) },
    ));
  }
  for (const [X, Y, sym] of importEdges) {
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to ${X} (the importer needs ${sym}); the answer is ${X}.`,
      { say: `${X} imports ${Y} because it needs ${sym} — which of them needs ${sym}`, expect: wgExpect(X) },
    ));
  }
  for (const m of ["app/lib/b.mjs", "app/functions/d/handler.mjs"]) {
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to app/unit-tests/b.test.mjs (the test that covers ${m}); the answer is the test module.`,
      { say: `app/unit-tests/b.test.mjs must not be deleted because it covers ${m} — which of them covers ${m}`, expect: wgExpect("app/unit-tests/b.test.mjs") },
    ));
  }
  const inheritEdges = [["Widget", "Base"], ["Button", "Widget"]];
  for (const [C1, C2] of inheritEdges) {
    const m1 = t.site(t.id(C1));
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to ${C1}, which is defined in ${m1}; the answer is ${C1}.`,
      { say: `${C1} inherits from ${C2} although it is defined in ${m1} — which of them is defined in ${m1}`, expect: wgExpect(C1) },
    ));
    const m2 = t.site(t.id(C2));
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to ${C2}, which is defined in ${m2}; the answer is ${C2}.`,
      { say: `${C1} inherits from ${C2} although it is defined in ${m2} — which of them is defined in ${m2}`, expect: wgExpect(C2) },
    ));
  }
  items.push(turnsItem(
    "Winograd-style binding: \"it\" refers to fnAlpha (the widely used symbol); the answer is fnAlpha.",
    { say: "app/functions/d/handler.mjs re-exports fnAlpha because it is widely used — which of them is widely used", expect: wgExpect("fnAlpha") },
  ));
  items.push(turnsItem(
    "Winograd-style binding: \"it\" refers to app/functions/d/handler.mjs (the module wanting a stable surface); the answer is the handler module.",
    { say: "app/functions/d/handler.mjs re-exports fnAlpha because it wants a stable surface — which of them wants a stable surface", expect: wgExpect("app/functions/d/handler.mjs") },
  ));
  items.push(turnsItem(
    "Winograd-style binding: \"it\" refers to app/lib/a.mjs (which defines fnAlpha); the answer is app/lib/a.mjs.",
    { say: "scripts/g.mjs calls app/lib/a.mjs because it defines fnAlpha — which of them defines fnAlpha", expect: wgExpect("app/lib/a.mjs") },
  ));
  items.push(turnsItem(
    "Winograd-style binding: \"it\" refers to scripts/g.mjs (the caller needing a helper); the answer is scripts/g.mjs.",
    { say: "scripts/g.mjs calls app/lib/a.mjs because it needs a helper — which of them needs a helper", expect: wgExpect("scripts/g.mjs") },
  ));
  for (const [X, Y] of [["app/lib/a.mjs", "app/lib/b.mjs"], ["app/lib/a.mjs", "app/lib/c.mjs"]]) {
    items.push(turnsItem(
      `Winograd-style binding over a cochange pair: "it" refers to ${Y} (${Y} imports ${X === "app/lib/a.mjs" ? "app/lib/a.mjs" : X}, so IT depends on the other); the answer is ${Y}.`,
      { say: `${X} always changes together with ${Y} because it depends on ${X} — which of them depends on ${X}`, expect: wgExpect(Y) },
    ));
  }
  for (const [X, Y] of [["app/lib/b.mjs", "app/lib/a.mjs"], ["app/lib/c.mjs", "app/lib/a.mjs"], ["app/lib/e.mjs", "app/lib/f.mjs"], ["app/functions/d/handler.mjs", "app/lib/c.mjs"]]) {
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to ${X}, the module doing the importing; the answer is ${X}.`,
      { say: `${X} can't be removed before ${Y} because it still imports ${Y} — which of them still imports ${Y}`, expect: wgExpect(X) },
    ));
  }
  for (const [X, Y] of [["app/lib/b.mjs", "app/lib/a.mjs"], ["app/lib/c.mjs", "app/lib/a.mjs"], ["app/lib/f.mjs", "app/lib/e.mjs"]]) {
    items.push(turnsItem(
      `Winograd-style binding: "it" refers to ${Y}, the module still being imported; the answer is ${Y}.`,
      { say: `${Y} can't be deleted because ${X} still imports it — which of them is still imported`, expect: wgExpect(Y) },
    ));
  }
  return items;
}

function c2Relative(t) {
  const items = [];
  const add = (say, truthLabels, ctx, expect) => items.push(turnsItem(ctx, { say, expect: expect ?? expectSet(t, truthLabels) }));
  add("which modules import the module that defines the function that Widget.render calls", t.importersOf("app/lib/a.mjs"),
    "Chain: Widget.render calls fnAlpha; fnAlpha is defined in app/lib/a.mjs; its importers are app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.");
  add("which tests cover the module that defines the class that Widget.render belongs to", ["app/unit-tests/b.test.mjs"],
    "Chain: Widget.render belongs to Widget; Widget is defined in app/lib/b.mjs; app/unit-tests/b.test.mjs covers it.");
  add("who touched the module that defines the function that app/functions/d/handler.mjs re-exports", ["abc1234"],
    "Chain: the handler re-exports fnAlpha; fnAlpha is defined in app/lib/a.mjs; abc1234 touched it.",
    { miss: false, answeredIdsInclude: ["commit-abc"], answerMatch: ["abc1234"] });
  add("which modules import the module that defines the class that inherits from Base", ["app/functions/d/handler.mjs"],
    "Chain: Widget inherits from Base; Widget is defined in app/lib/b.mjs; app/functions/d/handler.mjs imports it.");
  add("which modules import the module that defines the class that inherits from Widget", [],
    "Chain: Button inherits from Widget; Button is defined in app/lib/c.mjs; app/functions/d/handler.mjs imports app/lib/c.mjs — so the answer is app/functions/d/handler.mjs.",
    { miss: false, answeredIdsInclude: ["mod-d"], answerMatch: ["app/functions/d/handler\\.mjs"] });
  add("what imports the module that defines the method that calls fnAlpha", ["app/functions/d/handler.mjs"],
    "Chain: the method that calls fnAlpha is Widget.render, defined (sited) in app/lib/b.mjs; app/functions/d/handler.mjs imports it.");
  add("where is the function that app/functions/d/handler.mjs re-exports defined", null,
    "Chain: the handler re-exports fnAlpha; fnAlpha is defined in app/lib/a.mjs at line 12.",
    { miss: false, answerMatch: ["app/lib/a\\.mjs"] });
  add("which commit touched the module that defines the class that Widget.render belongs to", [],
    "Chain: Widget.render belongs to Widget, defined in app/lib/b.mjs; no commit ENTITY touches app/lib/b.mjs at module grain — honest empty.",
    { miss: true, answerNotMatch: ["I answer questions about"] });
  add("which tests cover the module that defines the function that Widget.render calls", [],
    "Chain: Widget.render calls fnAlpha, defined in app/lib/a.mjs; no test covers app/lib/a.mjs — honest empty.",
    { miss: true, answerNotMatch: ["I answer questions about"] });
  for (const T of ["app/lib/b.mjs", "app/functions/d/handler.mjs"]) {
    const truth = t.definesOf(T).filter((x) => t.byLabel.get(x)?.class === "Class");
    add(`which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named ${T}`, truth,
      `Chain: app/unit-tests/b.test.mjs covers ${T}; the classes defined there: ${truth.join(", ") || "none"}.`);
  }
  add("which module defines the function that the handler re-exports", ["app/lib/a.mjs"],
    "Chain: the handler (app/functions/d/handler.mjs) re-exports fnAlpha, defined in app/lib/a.mjs.");
  for (const C of ["Base", "Widget"]) {
    const sub = t.subclassesOf(C)[0];
    const mod = t.site(t.id(sub));
    add(`where is the class that inherits from ${C} defined`, null,
      `Chain: the class that inherits from ${C} is ${sub}, defined in ${mod}.`,
      { miss: false, answerMatch: [esc(mod)] });
  }
  add("where is the method that calls fnAlpha defined", null,
    "Chain: the method that calls fnAlpha is Widget.render, defined in app/lib/b.mjs at lines 5-9.",
    { miss: false, answerMatch: ["app/lib/b\\.mjs"] });
  add("who touched the method that Widget contains", null,
    "Chain: Widget contains render (Widget.render); commit abc1234 touched Widget.render (touchesSymbol).",
    { miss: false, answeredIdsInclude: ["commit-abc"], answerMatch: ["abc1234"] });
  add("what re-exports the function that app/lib/a.mjs defines", ["app/functions/d/handler.mjs"],
    "Chain: app/lib/a.mjs defines fnAlpha; app/functions/d/handler.mjs re-exports it.");
  add("what re-exports the function that app/lib/b.mjs defines", [],
    "Chain: app/lib/b.mjs defines no Function individuals (Widget is a Class, register a variable) — honest empty.",
    { miss: true, answerNotMatch: ["I answer questions about"] });
  for (const sym of ["fnAlpha", "Widget", "register"]) {
    const mod = t.definerOf(sym)[0];
    const truth = [...new Set(t.importersOf(mod).flatMap((u) => t.testsCovering(u)))];
    add(`which tests cover something that imports the module that defines ${sym}`, truth,
      `Chain: ${mod} defines ${sym}; its importers are {${t.importersOf(mod).join(", ") || "none"}}; the tests covering those: ${truth.join(", ") || "none"}.`);
  }
  add("what calls the module that defines the function that app/functions/d/handler.mjs re-exports", ["scripts/g.mjs"],
    "Chain: the handler re-exports fnAlpha; fnAlpha is defined in app/lib/a.mjs; scripts/g.mjs calls it.");
  add("which modules cochange with the module that defines the function that Widget.render calls", ["app/lib/b.mjs", "app/lib/c.mjs"],
    "Chain: Widget.render calls fnAlpha, defined in app/lib/a.mjs; its cochange partners are app/lib/b.mjs and app/lib/c.mjs.");
  add("which module defines the class that the class that inherits from Widget inherits from", ["app/lib/b.mjs"],
    "Chain: the class that inherits from Widget is Button; Button inherits from Widget; Widget is defined in app/lib/b.mjs.");
  add("what uses the module that defines the function that Widget.render calls", ["app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "scripts/g.mjs"],
    "Chain: fnAlpha lives in app/lib/a.mjs; its users (importers + callers) are app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs and scripts/g.mjs.");
  return items;
}

// ---- the cell → builder table ----

const BUILDERS = {
  "A1:naming-vocabulary": a1Naming,
  "A1:svo-query": a1Svo,
  "A1:quantifier-counting": a1Count,
  "A2:naming-vocabulary": a2Naming,
  "A2:svo-query": a2Svo,
  "A2:quantifier-counting": a2Count,
  "A2:pronoun-binding": a2Pronoun,
  "A2:negation": a2Negation,
  "A2:noise+svo-query": a2NoiseSvo,
  "B1:pronoun-binding": b1Pronoun,
  "B1:negation": b1Negation,
  "B1:reversible-passive": b1Passive,
  "B1:temporal": b1Temporal,
  "B1:discourse-reference": b1Discourse,
  "B1:pronoun-binding+negation": b1PronNeg,
  "B1:discourse-reference+quantifier-counting": b1DiscCount,
  "B2:reversible-passive": b2Passive,
  "B2:relative-embedded": b2Relative,
  "B2:coordination-compositional": b2Coordination,
  "B2:discourse-reference": b2Discourse,
  "B2:assert-recall": b2Assert,
  "B2:quantifier-counting+temporal": b2CountTemp,
  "B2:noise+pronoun-binding": b2NoisePron,
  "C1:temporal": c1Temporal,
  "C1:relative-embedded": c1Relative,
  "C1:coordination-compositional": c1Coordination,
  "C1:assert-recall": c1Assert,
  "C1:negation+relative-embedded": c1NegRel,
  "C2:pronoun-binding": c2Winograd,
  "C2:relative-embedded": c2Relative,
};

// ---- replay: auto-author expectations against the CURRENT engine ----

const TRUNCATE_OBSERVED = 240;

/** Replay one selected item; return the finished case (baselineFail marks +
 *  observed answers on turns whose desired checks the engine fails). */
export async function authorCase(item, id, cell, deps) {
  const caseDef = {
    id,
    tags: ["graded"],
    grade: cell.grade,
    construction: cell.construction,
    mode: item.mode,
    ...(item.mode === "session" ? { graph: item.graph ?? "fixture" } : {}),
    turns: item.turns.map((turn) => ({
      say: turn.say,
      ...(item.mode === "session" ? { session: turn.session ?? 1 } : {}),
      ...(turn.expect && Object.keys(turn.expect).length ? { expect: turn.expect } : {}),
    })),
  };
  const { transcript, turnEvals } = caseDef.mode === "session"
    ? await runSessionCase(caseDef, deps)
    : await runTurnsCase(caseDef, deps);
  let frontier = false;
  caseDef.turns.forEach((turn, i) => {
    const evalTurn = turnEvals[i];
    if (!turn.expect || !evalTurn) return;
    const failed = evalTurn.checks.some((ch) => !ch.pass);
    if (failed) {
      frontier = true;
      turn.expect = { ...turn.expect, baselineFail: true };
      const answer = transcript[i]?.answer ?? "";
      turn.observed = answer.length > TRUNCATE_OBSERVED ? `${answer.slice(0, TRUNCATE_OBSERVED)}…` : answer;
    }
  });
  const wantsMiss = caseDef.turns.some((turn) => turn.expect?.miss === true);
  caseDef.judge = {
    dimensions: frontier
      ? ["groundedness", "correctness", "honesty", "rephrase"]
      : wantsMiss ? ["groundedness", "honesty", "rephrase"] : ["groundedness", "correctness"],
    context: item.context,
  };
  return { caseDef, frontier };
}

export async function generatePool({ seed, out }) {
  const raw = JSON.parse(await readFile(FIXTURE, "utf8"));
  const truth = buildTruth(raw);
  const { deps, cleanup } = await createRunnerDeps("generate-graded");
  const lines = [];
  const summary = [];
  try {
    for (const cell of GRADED_MATRIX) {
      const key = cellKey(cell);
      const builder = BUILDERS[key];
      if (!builder) throw new Error(`no candidate builder for cell ${key}`);
      const candidates = builder(truth);
      if (candidates.length < cell.size) {
        throw new Error(`cell ${key}: only ${candidates.length} candidates for a pool of ${cell.size}`);
      }
      const rng = mulberry32((seed ^ fnv1a(key)) >>> 0);
      const selected = seededShuffle(candidates, rng).slice(0, cell.size);
      let frontierCount = 0;
      for (let i = 0; i < selected.length; i += 1) {
        const id = `g-${cell.grade.toLowerCase()}-${cell.slug}-${i + 1}`;
        const { caseDef, frontier } = await authorCase(selected[i], id, cell, deps);
        if (frontier) frontierCount += 1;
        lines.push(JSON.stringify(caseDef));
      }
      summary.push({ cell: key, size: cell.size, frontier: frontierCount, passing: cell.size - frontierCount });
      console.log(`${key}: ${cell.size} items — ${cell.size - frontierCount} passing, ${frontierCount} frontier`);
    }
  } finally {
    await cleanup();
  }
  const text = lines.join("\n") + "\n";
  const { errors } = parseCases(text);
  if (errors.length) throw new Error(`generated pool fails lint:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  await writeFile(out, text);
  const totals = summary.reduce((acc, s) => ({ size: acc.size + s.size, frontier: acc.frontier + s.frontier }), { size: 0, frontier: 0 });
  console.log(`\npool: ${totals.size} cases across ${summary.length} cells — ${totals.size - totals.frontier} passing, ${totals.frontier} frontier (seed ${seed})`);
  console.log(`written: ${out}`);
  return { summary, totals };
}

function parseArgs(argv) {
  const args = { seed: 20260704, out: DEFAULT_POOL };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  await generatePool(args);
}
