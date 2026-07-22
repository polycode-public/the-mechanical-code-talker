// chat.mjs tests — uuidv7, the pure turn function, a scripted (no-TTY) session
// against the entities fixture, and a binary smoke of `tmct chat`. The turn
// function is exercised through the SAME dispatchTool path the CLI uses, with
// config.graphFile pointed straight at the committed fixture (the same trick
// e2e/cli-smoke.test.mjs's repoWithFixtureGraph plays via .tmct/).
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
  renderVerbose, WALL_MISS_RE,
} from "../../src/services/chat.mjs";
import { dispatchTool } from "../../src/tools/server.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import * as source from "../../src/adapters/source.mjs";
import { CANONICAL_LINE_RE } from "../helpers/session.mjs";

// bin/tmct.mjs: a spawned child has non-TTY stdio, so `chat` takes the --plain
// readline path.
const BIN = fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
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
  const dir = await mkdtemp(join(tmpdir(), "tmct-chat-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
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
  assert.doesNotMatch(answer, /---tmct_ask---/, "the machine envelope is not shown in the TUI");
  assert.equal(logLines.length, 4);
  assert.match(logLines[0], ISO_RE);
  assert.equal(logLines[1], `> ${query}`);
  assert.equal(logLines[2], answer);
  assert.equal(logLines[3], "", "turn record ends with a blank line");
});

test("runTurn: a grammar miss gets the SHORT tailored miss (#1), not the full grammar wall", async () => {
  // #1: the full rephraseHint cheat-sheet now lives only behind /help; a genuine
  // parse-miss keeps the honest "couldn't parse … Try:" opening (graded hm-joke pins
  // those words) + at most two RELEVANT example shapes + a /help pointer.
  const { answer, logLines } = await runTurn("tell me a joke", { config: { graphFile: FIXTURE } });
  assert.match(answer, WALL_MISS_RE);
  assert.match(answer, /Type \/help for all query shapes\./);
  assert.doesNotMatch(answer, /which <functions\|classes\|modules>/, "the full grammar wall is gone (it lives behind /help)");
  assert.equal(logLines[2], answer, "the miss text is logged verbatim too");
});

