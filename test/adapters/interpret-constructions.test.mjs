// interpret-constructions.test.mjs — construction-grammar template banks
// (PLAN_ADVANCED_GRAMMAR.md track (d), interpret/strategies/constructions.mjs).
// The bank loads data/templates/constructions/*.toml into an own-class
// ("construction") pipeline strategy that continues grammar.mjs's T1-T10
// anchored-template numbering (T11+) as committed DATA rather than more
// normalize.mjs/grammar.mjs code. These tests prove: (1) the loader's
// closed-vocabulary validation (a `kind`/`entityType`/`shape` outside the
// RELATIONS/ENTITY_TO_TYPE/shape vocabulary is dropped, never guessed), (2) the
// three shipped surface constructions ("importers of X" / "X's importers" /
// "X importers") all compile to the SAME correct AST, (3) the real bug this
// track fixes — keyword-spot's genitive/compound-NP mis-parse as shape
// "forward" instead of "reverse" — stays fixed via a real graph answer, and
// (4) the strategy is registered at the right class/precedence so it outranks
// a same-text keyword-spot guess outright instead of colliding with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  constructionsStrategy, constructionBank, parseConstruction,
  setConstructionBanks, buildAgentNounTable, buildConstructionTemplates,
} from "../../src/interpret/strategies/constructions.mjs";
import { readConstructionFiles, CONSTRUCTIONS_DIR } from "../../src/adapters/corpus/construction-banks.mjs";
import { STRATEGIES, normalizeInput, runStrategiesSync } from "../../src/interpret/pipeline.mjs";
import { mergeStrategyResults } from "../../src/interpret/merge.mjs";
import { parseQuery, ask } from "../../src/ask.mjs";
import { parseEntities } from "../../src/codegraph.mjs";

// The strategy takes its banks registered from outside; this file wires the
// real committed data the way the product composition points do.
setConstructionBanks(readConstructionFiles);

const RICH_FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
function richGraph() { return parseEntities(JSON.parse(readFileSync(RICH_FIXTURE, "utf8"))); }

// ---- registration ----------------------------------------------------------

test("registration: constructionsStrategy is registered as its own class (own-class precedence, not array position, is what makes it win — see interpret/merge.mjs)", () => {
  const ids = STRATEGIES.map((s) => s.id);
  assert.ok(ids.includes("constructions"), "constructions strategy not registered");
  assert.equal(constructionsStrategy.class, "construction");
});

// ---- the shipped bank (data/templates/constructions/agent-noun-relations.toml) --

test("shipped bank: loads T11/T12/T13 with the closed importers/callers/users/subclasses vocabulary", () => {
  const bank = constructionBank();
  const ids = bank.templates.map((t) => t.id);
  assert.deepEqual(ids.sort(), ["T11", "T12", "T13"]);
  assert.deepEqual(bank.agentNounTable.importers, { kind: "imports", entityType: "Module" });
  assert.deepEqual(bank.agentNounTable.callers, { kind: "calls", entityType: null });
  assert.deepEqual(bank.agentNounTable.users, { kind: "uses", entityType: null });
  assert.deepEqual(bank.agentNounTable.subclasses, { kind: "inherits", entityType: "Class" });
});

test("three surface constructions compile to the SAME AST for the same relation", () => {
  const forms = [
    "importers of store.mjs",
    "store.mjs's importers",
    "store.mjs importers",
  ];
  const parses = forms.map((q) => parseConstruction(q));
  for (const p of parses) {
    assert.deepEqual(p, { shape: "reverse", entityType: "Module", modifier: "direct", kind: "imports", object: "store.mjs" });
  }
});

test("case-insensitive, tolerates a trailing '?', and an unrecognized agent noun is an honest non-match", () => {
  assert.deepEqual(
    parseConstruction("IMPORTERS OF Store.mjs?"),
    { shape: "reverse", entityType: "Module", modifier: "direct", kind: "imports", object: "Store.mjs" },
  );
  assert.equal(parseConstruction("widgets of store.mjs"), null, "widgets is not a curated agent noun");
  assert.equal(parseConstruction("exporters of store.mjs"), null, "exporters was deliberately left out of the closed set");
});

