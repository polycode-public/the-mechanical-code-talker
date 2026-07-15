// corpus/templates.mjs tests — the response-template library + SE phrase book:
// strict rendering, and the lint guarantee that every
// committed data row parses, is unique, and stays within its declared shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEMPLATES_FILE, PHRASEBOOK_FILE,
  loadTemplates, render, slotsOf, loadPhrasebook, TECHNICAL_SLOTS,
  loadTemplatesMerged,
} from "../../src/corpus/templates.mjs";

test("lint: every responses.jsonl row parses, ids are unique, registers valid, every template has a class", async () => {
  const templates = await loadTemplates(TEMPLATES_FILE); // loud on any bad row
  assert.ok(templates.size >= 40, `a real library, not a stub (got ${templates.size})`);
  assert.ok(templates.size <= 120, "stays skimmable");
  // the promised coverage: described entities, counts, misses, ambiguity
  // surrounds, assumption announcements, memory recalls
  const classes = new Set([...templates.values()].map((t) => t.class));
  for (const c of ["describe", "count", "miss", "ambiguity", "assumption", "recall"]) {
    assert.ok(classes.has(c), `template class "${c}" covered`);
  }
  const registers = new Set([...templates.values()].map((t) => t.register));
  assert.ok(registers.has("terse") && registers.has("friendly"), "both conversational registers present");
  assert.ok(registers.has("technical"), "the C1 technical register is present");
});

test("technical register: C1 templates over mechanical conclusions, provenance mandatory", async () => {
  const templates = await loadTemplates(TEMPLATES_FILE);
  const technical = [...templates.values()].filter((t) => t.register === "technical");
  assert.ok(technical.length >= 3 && technical.length <= 5, `3–5 technical templates (got ${technical.length})`);
  for (const row of technical) {
    // slot-lint: mechanical fills only, and every technical claim shows its source
    for (const s of row.slots) {
      assert.ok(TECHNICAL_SLOTS.has(s), `technical "${row.id}" slot {${s}} is mechanical`);
    }
    assert.ok(row.slots.includes("provenance"), `technical "${row.id}" carries {provenance}`);
    // the mechanical spine: a count / comparison / superlative value is present
    assert.ok(
      ["count", "comparison", "metric", "superlative"].some((s) => row.slots.includes(s)),
      `technical "${row.id}" fills a count/compare/superlative value`,
    );
  }
  // it renders to advanced prose from grounded slots only
  const out = render("technical-density", {
    subject: "the auth module", count: "340", noun: "tests",
    scope: "12 suites", provenance: "source: coverage index",
  }, templates);
  assert.equal(
    out,
    "the auth module carries 340 tests across 12 suites — a concentration well above what a codebase of this size typically sustains (source: coverage index).",
  );
});

test("technical slot-lint fails loudly: a non-mechanical slot or a missing provenance is rejected at load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tech-"));
  try {
    const bad = join(dir, "bad.jsonl");
    // free-text slot that could smuggle unattributable prose into the C1 register
    await writeFile(bad, '{"id":"t","class":"count","register":"technical","template":"{opinion} ({provenance})."}\n');
    await assert.rejects(() => loadTemplates(bad), /non-mechanical slot: opinion/);
    // a technical claim with no source
    await writeFile(bad, '{"id":"t","class":"count","register":"technical","template":"{count} {noun}."}\n');
    await assert.rejects(() => loadTemplates(bad), /must carry a \{provenance\} fill/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await loadTemplates(); // restore the module cache for later tests
  }
});

test("slotsOf: extracts slot names once each, in order; ignores malformed braces", () => {
  assert.deepEqual(slotsOf("if you mean {a} then {aAnswer}; {a} again"), ["a", "aAnswer"]);
  assert.deepEqual(slotsOf("no slots here"), []);
  assert.deepEqual(slotsOf("{1bad} {ok}"), ["ok"]);
});

test("render: fills every slot (repeats included); missing slot throws by name; unknown id throws", async () => {
  const templates = await loadTemplates();
  const out = render("ambiguity-two", {
    a: "the module", aAnswer: "it has 3 importers",
    b: "the class", bAnswer: "it has 2 subclasses",
  }, templates);
  assert.equal(out, "That could go two ways. If you mean the module then it has 3 importers; if you mean the class then it has 2 subclasses.");

  assert.throws(() => render("recall-plain", {}, templates), /missing slot: fact/);
  assert.throws(() => render("ambiguity-two", { a: "x", b: "y" }, templates), /missing slots: aAnswer, bAnswer/);
  assert.throws(() => render("no-such-template", {}, templates), /unknown template id/);
  // null is "missing" (never render the word null); extra slots are ignored
  assert.throws(() => render("count-plain", { count: 3, noun: null }, templates), /missing slot: noun/);
  assert.equal(render("count-plain", { count: 0, noun: "tests", extra: "ignored" }, templates), "0 tests.");
});

test("render: module cache — after loadTemplates() render works without passing the map", async () => {
  await loadTemplates();
  assert.equal(render("miss-plain", { query: "flurble" }), 'No match for "flurble".');
});

