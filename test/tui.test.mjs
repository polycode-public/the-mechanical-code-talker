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
import { App, statusText, appendTurn, transcriptLines, wrapLines } from "../src/tui/app.mjs";
import { createSession } from "../src/chat.mjs";

const h = React.createElement;
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

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
  const session = await createSession({ repoPath: dir });
  const { lastFrame, stdin, unmount } = render(h(App, { session }));
  // long lines are hard-wrapped at the column budget — strip the wraps to match phrases
  const flat = () => String(lastFrame() ?? "").replace(/\n/g, "");
  try {
    assert.ok(await until(() => /no graph( loaded)? — starting empty/.test(flat())), "bootstrap note in banner/status bar");
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
