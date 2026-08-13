// The extraction-findings closed vocabulary is declared in five places that
// nothing else cross-checks: shacl.mjs's EXTRACTION_FINDINGS (the source of
// truth), the SHACL shape's message, the ontology property's comment, the
// adapter contract doc's table, and core.mjs's own MEMORY_VOCABULARY note.
// Each parses its own file rather than holding a second hand-kept list, so
// this guard drifts exactly when the declarations it is checking drift,
// never independently of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXTRACTION_FINDINGS, RULE_KINDS } from "../../src/adapters/memory/shacl.mjs";
import { FINDING_CAVEATS } from "../../src/domain/fact-phrase.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHAPES_FILE = join(ROOT, "ontology", "memory-shapes.ttl");
const CORE_FILE = join(ROOT, "ontology", "tmct-core.ttl");
const CONTRACT_FILE = join(ROOT, "docs", "adapter-contract.md");
const CORE_MJS_FILE = join(ROOT, "src", "adapters", "memory", "core.mjs");

/** Pulls the pipe-joined name list out of a "... closed vocabulary a | b | c
 *  ..." sentence fragment, wherever it stops (a following space, paren or
 *  period all end it, since none of those can start a finding name). */
function closedVocabularyNames(text, sourceLabel) {
  const m = /closed vocabulary\s+([a-z][\w-]*(?:\s*\|\s*[a-z][\w-]*)*)/.exec(text);
  assert.ok(m, `no "closed vocabulary <list>" phrase found in ${sourceLabel}`);
  return m[1].split("|").map((s) => s.trim());
}

async function shapesFindingNames() {
  const text = await readFile(SHAPES_FILE, "utf8");
  const block = /sh:path mgx:extractionFinding ;[\s\S]*?sh:message "([^"]*)"/.exec(text);
  assert.ok(block, "mgx:extractionFinding property shape not found in memory-shapes.ttl");
  return closedVocabularyNames(block[1], "memory-shapes.ttl's mgx:extractionFinding sh:message");
}

async function coreFindingNames() {
  const text = await readFile(CORE_FILE, "utf8");
  const block = /mgx:extractionFinding a owl:DatatypeProperty ;[\s\S]*?rdfs:comment "([^"]*)"/.exec(text);
  assert.ok(block, "mgx:extractionFinding property not found in tmct-core.ttl");
  return closedVocabularyNames(block[1], "tmct-core.ttl's mgx:extractionFinding rdfs:comment");
}

async function coreMjsFindingNames() {
  const text = await readFile(CORE_MJS_FILE, "utf8");
  const note = /"mgx:extractionFinding", note: "([^"]*)"/.exec(text);
  assert.ok(note, "mgx:extractionFinding entry not found in core.mjs's MEMORY_VOCABULARY");
  return closedVocabularyNames(note[1], "core.mjs's MEMORY_VOCABULARY mgx:extractionFinding note");
}

