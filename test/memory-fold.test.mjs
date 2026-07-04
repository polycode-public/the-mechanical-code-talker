// memory/fold.mjs tests — session-log cleaning → corpus folding: the pure
// cleaner (drop slash-commands, filler, misses; keep real Q/A, normalized),
// the transcript answer parser it leans on, and the idempotent fold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionLog, turnKey } from "../src/sessions.mjs";
import { cleanSessionText, foldSessionLogs } from "../src/memory/fold.mjs";
import { BLOCKS_DIR_REL, loadBlockIndex, retrieveBlocks } from "../src/memory/blocks.mjs";

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
