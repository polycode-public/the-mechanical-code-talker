// Chat-interface-level proof that the multi-character mud engine works end to
// end: real createSession()/s.turn() sessions, one per acting character,
// driving scripted turns against the shipped mud-garden world — not unit-level
// calls into adventure.mjs's own functions (adventure-mud-threading.test.mjs
// and adventure-mud-knowledge.test.mjs already cover that layer).
//
// Two engine properties surfaced while writing this, both confirmed by
// running real turns rather than assumed from reading the grammar:
//
// - mud-garden's own HAND-AUTHORED, single-instance props (carrot, stone,
//   basket, seed) are bare-lemma-named, matching ashcombe-hall's own
//   "lamp"/"key" convention, so "take the carrot" resolves cleanly. A
//   DYNAMICALLY DUG object gets a minted id instead ("root-1"), because a
//   room can hold several of a kind; the world declares its own minted ids as
//   vocabulary, so "take the root-1" resolves too, while the bare kind word
//   "root" still names the lexicon lemma and no one instance. The dedicated
//   test below proves all three.
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
    const badger = await openCharacterSession(repo, "badger-2");
    try {
      const dug = await badger.turn("dig east");
      assert.match(dug.answer, /you dig east and open up a new room/, "the dig itself confirms a new room opened");

      const walked = await badger.turn("go east");
      assert.match(walked.answer, /you go east/);
      assert.match(walked.answer, /[Nn]ow in the sett-1-east/, "the dug room is real and enterable, not just narrated");
    } finally {
      await badger.close();
    }
  });
});

test("digging follows the room's own kind, and the burrow stays one level deep", async () => {
  await withTempRepo("dig-rules", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const sideways = await mole.turn("dig east");
      assert.match(sideways.answer, /open ground/, "there is nothing to tunnel east through in a garden");

      const under = await mole.turn("go down");
      assert.match(under.answer, /[Nn]ow in the burrow-1/);

      const deeper = await mole.turn("dig down");
      assert.match(deeper.answer, /one level deep/, "the burrow does not grow a second storey");

      const along = await mole.turn("dig west");
      assert.match(along.answer, /you dig west and open up a new room/, "but it does spread along its own level");
    } finally {
      await mole.close();
    }
  });
});

test("naming another animal reaches it: talking to one, and asking one a question", async () => {
  await withTempRepo("npc-vocabulary", async (repo) => {
    await loadMudGardenInto(repo);
    const badger = await openCharacterSession(repo, "badger-2");
    try {
      const spoken = await badger.turn("talk to groundhog-1");
      assert.doesNotMatch(spoken.answer, /isn't in my vocabulary/, "a world's own cast id is vocabulary the world declares");
      assert.match(spoken.answer, /the groundhog-1 says:/);

      const addressed = await badger.turn("groundhog-1 what do you know about food");
      assert.doesNotMatch(addressed.answer, /code question|code graph/, "naming who you are addressing never turns the line into a code question");
      assert.match(addressed.answer, /you don't know of any food yet/);

      const whoIsHere = await badger.turn("who is here");
      assert.match(whoIsHere.answer, /the groundhog-1/, "the room's cast answers from the same placements the talk verb reads");
    } finally {
      await badger.close();
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

test("a dug object is reachable by the short id it was minted under, not by its bare kind word", async () => {
  await withTempRepo("static-vs-dug-props", async (repo) => {
    await loadMudGardenInto(repo);
    const badger = await openCharacterSession(repo, "badger-2");
    try {
      const takenLettuce = await badger.turn("take the lettuce");
      assert.match(takenLettuce.answer, /you take the lettuce/, "the shipped world's own static prop resolves by its bare lemma");

      // Digging deterministically spawns one object of kind "root", minted as
      // "root-1" — short enough to read in a pouch, and distinct from the
      // world's own props.
      await badger.turn("go west");
      const dug = await badger.turn("dig south");
      assert.match(dug.answer, /In the loose earth: the root-1/, "a spawned object reads as its kind and a number, not a room path");

      const walked = await badger.turn("go south");
      assert.match(walked.answer, /[Nn]ow in the burrow-1-south/);

      const byId = await badger.turn("take the root-1");
      assert.match(byId.answer, /you take the root-1/, "the world declares its own minted ids, so the dug object is addressable");

      const bareNoun = await badger.turn("take the root");
      assert.match(
        bareNoun.answer,
        /isn't something you can take — it's only mentioned in passing here/,
        'the bare kind word still resolves to the lexicon lemma "root", never to any one of the placed instances',
      );
    } finally {
      await badger.close();
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

test("the food-knowledge query resolves the same way with the topic noun leading, before \"do you know about\"", async () => {
  await withTempRepo("food-query-noun-first", async (repo) => {
    const memoryDir = await loadMudGardenInto(repo);
    await recordExamined(memoryDir, { observer: "mole-1", thing: "carrot", k: 1 });

    const mole = await openCharacterSession(repo, "mole-1");
    const vole = await openCharacterSession(repo, "vole-1");
    try {
      // "what food do you know about" reads the same edges as "what do you
      // know about food" — a bare noun leading the sentence must not be
      // mistaken for the closed-set "what <class> do you know" enumeration
      // (which asks what KINDS exist in taught vocabulary, a different
      // question the world has no answer for at all).
      const moleKnows = await mole.turn("what food do you know about");
      assert.match(moleKnows.answer, /you know about: the carrot/, "mole-1 learned about the carrot and reports it back");
      assert.doesNotMatch(moleKnows.answer, /i learned:/, "never the generic ontology fact line for the \"food\" class itself");

      const voleKnows = await vole.turn("what food do you know about");
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
    const badger = await openCharacterSession(repo, "badger-2");
    const groundhog = await openCharacterSession(repo, "groundhog-1");
    try {
      const dug = await badger.turn("dig east");
      assert.match(dug.answer, /you dig east and open up a new room/);

      const groundhogWalked = await groundhog.turn("go east");
      assert.match(groundhogWalked.answer, /you go east/);
      assert.match(
        groundhogWalked.answer,
        /[Nn]ow in the sett-1-east/,
        "groundhog-1's SEPARATE session reads the exit badger-2's session wrote to the shared world state",
      );
    } finally {
      await badger.close();
      await groundhog.close();
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
