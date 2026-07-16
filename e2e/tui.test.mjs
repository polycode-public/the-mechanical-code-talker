// tui/app.mjs tests — the Ink shell over the shared session sink. The pure
// view-model (statusText / appendTurn / transcriptLines / wrapLines) is tested
// directly; the component is rendered with ink-testing-library and driven
// through its fake stdin; the exit paths (/exit, conversational bye, Ctrl+C)
// use ink's own render over stub streams so waitUntilExit() can be awaited.
// The on-disk contract (transcript bytes → memory utterances) is guarded by
// sessions.test.mjs's tripwire; here we assert the TUI writes through the SAME
// sink (log + sidecar carry the turns the screen showed).
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { render as inkRender } from "ink";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, statusText, appendTurn, transcriptLines, wrapLines,
  insertAt, backspaceAt, clampCursor, inputCells } from "../src/tui/app.mjs";
import { createSession } from "../src/chat.mjs";

const h = React.createElement;
const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));

/** Same fixture-backed temp repo as chat.test.mjs. */
async function repoWithFixtureGraph() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tui-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}

/** Poll until `fn()` is truthy (turns are async — the frame updates a beat later). */
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return Boolean(fn());
}

/** A raw-mode-capable fake stdin (what ink's useInput needs off-TTY). Ink 7
 *  consumes input through the `readable` event + read() protocol — the same
 *  stub shape ink-testing-library uses internally. */
function fakeStdin() {
  const stdin = new EventEmitter();
  let buffered = null;
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.read = () => { const d = buffered; buffered = null; return d; };
  stdin.write = (data) => { buffered = data; stdin.emit("readable"); };
  return stdin;
}

/** A sized sink stdout for ink's real render(). */
function fakeStdout({ columns = 80, rows = 24 } = {}) {
  const stdout = new PassThrough();
  stdout.columns = columns;
  stdout.rows = rows;
  return stdout;
}

// ---- the pure view-model ----

test("statusText: repo · module count · short session id, plus the honest bootstrap note when empty", () => {
  const base = { repo: "/some/repo", moduleCount: 8, sessionId: "019f0000-aaaa-7bbb-8ccc-000000000001" };
  assert.equal(statusText({ ...base, empty: false }), "/some/repo · 8 module(s) · session 019f0000");
  assert.equal(
    statusText({ ...base, moduleCount: 0, empty: true }),
    "/some/repo · 0 module(s) · session 019f0000 · no graph — starting empty",
  );
});

test("appendTurn/transcriptLines: the question echoes under the prompt it was typed at; the answer's lines follow, then a separator", () => {
  const items = appendTurn([], { prompt: "tmct(walk.mjs)> ", query: "what calls it", answer: "a.\nb." });
  assert.equal(items.length, 2);
  assert.deepEqual(transcriptLines(items), ["tmct(walk.mjs)> what calls it", "a.", "b.", ""]);
  // append is pure — the input array is untouched
  const more = appendTurn(items, { prompt: "tmct> ", query: "q2", answer: "a2" });
  assert.equal(items.length, 2);
  assert.equal(more.length, 4);
});

test("line editor: caret moves and edits happen mid-string, not just at the end", () => {
  // type "helo", move the caret back to before the last char, insert the missing "l"
  let { value, cursor } = insertAt("", 0, "helo"); // "helo", caret at 4
  assert.deepEqual({ value, cursor }, { value: "helo", cursor: 4 });
  cursor = clampCursor(value, cursor - 1); // ← between "hel" and "o"
  ({ value, cursor } = insertAt(value, cursor, "l"));
  assert.deepEqual({ value, cursor }, { value: "hello", cursor: 4 }, "insert lands at the caret, not the end");

  // backspace deletes the char BEFORE the caret; a no-op at column 0
  ({ value, cursor } = backspaceAt("hello", 3)); // remove the second "l"
  assert.deepEqual({ value, cursor }, { value: "helo", cursor: 2 });
  assert.deepEqual(backspaceAt("hi", 0), { value: "hi", cursor: 0 }, "backspace at home is a no-op");

  // caret clamps to the string bounds
  assert.equal(clampCursor("abc", -5), 0);
  assert.equal(clampCursor("abc", 99), 3);
});

