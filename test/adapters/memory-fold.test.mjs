// memory/fold.mjs tests — session-log cleaning → corpus folding: the pure
// cleaner (drop slash-commands, filler, misses; keep real Q/A, normalized),
// the transcript answer parser it leans on, and the idempotent fold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionLog, turnKey } from "../../src/services/sessions.mjs";
import { cleanSessionText } from "../../src/domain/memory/fold.mjs";
import { foldSessionLogs } from "../../src/services/fold.mjs";
import { BLOCKS_DIR_REL, loadBlockIndex, retrieveBlocks } from "../../src/adapters/memory/blocks.mjs";
import { appendFact, appendUtterances, loadMemory, openMemoryBackend, readFactRows, CANONICALISED_FROM_PROP } from "../../src/adapters/memory/core.mjs";

const SID = "01890000-0000-7000-8000-00000000f01d";
const T = (n) => `2026-07-03T10:0${n}:00.000Z`;

// A mixed session: greeting (flagged conversational), a real hit, a slash
// command + output, an unflagged "thanks!!", a miss, a second real hit, bye.
const TURNS = [
  { type: "turn", ts: T(1), query: "hi", conversational: true, resolvedIds: [], answeredIds: [], miss: false },
  { type: "turn", ts: T(2), query: "which  modules import   config.mjs?", resolvedIds: ["mod:config.mjs"], answeredIds: ["mod:app/lib/b.mjs"], miss: false },
  { type: "turn", ts: T(3), query: "/stats", command: "stats", resolvedIds: [], answeredIds: [], miss: false },
  { type: "turn", ts: T(4), query: "thanks!!", resolvedIds: [], answeredIds: [], miss: false },
  { type: "turn", ts: T(5), query: "tell me about zorbulon", resolvedIds: [], answeredIds: [], miss: true },
  { type: "turn", ts: T(6), query: "who calls helper?", resolvedIds: ["fn:app/y.mjs#helper"], answeredIds: [], miss: false },
  { type: "turn", ts: T(7), query: "bye", conversational: true, resolvedIds: [], answeredIds: [], miss: false },
];

function sidecarText(id = SID, turns = TURNS) {
  return [
    JSON.stringify({ type: "session", id, started: T(0), repo: "/r", tmctVersion: "0.2.0" }),
    ...turns.map((t) => JSON.stringify(t)),
    JSON.stringify({ type: "end", ts: T(8) }),
  ].join("\n") + "\n";
}

// The transcript chat.mjs writes: header, per-turn [ts, "> query", answer, ""], footer.
function logText(id = SID) {
  const block = (ts, q, a) => `${ts}\n> ${q}\n${a}\n`;
  return `# tmct chat 0.2.0 — session started ${T(0)} — repo /r\n\n` +
    block(T(1), "hi", "Hello! Ask me about this codebase.") +
    block(T(2), "which  modules import   config.mjs?", "config.mjs is imported by:\n  - app/lib/b.mjs") +
    block(T(3), "/stats", "modules: 2\ncommits: 0") +
    block(T(4), "thanks!!", "Any time.") +
    block(T(5), "tell me about zorbulon", 'no symbol matching "zorbulon" found in the index.') +
    block(T(6), "who calls helper?", "helper is called by app/lib/b.mjs.") +
    block(T(7), "bye", "Bye!") +
    `${T(8)}\n> /exit\nsession end ${T(8)}\n`;
}

async function repoWithSession(id = SID) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-fold-"));
  await mkdir(join(dir, ".tmct", "sessions"), { recursive: true });
  await writeFile(join(dir, ".tmct", "sessions", `session-${id}.jsonl`), sidecarText(id));
  await writeFile(join(dir, ".tmct", `session-${id}.log`), logText(id));
  return dir;
}

test("parseSessionLog: recovers each turn's answer prose, keyed by ts+query; multi-line answers intact", () => {
  const answers = parseSessionLog(logText());
  assert.equal(answers.get(turnKey(T(2), "which  modules import   config.mjs?")),
    "config.mjs is imported by:\n  - app/lib/b.mjs");
  assert.equal(answers.get(turnKey(T(6), "who calls helper?")), "helper is called by app/lib/b.mjs.");
  assert.equal(answers.get(turnKey(T(1), "hi")), "Hello! Ask me about this codebase.");
  assert.deepEqual(parseSessionLog(""), new Map());
  assert.deepEqual(parseSessionLog("not a transcript\nat all"), new Map());
});

