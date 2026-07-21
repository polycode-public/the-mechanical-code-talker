// sessions.mjs tests — chat sessions as first-class temporal graph data:
// the pure upsert (resolution tiers, honest drops, per-turn re-append), the
// sidecar .jsonl parser, and the atomic read-time graph append.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";
import {
  SESSIONS_DIR_REL, SESSION_CLASS, ASKS_ABOUT_PROP,
  upsertSession, appendSessionToGraph, parseSessionJsonl, readSessionRecords, foldInSessions,
} from "../../src/services/sessions.mjs";
import { CLASS_DOCS, PREDICATE_DOCS } from "../../src/tools/schema-docs.mjs";
import { runChat } from "../../src/services/chat.mjs";
import { loadMemory, openConfiguredMemoryBackend } from "../../src/adapters/memory/core.mjs";

/** Read the repo's memory store the way every routed reader does — through the
 *  configured backend (sqlite by default), never a flat graph.json. */
async function loadRepoMemory(dir) {
  const { dir: mem, close } = await openConfiguredMemoryBackend(dir);
  try {
    return await loadMemory(mem);
  } finally {
    await close();
  }
}

const SRC_SESSIONS = fileURLToPath(new URL("../../src/services/sessions.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

/** A minimal fresh entities payload (the buildEntities shape) for pure upsert tests. */
function freshEntities() {
  return {
    classes: [{ name: "Module", count: 2, sample: ["app/x.mjs", "app/y.mjs"] }],
    vocabulary: [{ prop: "mgx:importsNamespace", predicate: "imports" }],
    objectProperties: [{ predicate: "imports", prop: "mgx:importsNamespace", count: 1,
      examples: [{ subject: "mod:app/y.mjs", object: "mod:app/x.mjs", subjectLabel: "app/y.mjs", objectLabel: "app/x.mjs" }] }],
    individuals: [
      { id: "mod:app/x.mjs", label: "app/x.mjs", class: "Module", derived_from: [], mentions: [], attributes: [] },
      { id: "mod:app/y.mjs", label: "app/y.mjs", class: "Module", derived_from: [], mentions: [], attributes: [] },
      { id: "fn:app/y.mjs#helper", label: "helper", class: "Function", derived_from: [], mentions: [], attributes: [] },
    ],
  };
}

const RECORD = {
  id: "01890000-0000-7000-8000-000000000001",
  started: "2026-07-02T10:00:00.000Z",
  ended: "2026-07-02T10:05:00.000Z",
  turns: [
    { ts: "2026-07-02T10:01:00.000Z", query: "which modules import x.mjs",
      resolvedIds: ["mod:app/x.mjs"], answeredIds: ["mod:app/y.mjs"], miss: false },
  ],
};

// ---- upsertSession (pure) ----

test("upsertSession: Session individual + asksAbout group + classes/vocabulary entries; Modules untouched", () => {
  const e = freshEntities();
  const before = JSON.stringify(e.individuals.filter((i) => i.class === "Module"));
  const { kept, dropped } = upsertSession(e, RECORD);
  assert.equal(kept, 2);
  assert.equal(dropped, 0);

  const sess = e.individuals.find((i) => i.class === SESSION_CLASS);
  assert.ok(sess, "Session individual exists");
  assert.equal(sess.id, `session:${RECORD.id}`);
  assert.equal(sess.label, "01890000", "short time-ordered label, like a Commit's short sha");
  const attr = (k) => sess.attributes.find((a) => a.key === k)?.value;
  assert.equal(attr("started"), RECORD.started);
  assert.equal(attr("ended"), RECORD.ended);
  assert.equal(attr("turns"), "1");
  assert.match(attr("queries"), /which modules import x\.mjs/);

  const group = e.objectProperties.find((g) => g.prop === ASKS_ABOUT_PROP);
  assert.ok(group, "asksAbout group grouped like the other relation groups");
  assert.equal(group.predicate, "asksAbout");
  assert.equal(group.count, 2);
  assert.deepEqual(group.examples.map((x) => x.object).sort(), ["mod:app/x.mjs", "mod:app/y.mjs"]);
  assert.ok(group.examples.every((x) => x.subject === sess.id));

  assert.deepEqual(e.classes.find((c) => c.name === SESSION_CLASS), { name: "Session", count: 1, sample: ["01890000"] });
  assert.ok(e.vocabulary.some((v) => v.prop === ASKS_ABOUT_PROP && /runtime observation/.test(v.note)));

  // the source-derived content is undisturbed
  assert.equal(JSON.stringify(e.individuals.filter((i) => i.class === "Module")), before);
  assert.equal(e.classes.find((c) => c.name === "Module").count, 2);
  assert.equal(e.objectProperties.find((g) => g.prop === "mgx:importsNamespace").count, 1);
});

test("upsertSession: per-turn re-append REPLACES the prior copy — one individual, no duplicate edges", () => {
  const e = freshEntities();
  upsertSession(e, RECORD);
  const twoTurns = { ...RECORD, ended: "2026-07-02T10:06:00.000Z",
    turns: [...RECORD.turns, { ts: "2026-07-02T10:06:00.000Z", query: "tell me a joke", resolvedIds: [], answeredIds: [], miss: true }] };
  upsertSession(e, twoTurns);
  const sessions = e.individuals.filter((i) => i.class === SESSION_CLASS);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].attributes.find((a) => a.key === "turns").value, "2");
  assert.equal(sessions[0].attributes.find((a) => a.key === "ended").value, "2026-07-02T10:06:00.000Z");
  assert.equal(e.objectProperties.find((g) => g.prop === ASKS_ABOUT_PROP).count, 2, "edges not duplicated");
  assert.equal(e.classes.find((c) => c.name === SESSION_CLASS).count, 1);
});