test("inputCells: splits the value so the caret block highlights the char in place", () => {
  assert.deepEqual(inputCells("hello", 2), { before: "he", at: "l", after: "lo" });
  assert.deepEqual(inputCells("hi", 2), { before: "hi", at: " ", after: "" }, "past the end → caret over a space");
  assert.deepEqual(inputCells("", 0), { before: "", at: " ", after: "" });
});

test("wrapLines: hard-wraps at the column budget so the fixed-height pane's math stays honest", () => {
  assert.deepEqual(wrapLines(["abcdef", "xy"], 3), ["abc", "def", "xy"]);
  assert.deepEqual(wrapLines(["abc"], 3), ["abc"], "an exact fit does not split");
  assert.deepEqual(wrapLines([""], 3), [""], "empty lines survive");
});

// ---- the rendered app (ink-testing-library) ----

test("TUI: a turn renders question+answer into the transcript, updates the focus prompt, and lands in the session artifacts", async () => {
  const dir = await repoWithFixtureGraph();
  const session = await createSession({ repoPath: dir });
  const { lastFrame, stdin, unmount } = render(h(App, { session }));
  try {
    assert.ok(await until(() => /ask a question, or \/help/.test(lastFrame())), "banner rendered");
    assert.match(lastFrame(), /module\(s\) · session/, "the thin status bar is present");

    stdin.write("which modules import a.mjs");
    assert.ok(await until(() => lastFrame().includes("which modules import a.mjs")), "typed input echoes on the input line");
    stdin.write("\r");
    assert.ok(await until(() => /app\/lib\/b\.mjs/.test(lastFrame())), "the answer rendered into the transcript");
    assert.match(lastFrame(), /tmct> which modules import a\.mjs/, "the question is echoed under its prompt");
    assert.ok(await until(() => lastFrame().includes("tmct(app/lib/a.mjs)>")), "the resolved focus updated the prompt label");
    assert.equal(session.turns, 1, "exactly one dispatched turn went through the sink");
  } finally {
    unmount();
    await session.close();
  }
  // the SAME artifacts the readline shell writes — through the same sink
  const log = await readFile(session.logFile, "utf8");
  assert.match(log, /> which modules import a\.mjs\n/, "transcript log carries the turn in the canonical format");
  assert.match(log, /app\/lib\/b\.mjs/, "…with the answer prose (what memory re-reads)");
  assert.match(log, /session end \d{4}-/, "close() wrote the clean session end");
  const sidecar = (await readFile(session.sidecarFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(sidecar.filter((r) => r.type === "turn").length, 1);
  assert.equal(sidecar.at(-1).type, "end");
  await rm(dir, { recursive: true, force: true });
});

test("TUI: slash-commands dispatch through the sink; an empty repo's status bar says so honestly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tui-empty-"));
  // (TMCT_NO_SEED: the W3 seeded-bootstrap path has its own suite — wiring-seed.test.mjs)
  const session = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
  const { lastFrame, stdin, unmount } = render(h(App, { session }));
  // long lines are hard-wrapped at the column budget — strip the wraps to match phrases
  const flat = () => String(lastFrame() ?? "").replace(/\n/g, "");
  try {
    assert.ok(await until(() => /no (?:code )?graph( loaded)? — starting empty/.test(flat())), "bootstrap note in banner/status bar"); // #3
    // one chunk with the newline — the paste path submits the line atomically
    stdin.write("/help\n");
    assert.ok(await until(() => /question shapes for a bare line/.test(lastFrame())), "/help answered in the transcript");
    assert.equal(session.turns, 1, "the slash-command was a recorded turn");
  } finally {
    unmount();
    await session.close();
  }
  await rm(dir, { recursive: true, force: true });
});

// ---- exit paths (ink's own render over stub streams → awaitable exit) ----