test("runTurn: a structural query over a MISSING graph is an honest miss (bootstrap), not a crash", async () => {
  const { answer, record } = await runTurn("which modules import a.mjs", {
    config: { graphFile: "/nonexistent/.tmct/graph.json" },
  });
  assert.match(answer, /I can't answer that as a code question — no code graph is loaded in this session/);
  assert.match(answer, /tmct init/, "names the recovery");
  assert.doesNotMatch(answer, /the graph at .* is empty/, "the loader's internal error is never the answer");
  assert.doesNotMatch(answer, /\n\s+at /, "message only — never a stack trace");
  assert.equal(record.miss, true);
});

// ---- slash-commands: reach every tool (bare input still asks) ----

test("runTurn: a bare (non-slash) line still dispatches tmct_ask (the default)", async () => {
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
  // Bug F point 5: every command dispatch now carries its own "Goal (inferred):
  // …" line (GOAL_BY_COMMAND) — expected here alongside the tool's raw answer.
  const cases = [
    ["/find fnAlpha",             "tmct_search",       { query: "fnAlpha" },        "Locate a specific named entity."],
    ["/search fnAlpha",           "tmct_search",       { query: "fnAlpha" },        "Locate a specific named entity."],
    ["/context app/lib/a.mjs",    "tmct_context",      { symbol: "app/lib/a.mjs" }, "Gather the sized edit bundle for a symbol before changing code."],
    ["/snippet fnAlpha",          "tmct_snippet",      { symbol: "fnAlpha" },       "View a symbol's exact source."],
    ["/describe Base",            "tmct_describe",     { symbol: "Base" },          "Look up a symbol's definition and relations."],
    ["/signature fnAlpha",        "tmct_signature",    { symbol: "fnAlpha" },       "View a symbol's signature."],
    ["/members Widget",           "tmct_members",      { class: "Widget" },         "Understand class membership (methods/attributes)."],
    ["/subclasses Base",          "tmct_subclasses",   { class: "Base" },           "Understand a class hierarchy/inheritance relationship."],
    ["/impact app/lib/a.mjs",     "tmct_impact",       { module: "app/lib/a.mjs" }, "Understand what a change to this module would reach (impact closure)."],
    ["/callers fnAlpha",          "tmct_callers",      { symbol: "fnAlpha" },       "Understand a call relationship."],
    ["/callees fnAlpha",          "tmct_callees",      { symbol: "fnAlpha" },       "Understand a call relationship."],
    ["/tests fnAlpha",            "tmct_tests_for",    { symbol: "fnAlpha" },       "Assess test coverage."],
    ["/untested",                 "tmct_untested",     {},                         "Assess test coverage."],
    ["/history fnAlpha",          "tmct_history",      { symbol: "fnAlpha" },       "Understand commit/change history."],
    ["/exports app/lib/a.mjs",    "tmct_exports",      { module: "app/lib/a.mjs" }, "Understand a module's public exports/API surface."],
    ["/arch",                     "tmct_architecture", { package: "" },             "Understand the overall architecture (package/module boundaries)."],
  ];
  for (const [line, tool, args, goal] of cases) {
    const { answer } = await runTurn(line, { config: CONFIG, graph: g });
    // /snippet and /context READ the real source file (absent from the fixture dir), so
    // the tool throws ENOENT there — runTurn catches it into the answer, so compare against
    // the same caught message: either way this proves the exact tool+arg the command mapped to.
    const direct = await dispatchTool(tool, args, { config: CONFIG }).catch((e) => String(e?.message || e));
    assert.equal(answer, `${direct}\n\nGoal (inferred): ${goal}`, `${line} → ${tool}(${JSON.stringify(args)})`);
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
  // Bug F point 5: /help isn't worth a bespoke GOAL_BY_COMMAND entry — it gets
  // the short generic fallback goal line, same as /stats/memory/focus.
  assert.equal(answer, `${direct}\n\nGoal (inferred): Use a specific tool/command directly.`);
  for (const name of Object.keys(COMMANDS)) assert.ok(answer.includes(`/${name}`), `help lists /${name}`);
  assert.ok(answer.includes("/focus"), "help lists /focus");
  assert.ok(answer.includes("/exit"), "help lists /exit");
  assert.match(answer, /question shapes for a bare line/);
  assert.match(answer, /which <functions\|classes\|modules>/, "shapes come from the engine's rephraseHint");
});

// ---- multi-turn context: the FOCUS entity + the "it" follow-up ----

test("runTurn: an entity command sets the focus and records its resolved id", async () => {
  const { record, focus } = await runTurn("/describe app/lib/a.mjs", { config: CONFIG, graph: await graph() });
  assert.deepEqual(focus, { id: "mod:app/lib/a.mjs", label: "app/lib/a.mjs" });
  assert.equal(record.command, "describe");
  assert.deepEqual(record.resolvedIds, ["mod:app/lib/a.mjs"], "the command turn records the entity it resolved");
});

test("runTurn: a bare 'it' resolves to the focus (threaded to ask as contextId)", async () => {
  const g = await graph();
  const focus = { id: "mod:app/lib/a.mjs", label: "app/lib/a.mjs" };
  const withFocus = await runTurn("which modules import it", { config: CONFIG, graph: g, focus });
  assert.match(withFocus.answer, /app\/lib\/b\.mjs/, "'it' resolved to the focus module");
  // canonicalOf reads parsed.object as typed ("it"), never contextId-resolved — so the
  // trailing Canonical line legitimately differs between the two phrasings even though
  // the substantive answer (and Goal line) match byte-for-byte; excluded from this
  // equality check for that reason.
  const literalAnswer = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g }).then((r) => r.answer);
  assert.equal(withFocus.answer.replace(CANONICAL_LINE_RE, ""), literalAnswer.replace(CANONICAL_LINE_RE, ""));
  // with NO focus the pronoun is an honest miss, not a guess — proving the contextId did the work
  const noFocus = await runTurn("which modules import it", { config: CONFIG, graph: g, focus: null });
  assert.doesNotMatch(noFocus.answer, /app\/lib\/b\.mjs/);
});

