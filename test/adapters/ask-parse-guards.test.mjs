// Parse-level guards that the chat surface cannot observe — salvaged from the
// flat suites the grammar corpus lane replaced. Each pins an AST shape or an
// ask() envelope discipline whose behavioural twin already lives as a lane row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask, parseQueryFull } from "../../src/domain/ask.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

test("a trailing bare 'those'/'them' compiles to reverseSet+prevSet, not a literal object term", () => {
  assert.deepEqual(parseQueryFull("what tests cover those").parsed,
    { node: "reverseSet", kind: "tests", entityType: null, inner: { node: "prevSet" } });
  assert.deepEqual(parseQueryFull("what tests cover them").parsed,
    { node: "reverseSet", kind: "tests", entityType: null, inner: { node: "prevSet" } });
});

test("a leading bare 'those' (forward-clause subject) compiles to forwardSet+prevSet", () => {
  assert.deepEqual(parseQueryFull("what do those import").parsed,
    { node: "forwardSet", kind: "imports", entityType: null, inner: { node: "prevSet" } });
  assert.deepEqual(parseQueryFull("what does those import").parsed,
    { node: "forwardSet", kind: "imports", entityType: null, inner: { node: "prevSet" } });
});

test("a determiner use ('list those functions') is never seized as the plural-pronoun leaf", () => {
  const parsed = parseQueryFull("list those functions").parsed;
  assert.notEqual(parsed?.node, "reverseSet");
  assert.notEqual(parsed?.node, "forwardSet");
});

test("an 'of those' tail stays the anaphora production, not the plural-object leaf", () => {
  assert.equal(parseQueryFull("which of those are tested").parsed?.node, "anaphora");
});

test("ask-level scoped listing over an empty directory is an honest empty, never a guess", () => {
  // The chat surface currently mis-routes the imperative form into the teach
  // lane (see the skipped grammar/list-directory-scope-honest-empty row); the
  // engine's own answer is pinned here so the honest empty can't regress while
  // that routing bug is fixed.
  const r = ask(graph, "list modules in no_such_directory_anywhere");
  assert.equal(r.tmct_ask.miss, true);
  assert.deepEqual(r.tmct_ask.matches, []);
  assert.match(r.content, /no modules in this index/);
});

test("an explicit whole-query 'help' asks for the rephrase hint; a symbol named help is not intercepted", () => {
  const r = ask(graph, "help", { nlp: null });
  assert.equal(r.tmct_ask.miss, true);
  assert.equal(r.tmct_ask.help, true);
  assert.match(r.content, /which <functions\|classes\|modules>/);
  assert.notEqual(ask(graph, "which functions call help", { nlp: null }).tmct_ask.help, true);
});

test("an auxiliary-fronted where question keeps its verb out of the term: 'where does ann live' asks about ann", () => {
  const parsed = parseQueryFull("where does ann live", { nlp: null }).parsed;
  assert.equal(parsed.shape, "where");
  assert.equal(parsed.object, "ann");
  assert.equal(parsed.verb, "live");
  assert.equal(parsed.altObject, "ann live");
});

test("the same split holds for a plural auxiliary and for a light verb before a where marker", () => {
  const plural = parseQueryFull("where do the mice sleep", { nlp: null }).parsed;
  assert.equal(plural.object, "mice");
  assert.equal(plural.verb, "sleep");
  const marked = parseQueryFull("where does startup get defined", { nlp: null }).parsed;
  assert.equal(marked.object, "startup");
  assert.equal(marked.verb, "get");
});

test("a trailing temporal adverb is not mistaken for the fronted verb", () => {
  const parsed = parseQueryFull("where does ann live now", { nlp: null }).parsed;
  assert.equal(parsed.object, "ann");
  assert.equal(parsed.verb, "live");
  assert.equal(parsed.altObject, "ann live");
  // and the adverb comes off even when there is no verb to split out
  assert.equal(parseQueryFull("where do mice today", { nlp: null }).parsed.object, "mice");
});

test("'where does <term> live' resolves the same entity 'where is <term>' does", () => {
  const aux = ask(graph, "where does fnAlpha live", { nlp: null });
  assert.equal(aux.tmct_ask.miss, false);
  assert.equal(aux.content, ask(graph, "where is fnAlpha", { nlp: null }).content);
});

test("a relation verb keeps its own reading, and the copula where question is untouched", () => {
  const relational = parseQueryFull("where does fnAlpha import from", { nlp: null }).parsed;
  assert.equal(relational.shape, "forward");
  assert.equal(relational.kind, "imports");
  assert.equal(relational.object, "fnAlpha");
  assert.deepEqual(parseQueryFull("where is fnAlpha defined", { nlp: null }).parsed,
    { shape: "where", entityType: null, modifier: "direct", kind: "where", object: "fnAlpha" });
});

test("the yes/no form of the same sentence keeps its subject and object apart", () => {
  const parsed = parseQueryFull("does ann live in paris", { nlp: null }).parsed;
  assert.equal(parsed.shape, "ask");
  assert.equal(parsed.subject, "ann");
  assert.equal(parsed.object, "paris");
});
