// Chat-interface-level proof that the multi-character mud engine works end to
// end: real createSession()/s.turn() sessions, one per acting character,
// driving scripted turns against the shipped mud-garden world — not unit-level
// calls into adventure.mjs's own functions (adventure-mud-threading.test.mjs
// and adventure-mud-knowledge.test.mjs already cover that layer).
//
// Two engine limits surfaced while writing this, both confirmed by running
// real turns rather than assumed from reading the grammar:
//
// - mud-garden's own HAND-AUTHORED, single-instance props (carrot, stone,
//   basket, seed) are bare-lemma-named (a later workstream renamed them from
//   carrot-1/stone-1/basket-1/seed-1 specifically so typed natural language
//   could reach them — matching ashcombe-hall's own "lamp"/"key" convention),
//   so "take the carrot" resolves cleanly today. A DYNAMICALLY DUG object
//   still can't be: digging mints a fresh, per-room id (e.g. "root-garden-
//   south"), so its bare kind word ("root") never matches that placed
//   subject's exact string — a structural property of minting unique ids for
//   procedurally spawned content, not a naming oversight the way the static
//   props' old numbered ids were. The dedicated test below proves both
//   halves: the shipped static props resolve, a dug object's bare kind
//   doesn't.
// - recordTold/recordExamined (the durable per-character "knows-about" writes
//   the food-knowledge query reads) are only ever called from mud-turn.mjs's
//   autonomous engine — no player-typed verb in adventure.mjs's own
//   runWorldCommand calls either. A session's own "examine"/"take"/"eat"
//   commands never make a character durably "know" something through chat
//   today; the food-knowledge tests below seed that fact directly (the same
//   way adventure-mud-knowledge.test.mjs's own unit tests already do) and
//   prove the QUERY side resolves correctly through a real chat turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { openMemoryBackend, appendFacts, appendRule } from "../../src/adapters/memory/core.mjs";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { recordExamined } from "../../src/services/adventure.mjs";

const WORLD = "mud-garden";

/** Loads the shipped mud-garden world into a fresh temp repo's memory store,
 *  the exact fixture shape chat-session.test.mjs's own "actingSubject +
 *  adventureWorld" session-handle test uses. `extraFacts` optionally seeds
 *  test-only supplementary facts (e.g. a lexicon-resolvable bare-word prop)
 *  in the same append, tagged to the world's own provenance. */
async function loadMudGardenInto(repo, extraFacts = []) {
  clearWorldsPackCache();
  const { dir: memoryDir } = await openMemoryBackend(repo, "");
  const world = await getWorldsPackProvider({}).load(WORLD);
  assert.ok(world, "the mud-garden world ships in the pack");
  const tag = worldProvenanceTag(world.name);
  await appendFacts(memoryDir, [
    ...world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag })),
    ...extraFacts.map((f) => ({ ...f, provenance: tag })),
  ]);
  for (const rule of world.rules) {
    await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }
  return memoryDir;
}

function openCharacterSession(repo, actingSubject) {
  return createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1" }, actingSubject, adventureWorld: WORLD });
}

async function withTempRepo(prefix, body) {
  const repo = await mkdtemp(join(tmpdir(), `tmct-mud-chat-${prefix}-`));
  try {
    await body(repo);
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
}

test("movement: a session walks down into the burrow and back up, through real chat turns", async () => {
  await withTempRepo("move", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const down = await mole.turn("go down");
      assert.match(down.answer, /you go down/);
      assert.match(down.answer, /[Nn]ow in the burrow-1/);

      const up = await mole.turn("go up");
      assert.match(up.answer, /you go up/);
      assert.match(up.answer, /[Nn]ow in the garden/);
    } finally {
      await mole.close();
    }
  });
});

test("digging: a session digs a new room and a follow-up turn actually reaches it", async () => {
  await withTempRepo("dig", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const dug = await mole.turn("dig east");
      assert.match(dug.answer, /you dig east and open up a new room/, "the dig itself confirms a new room opened");

      const walked = await mole.turn("go east");
      assert.match(walked.answer, /you go east/);
      assert.match(walked.answer, /[Nn]ow in the garden-east/, "the dug room is real and enterable, not just narrated");
    } finally {
      await mole.close();
    }
  });
});