async function contractFindingNames() {
  const text = await readFile(CONTRACT_FILE, "utf8");
  const heading = text.indexOf("**The findings vocabulary**");
  assert.ok(heading >= 0, "docs/adapter-contract.md's findings-vocabulary heading not found");
  const tableStart = text.indexOf("| finding |", heading);
  assert.ok(tableStart >= 0, "findings vocabulary table not found after the heading");
  const tableEnd = text.indexOf("\n\n", tableStart);
  const table = text.slice(tableStart, tableEnd < 0 ? undefined : tableEnd);
  const names = [...table.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
  assert.ok(names.length > 0, "no finding rows parsed from the findings vocabulary table");
  return names;
}

async function contractCaveatEntries() {
  const text = await readFile(CONTRACT_FILE, "utf8");
  const heading = text.indexOf("**The caveat templates**");
  assert.ok(heading >= 0, "docs/adapter-contract.md's caveat-templates heading not found");
  const tableStart = text.indexOf("| finding |", heading);
  assert.ok(tableStart >= 0, "caveat templates table not found after the heading");
  const tableEnd = text.indexOf("\n\n", tableStart);
  const table = text.slice(tableStart, tableEnd < 0 ? undefined : tableEnd);
  const rows = [...table.matchAll(/^\| `([a-z0-9-]+)` \| `([^`]*)` \|/gm)];
  assert.ok(rows.length > 0, "no rows parsed from the caveat templates table");
  return Object.fromEntries(rows.map((m) => [m[1], m[2]]));
}

test("the extraction-findings closed vocabulary matches across shacl.mjs, both ontology files, core.mjs, and the adapter contract doc", async () => {
  const code = [...EXTRACTION_FINDINGS].sort();
  const shapes = (await shapesFindingNames()).sort();
  const core = (await coreFindingNames()).sort();
  const coreMjs = (await coreMjsFindingNames()).sort();
  const contract = (await contractFindingNames()).sort();

  assert.deepEqual(shapes, code, "ontology/memory-shapes.ttl's closed list drifted from EXTRACTION_FINDINGS");
  assert.deepEqual(core, code, "ontology/tmct-core.ttl's closed list drifted from EXTRACTION_FINDINGS");
  assert.deepEqual(coreMjs, code, "core.mjs's MEMORY_VOCABULARY note drifted from EXTRACTION_FINDINGS");
  assert.deepEqual(contract, code, "docs/adapter-contract.md's findings vocabulary table drifted from EXTRACTION_FINDINGS");
});

async function shapesRuleKindNames() {
  const text = await readFile(SHAPES_FILE, "utf8");
  const block = /sh:path mgx:ruleKind ;\s*sh:in \(([^)]*)\)/.exec(text);
  assert.ok(block, "mgx:ruleKind property shape's sh:in list not found in memory-shapes.ttl");
  return [...block[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

async function coreRuleKindNames() {
  const text = await readFile(CORE_FILE, "utf8");
  const block = /mgx:ruleKind a owl:DatatypeProperty ;[\s\S]*?rdfs:comment "([^"]*)"/.exec(text);
  assert.ok(block, "mgx:ruleKind property not found in tmct-core.ttl");
  return closedVocabularyNames(block[1], "tmct-core.ttl's mgx:ruleKind rdfs:comment");
}

async function coreMjsRuleKindNames() {
  const text = await readFile(CORE_MJS_FILE, "utf8");
  const note = /"mgx:ruleKind", note: "([^"]*)"/.exec(text);
  assert.ok(note, "mgx:ruleKind entry not found in core.mjs's MEMORY_VOCABULARY");
  return closedVocabularyNames(note[1], "core.mjs's MEMORY_VOCABULARY mgx:ruleKind note");
}

test("the ruleKind closed vocabulary matches across shacl.mjs, both ontology files, and core.mjs", async () => {
  const code = [...RULE_KINDS].sort();
  const shapes = (await shapesRuleKindNames()).sort();
  const core = (await coreRuleKindNames()).sort();
  const coreMjs = (await coreMjsRuleKindNames()).sort();

  assert.deepEqual(shapes, code, "ontology/memory-shapes.ttl's mgx:ruleKind sh:in list drifted from RULE_KINDS");
  assert.deepEqual(core, code, "ontology/tmct-core.ttl's mgx:ruleKind closed list drifted from RULE_KINDS");
  assert.deepEqual(coreMjs, code, "core.mjs's MEMORY_VOCABULARY mgx:ruleKind note drifted from RULE_KINDS");
});

test("the finding-caveat table matches FINDING_CAVEATS exactly, names and text both", async () => {
  const contract = await contractCaveatEntries();
  assert.deepEqual(
    Object.keys(contract).sort(),
    Object.keys(FINDING_CAVEATS).sort(),
    "docs/adapter-contract.md's caveat templates table drifted from FINDING_CAVEATS",
  );
  for (const [finding, caveat] of Object.entries(FINDING_CAVEATS)) {
    assert.equal(contract[finding], caveat, `the "${finding}" caveat text drifted from docs/adapter-contract.md`);
  }
});
