// The verb list is written down once (src/domain/cli-verbs.mjs) and read by
// both surfaces that name verbs. These tests are what stop the --help Usage
// block and the unknown-invocation line drifting apart from each other, and
// from the dispatcher, the way they had (`viz` shipped in --help but no
// unknown invocation ever suggested it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_VERBS, renderUsage, dispatchableModes, unknownInvocationMessage } from "../../src/domain/cli-verbs.mjs";

const BIN = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "bin", "tmct.mjs");

/** Every verb bin/tmct.mjs actually branches on, read off its dispatcher. */
function modesTheDispatcherHandles() {
  const source = readFileSync(BIN, "utf8");
  return [...new Set([...source.matchAll(/(?<![.\w])mode === "([^"]+)"/g)].map((m) => m[1]))].sort();
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

test("both chat and init carry a --research-source flag, the shared knob with --memory-backend", () => {
  for (const mode of ["chat", "init"]) {
    const flags = CLI_VERBS.find((v) => v.mode === mode).flags;
    assert.ok(flags.some((f) => f.flag.startsWith("[--research-source")), `${mode} lists --research-source`);
  }
});

test("a --repo path that does not exist is refused, and nothing is created under it", () => {
  const base = mkdtempSync(path.join(tmpdir(), "tmct-repo-gate-"));
  const missing = path.join(base, "typo-repo");
  try {
    const r = spawnSync(process.execPath, [BIN, "chat", "--repo", missing, "--prompt", "what is a dog"], {
      encoding: "utf8", timeout: 60_000,
    });
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /does not exist/);
    assert.match(r.stderr, /Nothing was created/);
    assert.match(r.stderr, /tmct init --repo/, "the message names the command that would create it");
    assert.equal(existsSync(missing), false, "the mistyped path was not scaffolded");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a --repo path whose parent is also missing declines by name, never a raw mkdir error", () => {
  const r = spawnSync(process.execPath, [BIN, "chat", "--repo", "/nonexistent-tmct-parent/xyz", "--prompt", "hi"], {
    encoding: "utf8", timeout: 60_000,
  });
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /does not exist/);
  assert.doesNotMatch(r.stderr, /ENOENT/, "no raw fs error reaches the user");
});

test("the news verb with no arguments polls, unlike the chat command's /news which shows the feed (test/services/chat-news-command.test.mjs pins that side)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tmct-news-verb-"));
  try {
    const r = spawnSync(process.execPath, [BIN, "news"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, TMCT_NO_SEED: "1", TMCT_GRAPH_FILE: "" },
    });
    assert.equal(r.status, 0, r.stderr);
    // the poll summary line, not "no news items yet" (the show-mode wording /news with
    // no arguments renders in chat) — the verb never carries a fetcher into newsTurn, so
    // every source resolves "no-fetcher" and the counts land at zero without touching the network
    assert.equal(r.stdout, "polled 0 sources: 0 new items, 0 facts stored, 0 derived, 0 failures, 0 evicted.\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a verb's continuation prose lines all hang at the prose column", () => {
  const lines = renderUsage().split("\n");
  const continuations = lines.filter((l) => /^ {31}\S/.test(l));
  assert.ok(continuations.length > 5, "the help wraps prose across lines");
  for (const l of continuations) assert.equal(l.slice(0, 31).trim(), "");
});

test("a bare `tmct news` still defaults to a poll, and tmct.toml's [news] sources list is honored", () => {
  const base = mkdtempSync(path.join(tmpdir(), "tmct-news-toml-"));
  try {
    writeFileSync(path.join(base, "tmct.toml"), "[news]\nsources = []\n");
    const r = spawnSync(process.execPath, [BIN, "news"], {
      cwd: base, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
    // Zero enabled sources reaches this exact text with no fetcher ever
    // touched — a bare invocation with an emptied [news] table stays
    // deterministic and network-free, and only reads this way because the
    // toml's own sources list was actually honored (an unread [news] table
    // would still poll the shipped defaults instead).
    assert.equal(r.stdout, "no sources enabled — nothing to poll.\n");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