test("taking/eating/putting succeed through real chat turns against the shipped world's own props", async () => {
  // mud-garden's static props (carrot, stone, basket) are bare-lemma-named
  // (see the file-header note), so this drives them directly — no
  // supplementary fixture needed.
  await withTempRepo("take-eat-put", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const taken = await mole.turn("take the carrot");
      assert.match(taken.answer, /you take the carrot/);

      const eaten = await mole.turn("eat the carrot");
      assert.match(eaten.answer, /you eat the carrot/);

      const carrying = await mole.turn("what am i carrying");
      assert.match(carrying.answer, /you aren't carrying anything/, "eating consumes the carrot — it's gone, not just moved into inventory");

      const tookStone = await mole.turn("take the stone");
      assert.match(tookStone.answer, /you take the stone/);

      const put = await mole.turn("put the stone in the basket");
      assert.match(put.answer, /you put the stone in the basket/);
    } finally {
      await mole.close();
    }
  });
});

test("the shipped static props resolve by typed natural language; a dynamically dug object's bare kind word does not", async () => {
  await withTempRepo("static-vs-dug-props", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const takenCarrot = await mole.turn("take the carrot");
      assert.match(takenCarrot.answer, /you take the carrot/, "the shipped world's own static prop resolves — its bare-lemma naming fix landed");

      // "dig south" deterministically spawns one object, kind "root", minted
      // as "root-garden-south" — a per-room id, never the bare lemma "root".
      const dug = await mole.turn("dig south");
      assert.match(dug.answer, /In the loose earth: the root-garden-south/, "a dug room's spawned object carries a per-room id, not a bare lemma");

      const walked = await mole.turn("go south");
      assert.match(walked.answer, /[Nn]ow in the garden-south/);

      const bareNoun = await mole.turn("take the root");
      assert.match(
        bareNoun.answer,
        /isn't something you can take — it's only mentioned in passing here/,
        "the bare kind word resolves to the lexicon lemma \"root\", never the placed \"root-garden-south\" — background vocabulary, not the real dug prop; a structural property of minting unique ids for dug content, not a naming oversight",
      );
    } finally {
      await mole.close();
    }
  });
});

test("the food-knowledge query, asked through real chat, isolates each character's own knowledge", async () => {
  await withTempRepo("food-query", async (repo) => {
    const memoryDir = await loadMudGardenInto(repo);
    // recordExamined is only ever called from mud-turn.mjs's autonomous
    // engine (see file header) — seeded directly here, the same way
    // adventure-mud-knowledge.test.mjs's own unit tests do, so this test can
    // focus on the QUERY side's real chat-interface behavior.
    await recordExamined(memoryDir, { observer: "mole-1", thing: "carrot", k: 1 });

    const mole = await openCharacterSession(repo, "mole-1");
    const vole = await openCharacterSession(repo, "vole-1");
    try {
      const moleKnows = await mole.turn("what do you know about food");
      assert.match(moleKnows.answer, /you know about: the carrot/, "mole-1 learned about the carrot and reports it back");

      const voleKnows = await vole.turn("what do you know about food");
      assert.match(voleKnows.answer, /you don't know of any food yet/, "vole-1 never examined anything — the honest empty answer, never a guess");
    } finally {
      await mole.close();
      await vole.close();
    }
  });
});

test("two characters, two sessions, one shared world: a dig by one is enterable by the other", async () => {
  await withTempRepo("cross-session-dig", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    const vole = await openCharacterSession(repo, "vole-1");
    try {
      const dug = await mole.turn("dig east");
      assert.match(dug.answer, /you dig east and open up a new room/);

      const voleWalked = await vole.turn("go east");
      assert.match(voleWalked.answer, /you go east/);
      assert.match(
        voleWalked.answer,
        /[Nn]ow in the garden-east/,
        "vole-1's SEPARATE session reads the exit mole-1's session wrote to the shared world state",
      );
    } finally {
      await mole.close();
      await vole.close();
    }
  });
});

test("an honest miss stays honest through the full chat turn — never a fabricated success", async () => {
  await withTempRepo("honest-miss", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const gibberish = await mole.turn("asdkfjasdf nonsense command");
      assert.doesNotMatch(gibberish.answer, /you (take|eat|put|go|dig)/, "gibberish never reads back as a successful world-mutating command");

      const absentButDeclared = await mole.turn("eat the lamp");
      assert.equal(
        absentButDeclared.answer,
        "I don't see a lamp here.",
        "a declared word naming something genuinely absent from this room declines honestly, never a guess",
      );
    } finally {
      await mole.close();
    }
  });
});
