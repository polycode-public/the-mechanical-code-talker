// Conversational-UX improvements (the "clumsy first-run" fixes):
//   #1 short, tailored miss (the full grammar wall lives behind /help only)
//   #2 intent lanes — MEMORY/TEACH + META/SELF — routed on a would-miss, so real
//      graph queries are never hijacked (the coordinator's frozen-v1 guard cases)
//   #3 empty / degenerate-graph orientation (0 modules → --repo/tmct init)
//   #4 honest-empty polish (an empty code graph carries the exit)
//   #5 TMCT_GRAPH_FILE honored by the chat surface (--repo still wins)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn, createSession, shortMissHint, moduleCountOf } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const mem = () => mkdtemp(join(tmpdir(), "tmct-ux-"));

// ---- #1 SHORT, TAILORED MISS ----

test("#1 shortMissHint: keeps the honest opening, drops the wall, tailors to keywords", () => {
  const wall = /which <functions\|classes\|modules>/;
  const imp = shortMissHint("does the frobnicator import things");
  assert.match(imp, /^couldn't parse this as a graph question\. Try:/, "graded hm-joke opening preserved");
  assert.match(imp, /Type \/help for all query shapes\.$/);
  assert.doesNotMatch(imp, wall, "the full grammar cheat-sheet is gone");
  assert.match(imp, /import/, "an import-flavoured query gets an import example");
  assert.match(shortMissHint("who calls stuff around here"), /calls <name>/, "a call-flavoured query gets a call example");
  assert.match(shortMissHint("explain the class hierarchy"), /inherit from|subclasses/, "hierarchy → inherit example");
});

test("#1 a grammar miss over a POPULATED graph is short, not the wall", async () => {
  const { answer, record } = await runTurn("tell me a joke", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^couldn't parse this as a graph question\. Try:/);
  assert.doesNotMatch(answer, /which <functions\|classes\|modules>/);
  assert.doesNotMatch(answer, /compositional queries also work/, "the compositional wall is gone too");
  assert.equal(record.miss, true, "still an honest miss");
});

test("#1 receipt-bearing misses KEEP their specific wording (not shortened)", async () => {
  const g = await graph();
  // (cycle W2P: "what calls fnAlpha" is now a real hit — Widget.render via callsSymbol — so
  // the receipt-bearing MISS example uses a genuinely-uncalled symbol; nothing calls
  // Widget.render, so it stays the honest empty with its callsSymbol traversal receipt.)
  const empty = await runTurn("what calls Widget.render", { config: CONFIG, graph: g });
  assert.match(empty.answer, /No .* found whose module directly calls Widget\.render/);
  // (0.8.2 WS1: the receipt left the honest-empty prose — it must survive into the
  // turn's detail so the why-path re-render still surfaces it.)
  assert.match(empty.last.detail.traversal, /callsSymbol edges where object = Widget\.render/,
    "the traversal receipt survives into detail for why/verbose");
  const why = await runTurn("why", { config: CONFIG, graph: g, last: empty.last });
  assert.match(why.answer, /traversal: callsSymbol edges where object = Widget\.render/,
    "'why' re-renders the receipt the terse prose dropped");
  const unresolved = await runTurn("which modules import zebra.mjs", { config: CONFIG, graph: g });
  assert.match(unresolved.answer, /no symbol matching "zebra\.mjs" found in the index/);
});

// ---- #2 MEMORY/TEACH lane (the coordinator's verbatim failing inputs) ----

test("#2 teach: 'remember that redis is a cache' fails LOUD with the shape, never the wall / silent drop", async () => {
  const dir = await mem();
  try {
    for (const say of ["remember that redis is a cache", "note that redis is a cache"]) {
      const { answer, record } = await runTurn(say, { config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "t" });
      assert.match(answer, /every X is a Y/, "says what CAN be remembered");
      assert.match(answer, /Did you mean: "every redis is a cache"/, "offers the corrected shape");
      assert.doesNotMatch(answer, /couldn't parse this as a graph question/, "never the grammar wall");
      assert.doesNotMatch(answer, /no module matching/, "never the misleading 'no module' miss");
      assert.equal(record.miss, true, "an un-storable teach is honestly a miss");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 teach: a storable 'remember that every X is a Y' lands a Fact and confirms", async () => {
  const dir = await mem();
  try {
    const { answer, record } = await runTurn("remember that every module is a component", {
      config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "t",
    });
    assert.match(answer, /noted — remembered 1 fact: module rdfs:subClassOf component/);
    assert.equal(record.miss, false);
    const m = await loadMemory(dir);
    assert.ok(m.individuals.some((i) => i.class === FACT_CLASS), "the fact is durable in memory");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 teach: a BARE 'X is a Y' declarative the ACE grammar can't fully parse is routed to teaching, not the wall", async () => {
  const dir = await mem();
  try {
    // 'redis' is not in the ACE lexicon, so even 'every redis is a cache' is residue —
    // but the user still gets the teach hint, never the grammar wall or a silent drop.
    const { answer } = await runTurn("redis is a cache", { config: CONFIG, graph: await graph(), memoryDir: dir });
    assert.match(answer, /every X is a Y/);
    assert.doesNotMatch(answer, /couldn't parse this as a graph question/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- #2 META/SELF lane ----

test("#2 meta: bare 'what do you know' → a SHORT summary, never a raw fact dump", async () => {
  const dir = await mem();
  try {
    await runTurn("every class is a component", { config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "m" });
    const { answer, record } = await runTurn("what do you know", { config: CONFIG, graph: await graph(), memoryDir: dir });
    assert.match(answer, /I remember 1 fact across 1 relation type/);
    assert.match(answer, /\/memory to explore/);
    assert.doesNotMatch(answer, /kind of component/, "it summarises, it does NOT list the facts");
    assert.equal(record.via, "meta");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 meta: 'what do you remember' / 'what facts do you know' STILL list facts (pinned readers unbroken)", async () => {
  const dir = await mem();
  try {
    await runTurn("every class is a component", { config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "m" });
    for (const q of ["what do you remember", "what facts do you know"]) {
      const { answer, record } = await runTurn(q, { config: CONFIG, graph: await graph(), memoryDir: dir });
      assert.match(answer, /class is a kind of component/, `"${q}" still lists the fact`);
      assert.equal(record.via, "fact");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 meta: 'what is this codebase' / 'how do i start' orient off a /stats-style overview (populated graph)", async () => {
  const g = await graph();
  for (const q of ["what is this codebase", "how do i start", "how do i load my code"]) {
    const { answer, record } = await runTurn(q, { config: CONFIG, graph: g });
    assert.match(answer, /tmct code graph — \d+ entities/, `"${q}" gives an overview`);
    assert.doesNotMatch(answer, /couldn't parse this as a graph question/);
    assert.equal(record.via, "meta");
  }
});

// ---- #2 GUARD: the meta/teach lanes must LOSE to graph-query routing ----

test("#2 guard: frozen-v1 graph queries are NOT hijacked by the meta/teach lanes", async () => {
  const g = await graph();
  // a real graph query that happens to start with "what does X …"
  const imp = await runTurn("what does app/lib/e.mjs import", { config: CONFIG, graph: g });
  assert.match(imp.answer, /app\/lib\/a\.mjs/, "stays a graph query");
  assert.equal(imp.record.miss, false);
  // the schema-meta "what does imports mean" keeps its own (both-readings) answer
  const mean = await runTurn("what does imports mean", { config: CONFIG, graph: g });
  assert.doesNotMatch(mean.answer, /couldn't parse this as a graph question/);
  assert.equal(mean.record.miss, false, "a resolved predicate is not a would-miss");
  // "what did i ask before" is memory RECALL, not the meta summary or a teach write
  const dir = await mem();
  try {
    const recall = await runTurn("what did i ask before", { config: CONFIG, graph: g, memoryDir: dir });
    assert.doesNotMatch(recall.answer, /I remember \d+ fact/, "not hijacked into the meta summary");
    assert.match(recall.answer, /recall/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 guard: ordinary graph queries with import/call keywords stay graph queries", async () => {
  const g = await graph();
  const a = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  assert.match(a.answer, /app\/lib\/b\.mjs/);
  assert.equal(a.record.miss, false);
});

// ---- membership-grammar brittleness → a tailored article hint, not the wall ----

test("membership: 'is a algorithm information' hints the missing article, not the wall", async () => {
  const { answer } = await runTurn("is a algorithm information", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^couldn't parse this as a graph question\. Try:/);
  assert.match(answer, /article before the kind/);
  assert.doesNotMatch(answer, /which <functions\|classes\|modules>/);
});

// ---- #3 EMPTY / DEGENERATE-GRAPH ORIENTATION + #4 HONEST-EMPTY POLISH ----

test("#3 an empty-graph session orients: banner + greeting point at --repo/tmct init, not 'ask me about this codebase'", async () => {
  clearCache();
  const dir = await mkdtemp(join(tmpdir(), "tmct-ux-empty-"));
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.moduleCount, 0);
    const banner = s.bannerLines.join("\n");
    assert.match(banner, /no code graph loaded — starting empty/);
    assert.match(banner, /tmct init|--repo/);
    assert.match(banner, /what is a cache/, "points at the seeded vocabulary");
    const hi = await s.turn("hi");
    assert.match(hi.answer, /no code graph loaded here/);
    assert.doesNotMatch(hi.answer, /Ask me about this codebase/, "no over-promising greeting");
    await s.close();
  } finally { clearCache(); await rm(dir, { recursive: true, force: true }); }
});

test("#3/#4 a structural query over an empty code graph carries the exit toward a real graph", async () => {
  clearCache();
  const dir = await mkdtemp(join(tmpdir(), "tmct-ux-empty2-"));
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    const r = await s.turn("which classes are there");
    assert.match(r.answer, /--repo <path>|tmct init/, "the honest empty carries the exit");
    await s.close();
  } finally { clearCache(); await rm(dir, { recursive: true, force: true }); }
});

test("#4 a POPULATED graph's honest empty does NOT get the empty-graph exit", async () => {
  const g = await graph();
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: g });
  assert.doesNotMatch(r.answer, /no code graph|tmct init/, "a populated graph never claims to be empty");
});

// ---- #5 TMCT_GRAPH_FILE honored by the chat surface; --repo precedence ----

test("#5 createSession honors TMCT_GRAPH_FILE (chat used to ignore it), memory stays the repo", async () => {
  clearCache();
  const alt = await mkdtemp(join(tmpdir(), "tmct-ux-alt-"));
  const graphPath = join(alt, "custom-graph.json");
  await writeFile(graphPath, await readFile(FIXTURE, "utf8"));
  const cwd = await mkdtemp(join(tmpdir(), "tmct-ux-cwd-"));
  try {
    const s = await createSession({ env: { TMCT_GRAPH_FILE: graphPath, TMCT_NO_SEED: "1" }, cwd, gitRoot: () => null });
    assert.equal(s.config.graphFile, graphPath, "the env graph is loaded");
    assert.equal(s.moduleCount, 8, "and it really loaded (8 fixture modules)");
    assert.equal(s.repo, cwd, "logs/memory still target the repo (cwd), not the graph's dir");
    await s.close();
  } finally { clearCache(); await rm(alt, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true }); }
});

test("#5 --repo takes precedence over TMCT_GRAPH_FILE", async () => {
  clearCache();
  const repo = await mkdtemp(join(tmpdir(), "tmct-ux-repo-"));
  await mkdir(join(repo, ".tmct"), { recursive: true });
  await writeFile(join(repo, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  try {
    const s = await createSession({ repoPath: repo, env: { TMCT_GRAPH_FILE: "/somewhere/else/graph.json", TMCT_NO_SEED: "1" } });
    assert.equal(s.config.graphFile, join(repo, ".tmct", "graph.json"), "--repo wins over the env var");
    await s.close();
  } finally { clearCache(); await rm(repo, { recursive: true, force: true }); }
});

// ---- a small sanity check on the helper ----

test("moduleCountOf: null/empty → 0, populated fixture → 8", async () => {
  assert.equal(moduleCountOf(null), 0);
  assert.equal(moduleCountOf({ individuals: [] }), 0);
  assert.equal(moduleCountOf(await graph()), 8);
});

// ---- 0.8.2 WS4: wall kindness (repeat suppression, live orientation examples,
//      stranger openers) + capability nudges (risk/opinion/imperative/why) ----

test("WS4(a) wall repeat suppression: 2nd consecutive wall is a one-liner, 3rd re-offers the hint", async () => {
  const g = await graph();
  const focus = g.individuals.find((i) => i.class === "Module");
  const walls = ["frobnicate zibble.mjs wozzit deeply", "blorp quux.mjs zibble again", "wozzit flurble.mjs blorp thing"];
  let last = null;
  const answers = [];
  for (const q of walls) {
    const r = await runTurn(q, { config: CONFIG, graph: g, focus, last });
    assert.equal(r.record.miss, true, `"${q}" is still recorded as a miss`);
    answers.push(r.answer);
    last = r.last ?? last;
  }
  assert.match(answers[0], /^couldn't parse this as a graph question\. Try:/, "1st miss: the tailored hint");
  assert.equal(answers[1], "still couldn't parse that — /help lists every query shape.", "2nd miss: the one-liner");
  assert.doesNotMatch(answers[1], /^couldn't parse this as a graph question\. Try:/, "the one-liner never matches WALL_MISS_RE");
  assert.match(answers[2], /^couldn't parse this as a graph question\. Try:/, "3rd miss: the tailored hint re-offered (self-limiting)");
});

test("WS4(b) orientation examples are LIVE from the loaded graph — and both answer", async () => {
  const g = await graph();
  const r = await runTurn("what can you do", { config: CONFIG, graph: g });
  assert.match(r.answer, /which modules import app\/lib\/a\.mjs/, "example1 = the fixture's sorted-first imported module");
  assert.match(r.answer, /what calls fnAlpha/, "example2 = the fixture's sorted-first called function");
  // a stranger typing the examples verbatim must get answers, not misses
  const ex1 = await runTurn("which modules import app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.equal(ex1.record.miss, false, "example1 answers");
  const ex2 = await runTurn("what calls fnAlpha", { config: CONFIG, graph: g });
  assert.equal(ex2.record.miss, false, "example2 answers");
});

test("WS4(b) orientation examples degrade: empty graph → empty orientation, null graph → generic pair", async () => {
  const empty = await runTurn("what can you do", { config: CONFIG, graph: { individuals: [], relations: [], byId: new Map() } });
  assert.match(empty.answer, /no code graph loaded/i, "an empty graph keeps the empty orientation");
  const nul = await runTurn("what can you do", { config: CONFIG, graph: null });
  assert.match(nul.answer, /which modules import walk\.mjs/, "a null (unknown) graph keeps the generic example1");
  assert.match(nul.answer, /what calls buildContextBundle/, "…and the generic example2");
});

test("WS4(c) META_ORIENT_RE: the stranger openers get the live overview, not the wall", async () => {
  const g = await graph();
  for (const q of ["what does this app do", "what does the codebase do?", "what does this project do",
    "what is this app", "what is the app for", "what's this app"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.equal(r.record.via, "meta", `"${q}" routes to the meta/self lane`);
    assert.equal(r.record.miss, false, `"${q}" is not a miss`);
    assert.match(r.answer, /This is a tmct code graph — \d+ entities/, `"${q}" gets the live overview`);
  }
});

test("WS4(d) riskiest nudge: honest proxies (impact + churn), recorded as a miss", async () => {
  const g = await graph();
  const r = await runTurn("what is the riskiest module", { config: CONFIG, graph: g });
  assert.equal(r.record.miss, true, "a capability wall stays a recorded miss");
  assert.match(r.answer, /don't score risk/);
  assert.match(r.answer, /\/impact /, "points at the impact proxy");
  assert.match(r.answer, /who touched /, "points at the churn proxy");
});

test("WS4(e) opinion honesty: 'is the code good' gets the personality line, never the membership hint", async () => {
  const g = await graph();
  for (const q of ["is the code good", "is this code messy?", "is this codebase well written"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.equal(r.record.miss, true, `"${q}" stays a recorded miss`);
    assert.match(r.answer, /don't hold opinions/, `"${q}" gets the honest personality line`);
    assert.doesNotMatch(r.answer, /is a <thing> a <kind>/, `"${q}" never gets the membership-shape hint`);
  }
});

test("WS4(8) imperative nudge: write/make/fix asks → the read-only wall; 'it' resolves to the focus", async () => {
  const g = await graph();
  const r = await runTurn("can you write a test for fnAlpha", { config: CONFIG, graph: g });
  assert.equal(r.record.miss, true, "recordMiss stays TRUE — capability walls never become recallable answers");
  assert.match(r.answer, /I don't write code — I read a graph of it/);
  assert.match(r.answer, /untested modules/);
  // "fix it" with a standing focus names the focus
  const focus = g.individuals.find((i) => i.label === "fnAlpha");
  const fix = await runTurn("please fix it and add a test", { config: CONFIG, graph: g, focus });
  assert.equal(fix.record.miss, true);
  assert.match(fix.answer, /\/tests fnAlpha/, "the pronoun resolves to the current focus name");
});

test("WS4(8) why-untested nudge: motive questions get the records-what-IS wall", async () => {
  const g = await graph();
  for (const q of ["why is fnAlpha untested", "why are the handlers not tested", "why isn't Widget.render uncovered"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.equal(r.record.miss, true, `"${q}" stays a recorded miss`);
    assert.match(r.answer, /can't know why — the graph records what IS/, `"${q}" gets the honest wall`);
    assert.match(r.answer, /untested modules/, `"${q}" points at the coverage facts`);
  }
});

test("WS4(8) guard: 'tell me a joke' keeps its ordinary honest miss (no imperative hijack)", async () => {
  const g = await graph();
  const r = await runTurn("tell me a joke", { config: CONFIG, graph: g });
  assert.doesNotMatch(r.answer, /I don't write code/, "'tell' is not an imperative-nudge verb");
  assert.match(r.answer, /^couldn't parse this as a graph question\. Try:/, "the graded hm-joke wording stands");
});
