// The one surface every demo page publishes: open a session, take a turn, ask
// a question, plan a request, and reach the page's own helpers under `page`.
// Every case here installs onto a plain object rather than the real global, so
// the tests never fight each other over `globalThis`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { publishTmctSurface } from "../../src/surfaces/web/tmct-surface.mjs";

const target = () => ({});

test("publishing installs the surface on the target and hands the same object back", () => {
  const host = target();
  const surface = publishTmctSurface({ open: () => ({}), target: host });
  assert.equal(host.tmct, surface);
  assert.deepEqual(
    Object.keys(surface).sort(),
    ["ask", "fallback", "open", "page", "plan", "session", "turn"],
  );
});

test("a page with no session factory is a wiring error, said plainly", () => {
  assert.throws(() => publishTmctSurface({ target: target() }), /`open` must be this page's session factory/);
});

test("open passes every argument through, so a factory keeps the signature it already has", async () => {
  const seen = [];
  const host = target();
  publishTmctSurface({
    open: (...args) => { seen.push(args); return { name: args[0] }; },
    target: host,
  });
  const session = await host.tmct.open("ashcombe-hall", { characters: ["mole-1"] });
  assert.deepEqual(seen, [["ashcombe-hall", { characters: ["mole-1"] }]]);
  assert.equal(session.name, "ashcombe-hall");
  assert.equal(host.tmct.session, session, "the live session is readable straight off the surface");
});

test("session is null until a page opens one, and every verb says so rather than failing obscurely", async () => {
  const host = target();
  publishTmctSurface({ open: () => ({}), ask: async () => ({}), plan: async () => ({}), target: host });
  assert.equal(host.tmct.session, null);
  await assert.rejects(() => host.tmct.turn("hello"), /no session is open on this page yet/);
  await assert.rejects(() => host.tmct.ask("what is a dog"), /no session is open on this page yet/);
  await assert.rejects(() => host.tmct.plan("assess the graph"), /no session is open on this page yet/);
});

test("reopening replaces the live session, so a page reset points at the new one", async () => {
  const host = target();
  let n = 0;
  publishTmctSurface({ open: () => ({ n: (n += 1) }), target: host });
  await host.tmct.open();
  const second = await host.tmct.open();
  assert.equal(second.n, 2);
  assert.equal(host.tmct.session.n, 2);
});

test("turn defaults to the session's own turn, options and all", async () => {
  const host = target();
  const calls = [];
  publishTmctSurface({
    open: () => ({ turn: (line, options) => { calls.push([line, options]); return { answer: "ok" }; } }),
    target: host,
  });
  await host.tmct.open();
  const result = await host.tmct.turn("solve it", { maxDepth: 12 });
  assert.deepEqual(calls, [["solve it", { maxDepth: 12 }]]);
  assert.equal(result.answer, "ok");
});

test("a page that supplies its own turn routes the line itself — several characters over one world", async () => {
  const host = target();
  publishTmctSurface({
    open: () => ({ windows: { "mole-1": { turn: (line) => ({ answer: `mole-1 heard "${line}"` }) } } }),
    turn: (line, options, session) => session.windows[options.as].turn(line),
    target: host,
  });
  await host.tmct.open();
  const result = await host.tmct.turn("dig north", { as: "mole-1" });
  assert.equal(result.answer, 'mole-1 heard "dig north"');
});

test("a session that holds no conversation says so instead of failing on a method it never had", async () => {
  const host = target();
  publishTmctSurface({ open: () => ({ ingest: () => ({}) }), target: host });
  await host.tmct.open();
  const result = await host.tmct.turn("a dog is an animal");
  assert.match(result.answer, /no conversational turn/);
  assert.equal(result.end, false);
  assert.equal(result.record, null);
});

test("an unwired ask refuses and names the route the page does have", async () => {
  const host = target();
  publishTmctSurface({ open: () => ({}), target: host });
  await host.tmct.open();
  const result = await host.tmct.ask("what relates to the logger");
  assert.equal(result.miss, true);
  assert.match(result.answer, /answers questions through tmct\.turn/);
});

test("an unwired plan refuses and names what it hasn't got", async () => {
  const host = target();
  publishTmctSurface({ open: () => ({}), target: host });
  await host.tmct.open();
  const result = await host.tmct.plan("of the modules impacted by X, which are untested");
  assert.equal(result.refused, true);
  assert.match(result.why, /no capability planner/);
  assert.deepEqual(result.calls, []);
});

test("ask and plan both take (request, options) and receive the live session", async () => {
  const host = target();
  const seen = {};
  publishTmctSurface({
    open: () => ({ id: "live" }),
    ask: (request, options, session) => { seen.ask = [request, options, session.id]; return { answer: "a" }; },
    plan: (request, options, session) => { seen.plan = [request, options, session.id]; return { refused: false }; },
    target: host,
  });
  await host.tmct.open();
  await host.tmct.ask("what is a dog", { sources: ["taught"] });
  await host.tmct.plan("assess", { depth: 2 });
  assert.deepEqual(seen.ask, ["what is a dog", { sources: ["taught"] }, "live"]);
  assert.deepEqual(seen.plan, ["assess", { depth: 2 }, "live"]);
});

test("the page bag rides through untouched, and defaults to empty", async () => {
  const host = target();
  const cellId = () => "c1";
  publishTmctSurface({ open: () => ({}), page: { cellId }, target: host });
  assert.equal(host.tmct.page.cellId, cellId);
  const bare = target();
  publishTmctSurface({ open: () => ({}), target: bare });
  assert.deepEqual(bare.tmct.page, {});
});

test("a fallback surface stands aside for a full engine, whichever of the two loads first", () => {
  // The full engine arrives second.
  const first = target();
  publishTmctSurface({ open: () => ({}), page: { kind: "standin" }, fallback: true, target: first });
  assert.equal(first.tmct.fallback, true);
  publishTmctSurface({ open: () => ({}), page: { kind: "live" }, target: first });
  assert.equal(first.tmct.fallback, false);
  assert.equal(first.tmct.page.kind, "live");

  // The full engine arrives first.
  const second = target();
  publishTmctSurface({ open: () => ({}), page: { kind: "live" }, target: second });
  const yielded = publishTmctSurface({ open: () => ({}), page: { kind: "standin" }, fallback: true, target: second });
  assert.equal(second.tmct.page.kind, "live", "the stand-in never displaces the engine that can teach");
  assert.equal(yielded, second.tmct, "and it hands back the standing surface rather than a dead one");
});

test("one fallback replaces another, so a stand-in is never stuck behind an older stand-in", () => {
  const host = target();
  publishTmctSurface({ open: () => ({}), page: { kind: "first" }, fallback: true, target: host });
  publishTmctSurface({ open: () => ({}), page: { kind: "second" }, fallback: true, target: host });
  assert.equal(host.tmct.page.kind, "second");
});
