// chat-commands.test.mjs — slash-optional system commands: a bare command word
// ("stats", "memory", "describe X") is treated as its slash form, but a
// compositional query that merely starts with a command word still reaches the
// ask engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { asBareCommand } from "../src/services/chat.mjs";

test("bare zero-arg system commands route to their slash form", () => {
  assert.equal(asBareCommand("stats"), "/stats");
  assert.equal(asBareCommand("memory"), "/memory");
  assert.equal(asBareCommand("memory verbose"), "/memory verbose");
  assert.equal(asBareCommand("untested"), "/untested");
});

test("bare entity commands route a short, name-like argument", () => {
  assert.equal(asBareCommand("describe Widget"), "/describe Widget");
  assert.equal(asBareCommand("describe my class"), "/describe my class");
  assert.equal(asBareCommand("members Widget"), "/members Widget");
  assert.equal(asBareCommand("subclasses Base"), "/subclasses Base");
});

test("a compositional query starting with a command word falls through (null)", () => {
  // these must reach the ask engine, not a zero-/single-arg command
  assert.equal(asBareCommand("untested modules importing app/lib/a.mjs"), null);
  assert.equal(asBareCommand("find functions that call fnAlpha"), null);
  assert.equal(asBareCommand("tests that cover Widget"), null);
  assert.equal(asBareCommand("history of the module that imports x"), null);
});

test("non-commands, slash lines, and blanks are left alone", () => {
  assert.equal(asBareCommand("which modules import a.mjs"), null); // a question
  assert.equal(asBareCommand("hello"), null); // a greeting
  assert.equal(asBareCommand("/stats"), null); // already slashed
  assert.equal(asBareCommand("help"), null); // help stays the friendly orientation
  assert.equal(asBareCommand("   "), null);
});

// ---- "find" routing precedence (PLAN_PREDICATE_QUERIES.md) — the old /find
// (tmct_search, a plain lexical search) and the ask engine's newer
// predicate-find grammar ("find [me] a/the <term> <entityType>") both claim a
// bare "find …" line; asBareCommand must pick one deterministically by SHAPE
// (does the tail name a real listable entity type, in one of the grammar's two
// closed orders?), never by incidental tail word count. ----
test('"find <term> <entityType>"-shaped lines defer to the ask engine (null) regardless of tail length', () => {
  // a short (3-word) and a long (4-word) tail of the SAME shape must land on
  // the SAME route — this was the reported inconsistency (word-count-gated).
  assert.equal(asBareCommand("find the widget class"), null);
  assert.equal(asBareCommand("find me the payment class"), null);
  assert.equal(asBareCommand("find the payment class"), null);
  assert.equal(asBareCommand("find a payment module"), null);
});

test('"find <entityType> <linker> <term>"-shaped lines also defer to the ask engine (null)', () => {
  assert.equal(asBareCommand("find the class named Foo"), null);
  assert.equal(asBareCommand("find a class called Foo"), null);
  assert.equal(asBareCommand("find module matching logger"), null);
});

test('a plain "find <name>" with no entity-type noun keeps the ORIGINAL /find (tmct_search) routing', () => {
  assert.equal(asBareCommand("find logger"), "/find logger");
  assert.equal(asBareCommand("find the payment thing"), "/find the payment thing");
});

test('"search" (the /find alias) is unaffected by the predicate-find precedence rule', () => {
  assert.equal(asBareCommand("search the widget class"), "/search the widget class");
});
