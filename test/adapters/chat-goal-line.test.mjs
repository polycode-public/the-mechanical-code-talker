// The always-on "Goal (inferred): …" trailer's unit seams — the parts a
// scripted session can't observe: last.answer staying trailer-free, the
// --narrate interaction, and the fact readers' additive `goal` field. The
// sentence-level trailer behaviours (append/suppress per turn shape) live as
// planning-lane corpus rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runTurn, NARRATE_MARKER, factAnswer, factReadBack } from "../../src/services/chat.mjs";
import { createInMemoryStore, appendFact, openMemoryBackend } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import * as source from "../../src/adapters/source.mjs";

/** A throwaway on-disk memory store, for the turn types (teach/count) that
 *  only fire with a write target. Returns the store dir and a cleanup. */
async function scratchMemory() {
  const root = await mkdtemp(path.join(tmpdir(), "tmct-goal-line-"));
  const backend = await openMemoryBackend(root, "");
  return { memoryDir: backend.dir, cleanup: async () => { await backend.close(); await rm(root, { recursive: true, force: true }); } };
}

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("goal line: NEVER touches last.answer — why/say-more and repeat-detection see the same text a goal-line-off run would", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph() });
  assert.doesNotMatch(r.last.answer, /Goal \(inferred\)/, "last.answer stays clean");
  const withoutTrailers = r.answer
    .replace(/\n\nCanonical:[^\n]*$/, "")
    .replace(/\n\nGoal \(inferred\):[^\n]*$/, "");
  assert.equal(r.last.answer, withoutTrailers, "last.answer is exactly the pre-goal-line, pre-canonical-line answer");
});

test("goal line: --narrate mode is COMPLETELY UNAFFECTED — still shows the full trace block, now ALSO gets the short line (and the canonical line) just before it (additive, not a replacement)", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph(), narrate: true });
  assert.match(r.answer, /^in app\/lib\/b\.mjs there is function Widget\.render\(\)\./, "the substantive answer still leads");
  assert.match(r.answer, /Goal \(inferred\): Understand a call relationship\.\n\nCanonical: .+\n\n--- narrate ---/, "the goal line, then the canonical line, sit right before the full trace block");
  assert.ok(r.answer.includes(NARRATE_MARKER), "the full narrate block still appears");
  assert.match(r.answer, /goal: understand a call relationship/, "the trace's own goal: line is untouched (lowercase, no period — a separate mechanism)");
});

// ---- the fact readers' own additive `goal` field ---------------------------
// factAnswer/factReadBack returns carry `goal` when a goal is deducible, so an
// envelope-less consumer (the ledger page's chat dock) can render the same
// "Goal (inferred)" line chat prints. Every other consumer reads named fields
// and ignores it.

async function taughtStore() {
  const h = createInMemoryStore();
  await appendFact(h, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA" });
  await appendFact(h, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" });
  await appendFact(h, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
  return h;
}

test("goal field: an envelope-less 'what is X' factAnswer hit carries the vocabulary-goal wording chat's own parse would deduce", async () => {
  const h = await taughtStore();
  const hit = await factAnswer(h, "what is a dog", null, true, {});
  assert.ok(hit && hit.text, "the definition answers");
  assert.equal(hit.goal, 'understand a vocabulary/definition term ("dog")');
});

test("goal field: an envelope-less relation chase through factReadBack carries the taught-fact-lookup goal", async () => {
  const h = await taughtStore();
  const hit = (await factAnswer(h, "who is the father of john", null, true, {}))
    ?? (await factReadBack(h, "who is the father of john", null, true, null));
  assert.ok(hit && hit.text, "the relation query answers");
  assert.match(hit.text, /ahab/);
  assert.equal(hit.goal, "look up a taught fact about a subject/verb/object");
});

test("goal field: absent (undefined) on a hit whose shape maps to no goal, and never fabricated on a miss", async () => {
  const h = await taughtStore();
  const canHit = (await factAnswer(h, "can a dog bark", null, true, {}))
    ?? (await factReadBack(h, "can a dog bark", null, true, null));
  assert.ok(canHit && canHit.text, "the capability yes/no answers");
  assert.equal(canHit.goal, undefined, "no goal wording exists for this shape — the field stays absent, the dock renders no line");
  const miss = await factAnswer(h, "zzz unparseable zzz", null, true, {});
  assert.equal(miss, null, "a miss stays a plain null — no goal-bearing wrapper object");
});

// ---- the plainTurn `goal` seam: teach carries it, a count stays silent -----
// A teach confirmation now sets `result.goal`, so the trailer appends — but
// `last.answer` (what why/say-more and the repeat-detection walls compare)
// must still be the pre-trailer bytes, exactly as for an ask turn.

test("goal line: a teach confirmation NOW carries the trailer and the `goal` field, while last.answer stays the pre-trailer bytes", async () => {
  const { memoryDir, cleanup } = await scratchMemory();
  try {
    const r = await runTurn("every dog is a animal", { memoryDir, sessionId: "s1", env: { TMCT_NO_SEED: "1" } });
    assert.match(r.answer, /\n\nGoal \(inferred\): Teach\/remember a new fact\./, "the teach confirmation grows the trailer");
    assert.equal(r.goal, "teach/remember a new fact", "the additive `goal` field carries the reused teach-lane string");
    assert.doesNotMatch(r.last.answer, /Goal \(inferred\)/, "last.answer stays clean — the walls see the pre-trailer text");
    const withoutTrailers = r.answer
      .replace(/\n\nCanonical:[^\n]*$/, "")
      .replace(/\n\nGoal \(inferred\):[^\n]*$/, "");
    assert.equal(r.last.answer, withoutTrailers, "last.answer is exactly the pre-goal-line, pre-canonical-line answer");
  } finally {
    await cleanup();
  }
});

test("goal line: a memory-store count still carries NO trailer and no `goal` field — the count family stays the documented silent case", async () => {
  const { memoryDir, cleanup } = await scratchMemory();
  try {
    await runTurn("every dog is a animal", { memoryDir, sessionId: "s1", env: { TMCT_NO_SEED: "1" } });
    const r = await runTurn("how many facts do you know", { memoryDir, sessionId: "s1", env: { TMCT_NO_SEED: "1" } });
    assert.match(r.answer, /^\d+ facts?\.$/, "the count answers");
    assert.doesNotMatch(r.answer, /Goal \(inferred\)/, "no trailer on a count");
    assert.equal(r.goal, undefined, "the count never sets the `goal` field");
  } finally {
    await cleanup();
  }
});
