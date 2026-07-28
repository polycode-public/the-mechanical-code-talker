// Chat-interface-level proof that the multi-character mud engine works end to
// end: real createSession()/s.turn() sessions, one per acting character,
// driving scripted turns against the shipped mud-garden world — not unit-level
// calls into adventure.mjs's own functions (adventure-mud-threading.test.mjs
// and adventure-mud-knowledge.test.mjs already cover that layer).
//
// Two engine limits surfaced while writing this, both confirmed by running
// real turns rather than assumed from reading the grammar:
//
// - mud-garden's own props (carrot-1, stone-1, basket-1, seed-1) can never be
//   addressed by typed natural language at all, in either "take the carrot"
//   or literal-id "take carrot-1" form. parseImperative resolves a bare noun
//   to its LEXICON lemma ("carrot"), and runWorldCommand matches that lemma
//   against a placement fact by exact subject string — mud-garden places
//   "carrot-1", never "carrot", so the lemma never matches. The literal id
//   form fares no better: "carrot-1" isn't a dictionary word, so the closed
//   lexicon doesn't recognise it as a token at all. The take/eat/put tests
//   below prove the MECHANISM works, using a supplementary bare-word fixture
//   (a second "carrot"/"stone"/"basket" placed alongside the numbered ones,
//   the same naming style ashcombe-hall's props already use), and a separate
//   test pins down the honest decline mud-garden's own numbered props get
//   today.
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

test("taking/eating/putting succeed through real chat turns against a lexicon-resolvable prop", async () => {
  // mud-garden's own carrot-1/stone-1/basket-1 can't be addressed by typed NL
  // at all (see the file-header note and the dedicated decline test below),
  // so this proves the take/eat/put MECHANISM itself works end to end through
  // the real chat interface, using a second, bare-word-named carrot/stone/
  // basket placed alongside the numbered ones — the naming style
  // ashcombe-hall's own props ("lamp", "key") already rely on.
  await withTempRepo("take-eat-put", async (repo) => {
    await loadMudGardenInto(repo, [
      { subject: "carrot", predicate: "rdf:type", object: "food" },
      { subject: "carrot", predicate: "mgx:located-in", object: "garden" },
      { subject: "carrot", predicate: "mgx:hasMass", object: "3" },
      { subject: "stone", predicate: "rdf:type", object: "portable" },
      { subject: "stone", predicate: "mgx:located-in", object: "garden" },
      { subject: "basket", predicate: "rdf:type", object: "furniture" },
      { subject: "basket", predicate: "mgx:fixed-in", object: "garden" },
      { subject: "basket", predicate: "mgx:is-container", object: "true" },
      { subject: "basket", predicate: "mgx:is-open", object: "true" },
    ]);
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

test("mud-garden's own numbered props stay unreachable by typed natural language, in either phrasing", async () => {
  await withTempRepo("numbered-props-decline", async (repo) => {
    await loadMudGardenInto(repo);
    const mole = await openCharacterSession(repo, "mole-1");
    try {
      const bareNoun = await mole.turn("take the carrot");
      assert.match(
        bareNoun.answer,
        /isn't something you can take/,
        "the bare class noun resolves to the lexicon lemma \"carrot\", never the placed \"carrot-1\"",
      );

      const literalId = await mole.turn("take carrot-1");
      assert.equal(
        literalId.answer,
        'I don\'t know the word "carrot-1" — it isn\'t in my vocabulary.',
        "the literal id isn't a dictionary word either, so the closed-set grammar never tokenizes it",
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
    await recordExamined(memoryDir, { observer: "mole-1", thing: "carrot-1", k: 1 });

    const mole = await openCharacterSession(repo, "mole-1");
    const vole = await openCharacterSession(repo, "vole-1");
    try {
      const moleKnows = await mole.turn("what do you know about food");
      assert.match(moleKnows.answer, /you know about: the carrot-1/, "mole-1 learned about carrot-1 and reports it back");

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