test("upsertSession: updatedAt advances turn-over-turn while createdAt stays pinned", async () => {
  const e = freshEntities();
  upsertSession(e, RECORD);
  const sessAfterFirst = e.individuals.find((i) => i.class === SESSION_CLASS);
  const attr = (ind, k) => ind.attributes.find((a) => a.key === k)?.value;
  const createdAt1 = attr(sessAfterFirst, "createdAt");
  const updatedAt1 = attr(sessAfterFirst, "updatedAt");
  assert.ok(createdAt1, "createdAt stamped on first upsert");
  assert.ok(updatedAt1, "updatedAt stamped on first upsert");

  await new Promise((r) => setTimeout(r, 5)); // force a distinct wall-clock millisecond
  const twoTurns = { ...RECORD, ended: "2026-07-02T10:06:00.000Z",
    turns: [...RECORD.turns, { ts: "2026-07-02T10:06:00.000Z", query: "tell me a joke", resolvedIds: [], answeredIds: [], miss: true }] };
  upsertSession(e, twoTurns);
  const sessAfterSecond = e.individuals.find((i) => i.class === SESSION_CLASS);
  const createdAt2 = attr(sessAfterSecond, "createdAt");
  const updatedAt2 = attr(sessAfterSecond, "updatedAt");

  assert.equal(createdAt2, createdAt1, "createdAt is first-write-wins — pinned across re-appends");
  assert.ok(updatedAt2 > updatedAt1, `updatedAt advances turn-over-turn (${updatedAt1} -> ${updatedAt2})`);
});

