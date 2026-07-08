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
    // The fix (this WAS the "lying example" bug): TMCT_NO_SEED=1 means vocabulary
    // was never actually seeded, so the banner must NOT claim "what is a cache"
    // works — that's a promise this exact session can't keep. It points at
    // `tmct init` (the way to actually get it) instead.
    assert.doesNotMatch(banner, /what is a cache/, "never offers an example that wasn't actually seeded");
    assert.match(banner, /tmct init.*seed|seed.*starter vocabulary/i, "points at how to actually get the vocabulary");
    const hi = await s.turn("hi");
    // The fix (was: leads with an apology — "no code graph loaded here" — even
    // though the seeded vocabulary already answers general questions). Now leads
    // with identity + a working capability; the ONE invariant worth keeping is
    // never claiming structure-query readiness with no graph loaded.
    assert.match(hi.answer, /I'm tmct/, "leads with identity, not an apology");
    assert.match(hi.answer, /what is a cache|tmct init/, "leads with a working capability");
    assert.doesNotMatch(hi.answer, /Ask me about this codebase/, "no over-promising greeting");
    await s.close();
  } finally { clearCache(); await rm(dir, { recursive: true, force: true }); }
});

test("vocab-hint is never a lie: an unseeded session never offers a term-specific example, a seeded session's offered term actually resolves", async () => {
  clearCache();
  // UNSEEDED (TMCT_NO_SEED=1): none of the 5 "try this" surfaces may claim "what
  // is a cache" — the corpus was never seeded, so that example would fail if
  // followed. This is the exact bug found in research: every surface used to be
  // gated only on "no code graph", never on whether seeding actually happened.
  const dirA = await mkdtemp(join(tmpdir(), "tmct-ux-hintlie-"));
  try {
    const s = await createSession({ repoPath: dirA, env: { TMCT_NO_SEED: "1" } });
    assert.doesNotMatch(s.bannerLines.join("\n"), /what is a cache/, "banner");
    const hi = await s.turn("hi");
    assert.doesNotMatch(hi.answer, /what is a cache/, "greeting");
    const cap = await s.turn("what can you do");
    assert.doesNotMatch(cap.answer, /what is a cache/, "capability orientation");
    const meta = await s.turn("what is this");
    assert.doesNotMatch(meta.answer, /what is a cache/, "meta/self lane (orientationText)");
    const know = await s.turn("what do you know");
    assert.doesNotMatch(know.answer, /what is a cache/, "memory summary");
    // The unseeded state must still be ACTIONABLE (not just an absence) — every
    // surface above should point at how to actually get vocabulary.
    for (const [label, r] of [["greeting", hi], ["capability", cap]]) {
      assert.match(r.answer, /tmct init/, `${label} points at how to actually seed vocabulary`);
    }
    await s.close();
  } finally { clearCache(); await rm(dirA, { recursive: true, force: true }); }

  // SEEDED (default): the offered term must actually resolve when asked.
  const dirB = await mkdtemp(join(tmpdir(), "tmct-ux-hinttrue-"));
  try {
    const s = await createSession({ repoPath: dirB });
    assert.match(s.bannerLines.join("\n"), /what is a cache/, "a seeded session's banner offers the term");
    const cache = await s.turn("what is a cache");
    assert.doesNotMatch(cache.answer, /couldn't parse|isn't a term in this graph/i, "the offered example actually resolves, end to end");
    await s.close();
  } finally { clearCache(); await rm(dirB, { recursive: true, force: true }); }
});

