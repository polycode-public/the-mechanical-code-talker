// chat-commands.test.mjs — slash-optional system commands: a bare command word
// ("stats", "memory", "describe X") is treated as its slash form, but a
// compositional query that merely starts with a command word still reaches the
// ask engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { asBareCommand } from "../src/chat.mjs";

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