test("cleanSessionText: drops slash-commands, conversational + unflagged filler, and misses; keeps normalized Q/A", () => {
  const record = { id: SID, turns: TURNS.map(({ type, ...t }) => t) };
  const text = cleanSessionText(record, parseSessionLog(logText()));
  assert.equal(text, [
    "Q: which modules import config.mjs?", // whitespace normalized
    "A: config.mjs is imported by: - app/lib/b.mjs",
    "Q: who calls helper?",
    "A: helper is called by app/lib/b.mjs.",
  ].join("\n"));
  // no transcript → question-only lines, honestly — never a lost session
  assert.equal(cleanSessionText(record), "Q: which modules import config.mjs?\nQ: who calls helper?");
  // all-filler session cleans to nothing
  assert.equal(cleanSessionText({ turns: [{ ts: T(1), query: "hello there!!" }, { ts: T(2), query: "/help", command: "help" }] }), "");
});

test("cleanSessionText: wall answers and recall replays never fold, even when NOT flagged miss", () => {
  // An old-build poisoned store: via:"recall" turns recorded miss:false whose
  // answers carry the recall preamble + the grammar wall below it, and a wall
  // answer that slipped through unflagged. Re-folding must drop BOTH.
  const turns = [
    { ts: T(1), query: "who owns billing.mjs", miss: false },
    { ts: T(2), query: "which modules import config.mjs", miss: false },
    { ts: T(3), query: "who calls helper?", miss: false },
  ];
  const answers = new Map([
    [turnKey(T(1), "who owns billing.mjs"),
      'couldn\'t parse this as a graph question. Try: "which modules import <name>". Type /help for all query shapes.'],
    [turnKey(T(2), "which modules import config.mjs"),
      "you asked about this before (session 0189aaaa, 2026-07-01):\n  Q: which modules import config.mjs\n  A: app/lib/b.mjs\n\ncouldn't parse this as a graph question. Try: …"],
    [turnKey(T(3), "who calls helper?"), "helper is called by app/lib/b.mjs."],
  ]);
  const text = cleanSessionText({ id: SID, turns }, answers);
  assert.equal(text, "Q: who calls helper?\nA: helper is called by app/lib/b.mjs.",
    "only the substantive turn survives — wall + recall-replay answers are dropped");
  assert.doesNotMatch(text, /couldn't parse|asked about this before/);
});

test("foldSessionLogs: a mixed fixture session folds to the expected cleaned block; folding twice yields ONE block", async () => {
  const dir = await repoWithSession();
  try {
    const first = await foldSessionLogs(dir);
    assert.deepEqual(first, { folded: [SID], removed: [], skipped: 0 });
    const again = await foldSessionLogs(dir); // re-fold: replace, never duplicate
    assert.deepEqual(again.folded, [SID]);

    const index = await loadBlockIndex(dir);
    assert.deepEqual(Object.keys(index.blocks), [SID], "one block, id = session id");
    const files = (await readdir(join(dir, BLOCKS_DIR_REL))).filter((n) => n.endsWith(".txt"));
    assert.equal(files.length, 1);

    // the folded block is retrievable by what the session was actually about
    const hits = await retrieveBlocks(dir, "who calls helper", 1);
    assert.equal(hits[0].id, SID);
    assert.match(hits[0].text, /^Q: which modules import config\.mjs\?/);
    assert.doesNotMatch(hits[0].text, /stats|zorbulon|thanks|bye|hi\b/i, "noise never reaches the corpus");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foldSessionLogs: sessionId scoping folds just that session; missing dir / unknown id are clean no-ops", async () => {
  const other = "01890000-0000-7000-8000-00000000cafe";
  const dir = await repoWithSession();
  try {
    await writeFile(join(dir, ".tmct", "sessions", `session-${other}.jsonl`), sidecarText(other));
    await writeFile(join(dir, ".tmct", `session-${other}.log`), logText(other));
    const res = await foldSessionLogs(dir, { sessionId: other });
    assert.deepEqual(res.folded, [other], "only the named session folded");
    assert.deepEqual(Object.keys((await loadBlockIndex(dir)).blocks), [other]);
    assert.deepEqual(await foldSessionLogs(dir, { sessionId: "nope" }), { folded: [], removed: [], skipped: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const bare = await mkdtemp(join(tmpdir(), "tmct-mem-fold-bare-"));
  try {
    assert.deepEqual(await foldSessionLogs(bare), { folded: [], removed: [], skipped: 0 });
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
});

// ---- canonise + link (Phase 7) + the fold-time speculative pass (Phase 9) ----
// A memory graph with two as-spoken assertions and the canonical Facts reified
// from them. Folding must (1) LINK each canonical Fact back to its as-spoken
// utterance via mgx:canonicalisedFrom (canonise AND link, never replace), and
// (2) run a bounded, focus-scoped speculative pass that closes the subclass chain
// the session touched — cache⊑store, store⊑component ⊨ cache⊑component.
test("foldSessionLogs: canonise+link edges the canonical Fact to its as-spoken utterance; recall reads canonical, provenance walks back", async () => {
  const S = "01890000-0000-7000-8000-0000000ca11a";
  const TA = "2026-07-04T10:00:00.000Z";
  const TB = "2026-07-04T10:01:00.000Z";
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-canon-"));
  try {
    // as-spoken utterances (the honest record) + the canonical Facts reified
    // from them, tagged with the chat provenance the ACE bridge writes — seeded
    // through the ROUTED backend, the same store the fold resolves for itself.
    const { dir: handle, close } = await openMemoryBackend(dir, "");
    await appendUtterances(handle, [
      { role: "visitor", text: "every cache is a store", ts: TA, sessionId: S, sessionStarted: T(0) },
      { role: "visitor", text: "every store is a component", ts: TB, sessionId: S, sessionStarted: T(0) },
    ]);
    await appendFact(handle, { subject: "cache", predicate: "rdfs:subClassOf", object: "store", provenance: `ace:chat:${S}@${TA}` });
    await appendFact(handle, { subject: "store", predicate: "rdfs:subClassOf", object: "component", provenance: `ace:chat:${S}@${TB}` });
    await close();

    // a matching sidecar so the fold processes this session id
    await mkdir(join(dir, ".tmct", "sessions"), { recursive: true });
    const sidecar = [
      JSON.stringify({ type: "session", id: S, started: T(0), repo: "/r" }),
      JSON.stringify({ type: "turn", ts: TA, query: "every cache is a store", via: "assert" }),
      JSON.stringify({ type: "turn", ts: TB, query: "every store is a component", via: "assert" }),
      JSON.stringify({ type: "end", ts: T(8) }),
    ].join("\n") + "\n";
    await writeFile(join(dir, ".tmct", "sessions", `session-${S}.jsonl`), sidecar);

    await foldSessionLogs(dir, { sessionId: S });

    const routed = await openMemoryBackend(dir, "");
    const memory = await loadMemory(routed.dir);
    await routed.close();
    const rows = readFactRows(memory);
    // recall reads CANONICAL: the reified fact is present and normalized
    const cacheStore = rows.find((r) => r.subject === "cache" && r.object === "store" && r.predicate === "rdfs:subClassOf");
    assert.ok(cacheStore, "canonical Fact recallable");

    // canonicalisedFrom LINKS the canonical Fact back to the as-spoken utterance
    const links = (memory.objectProperties || []).find((g) => g.prop === CANONICALISED_FROM_PROP);
    assert.ok(links, "an mgx:canonicalisedFrom relation exists");
    const uttId = `utt:${S}#${TA}#visitor`;
    assert.ok(
      links.examples.some((e) => e.subject === cacheStore.id && e.object === uttId),
      "the canonical Fact edges back to its as-spoken utterance",
    );
    // the as-spoken prose is left VERBATIM (canonise never replaces)
    const utt = memory.individuals.find((i) => i.id === uttId);
    assert.equal(utt.attributes.find((a) => a.key === "text").value, "every cache is a store");

    // the fold-time speculative pass closed the chain the session touched
    const derived = rows.find((r) => r.subject === "cache" && r.object === "component" && r.predicate === "rdfs:subClassOf");
    assert.ok(derived, "cache⊑component pre-derived at fold time (focus-scoped Phase 9 pass)");
    assert.match(derived.provenance, /entailed:subClassOf/, "and honestly marked entailed, low-trust");
    assert.ok(derived.trust < 0.5, "entailed facts carry speculative trust");

    // re-fold is idempotent: no duplicate canonicalisedFrom edge
    await foldSessionLogs(dir, { sessionId: S });
    const routed2 = await openMemoryBackend(dir, "");
    const links2 = (await loadMemory(routed2.dir)).objectProperties.find((g) => g.prop === CANONICALISED_FROM_PROP);
    await routed2.close();
    assert.equal(links2.examples.filter((e) => e.subject === cacheStore.id && e.object === uttId).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foldSessionLogs: a session that cleans down to nothing removes its stale block; torn sidecars are skipped", async () => {
  const dir = await repoWithSession();
  try {
    await foldSessionLogs(dir);
    // the session is rewritten as all-filler (say, a redaction) — re-fold removes the block
    const filler = [{ type: "turn", ts: T(1), query: "hi", conversational: true, resolvedIds: [], answeredIds: [], miss: false }];
    await writeFile(join(dir, ".tmct", "sessions", `session-${SID}.jsonl`), sidecarText(SID, filler));
    await writeFile(join(dir, ".tmct", "sessions", "session-torn.jsonl"), '{"type":"turn","query":"killed mid-wri');
    const res = await foldSessionLogs(dir);
    assert.deepEqual(res.removed, [SID]);
    assert.equal(res.skipped, 1, "the headerless torn sidecar is skipped, not fatal");
    assert.deepEqual(Object.keys((await loadBlockIndex(dir)).blocks), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