test("runTurn: a no-arg entity command reuses the focus", async () => {
  const g = await graph();
  const focus = { id: "mod:app/lib/a.mjs", label: "app/lib/a.mjs" };
  const { answer, record } = await runTurn("/impact", { config: CONFIG, graph: g, focus });
  const direct = await dispatchTool("tmct_impact", { module: "app/lib/a.mjs" }, { config: CONFIG });
  assert.equal(answer, `${direct}\n\nGoal (inferred): Understand what a change to this module would reach (impact closure).`);
  assert.deepEqual(record.resolvedIds, ["mod:app/lib/a.mjs"]);
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
  assert.equal(focus?.id, "mod:app/lib/a.mjs", "the ask object term became the focus");
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

// ---- answerEdgeCount: bare "how many X" for EDGE-NOMINALIZED nouns
// (tests/importers/callers/…). COUNT_NOUNS only maps a noun to a
// graph INDIVIDUAL CLASS; these nouns instead name an EDGE KIND
// (ask-vocab.mjs's EDGE_NOUN_TO_METRIC, the same table the superlative lane
// "which module has the most tests" already reads) — answerEdgeCount routes
// them through the SAME per-entity degree computation (ask.mjs's exported
// degreeMetric) rather than the header-count path. Fixture edges: b.mjs,
// c.mjs, e.mjs all import a.mjs (3 importers); scripts/g.mjs calls a.mjs (1
// caller); b.test.mjs tests b.mjs and d/handler.mjs (1 test covers each); cls-button inherits
// cls-widget (1 subclass); cls-widget contains m-render + a-name (2 members).

test("runTurn: 'how many tests cover X' answers via the edge-metric path, not 'I can't count'", async () => {
  const g = await graph();
  const { answer, record } = await runTurn("how many tests cover app/lib/b.mjs", { config: CONFIG, graph: g });
  assert.equal(answer, "1 test.");
  assert.equal(record.miss, false);
});

test("runTurn: 'how many importers does X have' answers via the edge-metric path", async () => {
  const g = await graph();
  const { answer, record } = await runTurn("how many importers does app/lib/a.mjs have", { config: CONFIG, graph: g });
  assert.equal(answer, "3 importers.");
  assert.equal(record.miss, false);
});

test("runTurn: 'how many callers does X have' answers via the edge-metric path", async () => {
  const g = await graph();
  const { answer } = await runTurn("how many callers does app/lib/a.mjs have", { config: CONFIG, graph: g });
  assert.equal(answer, "1 caller.");
});

test("runTurn: other EDGE_NOUN_TO_METRIC nouns also resolve per-entity (subclasses, members)", async () => {
  const g = await graph();
  const subclasses = await runTurn("how many subclasses does Widget have", { config: CONFIG, graph: g });
  assert.equal(subclasses.answer, "1 subclass.");
  const members = await runTurn("how many members does Widget have", { config: CONFIG, graph: g });
  assert.equal(members.answer, "2 members.");
});

test("runTurn: a bare edge-nominalized count with no resolvable entity still gets answerCount's honest 'I can't count' miss (scoped out, not silently wrong)", async () => {
  const g = await graph();
  const { answer } = await runTurn("how many tests are there", { config: CONFIG, graph: g });
  assert.match(answer, /can't count "tests"/);
  const noEntity = await runTurn("how many importers does nonexistent_module_xyz.mjs have", { config: CONFIG, graph: g });
  assert.match(noEntity.answer, /can't count "importers"/);
});

test("runTurn: existing COUNT_NOUNS counts (a real graph class) are unaffected by the new edge-count lane", async () => {
  const g = await graph();
  assert.equal((await runTurn("how many classes are there", { config: CONFIG, graph: g })).answer, "3 classes.");
  assert.equal((await runTurn("how many modules are there", { config: CONFIG, graph: g })).answer, "8 modules.");
});

test("runTurn: the differently-phrased equivalent ('how many modules test X', restrictor path via the ask engine) still works and agrees with the new edge-count lane", async () => {
  const g = await graph();
  const modules = await runTurn("how many modules test app/lib/b.mjs", { config: CONFIG, graph: g });
  const tests = await runTurn("how many tests cover app/lib/b.mjs", { config: CONFIG, graph: g });
  assert.ok(modules.answer.startsWith("1 module."), `expected to start with "1 module.", got: ${modules.answer}`);
  assert.equal(tests.answer, "1 test.");
});

test("runTurn: the superlative lane ('which module has the most tests') is unaffected by the edge-count fix", async () => {
  const g = await graph();
  const { answer } = await runTurn("which module has the most tests", { config: CONFIG, graph: g });
  assert.match(answer, /app\/lib\/b\.mjs|app\/functions\/d\/handler\.mjs/);
});

// Bug C (operator manual-chat find, this session): "count soup" with NO code
// graph loaded rendered the grammatically-broken "I count: ." (a dangling
// empty list) and then pointlessly suggested "how many classes are there",
// which would ALSO fail — countableKinds(graph) is genuinely empty when no
// class individual is present at all.
test("answerCount Bug C: an unknown kind with a graph carrying NO countable individuals gets an honest 'no code graph loaded' message, never the broken dangling-list one", () => {
  const empty = { individuals: [], byId: new Map(), relations: [], truncated: [], proseIndex: {} };
  const r = answerCount(empty, "count soup");
  assert.match(r, /^I can't count "soup" — no code graph is loaded yet, so there's nothing to count/);
  assert.doesNotMatch(r, /I count: \./, "never the dangling-empty-list phrasing");
  assert.doesNotMatch(r, /how many classes are there/, "never a suggested example that would ALSO fail on this graph");
});

test("runTurn: a count question is answered before ask, recorded as a non-miss turn, focus untouched", async () => {
  const g = await graph();
  const focus = { id: "mod:app/lib/a.mjs", label: "app/lib/a.mjs" };
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
  // Bug F point 5: /stats isn't worth a bespoke GOAL_BY_COMMAND entry — it gets
  // the short generic fallback goal line, same as /help/memory/focus.
  assert.equal(answer, `${stats}\n\nGoal (inferred): Use a specific tool/command directly.`);
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
  const mirrored = await runTurn("hello there", { config: CONFIG, graph: g });
  assert.match(mirrored.answer, /Hello there\./);
  assert.doesNotMatch(mirrored.answer, /hollow voice|fool/i, "a plain greeting carries no aside that reads as an insult");
  const ta = await runTurn("thanks", { config: CONFIG, graph: g });
  assert.match(ta.answer, /Any time/);
  const cheers = await runTurn("cheers", { config: CONFIG, graph: g });
  assert.match(cheers.answer, /Any time/);
  const help = await runTurn("what can you do", { config: CONFIG, graph: g });
  assert.match(help.answer, /I answer questions about THIS codebase's structure/, "help/orientation reuses FRIENDLY");
  // IDENTITY is now a distinct lane from CAPABILITY (was: both conflated onto the
  // capability blurb, so "who are you" never got a self-description) — "who are
  // you" answers with identity-self, not the "ask me about this codebase" card.
  const who = await runTurn("who are you", { config: CONFIG, graph: g });
  assert.match(who.answer, /I'm tmct/, "who-are-you gets a self-description");
  assert.doesNotMatch(who.answer, /I answer questions about THIS codebase/, "identity is distinct from capability orientation");
  for (const r of [hey, mirrored, ta, cheers, help, who]) {
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

test("runTurn: discourse anaphora — 'which of those are tested' filters the previous answer set", async () => {
  const g = await graph();
  const list = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  assert.equal(list.record.miss, false);
  // the follow-up refers to turn 1's ids (threaded as `prev` via last.detail.matches)
  const those = await runTurn("which of those are tested", { config: CONFIG, graph: g, last: list.last });
  assert.equal(those.record.miss, false, "the anaphora resolves, not a 'needs a previous answer' miss");
  assert.doesNotMatch(those.answer, /needs a previous answer/);
  // with NO prior answer it stays an honest miss (never a guess)
  const bare = await runTurn("which of those are tested", { config: CONFIG, graph: g, last: null });
  assert.equal(bare.record.miss, true);
});

test("runTurn: discourse+count — 'how many of those' / 'count them' count the previous set, not a bad-kind error", async () => {
  const g = await graph();
  const list = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  const nMatch = list.answer.match(/app\/lib/g) || [];
  const howMany = await runTurn("how many of those", { config: CONFIG, graph: g, last: list.last });
  assert.doesNotMatch(howMany.answer, /I can't count/, "the anaphoric count no longer falls into the bad-kind branch");
  assert.match(howMany.answer, /^\d+ /, "answers with a leading count");
  const countThem = await runTurn("count them", { config: CONFIG, graph: g, last: list.last });
  assert.match(countThem.answer, /^\d+ /);
  // a plain kind count is untouched by the anaphora decline
  const plain = await runTurn("how many classes are there", { config: CONFIG, graph: g });
  assert.equal(plain.answer, "3 classes.");
});

test("runTurn: 'what about X' re-asks the prior question shape with X swapped in", async () => {
  const g = await graph();
  const first = await runTurn("what does app/lib/e.mjs import", { config: CONFIG, graph: g });
  const direct = await runTurn("what does app/lib/c.mjs import", { config: CONFIG, graph: g });
  const about = await runTurn("what about app/lib/c.mjs", { config: CONFIG, graph: g, last: first.last });
  assert.equal(about.answer, direct.answer, "the continuation answers as if the prior shape were re-asked for the new subject");
  assert.equal(about.record.query, "what about app/lib/c.mjs", "the record keeps the user's actual words");
  // no prior turn → nothing to continue, an ordinary (miss) turn
  const orphan = await runTurn("what about app/lib/c.mjs", { config: CONFIG, graph: g, last: null });
  assert.notEqual(orphan.answer, direct.answer);
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
    assert.match(log, /session end \d{2}:\d{2}:\d{2}\.\d{3}/, "the session ended cleanly after bye");
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

test("runChat: scripted session writes .tmct/session-<uuidv7>.md — glow-Markdown header, turns, exit", async () => {
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
    assert.match(logName, /^session-[0-9a-f-]{36}\.md$/);
    assert.match(logName.slice("session-".length, -".md".length), UUID_V7_RE);

    const log = await readFile(logFile, "utf8");
    assert.match(log, /^# tmct chat \d+\.\d+\.\d+ — session [0-9a-f]{8}\n\n\*\d{4}-\d{2}-\d{2} · started \d{2}:\d{2}:\d{2}\.\d{3} · repo /, "the title + byline carry version, a short session id, the date, and the repo");
    assert.ok(log.includes(dir), "byline names the repo");
    assert.match(log, /### \d{2}:\d{2}:\d{2}\.\d{3} · turn 1\n\n> which modules import a\.mjs\n\n```text\n/, "turn 1 is a time-of-day heading, a verbatim blockquote, then a fenced block");
    assert.match(log, /app\/lib\/b\.mjs/);
    assert.match(log, /### \d{2}:\d{2}:\d{2}\.\d{3} · turn 2\n\n> tell me a joke\n\n```text\n/);
    assert.match(log, /couldn't parse this as a graph question/);
    assert.match(log, /### \d{2}:\d{2}:\d{2}\.\d{3} · turn 3\n\n> \/exit\n\n```text\n```\n\n---\n\n\*session end \d{2}:\d{2}:\d{2}\.\d{3} — 3 turns\*\n$/, "the closing /exit marker and the session-end line");

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
    assert.ok(sidecarFile.startsWith(join(dir, ".tmct", "sessions") + "/"), sidecarFile);
    const uuid = logFile.match(/session-([0-9a-f-]{36})\.md$/)[1];
    assert.ok(sidecarFile.endsWith(`session-${uuid}.jsonl`), "sidecar shares the session uuid");
    const lines = (await readFile(sidecarFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 4);
    assert.equal(lines[0].type, "session");
    assert.equal(lines[0].id, uuid);
    assert.equal(lines[0].repo, dir);
    assert.match(lines[0].tmctVersion, /^\d+\.\d+\.\d+/);
    const [hit, miss] = [lines[1], lines[2]];
    assert.equal(hit.type, "turn");
    assert.equal(hit.query, "which modules import a.mjs");
    assert.equal(hit.miss, false);
    assert.ok(hit.answeredIds.includes("mod:app/lib/b.mjs"), `answer cites the graph's entity ids: ${hit.answeredIds}`);
    assert.deepEqual(hit.resolvedIds, ["mod:app/lib/a.mjs"], "the engine's resolveObject hit for the object term");
    assert.equal(miss.miss, true);
    assert.deepEqual([miss.resolvedIds, miss.answeredIds], [[], []], "empty arrays on a miss");
    assert.equal(lines[3].type, "end");

    // read-time append: graph.json now carries the Session individual + asksAbout edges
    const g = JSON.parse(await readFile(join(dir, ".tmct", "graph.json"), "utf8"));
    const sess = g.individuals.find((i) => i.id === `session:${uuid}`);
    assert.ok(sess, "Session individual appended to graph.json");
    assert.equal(sess.class, "Session");
    assert.equal(sess.attributes.find((a) => a.key === "turns").value, "2");
    assert.match(sess.attributes.find((a) => a.key === "queries").value, /which modules import a\.mjs \| tell me a joke/);
    const group = g.objectProperties.find((x) => x.prop === "mgx:asksAbout");
    assert.ok(group.examples.some((x) => x.subject === sess.id && x.object === "mod:app/lib/a.mjs"));
    assert.ok(group.examples.some((x) => x.subject === sess.id && x.object === "mod:app/lib/b.mjs"));
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
    assert.deepEqual(impact.resolvedIds, ["mod:app/lib/a.mjs"], "the command turn resolved its subject id");
    const help = lines.find((l) => l.type === "turn" && l.command === "help");
    assert.ok(help, "the /help turn is recorded too");
    assert.deepEqual(help.resolvedIds, [], "a no-entity command records no asksAbout id");

    // the /impact turn became first-class graph data — a Session node + asksAbout edge
    const uuid = logFile.match(/session-([0-9a-f-]{36})\.md$/)[1];
    const gjson = JSON.parse(await readFile(join(dir, ".tmct", "graph.json"), "utf8"));
    const sess = gjson.individuals.find((i) => i.id === `session:${uuid}`);
    assert.ok(sess, "Session individual appended");
    assert.match(sess.attributes.find((a) => a.key === "queries").value, /\/impact app\/lib\/a\.mjs \| \/help/);
    const group = gjson.objectProperties.find((x) => x.prop === "mgx:asksAbout");
    assert.ok(group.examples.some((x) => x.subject === sess.id && x.object === "mod:app/lib/a.mjs"), "slash-command asksAbout edge landed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: the transcript echoes the user's line verbatim — a rewritten opener and a multi-sentence teach both quote what was typed", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const input = Readable.from([
      "what people do you know about\n",
      "disk-1 is a disk. disk-2 is a disk. disk-3 is a disk.\n",
      "/exit\n",
    ]);
    const { out } = sink();
    const { logFile } = await runChat({ repoPath: dir, input, output: out, env: { TMCT_NO_SEED: "1" } });
    const log = await readFile(logFile, "utf8");
    // The vocab-opener rewrite ("what is a person") must not leak into the echo.
    assert.match(log, /^> what people do you know about$/m, "the opener is echoed verbatim");
    assert.ok(!/^> what is a person$/m.test(log), "the internal rewrite never reaches the transcript");
    // A multi-sentence teach echoes the WHOLE line, not just its last sentence.
    assert.match(log, /^> disk-1 is a disk\. disk-2 is a disk\. disk-3 is a disk\.$/m, "the whole multi-sentence line is echoed");
    assert.ok(!/^> disk-3 is a disk\.$/m.test(log), "the last sentence alone is never the echo");
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
    assert.match(log, /session end \d{2}:\d{2}:\d{2}\.\d{3}/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChat: missing graph bootstraps clean — honest empty banner, conversational turns work, and the session CREATES graph.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-chat-nograph-"));
  try {
    const { out, text } = sink();
    const input = Readable.from(["hi\n", "which modules import a.mjs\n", "/exit\n"]);
    // W3 seeding is covered by wiring-seed.test.mjs — opted out here to keep this
    // test about the bootstrap banner/turn/fold contract (and fast).
    const { turns } = await runChat({ repoPath: dir, input, output: out, env: { TMCT_NO_SEED: "1" } });
    assert.equal(turns, 2);
    // the banner is honest about the empty start — and never an error before the prompt
    assert.match(text(), /no code graph loaded — starting empty/); // #3: 0-module orientation
    assert.match(text(), /remembered to .*graph\.json/);
    // a structural query over the empty graph answers with the engine's honest miss, no stack
    assert.match(text(), /no symbol matching "a\.mjs" found in the index\./);
    assert.doesNotMatch(text(), /\n\s+at /);
    // the conversation itself became the first graph write: a Session individual exists
    const g = JSON.parse(await readFile(join(dir, ".tmct", "graph.json"), "utf8"));
    const sess = g.individuals.filter((i) => i.class === "Session");
    assert.equal(sess.length, 1, "the session was folded into a freshly created graph.json");
    assert.equal(sess[0].attributes.find((a) => a.key === "turns").value, "2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- binary smoke ----

test("cli chat: real binary, stdin closed after /exit → exit 0; graphless repo → clean empty start", async () => {
  const dir = await repoWithFixtureGraph();
  const bare = await mkdtemp(join(tmpdir(), "tmct-chat-bare-"));
  try {
    const ok = spawnSync(process.execPath, [BIN, "chat", "--repo", dir], {
      encoding: "utf8", input: "which modules import a.mjs\n/exit\n",
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /app\/lib\/b\.mjs/);
    const names = await readdir(join(dir, ".tmct"));
    assert.ok(names.some((n) => /^session-.*\.md$/.test(n)), "binary session wrote its log");

    // no graph → the bootstrap path: honest empty banner, greeting works, clean exit 0
    // (TMCT_NO_SEED: the W3 seeded-bootstrap path has its own suite — wiring-seed.test.mjs)
    const bad = spawnSync(process.execPath, [BIN, "chat", "--repo", bare], {
      encoding: "utf8", input: "hi\n/exit\n", env: { ...process.env, TMCT_NO_SEED: "1" },
    });
    assert.equal(bad.status, 0, bad.stderr);
    assert.match(bad.stdout, /no code graph loaded — starting empty/); // #3
    const bareGraph = JSON.parse(await readFile(join(bare, ".tmct", "graph.json"), "utf8"));
    assert.ok(bareGraph.individuals.some((i) => i.class === "Session"), "bootstrap session folded into a new graph.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
  }
});
