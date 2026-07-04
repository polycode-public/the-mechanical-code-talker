// corpus/templates.mjs tests — the response-template library + SE phrase book
// (Phase 2 items 4+7): strict rendering, and the lint guarantee that every
// committed data row parses, is unique, and stays within its declared shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEMPLATES_FILE, PHRASEBOOK_FILE,
  loadTemplates, render, slotsOf, loadPhrasebook,
} from "../src/corpus/templates.mjs";

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
  assert.ok(registers.has("terse") && registers.has("friendly"), "both registers present");
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