test("TUI: /exit ends the app without dispatching a turn; Ctrl+C and a conversational bye end it too", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    // /exit — handled by the shell (no turn), resolves waitUntilExit
    {
      const session = await createSession({ repoPath: dir });
      const stdin = fakeStdin();
      const app = inkRender(h(App, { session }), { stdout: fakeStdout(), stdin, exitOnCtrlC: true, patchConsole: false });
      await new Promise((r) => setTimeout(r, 30));
      stdin.write("/exit\r");
      await app.waitUntilExit();
      app.unmount();
      await session.close();
      assert.equal(session.turns, 0, "/exit is not a turn — same as the readline shell");
      assert.match(await readFile(session.logFile, "utf8"), /session end \d{4}-/);
    }
    // a conversational "bye" — the turn's end:true exits the app after answering
    {
      const session = await createSession({ repoPath: dir });
      const stdin = fakeStdin();
      const app = inkRender(h(App, { session }), { stdout: fakeStdout(), stdin, exitOnCtrlC: true, patchConsole: false });
      await new Promise((r) => setTimeout(r, 30));
      stdin.write("bye\r");
      await app.waitUntilExit();
      app.unmount();
      await session.close();
      assert.equal(session.turns, 1, "bye IS a recorded turn (the farewell answered)");
      assert.match(await readFile(session.logFile, "utf8"), /> bye\n/);
    }
    // Ctrl+C — ink's exitOnCtrlC, then the same clean close
    {
      const session = await createSession({ repoPath: dir });
      const stdin = fakeStdin();
      const app = inkRender(h(App, { session }), { stdout: fakeStdout(), stdin, exitOnCtrlC: true, patchConsole: false });
      await new Promise((r) => setTimeout(r, 30));
      stdin.write("\x03");
      await app.waitUntilExit();
      app.unmount();
      await session.close();
      assert.match(await readFile(session.logFile, "utf8"), /session end \d{4}-/, "Ctrl+C still flushes the clean end");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- genuine first-run: a fresh, empty repo, the REAL seed (no TMCT_NO_SEED),
// through the actual TUI render path — the exact combination nothing else in this
// suite exercises. The existing empty-repo TUI test above deliberately opts OUT of
// seeding (env: {TMCT_NO_SEED:"1"}, seeding has its own suite, wiring-seed.test.mjs)
// and wiring-seed.test.mjs never touches the TUI — so "does `tmct chat` in a brand
// new directory actually reach a working prompt, seed included" was untested. Found
// live: an operator reported `npm run chat` appearing to hang with no visible
// output. Root-caused: createSession's first-run seed genuinely takes ~2.5-3s
// (measured; corpus/seon + ConceptNet, and this session's own ontology-wiring work
// added roughly 500ms of that vs. the pre-session baseline) and produces ZERO
// output until it fully resolves — runChat/runTui now both print an immediate
// "starting…" line before the seed for exactly this reason (src/chat.mjs,
// src/tui/app.mjs). This test doesn't go through runTui (it renders the App
// component directly, same as the other TUI tests), so it doesn't see that line —
// it guards the underlying "does the seed+render path ever complete" property.
test("TUI: a genuinely fresh, unseeded repo reaches a working prompt through the real seed path (no TMCT_NO_SEED) and answers a natural-language question", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tui-freshseed-"));
  const t0 = Date.now();
  const session = await createSession({ repoPath: dir }); // no TMCT_NO_SEED — the real seed runs
  const { lastFrame, stdin, unmount } = render(h(App, { session }));
  try {
    assert.ok(await until(() => /ask a question, or \/help/.test(lastFrame())), "the prompt is reached, not stuck mid-render");
    // The real seed measured ~2.5-3s on this machine — genuinely slow, not instant,
    // but bounded. This guards against an actual hang (minutes/forever), not the
    // known, separately-tracked seed latency itself (a perf follow-up, not a
    // correctness bug) — a tight threshold here would just make the test flaky
    // against its own measured baseline.
    assert.ok(Date.now() - t0 < 15000, "reaches a working prompt within a bounded time — no open-ended hang");
    assert.match(lastFrame(), /seeded \d+ starter facts/, "the real seed ran (not TMCT_NO_SEED-skipped) and its banner line rendered");

    // a natural-language question through the live prompt, immediately after the
    // seed — the exact next thing an operator does, and the other half of what
    // was untested (a first-run session answering ANYTHING at all).
    stdin.write("what is a cache");
    assert.ok(await until(() => lastFrame().includes("what is a cache")), "the typed question echoes");
    stdin.write("\r");
    assert.ok(await until(() => session.turns === 1), "the question dispatched as a real turn, not silently dropped");
    assert.equal(lastFrame().includes("went wrong"), false, "no crash/error surfaced for the first live question");
  } finally {
    unmount();
    await session.close();
    await rm(dir, { recursive: true, force: true });
  }
});