test("broadened conversational coverage: dialect/formal/slang/typo/identity/AI openers all get a real answer, never the raw grammar wall", async () => {
  const g = await graph();
  const WALL = /couldn't parse this as a graph question/;
  const samples = [
    // dialect/formal/slang (closed-set expansion, A1)
    "you alright", "gday", "good day", "salutations", "wassup",
    // elongation collapse (A3) + fuzzy typo tolerance (A4)
    "heyyyy", "helo", "thnx", "byee", "sallutations",
    // unix-habit openers inside the REPL (A2/CAPABILITY_PHRASES)
    "whoami", "--help", "-h", "man",
    // identity, distinct from capability (A2/IDENTITY_PHRASES)
    "who are you", "what are you", "whats your name", "tell me about yourself",
    // the AI/LLM sub-family (A2/AI_IDENTITY_PHRASES) — a real, on-brand answer
    "are you an AI", "are you chatgpt", "is this claude", "do you use ai",
    // confused/new-user openers (ORIENT_OPENERS)
    "huh", "confused", "just installed this",
  ];
  for (const q of samples) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.doesNotMatch(r.answer, WALL, `"${q}" doesn't hit the raw grammar wall`);
  }
  // The AI/LLM sub-family gets its OWN honest answer, not the generic identity blurb.
  const ai = await runTurn("are you an AI", { config: CONFIG, graph: g });
  assert.match(ai.answer, /no LLM/i, "the AI/LLM question gets tmct's actual positioning");
  const who = await runTurn("who are you", { config: CONFIG, graph: g });
  assert.doesNotMatch(who.answer, /no LLM involved/i, "identity and the AI/LLM clarification stay distinct answers");
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
  // The fix: an empty graph's orientation leads with identity + a working
  // capability, not an apology — the --repo pointer is still present, just not
  // the opening line. See #3 in chat-ux.test.mjs for the greeting's sibling case.
  assert.match(empty.answer, /I'm tmct/i, "an empty graph keeps the empty orientation (identity-led)");
  assert.match(empty.answer, /--repo <path>/, "…and still carries the --repo exit");
  const nul = await runTurn("what can you do", { config: CONFIG, graph: null });
  assert.match(nul.answer, /which modules import walk\.mjs/, "a null (unknown) graph keeps the generic example1");
  assert.match(nul.answer, /what calls buildContextBundle/, "…and the generic example2");
});