test("each of the four relations resolves via all three constructions", () => {
  const cases = [
    ["callers of X", { kind: "calls", entityType: null }],
    ["X's callers", { kind: "calls", entityType: null }],
    ["X callers", { kind: "calls", entityType: null }],
    ["users of X", { kind: "uses", entityType: null }],
    ["X's users", { kind: "uses", entityType: null }],
    ["X users", { kind: "uses", entityType: null }],
    ["subclasses of X", { kind: "inherits", entityType: "Class" }],
    ["X's subclasses", { kind: "inherits", entityType: "Class" }],
    ["X subclasses", { kind: "inherits", entityType: "Class" }],
  ];
  for (const [q, expect] of cases) {
    const p = parseConstruction(q);
    assert.ok(p, `expected a parse for ${JSON.stringify(q)}`);
    assert.equal(p.kind, expect.kind, q);
    assert.equal(p.entityType, expect.entityType, q);
    assert.equal(p.shape, "reverse", q);
    assert.equal(p.object, "X", q);
  }
});

// ---- the real bug this track fixes: keyword-spot's genitive/compound mis-parse --

test("REGRESSION: genitive/compound possessive forms now win outright over keyword-spot's wrong 'forward' guess", () => {
  for (const q of ["store.mjs's importers", "store.mjs importers", "store.mjs's callers", "store.mjs callers"]) {
    const { text } = normalizeInput(q);
    const merged = mergeStrategyResults(runStrategiesSync(text, {}));
    assert.equal(merged.class, "construction", `${q} should be won by the construction strategy`);
    assert.equal(merged.parsed.shape, "reverse", `${q} must resolve as reverse (X is the OBJECT), not forward`);
    assert.equal(merged.parsed.object, "store.mjs");
  }
});

test("end-to-end via ask(): the possessive/compound forms answer IDENTICALLY to the working 'of' form", () => {
  const graph = richGraph();
  const canonical = ask(graph, "importers of app/lib/a.mjs");
  assert.equal(canonical.tmct_ask.miss, false);
  assert.match(canonical.content, /app\/lib\/b\.mjs/);
  for (const q of ["app/lib/a.mjs's importers", "app/lib/a.mjs importers"]) {
    const r = ask(graph, q);
    assert.equal(r.content, canonical.content, q);
    assert.equal(r.tmct_ask.miss, false, q);
  }
});

test("parseQuery: the possessive form parses to shape reverse (not the pre-fix forward misreading)", () => {
  const parsed = parseQuery("app/lib/a.mjs's importers");
  assert.equal(parsed.shape, "reverse");
  assert.equal(parsed.kind, "imports");
  assert.equal(parsed.object, "app/lib/a.mjs");
});

// ---- loader / validation discipline ("slot types validated against
// ENTITY_TO_TYPE/VERB_TO_KIND", the track's own deliverable) ----------------

test("buildAgentNounTable: drops an entry with an unrecognized kind (not in RELATIONS)", () => {
  const table = buildAgentNounTable([
    { noun: "widgeters", kind: "widgetifies" }, // not a real relation kind
    { noun: "importers", kind: "imports" },
  ]);
  assert.equal(table.widgeters, undefined);
  assert.deepEqual(table.importers, { kind: "imports", entityType: null });
});

test("buildAgentNounTable: drops an entry with an unrecognized entityType (not in ENTITY_TO_TYPE)", () => {
  const table = buildAgentNounTable([
    { noun: "importers", kind: "imports", entityType: "Widget" }, // not a real class
  ]);
  assert.equal(table.importers, undefined);
});

