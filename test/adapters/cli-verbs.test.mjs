// The verb list is written down once (src/domain/cli-verbs.mjs) and read by
// both surfaces that name verbs. These tests are what stop the --help Usage
// block and the unknown-invocation line drifting apart from each other, and
// from the dispatcher, the way they had (`viz` shipped in --help but no
// unknown invocation ever suggested it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_VERBS, renderUsage, dispatchableModes, unknownInvocationMessage } from "../../src/domain/cli-verbs.mjs";

const BIN = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "bin", "tmct.mjs");

/** Every verb bin/tmct.mjs actually branches on, read off its dispatcher. */
function modesTheDispatcherHandles() {
  const source = readFileSync(BIN, "utf8");
  return [...new Set([...source.matchAll(/\bmode === "([^"]+)"/g)].map((m) => m[1]))].sort();
}

test("every verb the dispatcher handles is described in the help", () => {
  const described = new Set(dispatchableModes());
  const undocumented = modesTheDispatcherHandles().filter((m) => !described.has(m));
  assert.deepEqual(undocumented, [], "a dispatcher arm no --help entry describes");
});

test("the help describes no verb the dispatcher cannot answer to", () => {
  const handled = new Set(modesTheDispatcherHandles());
  const phantom = dispatchableModes().filter((m) => !handled.has(m));
  assert.deepEqual(phantom, [], "a --help entry for a verb with no dispatcher arm");
});

test("the unknown-invocation line names the same verbs the help does", () => {
  const message = unknownInvocationMessage("wat");
  for (const { errorLabel } of CLI_VERBS) {
    if (!errorLabel) continue;
    assert.ok(message.includes(`\`${errorLabel}\``), `unknown invocation never suggests ${errorLabel}`);
  }
  for (const mode of dispatchableModes()) {
    assert.ok(message.includes(mode), `unknown invocation never mentions ${mode}`);
  }
});

test("the unknown-invocation line quotes what was typed and reads as one sentence", () => {
  const message = unknownInvocationMessage("frobnicate --hard");
  assert.match(message, /^tmct: unknown invocation "frobnicate --hard"\. Use `chat`, /);
  assert.match(message, /, or `cli digest …`\.\n$/);
});

test("the syllogise help names the mechanism, not just the verb: a forward-chaining materialisation over OWL 2 RL rules", () => {
  const usage = renderUsage();
  assert.match(usage, /forward-chaining materialisation/, "the mechanism's own name");
  assert.match(usage, /OWL 2 RL/, "the rule family it materialises over");
  assert.match(usage, /syllogism/, "the classical case is placed inside the broader mechanism");
});

test("usage renders two columns: the verb at column 2, its prose at column 31", () => {
  const lines = renderUsage().split("\n");
  assert.equal(lines[0], "  tmct".padEnd(31) + "interactive chat (the headline surface)");
  const flagRow = lines.find((l) => l.startsWith("       [--ephemeral]"));
  assert.equal(flagRow.indexOf("read the graph"), 31);
});

test("a left column past the prose column pushes its prose two spaces clear of it", () => {
  const long = CLI_VERBS.find((v) => v.mode === "chat").flags
    .find((f) => f.flag.startsWith("[--memory-backend"));
  const row = renderUsage().split("\n").find((l) => l.includes(long.flag) && l.includes(long.prose[0]));
  assert.equal(row.indexOf(long.prose[0]), 7 + long.flag.length + 2);
});

test("a verb's continuation prose lines all hang at the prose column", () => {
  const lines = renderUsage().split("\n");
  const continuations = lines.filter((l) => /^ {31}\S/.test(l));
  assert.ok(continuations.length > 5, "the help wraps prose across lines");
  for (const l of continuations) assert.equal(l.slice(0, 31).trim(), "");
});