test("WS4(b) Bug B1 (0.8.2 follow-up): a 2nd identical orientation turn is a one-liner, 3rd re-offers the blurb", async () => {
  // "so then" is short + non-code-ish (isConversational's fallback heuristic) but
  // NOT a GREETING/THANKS/BYE/WHY/HELP_PHRASES literal, so — unlike "what can you
  // do" — it is NOT intercepted by conversationalTurn() at the top of runTurn
  // (which never threads `last` through: "a conversational turn never overwrites
  // the last real answer"). It falls through to runAsk's isConversational branch,
  // the one this fix targets.
  const g = await graph();
  let last = null;
  const answers = [];
  for (let i = 0; i < 3; i++) {
    const r = await runTurn("so then", { config: CONFIG, graph: g, last });
    assert.equal(r.record.via, "template", "orientation always carries via:'template'");
    answers.push(r.answer);
    last = r.last ?? last;
  }
  assert.match(answers[0], /which modules import app\/lib\/a\.mjs/, "1st turn: the full orientation blurb");
  assert.equal(answers[1], "still the same overview — /help lists every command and query shape.",
    "2nd identical turn: the repeat one-liner");
  assert.notEqual(answers[2], answers[1], "3rd turn: the one-liner self-limits");
  assert.match(answers[2], /which modules import app\/lib\/a\.mjs/, "3rd turn: the full blurb re-offered");
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

test("chat-feel residual (0.8.2 confirmation playtest, follow-up #3): META_ORIENT_RE's own repeat also shortens (not just isConversational's)", async () => {
  // Bug B1 only taught the isConversational-triggered orientation branch (the "so
  // then" test above) to shorten on repeat — metaLane's META_ORIENT_RE branch is a
  // SEPARATE route to the same class of full-blurb text ("what does this app do"),
  // and used to reprint it verbatim on every repeat with no suppression at all.
  const g = await graph();
  let last = null;
  const answers = [];
  for (let i = 0; i < 3; i++) {
    const r = await runTurn("what does this app do", { config: CONFIG, graph: g, last });
    assert.equal(r.record.via, "meta", "still routes to the meta/self lane");
    answers.push(r.answer);
    last = r.last ?? last;
  }
  assert.match(answers[0], /This is a tmct code graph — \d+ entities/, "1st turn: the full overview");
  assert.equal(answers[1], "still the same overview — /stats for the full one, /help for commands.",
    "2nd identical turn: the repeat one-liner");
  assert.notEqual(answers[1], "still the same overview — /help lists every command and query shape.",
    "uses its OWN oneliner text, distinct from isConversational's ORIENTATION_REPEAT_ONELINER");
  assert.notEqual(answers[2], answers[1], "3rd turn: the one-liner self-limits");
  assert.match(answers[2], /This is a tmct code graph — \d+ entities/, "3rd turn: the full overview re-offered");
});

test("Bug E (0.8.2 follow-up) MODULE_ORIENT_RE: 'what does <module> do' gets a friendly overview, not the wall", async () => {
  const g = await graph();
  // app/functions/d/handler.mjs (mod-d) is populated across imports/reexports/tests
  // in the fixture — imports app/lib/b.mjs + app/lib/c.mjs, re-exports fnAlpha, and
  // is covered by app/unit-tests/b.test.mjs.
  const r = await runTurn("what does app/functions/d/handler.mjs do", { config: CONFIG, graph: g });
  assert.equal(r.record.via, "meta", "routes to the meta/self lane, not composed/miss");
  assert.equal(r.record.miss, false);
  assert.match(r.answer, /^app\/functions\/d\/handler\.mjs is a module —/);
  assert.match(r.answer, /imports 2 \(app\/lib\/b\.mjs, app\/lib\/c\.mjs\)/);
  assert.match(r.answer, /exports 1 \(fnAlpha\)/);
  assert.match(r.answer, /covered by 1 test module/);
  assert.match(r.answer, /\/describe app\/functions\/d\/handler\.mjs for the full breakdown\./);

  // app/lib/b.mjs (mod-b) is populated across defines/imports/tests but has NO
  // reexports — that line must simply be absent, not render as "exports 0".
  const b = await runTurn("what does app/lib/b.mjs do", { config: CONFIG, graph: g });
  assert.equal(b.record.via, "meta");
  assert.match(b.answer, /defines 2 \(Widget, register\)/);
  assert.match(b.answer, /imports 1 \(app\/lib\/a\.mjs\)/);
  assert.match(b.answer, /covered by 1 test module/);
  assert.doesNotMatch(b.answer, /exports \d/);
});

test("Bug E MODULE_ORIENT_RE: a module with no defines/imports/reexports/tests gets an honest 'no recorded tests' line", async () => {
  const g = await graph();
  // scripts/g.mjs has only a "calls" edge in the fixture — none of
  // defines/imports/reexports/tests, the four kinds this overview reads.
  const r = await runTurn("what does scripts/g.mjs do", { config: CONFIG, graph: g });
  assert.equal(r.record.via, "meta");
  assert.match(r.answer, /^scripts\/g\.mjs is a module — no recorded tests\./);
});

test("Bug E MODULE_ORIENT_RE: an unresolvable subject falls through (honest miss, never a guess)", async () => {
  const g = await graph();
  const r = await runTurn("what does zzz-nonexistent-symbol do", { config: CONFIG, graph: g });
  assert.equal(r.record.miss, true);
  assert.notEqual(r.record.via, "meta");
});

test("Bug E MODULE_ORIENT_RE: a pronoun subject is left to isConversational/META_ORIENT_RE, not guessed at", async () => {
  const g = await graph();
  const focus = g.individuals.find((i) => i.id === "mod-d");
  const r = await runTurn("what does it do", { config: CONFIG, graph: g, focus });
  assert.notEqual(r.answer.split(" ")[0], "app/functions/d/handler.mjs",
    "moduleOrientLane must decline a pronoun subject, not silently resolve it via focus");
});

test("ADVANCED_GRAMMAR track (a): a counterfactual deletion query gets a hypothetical marker on its real answer", async () => {
  const g = await graph();
  const r = await runTurn("if app/lib/a.mjs were deleted, what would break", { config: CONFIG, graph: g });
  assert.equal(r.record.via, "composed");
  assert.equal(r.record.miss, false);
  assert.match(r.answer, /^hypothetically, if app\/lib\/a\.mjs were removed: /);
  // the traversal itself is the SAME real reverse-dependency closure a direct
  // "transitively import" question answers — only the marker is added.
  const direct = await runTurn("which modules transitively import app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.equal(r.answer, `hypothetically, if app/lib/a.mjs were removed: ${direct.answer}`);
});

test("ADVANCED_GRAMMAR track (a): a subordination-wrapped question answers identically to its bare form", async () => {
  const g = await graph();
  const wrapped = await runTurn("since we're refactoring, which modules import app/lib/a.mjs", { config: CONFIG, graph: g });
  const bare = await runTurn("which modules import app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.equal(wrapped.answer, bare.answer);
  assert.equal(wrapped.record.miss, false);
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

// ---- ADVANCED_GRAMMAR track (f) (PLAN_ADVANCED_GRAMMAR.md §2f): the
// presupposition honest-nudge — "why does X still/again import Y" names the
// presupposition being checked (against the graph, confidently — and, for an
// embedded "the DEPRECATED Y" adjective claim, against memory), then answers
// what survives. Fires only where the base grammar's own "why does X import
// Y" answer is a MISS (the relation does NOT hold) — a real "Yes" answer is
// never shadowed, see presuppositionNudge's own docblock. ----

test("presupposition (f): a REFUTED relation presupposition is named, honestly, with a confident 'no'", async () => {
  const g = await graph();
  // app/lib/f.mjs does NOT import app/lib/a.mjs in the fixture.
  const r = await runTurn("why does app/lib/f.mjs still import app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.equal(r.record.via, "presupposition");
  assert.equal(r.record.miss, false, "a confident graph-checked 'no' is an answer, not a miss");
  assert.match(r.answer, /^checking the presupposition first: app\/lib\/f\.mjs doesn't import app\/lib\/a\.mjs \(no\)/);
  assert.match(r.answer, /the premise doesn't hold/);
});

test("presupposition (f): an embedded 'the <adjective> <term>' claim is checked against memory and cited", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    await runTurn("remember that app/lib/a.mjs is deprecated", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "presup" });
    const r = await runTurn(
      "why does app/lib/f.mjs still import the deprecated app/lib/a.mjs",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.equal(r.record.via, "presupposition");
    assert.match(r.answer, /app\/lib\/a\.mjs deprecated — yes \(source: ace:chat:presup@/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("presupposition (f): an embedded adjective with NO matching fact is honestly 'no fact saying so', never assumed", async () => {
  const g = await graph();
  const r = await runTurn("why does app/lib/f.mjs still import the fancy app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.equal(r.record.via, "presupposition");
  assert.match(r.answer, /app\/lib\/a\.mjs fancy — I have no fact saying so/);
});

test("presupposition (f) guard: a HELD relation presupposition keeps the engine's own real 'Yes' answer, never shadowed", async () => {
  const g = await graph();
  // app/lib/b.mjs DOES import app/lib/a.mjs — the base grammar already
  // answers this for real (miss:false); the presupposition lane must not fire.
  const r = await runTurn("why does app/lib/b.mjs still import app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.notEqual(r.record.via, "presupposition");
  assert.match(r.answer, /^Yes — imports edge from app\/lib\/b\.mjs to app\/lib\/a\.mjs\./);
});

// ---- describe-wrapper rescue (playtest sprint round 2, SKILL_PLAYTEST_SPRINT.md):
// a describe-intent question wrapped in an ordinary polite request ("can you
// describe X for me", "can you tell me more about X") is rescued as a LAST-RESORT
// lane, tried only after every earlier lane (concept/relation force, teach, author,
// presupposition, capability nudges) has declined — so it must never shadow the
// relation force's own "tell me about <concept>" trigger for an enumerable concept
// like inheritance. ----

test("describe-wrapper rescue: a polite wrapper around a real symbol name resolves via tmct_describe instead of the generic wall", async () => {
  const g = await graph();
  const r1 = await runTurn("can you describe Widget for me", { config: CONFIG, graph: g });
  assert.equal(r1.record.via, "describe");
  assert.equal(r1.record.miss, false);
  assert.match(r1.answer, /^Widget — Class/);

  const r2 = await runTurn("can you tell me more about Widget", { config: CONFIG, graph: g });
  assert.equal(r2.record.via, "describe");
  assert.match(r2.answer, /^Widget — Class/);
});

test("describe-wrapper rescue: a trailing 'please' (not just a leading one) still resolves (playtest sprint round 3)", async () => {
  const g = await graph();
  const r = await runTurn("could you tell me more about Widget please", { config: CONFIG, graph: g });
  assert.equal(r.record.via, "describe");
  assert.equal(r.record.miss, false);
  assert.match(r.answer, /^Widget — Class/);
});

test("describe-wrapper rescue guard: an unresolvable wrapped term declines silently — the ordinary wall stands, unchanged wording", async () => {
  const g = await graph();
  const r = await runTurn("can you tell me more about NotARealSymbol", { config: CONFIG, graph: g });
  assert.notEqual(r.record.via, "describe");
  assert.equal(r.record.miss, true);
});

test("describe-wrapper rescue guard: 'tell me about <enumerable concept>' still reaches the relation force, never the describe rescue", async () => {
  const g = await graph();
  const r = await runTurn("tell me about inheritance", { config: CONFIG, graph: g });
  assert.notEqual(r.record.via, "describe");
  assert.equal(r.record.miss, false);
  assert.match(r.answer, /class deriving its structure and behaviour from another/);
});

test("presupposition (f) guard: an unresolvable subject/object declines (falls through), never guesses", async () => {
  const g = await graph();
  const r = await runTurn("why does zzz-nonexistent still import app/lib/a.mjs", { config: CONFIG, graph: g });
  assert.notEqual(r.record.via, "presupposition");
});
