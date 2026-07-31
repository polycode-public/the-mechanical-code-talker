// An adventure world command's object registers as one referent among N in the
// shared discourse record (class AdventureObject, lane adventure) rather than a
// second private focus holder, and a pronoun command binds through that record
// — scoped to this lane, so a code-graph referent from an earlier question is
// never mistaken for the thing "it" means. With nothing standing, the reference
// nudge carries over verbatim. Driven through the real runTurn path against a
// temp store the opener writes the shipped world into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/services/chat.mjs";
import { emptyRecord } from "../../src/domain/discourse.mjs";

async function driveAdventure(dir, queries) {
  const turns = [];
  let discourse = emptyRecord();
  let last = null;
  let planState = null;
  for (const query of queries) {
    const r = await runTurn(query, { config: {}, memoryDir: dir, discourse, last, planState });
    turns.push(r);
    discourse = r.discourse;
    last = r.last;
    if ("planState" in r) planState = r.planState;
  }
  return turns;
}

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-discourse-adventure-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a world command's object registers as an AdventureObject entity in the discourse record", async () => {
  await withStore(async (dir) => {
    const [, look] = await driveAdventure(dir, ["play ashcombe hall", "look lamp"]);
    const entity = look.discourse.referents.find((r) => r.from.lane === "adventure");
    assert.ok(entity, "the object the look named registered as a referent");
    assert.equal(entity.kind, "entity");
    assert.equal(entity.class, "AdventureObject");
    assert.equal(entity.label, "lamp");
    assert.deepEqual(entity.ids, ["adventure:lamp"]);
    assert.ok(entity.binds.includes("it"), "an entity answers to 'it', which every adventure pronoun normalizes to");
  });
});

test("a later pronoun binds the standing adventure object through the record", async () => {
  await withStore(async (dir) => {
    const [, , examineIt, examineLamp] = await driveAdventure(dir, [
      "play ashcombe hall", "look lamp", "examine it", "examine lamp",
    ]);
    assert.doesNotMatch(String(examineIt.answer), /refers to/, "'examine it' bound the lamp, not the reference nudge");
    assert.doesNotMatch(String(examineIt.answer), /in my vocabulary/, "and never the vocabulary decline");
    assert.match(String(examineIt.answer), /[Ll]amp/, "'examine it' read the lamp");
    assert.equal(
      String(examineIt.answer).split("\n")[0],
      String(examineLamp.answer).split("\n")[0],
      "'examine it' reads exactly as 'examine lamp' does the next turn",
    );
  });
});

test("a pronoun with no adventure object standing gives the verbatim reference nudge, never the vocabulary decline", async () => {
  await withStore(async (dir) => {
    const [, nudged] = await driveAdventure(dir, ["play ashcombe hall", "examine it"]);
    assert.equal(nudged.record.miss, true, "an unbindable pronoun is an honest miss");
    assert.match(
      String(nudged.answer),
      /^I'm not sure what "it" refers to yet — name the thing, e\.g\. "examine cabinet"\./,
      "the reference nudge names a real room object and is preserved verbatim",
    );
    assert.doesNotMatch(String(nudged.answer), /in my vocabulary/, "a pronoun is a reference, never an unknown word");
  });
});

test("an adventure object does not bind a code-graph pronoun's meaning, and vice versa", async () => {
  await withStore(async (dir) => {
    // The record is scoped by lane: the adventure bind only ever reaches an
    // adventure-lane referent, so a stray same-kind referent from elsewhere
    // cannot be mistaken for the thing a world pronoun means.
    const [, look, examineIt] = await driveAdventure(dir, ["play ashcombe hall", "look lamp", "examine it"]);
    const advRefs = look.discourse.referents.filter((r) => r.from.lane === "adventure");
    assert.equal(advRefs.length, 1, "only the adventure object stands in the record");
    assert.match(String(examineIt.answer), /[Ll]amp/, "the world pronoun bound the adventure object");
  });
});
