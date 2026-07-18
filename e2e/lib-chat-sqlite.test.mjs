// The library surface over the sqlite backend: import the public entry
// (src/services/index.mjs), open a session on Backend C, and run the three
// capability flows — teach + read-back, the scripted guessing game, and
// learn-on-miss over the real shipped reference pack. Then prove persistence
// the only way that counts: close the session, reopen the same repo on the
// same backend, and read the taught and reference facts back out of the
// sqlite file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSession } from "../src/services/index.mjs";

test("a library sqlite session teaches, plays, learns from the pack, and holds it all across a reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-lib-sqlite-"));
  const opts = { repoPath: dir, memoryBackend: "sqlite", env: { TMCT_NO_SEED: "1", TMCT_GAME_SECRET: "42" } };
  try {
    const first = await createSession(opts);
    try {
      // flow 1 — teach + read-back through the library entry
      const taught = await first.turn("every dog is a mammal");
      assert.match(taught.answer, /dog is a kind of mammal/);
      const readBack = await first.turn("is a dog a mammal");
      assert.match(readBack.answer, /^yes — /);

      // flow 2 — the scripted thinker game over the seeded secret
      const opening = await first.turn("think of a number between 1 and 100");
      assert.match(opening.answer, /I've thought of a number between 1 and 100/);
      assert.match((await first.turn("50")).answer, /^lower — guess again\./);
      assert.match((await first.turn("25")).answer, /^higher — guess again\./);
      assert.match((await first.turn("42")).answer, /Correct — you got it in 3 guesses! The number was 42\./);

      // flow 3 — learn-on-miss over the real shipped pack
      const learned = await first.turn("what is an otter");
      assert.equal(learned.record.miss, false);
      assert.match(learned.answer, /\(source: reference article "Otter", Simple English Wikipedia, CC BY-SA 4\.0/);
    } finally {
      await first.close();
    }

    await access(join(dir, ".tmct", "memory", "graph.sqlite"));

    const reopened = await createSession(opts);
    try {
      const dog = await reopened.turn("is a dog a mammal");
      assert.match(dog.answer, /^yes — /, "the taught fact survived the reopen in sqlite");
      const otter = await reopened.turn("what is an otter");
      assert.equal(otter.record.via, "fact", "the reference fact answers from the store, not the pack");
      assert.match(otter.answer, /otter is a kind of animal/);
      assert.match(otter.answer, /source: reference:simplewiki:Otter@\d+/, "the reopened answer cites the reference provenance");
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