test("loadTemplates: bad rows fail loudly with file:line (invalid JSON, duplicate id, bad register)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tpl-"));
  try {
    const bad = join(dir, "bad.jsonl");
    await writeFile(bad, "not json\n");
    await assert.rejects(() => loadTemplates(bad), /bad\.jsonl:1: not valid JSON/);
    await writeFile(bad, '{"id":"a","class":"c","template":"t","register":"terse"}\n{"id":"a","class":"c","template":"t","register":"terse"}\n');
    await assert.rejects(() => loadTemplates(bad), /:2: duplicate template id "a"/);
    await writeFile(bad, '{"id":"a","class":"c","template":"t","register":"shouty"}\n');
    await assert.rejects(() => loadTemplates(bad), /register must be terse\|friendly/);
    await writeFile(bad, '{"id":"a","class":"c","register":"terse"}\n');
    await assert.rejects(() => loadTemplates(bad), /missing\/empty "template"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await loadTemplates(); // restore the module cache for later tests
  }
});

test("phrasebook: parses to patterns + synonym families; big enough to be a vocabulary", async () => {
  const { patterns, synonyms } = await loadPhrasebook(PHRASEBOOK_FILE);
  assert.ok(patterns.length >= 120, `a real phrase book (got ${patterns.length} patterns)`);
  assert.ok(synonyms.length >= 20, `synonym families included (got ${synonyms.length})`);
  // the headline phrases from the roadmap are literally present
  const raw = patterns.map((p) => p.pattern);
  assert.ok(raw.includes("what calls {x}"));
  assert.ok(raw.includes("who imports {x}"));
  assert.ok(raw.includes("is {x} tested"));
  // slots parsed; no pattern sneaks in an undeclared slot shape
  const callers = patterns.find((p) => p.pattern === "does {x} call {y}");
  assert.deepEqual(callers.slots, ["x", "y"]);
  for (const p of patterns) {
    assert.ok(!p.pattern.startsWith("~") && !p.pattern.startsWith("#"), "comments/families never leak into patterns");
    for (const s of p.slots) assert.match(s, /^[a-z]$/, `single-letter entity slots only, got {${s}} in "${p.pattern}"`);
  }
  // families are lowercase, trimmed, ≥2 members
  for (const fam of synonyms) {
    assert.ok(fam.length >= 2);
    for (const w of fam) assert.equal(w, w.trim().toLowerCase());
  }
  // the call/invoke family exists — the roadmap's synonym-family example
  assert.ok(synonyms.some((f) => f.includes("call") && f.includes("invoke")));
});

test("phrasebook: malformed synonym family fails loudly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-pb-"));
  try {
    const bad = join(dir, "bad.txt");
    await writeFile(bad, "# fine\n~ lonely\n");
    await assert.rejects(() => loadPhrasebook(bad), /:2: a synonym family needs at least 2 entries/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Part 3 (extension-pack batch): loadTemplatesMerged + namespacing -------

test("loadTemplatesMerged: merges several namespaced extension-pack files into one Map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tplmerge-"));
  try {
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    await writeFile(a, '{"id":"packa:greet","class":"describe","template":"hi from a.","register":"terse"}\n');
    await writeFile(b, '{"id":"packb:greet","class":"describe","template":"hi from b.","register":"terse"}\n');
    const merged = await loadTemplatesMerged([a, b]);
    assert.equal(merged.size, 2);
    assert.equal(render("packa:greet", {}, merged), "hi from a.");
    assert.equal(render("packb:greet", {}, merged), "hi from b.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadTemplatesMerged: a bare, non-namespaced id throws, naming the path and id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tplmerge-"));
  try {
    const bad = join(dir, "bad.jsonl");
    await writeFile(bad, '{"id":"greet","class":"describe","template":"hi.","register":"terse"}\n');
    await assert.rejects(() => loadTemplatesMerged([bad]), /not namespaced.*"<packname>:<id>"/);
    await assert.rejects(() => loadTemplatesMerged([bad]), /"greet"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadTemplatesMerged: the SAME id across two paths throws (cross-file id uniqueness), rather than silently shadowing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tplmerge-"));
  try {
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    await writeFile(a, '{"id":"pack:greet","class":"describe","template":"hi from a.","register":"terse"}\n');
    await writeFile(b, '{"id":"pack:greet","class":"describe","template":"hi from b.","register":"terse"}\n');
    await assert.rejects(() => loadTemplatesMerged([a, b]), /duplicate template id "pack:greet"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadTemplatesMerged: never clobbers the module's own render() default cache as a side effect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tplmerge-"));
  try {
    await loadTemplates(); // prime the default cache with the real responses.jsonl
    const before = render("miss-plain", { query: "flurble" });
    const pack = join(dir, "pack.jsonl");
    await writeFile(pack, '{"id":"pack:greet","class":"describe","template":"hi.","register":"terse"}\n');
    await loadTemplatesMerged([pack]);
    // the default cache still serves the ORIGINAL responses.jsonl, not the pack
    assert.equal(render("miss-plain", { query: "flurble" }), before);
    assert.throws(() => render("pack:greet"), /unknown template id/, "the merged pack was never installed as the default");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await loadTemplates(); // restore the module cache for later tests
  }
});