test("upsertSession: unresolvable ref → edge dropped + counted; moved symbol re-resolves via unique label", () => {
  const e = freshEntities();
  const rec = { ...RECORD, turns: [{ ts: RECORD.turns[0].ts, query: "where is helper",
    // helper was recorded at app/OLD.mjs; the fresh graph defines it at app/y.mjs (label tier).
    // mod:gone.mjs matches nothing at all (dropped, never guessed).
    resolvedIds: ["fn:app/OLD.mjs#helper"], answeredIds: ["mod:gone.mjs"], miss: false }] };
  const { kept, dropped } = upsertSession(e, rec);
  assert.equal(kept, 1);
  assert.equal(dropped, 1);
  const group = e.objectProperties.find((g) => g.prop === ASKS_ABOUT_PROP);
  assert.deepEqual(group.examples.map((x) => x.object), ["fn:app/y.mjs#helper"], "re-resolved by unique label");
  const sess = e.individuals.find((i) => i.class === SESSION_CLASS);
  assert.equal(sess.attributes.find((a) => a.key === "dropped").value, "1");
  const ids = new Set(e.individuals.map((i) => i.id));
  assert.ok(group.examples.every((x) => ids.has(x.object)), "no dangling edge targets");
});

// ---- sidecar parsing ----

test("parseSessionJsonl: header + turns + end; torn trailing line skipped; headerless → null", () => {
  const text = [
    JSON.stringify({ type: "session", id: RECORD.id, started: RECORD.started, repo: "/r", tmctVersion: "0.2.1" }),
    JSON.stringify({ type: "turn", ...RECORD.turns[0] }),
    JSON.stringify({ type: "turn", ts: "2026-07-02T10:02:00.000Z", query: "tell me a joke", resolvedIds: [], answeredIds: [], miss: true }),
    JSON.stringify({ type: "end", ts: RECORD.ended }),
    '{"type":"turn","query":"killed mid-wri', // torn line from a killed session
  ].join("\n");
  const rec = parseSessionJsonl(text);
  assert.equal(rec.id, RECORD.id);
  assert.equal(rec.started, RECORD.started);
  assert.equal(rec.ended, RECORD.ended);
  assert.equal(rec.turns.length, 2);
  assert.deepEqual(rec.turns[0].answeredIds, ["mod:app/y.mjs"]);
  assert.equal(rec.turns[1].miss, true);
  assert.equal(parseSessionJsonl("not json\n"), null);
});

test("parseSessionJsonl: a rewritten turn's verbatim `input` survives beside the query, and the session's recorded questions quote it", () => {
  const text = [
    JSON.stringify({ type: "session", id: RECORD.id, started: RECORD.started, repo: "/r", tmctVersion: "0.2.1" }),
    JSON.stringify({ type: "turn", ts: "2026-07-02T10:03:00.000Z", query: "tell me about a horse", input: "i wanna know about a horse", resolvedIds: [], answeredIds: [], miss: false }),
    JSON.stringify({ type: "end", ts: RECORD.ended }),
  ].join("\n");
  const rec = parseSessionJsonl(text);
  assert.equal(rec.turns[0].query, "tell me about a horse");
  assert.equal(rec.turns[0].input, "i wanna know about a horse");
  const entities = { classes: [], vocabulary: [], objectProperties: [], individuals: [] };
  upsertSession(entities, rec);
  const session = entities.individuals.find((i) => i.class === "Session");
  const queries = session.attributes.find((a) => a.key === "queries")?.value;
  assert.equal(queries, "i wanna know about a horse");
});

// ---- read-time graph append (atomic) ----

