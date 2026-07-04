// chat.mjs tests — uuidv7, the pure turn function, a scripted (no-TTY) session
// against the entities fixture, and a binary smoke of `seonix chat`. The turn
// function is exercised through the SAME dispatchTool path the CLI uses, with
// config.graphFile pointed straight at the committed fixture (the same trick
// cli-smoke.test.mjs's repoWithFixtureGraph plays via .seonix/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";
import {
  uuidv7, runTurn, runChat, helpText, COMMANDS, SESSION_LOG_DIR, PROMPT,
  answerCount, renderStats, isConversational,
  renderVerbose,
} from "../src/chat.mjs";
import { dispatchTool } from "../src/server.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const BIN = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

/** The parsed fixture graph — what runChat loads once and threads into every turn. */
let GRAPH;
async function graph() {
  return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG)));
}

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Same fixture-backed temp repo as cli-smoke.test.mjs. */
async function repoWithFixtureGraph() {
  const dir = await mkdtemp(join(tmpdir(), "seonix-chat-"));
  await mkdir(join(dir, ".seonix"), { recursive: true });
  await writeFile(join(dir, ".seonix", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}

/** Collect everything written to a stream-like output. */
function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  let text = "";
  out.on("data", (c) => (text += c));
  return { out, text: () => text };
}

// ---- uuidv7 ----

test("uuidv7: RFC 9562 format — version 7, variant 10xx", () => {
  for (let i = 0; i < 50; i++) assert.match(uuidv7(), UUID_V7_RE);
});

test("uuidv7: leading 48 bits are the unix-ms timestamp; ids 10ms apart sort correctly", () => {
  const t = Date.parse("2026-07-02T12:00:00.000Z");
  const a = uuidv7(t);
  const b = uuidv7(t + 10);
  assert.equal(parseInt(a.replace(/-/g, "").slice(0, 12), 16), t);
  assert.equal(parseInt(b.replace(/-/g, "").slice(0, 12), 16), t + 10);
  assert.ok(a < b, `later id sorts after earlier: ${a} < ${b}`);
});

test("uuidv7: unique over 1000 ids", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(uuidv7());
  assert.equal(ids.size, 1000);
});

// ---- runTurn (pure: query → { answer, logLines }) ----

test("runTurn: a hit query answers from the graph, envelope stripped, log lines well-formed", async () => {
  const query = "which modules import a.mjs";
  const { answer, logLines } = await runTurn(query, { config: { graphFile: FIXTURE } });
  assert.match(answer, /app\/lib\/b\.mjs/);
  assert.doesNotMatch(answer, /---seonix_ask---/, "the machine envelope is not shown in the TUI");
  assert.equal(logLines.length, 4);
  assert.match(logLines[0], ISO_RE);
  assert.equal(logLines[1], `> ${query}`);
  assert.equal(logLines[2], answer);
  assert.equal(logLines[3], "", "turn record ends with a blank line");
});

