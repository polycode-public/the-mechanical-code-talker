// wiring-facts-reverse.test.mjs — PLAN_CONVERSATION.md Finding 5's four new
// factAnswer readers (src/chat.mjs): forward yes/no + reverse-by-object shapes
// for mgx:capableOf, mgx:hasA, and the ISA-family predicates, against the REAL
// default-persona bootstrap (corpus/tier2/human.jsonl) — no --repo, no fixture
// graph, the same graph-less first-run seeding W3's own wiring-seed.test.mjs
// and chat-cross-ontology-bridge.test.mjs exercise.
//
// Corpus facts this file leans on (grepped from corpus/tier2/human.jsonl,
// verbatim, ConceptNet-shaped rows the seed pass turns into mgx:hasA/
// mgx:capableOf/rdfs:subClassOf Facts):
//   {"start":"/c/en/dog","rel":"/r/IsA","end":"/c/en/animal", …}
//   {"start":"/c/en/dog","rel":"/r/HasA","end":"/c/en/tail", …}
//   {"start":"/c/en/dog","rel":"/r/CapableOf","end":"/c/en/bark", …}
//   {"start":"/c/en/car","rel":"/r/HasA","end":"/c/en/wheel", …}
//   {"start":"/c/en/bicycle","rel":"/r/HasA","end":"/c/en/wheel", …}
//   {"start":"/c/en/train","rel":"/r/HasA","end":"/c/en/wheel", …}
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const mem = () => mkdtemp(join(tmpdir(), "tmct-facts-reverse-"));

// Reads a session's sidecar JSONL and returns the LAST "turn" record's
// {via, miss} — the same sidecar shape test/chat.test.mjs's own hit/miss
// assertions read (writeSidecar's per-turn record includes both fields).
const lastTurnRecord = async (sidecarFile) => {
  const lines = (await readFile(sidecarFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const turns = lines.filter((l) => l.type === "turn");
  return turns[turns.length - 1];
};

test("CAN_ASK_RE: 'can a dog bark' answers yes from the corpus-seeded mgx:capableOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("can a dog bark");
    await s.close();
    assert.match(r.answer, /dog can bark/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.via, "fact");
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_CAN_DO_RE: 'what can a dog do' lists the corpus-seeded mgx:capableOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what can a dog do");
    await s.close();
    assert.match(r.answer, /dog can bark/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_HAS_RE: 'what has a wheel' lists every distinct subject — car, bicycle, and train", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what has a wheel");
    await s.close();
    assert.match(r.answer, /car has wheel/);
    assert.match(r.answer, /bicycle has wheel/);
    assert.match(r.answer, /train has wheel/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_INHERITS_RE: 'what inherits from horse' surfaces a freshly taught subClassOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const taught = await s.turn("shirehorse is a kind of horse");
    assert.match(taught.answer, /noted — remembered/, "the taught link stores cleanly");
    const r = await s.turn("what inherits from horse");
    await s.close();
    assert.match(r.answer, /shirehorse is a kind of horse/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-shadow regression: 'what has changed recently' stays a code-graph-flavored miss, not a fact answer", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what has changed recently");
    await s.close();
    assert.doesNotMatch(r.answer, /source: corpus/);
    assert.doesNotMatch(r.answer, /you told me/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