test("appendSessionToGraph: fresh-read + atomic write; second append updates in place; no temp litter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sess-append-"));
  try {
    const graphFile = join(dir, "graph.json");
    await writeFile(graphFile, JSON.stringify(freshEntities()));
    await appendSessionToGraph(graphFile, RECORD);
    let g = JSON.parse(await readFile(graphFile, "utf8"));
    assert.equal(g.individuals.filter((i) => i.class === SESSION_CLASS).length, 1);
    assert.equal(g.objectProperties.find((x) => x.prop === ASKS_ABOUT_PROP).count, 2);

    // a re-index replaced the file mid-session (x.mjs is gone) → next append re-reads
    // and drops the vanished target, keeping the survivor
    const reindexed = freshEntities();
    reindexed.individuals = reindexed.individuals.filter((i) => i.id !== "mod:app/x.mjs");
    await writeFile(graphFile, JSON.stringify(reindexed));
    await appendSessionToGraph(graphFile, RECORD);
    g = JSON.parse(await readFile(graphFile, "utf8"));
    const group = g.objectProperties.find((x) => x.prop === ASKS_ABOUT_PROP);
    assert.deepEqual(group.examples.map((x) => x.object), ["mod:app/y.mjs"], "vanished target dropped, never dangling");
    const sess = g.individuals.find((i) => i.class === SESSION_CLASS);
    assert.equal(sess.attributes.find((a) => a.key === "dropped").value, "1");

    const names = await readdir(dir);
    assert.ok(!names.some((n) => n.includes(".tmp-")), `atomic write leaves no temp files: ${names}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSessionRecords: no sessions dir → [] (every existing fixture repo)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sess-none-"));
  try {
    assert.deepEqual(await readSessionRecords(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foldInSessions: zero records is a no-op (session-less graphs stay byte-identical)", () => {
  const e = freshEntities();
  const before = JSON.stringify(e);
  foldInSessions(e, []);
  assert.equal(JSON.stringify(e), before);
});

// ---- the memory side-write (item 9 wiring: chat.mjs untouched) ----

/** A repo laid out the way chat.mjs leaves it: .tmct/graph.json + transcript
 *  log (+ optionally the structured sidecar). */
async function repoForMemory({ withEnd = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sess-mem-"));
  await mkdir(join(dir, ".tmct", "sessions"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(freshEntities()));
  const t = RECORD.turns[0];
  await writeFile(join(dir, ".tmct", `session-${RECORD.id}.log`),
    `# tmct chat 0.2.0 — session started ${RECORD.started} — repo ${dir}\n\n` +
    `${t.ts}\n> ${t.query}\napp/x.mjs is imported by:\n  - app/y.mjs\n\n`);
  await writeFile(join(dir, ".tmct", "sessions", `session-${RECORD.id}.jsonl`), [
    JSON.stringify({ type: "session", id: RECORD.id, started: RECORD.started, repo: dir, tmctVersion: "0.2.0" }),
    JSON.stringify({ type: "turn", ...t }),
    ...(withEnd ? [JSON.stringify({ type: "end", ts: RECORD.ended })] : []),
  ].join("\n") + "\n");
  return dir;
}