test("runTurn: a grammar miss prints the engine's own hint text — no special handling", async () => {
  const { answer, logLines } = await runTurn("tell me a joke", { config: { graphFile: FIXTURE } });
  assert.match(answer, /couldn't parse this as a graph question/);
  assert.match(answer, /which <functions\|classes\|modules>/);
  assert.equal(logLines[2], answer, "the miss text is logged verbatim too");
});

test("runTurn: a thrown ToolError (no graph) becomes the answer, not a crash", async () => {
  const { answer } = await runTurn("which modules import a.mjs", {
    config: { graphFile: "/nonexistent/.seonix/graph.json" },
  });
  assert.match(answer, /no graph artifact at/);
  assert.match(answer, /index_repository/);
});

// ---- slash-commands: reach every tool (bare input still asks) ----

test("runTurn: a bare (non-slash) line still dispatches seonix_ask (the default)", async () => {
  const { answer, record } = await runTurn("which modules import a.mjs", { config: CONFIG, graph: await graph() });
  assert.match(answer, /app\/lib\/b\.mjs/);
  assert.equal(record.command, undefined, "an ask turn carries no command field");
  assert.equal(record.miss, false);
});

// Each command class dispatches its MAPPED tool with its MAPPED arg key: the chat
// answer must equal dispatchTool called directly with the mapped tool+arg. That
// proves the command→tool→arg wiring for real, against the fixture graph.
test("runTurn: every slash-command dispatches the tool + arg key it maps to", async () => {
  const g = await graph();
  const cases = [
    ["/find fnAlpha",             "seonix_search",       { query: "fnAlpha" }],
    ["/search fnAlpha",           "seonix_search",       { query: "fnAlpha" }],
    ["/context app/lib/a.mjs",    "seonix_context",      { symbol: "app/lib/a.mjs" }],
    ["/snippet fnAlpha",          "seonix_snippet",      { symbol: "fnAlpha" }],
    ["/describe Base",            "seonix_describe",     { symbol: "Base" }],
    ["/signature fnAlpha",        "seonix_signature",    { symbol: "fnAlpha" }],
    ["/members Widget",           "seonix_members",      { class: "Widget" }],
    ["/subclasses Base",          "seonix_subclasses",   { class: "Base" }],
    ["/impact app/lib/a.mjs",     "seonix_impact",       { module: "app/lib/a.mjs" }],
    ["/callers fnAlpha",          "seonix_callers",      { symbol: "fnAlpha" }],
    ["/callees fnAlpha",          "seonix_callees",      { symbol: "fnAlpha" }],
    ["/tests fnAlpha",            "seonix_tests_for",    { symbol: "fnAlpha" }],
    ["/untested",                 "seonix_untested",     {}],
    ["/history fnAlpha",          "seonix_history",      { symbol: "fnAlpha" }],
    ["/exports app/lib/a.mjs",    "seonix_exports",      { module: "app/lib/a.mjs" }],
    ["/arch",                     "seonix_architecture", { package: "" }],
  ];
  for (const [line, tool, args] of cases) {
    const { answer } = await runTurn(line, { config: CONFIG, graph: g });
    // /snippet and /context READ the real source file (absent from the fixture dir), so
    // the tool throws ENOENT there — runTurn catches it into the answer, so compare against
    // the same caught message: either way this proves the exact tool+arg the command mapped to.
    const direct = await dispatchTool(tool, args, { config: CONFIG }).catch((e) => String(e?.message || e));
    assert.equal(answer, direct, `${line} → ${tool}(${JSON.stringify(args)})`);
  }
});

test("runTurn: unknown /command is handled with a /help nudge, not a crash", async () => {
  const { answer, record } = await runTurn("/bogus x", { config: CONFIG, graph: await graph() });
  assert.match(answer, /unknown command \/bogus/);
  assert.match(answer, /\/help/);
  assert.equal(record.miss, true);
  assert.equal(record.command, "bogus");
});

test("runTurn: a bad symbol prints the tool's clean error, never a stack; miss recorded", async () => {
  const { answer, record } = await runTurn("/describe no_such_symbol_xyz", { config: CONFIG, graph: await graph() });
  assert.match(answer, /no entity matching/);
  assert.doesNotMatch(answer, /\bat \w+.*:\d+:\d+/, "no stack frames leak");
  assert.equal(record.miss, true);
  assert.deepEqual(record.resolvedIds, []);
});

test("runTurn: /help lists the commands (from COMMANDS) and the ask question shapes", async () => {
  const { answer } = await runTurn("/help", { config: CONFIG, graph: await graph() });
  const direct = await helpText();
  assert.equal(answer, direct);
  for (const name of Object.keys(COMMANDS)) assert.ok(answer.includes(`/${name}`), `help lists /${name}`);
  assert.ok(answer.includes("/focus"), "help lists /focus");
  assert.ok(answer.includes("/exit"), "help lists /exit");
  assert.match(answer, /question shapes for a bare line/);
  assert.match(answer, /which <functions\|classes\|modules>/, "shapes come from the engine's rephraseHint");
});

// ---- multi-turn context: the FOCUS entity + the "it" follow-up ----

test("runTurn: an entity command sets the focus and records its resolved id", async () => {
  const { record, focus } = await runTurn("/describe app/lib/a.mjs", { config: CONFIG, graph: await graph() });
  assert.deepEqual(focus, { id: "mod-a", label: "app/lib/a.mjs" });
  assert.equal(record.command, "describe");
  assert.deepEqual(record.resolvedIds, ["mod-a"], "the command turn records the entity it resolved");
});

test("runTurn: a bare 'it' resolves to the focus (threaded to ask as contextId)", async () => {
  const g = await graph();
  const focus = { id: "mod-a", label: "app/lib/a.mjs" };
  const withFocus = await runTurn("which modules import it", { config: CONFIG, graph: g, focus });
  assert.match(withFocus.answer, /app\/lib\/b\.mjs/, "'it' resolved to the focus module");
  assert.equal(withFocus.answer, await runTurn("which modules import a.mjs", { config: CONFIG, graph: g }).then((r) => r.answer));
  // with NO focus the pronoun is an honest miss, not a guess — proving the contextId did the work
  const noFocus = await runTurn("which modules import it", { config: CONFIG, graph: g, focus: null });
  assert.doesNotMatch(noFocus.answer, /app\/lib\/b\.mjs/);
});

test("runTurn: a no-arg entity command reuses the focus", async () => {
  const g = await graph();
  const focus = { id: "mod-a", label: "app/lib/a.mjs" };
  const { answer, record } = await runTurn("/impact", { config: CONFIG, graph: g, focus });
  assert.equal(answer, await dispatchTool("seonix_impact", { module: "app/lib/a.mjs" }, { config: CONFIG }));
  assert.deepEqual(record.resolvedIds, ["mod-a"]);
  // no arg AND no focus → a helpful "needs a …" line, not a crash
  const bare = await runTurn("/impact", { config: CONFIG, graph: g, focus: null });
  assert.match(bare.answer, /\/impact needs a module/);
  assert.equal(bare.record.miss, true);
});

test("runTurn: /focus sets the focus explicitly; no-arg /focus reports it", async () => {
  const g = await graph();
  const set = await runTurn("/focus Widget", { config: CONFIG, graph: g });
  assert.match(set.answer, /focus set to Widget/);
  assert.deepEqual(set.focus, { id: "cls-widget", label: "Widget" });
  assert.deepEqual(set.record.resolvedIds, ["cls-widget"]);
  const show = await runTurn("/focus", { config: CONFIG, graph: g, focus: set.focus });
  assert.match(show.answer, /focus is Widget/);
  const none = await runTurn("/focus", { config: CONFIG, graph: g, focus: null });
  assert.match(none.answer, /no focus set/);
});

test("runTurn: a bare-ask hit sets the focus so the next 'it' has something to bind to", async () => {
  const g = await graph();
  const { focus } = await runTurn("what does app/lib/a.mjs import", { config: CONFIG, graph: g });
  assert.equal(focus?.id, "mod-a", "the ask object term became the focus");
});

// ---- aggregate / count queries (answered off the graph header) ----

test("answerCount: plurals and singulars map to the right class; count is live off individuals", async () => {
  const g = await graph();
  // fixture: Class:3 (Base/Widget/Button), Function:1 (fnAlpha), Module:8, Method:1
  assert.equal(answerCount(g, "how many classes are there"), "3 classes.");
  assert.equal(answerCount(g, "how many class"), "3 classes.");
  assert.equal(answerCount(g, "count the functions"), "1 function.", "singular when n===1");
  assert.equal(answerCount(g, "number of modules"), "8 modules.");
  assert.equal(answerCount(g, "how many methods"), "1 method.");
});

test("answerCount: an unknown kind lists what it CAN count, and a non-count line is null (→ ask)", async () => {
  const g = await graph();
  const unknown = answerCount(g, "how many bananas are there");
  assert.match(unknown, /can't count "bananas"/);
  assert.match(unknown, /classes/);
  assert.equal(answerCount(g, "which modules import a.mjs"), null, "not a count query → falls through to ask");
});

test("runTurn: a count question is answered before ask, recorded as a non-miss turn, focus untouched", async () => {
  const g = await graph();
  const focus = { id: "mod-a", label: "app/lib/a.mjs" };
  const { answer, record, focus: after } = await runTurn("how many classes are there", { config: CONFIG, graph: g, focus });
  assert.equal(answer, "3 classes.");
  assert.equal(record.miss, false);
  assert.deepEqual(record.resolvedIds, []);
  assert.deepEqual(after, focus, "a count names no entity — focus is unchanged");
});

test("renderStats / /stats: entity counts, predicate counts and package totals off the header", async () => {
  const g = await graph();
  const stats = renderStats(g);
  assert.match(stats, /entities by class:/);
  assert.match(stats, /\bModule\b/);
  assert.match(stats, /\bClass\b/);
  assert.match(stats, /relationships by predicate:/);
  assert.match(stats, /module\(s\) across \d+ top-level package\(s\)/);
  const { answer, record } = await runTurn("/stats", { config: CONFIG, graph: g });
  assert.equal(answer, stats);
  assert.equal(record.command, "stats");
  assert.equal(record.miss, false);
});

// ---- friendly vs. grammar-hint branch ----

test("isConversational: greetings / help-phrases / short non-code → true; near-miss structural → false", () => {
  for (const c of ["hi", "hello", "Hey", "thanks", "thank you", "what can you do", "help me", "?", "banana"]) {
    assert.equal(isConversational(c), true, `"${c}" is conversational`);
  }
  for (const s of ["which modules import a.mjs", "what calls fnAlpha", "where is walk.mjs", "buildContextBundle", "a.mjs"]) {
    assert.equal(isConversational(s), false, `"${s}" looks structural`);
  }
});

test("runTurn: a greeting gets a short friendly greeting + a nudge (conversational layer, not the grammar hint)", async () => {
  const g = await graph();
  const { answer, record } = await runTurn("hello", { config: CONFIG, graph: g });
  assert.match(answer, /^Hi\./);
  assert.match(answer, /\/help/, "the greeting nudges toward /help");
  assert.doesNotMatch(answer, /couldn't parse this as a graph question/, "no raw grammar hint for a greeting");
  assert.equal(record.conversational, true, "recorded as a conversational turn");
  assert.deepEqual(record.resolvedIds, [], "a greeting resolves no entity → no asksAbout edge");
});

test("runTurn: a near-miss structural question keeps the precise grammar hint", async () => {
  // a genuine grammar miss that mentions a structural word ("class") → NOT conversational
  const { answer, record } = await runTurn("explain the class hierarchy to me", { config: CONFIG, graph: await graph() });
  assert.equal(record.miss, true);
  assert.match(answer, /couldn't parse this as a graph question/);
  assert.doesNotMatch(answer, /I answer questions about THIS codebase/);
});

// ---- conversational (ELIZA/Zork-manners) templated layer ----

test("runTurn: greetings / thanks / help each return their template, none polluting the graph", async () => {
  const g = await graph();
  const hey = await runTurn("hey", { config: CONFIG, graph: g });
  assert.match(hey.answer, /^Hi\./);
  const zork = await runTurn("hello there", { config: CONFIG, graph: g });
  assert.match(zork.answer, /Hello there\./);
  assert.match(zork.answer, /hollow voice/i, "the Zork nod for 'hello there'");
  const ta = await runTurn("thanks", { config: CONFIG, graph: g });
  assert.match(ta.answer, /Any time/);
  const cheers = await runTurn("cheers", { config: CONFIG, graph: g });
  assert.match(cheers.answer, /Any time/);
  const help = await runTurn("what can you do", { config: CONFIG, graph: g });
  assert.match(help.answer, /I answer questions about THIS codebase's structure/, "help/orientation reuses FRIENDLY");
  const who = await runTurn("who are you", { config: CONFIG, graph: g });
  assert.match(who.answer, /I answer questions about THIS codebase/);
  for (const r of [hey, zork, ta, cheers, help, who]) {
    assert.equal(r.record.conversational, true, `${r.record.query} recorded conversational`);
    assert.deepEqual(r.record.resolvedIds, [], "no asksAbout id for a conversational turn");
    assert.deepEqual(r.record.answeredIds, [], "no answered ids either");
    assert.notEqual(r.end, true, "only bye ends the session");
  }
});

test("runTurn: bye/goodbye signals a clean end of session (end:true) with a farewell", async () => {
  const g = await graph();
  for (const word of ["bye", "goodbye", "see ya", "quit"]) {
    const r = await runTurn(word, { config: CONFIG, graph: g });
    assert.equal(r.end, true, `"${word}" ends the session`);
    assert.match(r.answer, /Bye/);
    assert.equal(r.record.conversational, true);
  }
});

test("runTurn: why/say-more re-renders the last answer verbosely (traversal + matches)", async () => {
  const g = await graph();
  // a real hit first — its detail (traversal + matches) is threaded as `last`
  const hit = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  assert.match(hit.answer, /app\/lib\/b\.mjs/);
  assert.ok(hit.last?.answer, "the hit becomes the last answer");
  assert.ok(hit.last.detail?.traversal, "detail carries the traversal receipt");

  const why = await runTurn("why", { config: CONFIG, graph: g, last: hit.last });
  assert.match(why.answer, /expanding: which modules import a\.mjs/);
  assert.match(why.answer, /app\/lib\/b\.mjs/, "repeats the previous answer");
  assert.match(why.answer, /traversal:/, "shows the traversal receipt the terse render trims");
  assert.match(why.answer, /matches \(\d+\):/, "lists the matched entities");
  assert.deepEqual(why.last, hit.last, "say-more does not overwrite the last answer");

  const more = await runTurn("say more", { config: CONFIG, graph: g, last: hit.last });
  assert.match(more.answer, /traversal:/, "'say more' re-renders too");
});

test("runTurn: why with no previous answer says so plainly, not a crash", async () => {
  const g = await graph();
  const r = await runTurn("why", { config: CONFIG, graph: g, last: null });
  assert.match(r.answer, /No previous answer to expand/);
  assert.equal(r.record.miss, true, "an empty expand is recorded as a miss");
  assert.deepEqual(r.record.resolvedIds, []);
});

test("renderVerbose: empty state and a populated detail", () => {
  assert.equal(renderVerbose(null).empty, true);
  assert.equal(renderVerbose({ query: "q", answer: "" }).empty, true);
  const v = renderVerbose({
    query: "which modules import a.mjs", answer: "app/lib/b.mjs.",
    detail: { traversal: "imports edges where object = a.mjs", matches: [{ label: "app/lib/b.mjs", type: "Module" }] },
  });
  assert.equal(v.empty, false);
  assert.match(v.text, /traversal: imports edges/);
  assert.match(v.text, /app\/lib\/b\.mjs \[Module\]/);
});

test("runTurn: a dispatched turn updates `last`; a conversational turn preserves it", async () => {
  const g = await graph();
  const hit = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  const greet = await runTurn("hi", { config: CONFIG, graph: g, last: hit.last });
  assert.deepEqual(greet.last, hit.last, "a greeting does not overwrite the last answer");
  // a count turn is also expandable
  const count = await runTurn("how many classes are there", { config: CONFIG, graph: g });
  assert.equal(count.last.answer, "3 classes.");
});

test("runChat: a scripted conversational session — greeting, hit, why re-render, then bye ends it", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const input = Readable.from(["hi\n", "which modules import a.mjs\n", "why\n", "bye\n", "this line is never read\n"]);
    const { out, text } = sink();
    const { logFile, turns } = await runChat({ repoPath: dir, input, output: out });
    assert.equal(turns, 4, "greeting, hit, why, and bye are all turns; the line after bye is unread");
    const shown = text();
    assert.match(shown, /^.*Hi\./m, "greeting shown");
    assert.match(shown, /expanding: which modules import a\.mjs/, "why re-rendered the last answer");
    assert.match(shown, /traversal:/, "the verbose re-render carries the traversal receipt");
    assert.match(shown, /Bye/, "farewell shown");
    const log = await readFile(logFile, "utf8");
    assert.match(log, /> bye\n/, "the bye turn is logged");
    assert.match(log, /session end \d{4}-/, "the session ended cleanly after bye");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- default target = the git root, not raw cwd ----

test("runChat: with no --repo, the target defaults to the injected git toplevel", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const { out, text } = sink();
    // no repoPath — a mocked gitRoot stands in for `git rev-parse --show-toplevel`
    const { logFile } = await runChat({
      input: Readable.from(["/exit\n"]), output: out,
      cwd: "/some/nested/package/dir", gitRoot: () => dir,
    });
    assert.ok(logFile.startsWith(join(dir, SESSION_LOG_DIR) + "/"), "session lands under the git root, not cwd");
    assert.ok(text().includes(dir), "banner shows the resolved git-root repo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: not in a git repo (gitRoot → null) falls back to cwd", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const { out } = sink();
    const { logFile } = await runChat({
      input: Readable.from(["/exit\n"]), output: out,
      cwd: dir, gitRoot: () => null,
    });
    assert.ok(logFile.startsWith(join(dir, SESSION_LOG_DIR) + "/"), "falls back to cwd when not in a git repo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- runChat (scripted session, no TTY) ----

test("runChat: scripted session writes .seonix/session-<uuidv7>.log with header, turns, exit", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const input = Readable.from(["which modules import a.mjs\n", "tell me a joke\n", "  \n", "/exit\n"]);
    const { out, text } = sink();
    const { logFile, turns } = await runChat({ repoPath: dir, input, output: out });

    assert.equal(turns, 2, "the blank line and /exit are not turns");

    // log lands where the constant says, named by a v7 uuid
    assert.ok(logFile.startsWith(join(dir, SESSION_LOG_DIR) + "/"), logFile);
    const names = await readdir(join(dir, SESSION_LOG_DIR));
    const logName = names.find((n) => n.startsWith("session-"));
    assert.ok(logName, "session log exists");
    assert.match(logName, /^session-[0-9a-f-]{36}\.log$/);
    assert.match(logName.slice("session-".length, -".log".length), UUID_V7_RE);

    const log = await readFile(logFile, "utf8");
    assert.match(log, /^# seonix chat \d+\.\d+\.\d+ — session started \d{4}-.* — repo /, "header line");
    assert.ok(log.includes(dir), "header names the repo");
    assert.match(log, /> which modules import a\.mjs\n/);
    assert.match(log, /app\/lib\/b\.mjs/);
    assert.match(log, /> tell me a joke\n/);
    assert.match(log, /couldn't parse this as a graph question/);
    assert.match(log, /> \/exit\nsession end \d{4}-/, "exit + session end time are logged");

    // the TUI itself: banner (repo, module count, log path), hint, prompt, answers
    const shown = text();
    assert.ok(shown.includes(dir), "banner names the repo");
    assert.match(shown, /\d+ module\(s\)/);
    assert.ok(shown.includes(logFile), "banner names the log file");
    assert.match(shown, /ask a question, or \/help for commands \(\/stats for an overview\) — \/exit to leave/);
    assert.match(shown, /pass --repo <path> to target a different repo/);
    assert.ok(shown.includes(PROMPT));
    assert.match(shown, /app\/lib\/b\.mjs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: structured sidecar + read-time graph append — the session becomes graph data", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const input = Readable.from(["which modules import a.mjs\n", "tell me a joke\n", "/exit\n"]);
    const { out } = sink();
    const { logFile, sidecarFile, turns } = await runChat({ repoPath: dir, input, output: out });
    assert.equal(turns, 2);

    // sidecar: same uuid as the log, header + one line per turn + end marker, all valid JSON
    assert.ok(sidecarFile.startsWith(join(dir, ".seonix", "sessions") + "/"), sidecarFile);
    const uuid = logFile.match(/session-([0-9a-f-]{36})\.log$/)[1];
    assert.ok(sidecarFile.endsWith(`session-${uuid}.jsonl`), "sidecar shares the session uuid");
    const lines = (await readFile(sidecarFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 4);
    assert.equal(lines[0].type, "session");
    assert.equal(lines[0].id, uuid);
    assert.equal(lines[0].repo, dir);
    assert.match(lines[0].seonixVersion, /^\d+\.\d+\.\d+/);
    const [hit, miss] = [lines[1], lines[2]];
    assert.equal(hit.type, "turn");
    assert.equal(hit.query, "which modules import a.mjs");
    assert.equal(hit.miss, false);
    assert.ok(hit.answeredIds.includes("mod-b"), `answer cites the graph's entity ids: ${hit.answeredIds}`);
    assert.deepEqual(hit.resolvedIds, ["mod-a"], "the engine's resolveObject hit for the object term");
    assert.equal(miss.miss, true);
    assert.deepEqual([miss.resolvedIds, miss.answeredIds], [[], []], "empty arrays on a miss");
    assert.equal(lines[3].type, "end");

    // read-time append: graph.json now carries the Session individual + asksAbout edges
    const g = JSON.parse(await readFile(join(dir, ".seonix", "graph.json"), "utf8"));
    const sess = g.individuals.find((i) => i.id === `session:${uuid}`);
    assert.ok(sess, "Session individual appended to graph.json");
    assert.equal(sess.class, "Session");
    assert.equal(sess.attributes.find((a) => a.key === "turns").value, "2");
    assert.match(sess.attributes.find((a) => a.key === "queries").value, /which modules import a\.mjs \| tell me a joke/);
    const group = g.objectProperties.find((x) => x.prop === "mgx:asksAbout");
    assert.ok(group.examples.some((x) => x.subject === sess.id && x.object === "mod-a"));
    assert.ok(group.examples.some((x) => x.subject === sess.id && x.object === "mod-b"));
    // and the source-derived content is untouched (Module count, other edge groups)
    assert.equal(g.classes.find((c) => c.name === "Module").count, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: a slash-command turn is recorded — sidecar carries the command, graph gets its asksAbout edge", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const input = Readable.from(["/impact app/lib/a.mjs\n", "/help\n", "/exit\n"]);
    const { out } = sink();
    const { logFile, sidecarFile, turns } = await runChat({ repoPath: dir, input, output: out });
    assert.equal(turns, 2, "the slash-command AND /help are turns; /exit is not");

    const lines = (await readFile(sidecarFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const impact = lines.find((l) => l.type === "turn" && l.command === "impact");
    assert.ok(impact, "the /impact turn is in the sidecar with its command name");
    assert.equal(impact.query, "/impact app/lib/a.mjs");
    assert.deepEqual(impact.resolvedIds, ["mod-a"], "the command turn resolved its subject id");
    const help = lines.find((l) => l.type === "turn" && l.command === "help");
    assert.ok(help, "the /help turn is recorded too");
    assert.deepEqual(help.resolvedIds, [], "a no-entity command records no asksAbout id");

    // the /impact turn became first-class graph data — a Session node + asksAbout edge
    const uuid = logFile.match(/session-([0-9a-f-]{36})\.log$/)[1];
    const gjson = JSON.parse(await readFile(join(dir, ".seonix", "graph.json"), "utf8"));
    const sess = gjson.individuals.find((i) => i.id === `session:${uuid}`);
    assert.ok(sess, "Session individual appended");
    assert.match(sess.attributes.find((a) => a.key === "queries").value, /\/impact app\/lib\/a\.mjs \| \/help/);
    const group = gjson.objectProperties.find((x) => x.prop === "mgx:asksAbout");
    assert.ok(group.examples.some((x) => x.subject === sess.id && x.object === "mod-a"), "slash-command asksAbout edge landed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: input ending without /exit (Ctrl+D shape) still closes cleanly and logs the end", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const input = Readable.from(["which modules import a.mjs\n"]); // stream just ends
    const { out } = sink();
    const { logFile, turns } = await runChat({ repoPath: dir, input, output: out });
    assert.equal(turns, 1);
    const log = await readFile(logFile, "utf8");
    assert.match(log, /session end \d{4}-/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: missing graph throws the server's own helpful error before any prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seonix-chat-nograph-"));
  try {
    const { out } = sink();
    await assert.rejects(
      () => runChat({ repoPath: dir, input: Readable.from([]), output: out }),
      /no graph artifact at .*index_repository/s,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- binary smoke ----

test("cli chat: real binary, stdin closed after /exit → exit 0; graphless repo → clean error", async () => {
  const dir = await repoWithFixtureGraph();
  const bare = await mkdtemp(join(tmpdir(), "seonix-chat-bare-"));
  try {
    const ok = spawnSync(process.execPath, [BIN, "chat", "--repo", dir], {
      encoding: "utf8", input: "which modules import a.mjs\n/exit\n",
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /app\/lib\/b\.mjs/);
    const names = await readdir(join(dir, ".seonix"));
    assert.ok(names.some((n) => /^session-.*\.log$/.test(n)), "binary session wrote its log");

    // stdin immediately closed, no graph → the no-graph error, non-zero exit, no crash
    const bad = spawnSync(process.execPath, [BIN, "chat", "--repo", bare], { encoding: "utf8", input: "" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /no graph artifact at/);
    assert.match(bad.stderr, /index_repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
  }
});