test("buildAgentNounTable: first occurrence of a duplicate noun wins", () => {
  const table = buildAgentNounTable([
    { noun: "importers", kind: "imports" },
    { noun: "importers", kind: "calls" }, // duplicate — ignored
  ]);
  assert.equal(table.importers.kind, "imports");
});

test("buildAgentNounTable: malformed rows (missing noun, non-string kind) are dropped, never thrown", () => {
  assert.deepEqual(buildAgentNounTable([{ kind: "imports" }, { noun: "" }, null, undefined]), {});
  assert.deepEqual(buildAgentNounTable(null), {});
});

test("buildConstructionTemplates: drops an entry with an invalid shape", () => {
  const templates = buildConstructionTemplates(
    [{ id: "TX", shape: "not-a-real-shape", pattern: "<AGENT> of <TERM>" }],
    { importers: { kind: "imports", entityType: "Module" } },
  );
  assert.equal(templates.length, 0);
});

test("buildConstructionTemplates: drops a pattern missing an <AGENT> or <TERM> token", () => {
  const table = { importers: { kind: "imports", entityType: "Module" } };
  assert.equal(buildConstructionTemplates([{ id: "TX", shape: "reverse", pattern: "<TERM> only" }], table).length, 0);
  assert.equal(buildConstructionTemplates([{ id: "TX", shape: "reverse", pattern: "<AGENT> only" }], table).length, 0);
});

test("buildConstructionTemplates: first occurrence of a duplicate id wins", () => {
  const table = { importers: { kind: "imports", entityType: "Module" } };
  const templates = buildConstructionTemplates(
    [
      { id: "T11", shape: "reverse", pattern: "<AGENT> of <TERM>" },
      { id: "T11", shape: "reverse", pattern: "<TERM>'s <AGENT>" }, // duplicate id — ignored
    ],
    table,
  );
  assert.equal(templates.length, 1);
  assert.equal(templates[0].name, "T11");
});

test("readConstructionFiles: a missing directory degrades to an empty bank, never throws", () => {
  assert.deepEqual(readConstructionFiles("/no/such/directory/at/all"), { relations: [], constructions: [] });
});

test("readConstructionFiles: a malformed TOML file in the directory is skipped, valid siblings still load", () => {
  const dir = mkdtempSync(join(tmpdir(), "tmct-constructions-"));
  try {
    writeFileSync(join(dir, "a-broken.toml"), "this is [not valid toml at all", "utf8");
    writeFileSync(
      join(dir, "b-valid.toml"),
      '[[relation]]\nnoun = "widgeteers"\nkind = "imports"\n\n[[construction]]\nid = "TX"\nshape = "reverse"\npattern = "<AGENT> of <TERM>"\n',
      "utf8",
    );
    const { relations, constructions } = readConstructionFiles(dir);
    assert.equal(relations.length, 1);
    assert.equal(relations[0].noun, "widgeteers");
    assert.equal(constructions.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("constructionBank: a directory with only invalid rows degrades to an empty, safe bank", () => {
  const dir = mkdtempSync(join(tmpdir(), "tmct-constructions-"));
  try {
    writeFileSync(
      join(dir, "bad.toml"),
      '[[relation]]\nnoun = "widgeteers"\nkind = "not-a-real-kind"\n\n[[construction]]\nid = "TX"\nshape = "reverse"\npattern = "<AGENT> of <TERM>"\n',
      "utf8",
    );
    setConstructionBanks(() => readConstructionFiles(dir));
    try {
      const bank = constructionBank();
      assert.deepEqual(bank.agentNounTable, {});
      assert.equal(bank.templates.length, 0, "no valid agent noun means the pattern can't compile either");
      assert.equal(parseConstruction("widgeteers of X", bank), null);
    } finally {
      setConstructionBanks(readConstructionFiles);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CONSTRUCTIONS_DIR points at the real committed data directory", () => {
  assert.match(CONSTRUCTIONS_DIR, /data[\\/]templates[\\/]constructions$/);
});