test("appendSessionToGraph: the turn ALSO lands in the configured memory store — visitor utterance + tmct reply with the transcript's answer text, no flat graph.json", async () => {
  const dir = await repoForMemory();
  try {
    const graphFile = join(dir, ".tmct", "graph.json");
    await appendSessionToGraph(graphFile, RECORD);
    await appendSessionToGraph(graphFile, RECORD); // per-turn replay — idempotent

    // the PROVIDER-side graph got the Session as before; utterances never leak into it
    const g = JSON.parse(await readFile(graphFile, "utf8"));
    assert.equal(g.individuals.filter((i) => i.class === SESSION_CLASS).length, 1);
    assert.ok(!g.individuals.some((i) => i.class === "Utterance"), "memory stays out of the provider graph");

    // tmct's OWN store — the configured backend, where the session's facts also
    // live — holds the Q and the A, paired. The retired flat-file store never
    // appears: utterances and facts share ONE store, so the fold's
    // canonise-link can find these utterances for real sessions.
    const memEntries = await readdir(join(dir, ".tmct", "memory"));
    assert.ok(!memEntries.includes("graph.json"), "the mirror writes the configured backend, never a flat graph.json");
    assert.ok(memEntries.includes("graph.sqlite"), "the default backend's sqlite store received the write");
    const m = await loadRepoMemory(dir);
    const utts = m.individuals.filter((i) => i.class === "Utterance");
    assert.equal(utts.length, 2, "one visitor + one tmct utterance, no duplicates from the replay");
    const attr = (ind, k) => ind.attributes.find((a) => a.key === k)?.value;
    const visitor = utts.find((u) => attr(u, "role") === "visitor");
    const reply = utts.find((u) => attr(u, "role") === "tmct");
    assert.equal(attr(visitor, "text"), RECORD.turns[0].query);
    assert.deepEqual(JSON.parse(attr(visitor, "parsed")),
      { resolvedIds: ["mod:app/x.mjs"], answeredIds: ["mod:app/y.mjs"] });
    assert.equal(attr(reply, "text"), "app/x.mjs is imported by: - app/y.mjs", "answer prose recovered from the transcript");
    const replyGroup = m.objectProperties.find((x) => x.prop === "mgx:inReplyTo");
    assert.deepEqual([replyGroup.examples[0].subject, replyGroup.examples[0].object], [reply.id, visitor.id]);
    assert.equal(m.objectProperties.find((x) => x.prop === "mgx:saidInSession").count, 2);

    // no end marker yet → nothing folded
    assert.equal(await readdir(join(dir, ".tmct", "memory")).then((n) => n.includes("blocks")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendSessionToGraph: once the sidecar carries its end marker, the session folds into the block corpus", async () => {
  const dir = await repoForMemory({ withEnd: true });
  try {
    await appendSessionToGraph(join(dir, ".tmct", "graph.json"), RECORD);
    const index = JSON.parse(await readFile(join(dir, ".tmct", "memory", "blocks", "index.json"), "utf8"));
    assert.deepEqual(Object.keys(index.blocks), [RECORD.id], "one block, id = session id");
    const block = await readFile(join(dir, ".tmct", "memory", "blocks", index.blocks[RECORD.id].file), "utf8");
    assert.equal(block, `Q: ${RECORD.turns[0].query}\nA: app/x.mjs is imported by: - app/y.mjs`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendSessionToGraph: memory is best-effort and scoped — no .tmct layout → no memory writes; memory:false disables; a memory failure never fails the graph append", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sess-nomem-"));
  try {
    // graph file NOT under .tmct → no repo to attach memory to → graph append only
    const bareGraph = join(dir, "graph.json");
    await writeFile(bareGraph, JSON.stringify(freshEntities()));
    await appendSessionToGraph(bareGraph, RECORD);
    assert.deepEqual((await readdir(dir)).sort(), ["graph.json"], "nothing but the graph artifact");

    // .tmct layout but memory disabled by the caller
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const tmctGraph = join(dir, ".tmct", "graph.json");
    await writeFile(tmctGraph, JSON.stringify(freshEntities()));
    await appendSessionToGraph(tmctGraph, RECORD, { memory: false });
    assert.ok(!(await readdir(join(dir, ".tmct"))).includes("memory"), "memory:false writes no memory");

    // a poisoned memory store must not break the graph append (best-effort seam)
    await mkdir(join(dir, ".tmct", "memory"), { recursive: true });
    await writeFile(join(dir, ".tmct", "memory", "graph.sqlite"), "not a sqlite database {");
    const res = await appendSessionToGraph(tmctGraph, RECORD);
    assert.equal(res.kept, 2, "graph append succeeded despite the broken memory store");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- GUARD: the shell-transcript tripwire ----
// The memory subsystem recovers each turn's ANSWER text by RE-READING the human
// transcript .tmct/session-<id>.log (parseSessionLog, keyed by turnKey(ts, query)),
// which depends on (a) the sidecar record's ts matching the transcript block's ts
// line and (b) writeLog flushing BEFORE the per-turn graph upsert. Any chat shell
// (readline today, an Ink TUI, anything future) must write the SAME transcript
// format through the SAME sequencing, or answer text silently stops reaching
// memory. This test drives a scripted session through the real shell and asserts
// every non-conversational, non-miss turn produced a NON-EMPTY tmct answer
// utterance in the repo's configured memory store — the tripwire transcript
// drift would trip.

test("guard: every dispatched (non-conversational, non-miss) turn's answer lands as a NON-EMPTY memory utterance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sess-guard-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
    const input = Readable.from([
      "hi\n",                          // conversational — outside the guard
      "which modules import a.mjs\n",  // ask-engine hit
      "how many classes are there\n",  // mechanical count answer
      "/describe Base\n",              // slash-command answer
      "tell me a joke\n",              // grammar miss — outside the guard
      "/exit\n",
    ]);
    const out = new PassThrough();
    out.resume(); // drain — this guard is about the artifacts, not the screen
    const { sidecarFile } = await runChat({ repoPath: dir, input, output: out });

    const sidecar = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
    const guarded = sidecar.turns.filter((t) => !t.conversational && !t.miss);
    assert.equal(guarded.length, 3, "the script dispatched exactly three answerable turns");

    const memory = await loadRepoMemory(dir);
    const byId = new Map(memory.individuals.map((i) => [i.id, i]));
    for (const t of guarded) {
      const utt = byId.get(`utt:${sidecar.id}#${t.ts}#tmct`);
      assert.ok(utt, `a tmct answer utterance was recorded for "${t.query}"`);
      const text = utt.attributes.find((a) => a.prop === "mgx:utteranceText")?.value;
      assert.ok(text && text.trim().length > 0,
        `the answer utterance text is non-empty for "${t.query}" (got ${JSON.stringify(text)})`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The session shell holds its own long-lived store connection (with a payload
// cache) while the per-turn mirror opens a fresh one; a cached write from the
// session's connection can drop rows the mirror appended in between. The mirror
// replays the WHOLE record every turn with deterministic ids, so the state after
// each completed append is always the full session. This test interleaves a
// teach turn (a session-connection fact write) between mirrored turns and
// asserts nothing is lost from the shared store by session end.
test("a teach turn mid-session never loses earlier turns' utterances — facts and the full utterance mirror share one store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sess-teach-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
    const input = Readable.from([
      "which modules import a.mjs\n",   // mirrored before the teach
      "every module is a component\n",  // teach — writes a Fact through the session's own connection
      "how many classes are there\n",   // mirrored after the teach
      "/exit\n",
    ]);
    const out = new PassThrough();
    out.resume();
    const { sidecarFile } = await runChat({ repoPath: dir, input, output: out, env: { TMCT_NO_SEED: "1" } });

    const sidecar = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
    const memory = await loadRepoMemory(dir);
    const ids = new Set(memory.individuals.map((i) => i.id));
    for (const t of sidecar.turns) {
      assert.ok(ids.has(`utt:${sidecar.id}#${t.ts}#visitor`),
        `the visitor utterance for "${t.query}" survived to session end`);
    }
    const facts = memory.individuals.filter((i) => i.class === "Fact");
    assert.ok(facts.some((f) => {
      const attr = (k) => f.attributes.find((a) => a?.key === k)?.value;
      return attr("subject") === "module" && attr("object") === "component";
    }), "the taught fact lives in the SAME store as the utterances");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- schema drift guard (mirrors schema-docs.test.mjs, scoped to sessions.mjs) ----

test("drift guard: every class/prop literal sessions.mjs emits has a CLASS_DOCS/PREDICATE_DOCS entry", async () => {
  const src = await readFile(SRC_SESSIONS, "utf8");
  const documentedClasses = new Set(CLASS_DOCS.map((c) => c.name));
  const documentedProps = new Set(PREDICATE_DOCS.map((p) => p.prop));
  assert.ok(documentedClasses.has(SESSION_CLASS), "Session has a CLASS_DOCS entry (→ SchemaClass individual)");
  assert.ok(documentedProps.has(ASKS_ABOUT_PROP), "mgx:asksAbout has a PREDICATE_DOCS entry");
  for (const [, prop] of src.matchAll(/prop:\s*"([a-zA-Z:]+)"/g)) {
    assert.ok(documentedProps.has(prop), `sessions.mjs emits prop "${prop}" with no PREDICATE_DOCS entry`);
  }
});
