// The count surface of a possession fact ("how many legs does a dog have"),
// the modal surface of a property question ("can a pig be alive"), the
// inverted vocabulary question ("a dog is what"), and the miss hint that names
// the subject the failed question read. Each lane's guards live here: what
// makes it decline, and what it must leave alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn, vocabExampleHint } from "../../src/services/chat.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-count-modal-lanes-"));
}

async function say(dir, line, extra = {}) {
  const { answer } = await runTurn(line, { memoryDir: dir, sessionId: "lanes", ...extra });
  return answer;
}

test("a count ask reads the quantity off a taught have fact, in digits or in words", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "a dog has 4 legs");
    await say(dir, "a human has two eyes");
    const legs = await say(dir, "how many legs does a dog have");
    assert.match(legs, /^4 — /);
    assert.match(legs, /dog has 4 legs/);
    const eyes = await say(dir, "how many eyes does a human have");
    assert.match(eyes, /^2 — /, "a number word answers with the count it names");
    assert.match(eyes, /human has two eyes/, "the fact is cited as it was taught");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a count ask reads the plural sibling of the same question", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "a dog has 4 legs");
    assert.match(await say(dir, "how many legs do dogs have"), /^4 — /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a count ask over a possession fact carrying no quantity never invents one", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "a dog has a tail");
    const answer = await say(dir, "how many tails does a dog have");
    assert.doesNotMatch(answer, /^\d+ — /, "an unquantified fact answers no count");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a count ask with nothing stored behind it misses, and names the subject it read", async () => {
  const dir = await tmpRepo();
  try {
    const answer = await say(dir, "how many eyes does a human have", { vocabHint: vocabExampleHint(true) });
    assert.match(answer, /what is a human/, "the recovery example names the question's own subject");
    assert.doesNotMatch(answer, /^\d+ — /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a miss whose question named no term the lexicon knows keeps the stock recovery example", async () => {
  const dir = await tmpRepo();
  try {
    const answer = await say(dir, "how many zorbnax does a quibblewick have", { vocabHint: vocabExampleHint(true) });
    assert.match(answer, /what is a dog/, "an unreadable subject leaves the session's own example alone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an inverted vocabulary question reaches the same answer as the plain one", async () => {
  const dir = await tmpRepo();
  try {
    const plain = await say(dir, "what is a dog");
    assert.match(plain, /canine/);
    assert.equal(await say(dir, "a dog is what"), plain);
    assert.equal(await say(dir, "a dog is what?"), plain, "the question mark is optional");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an inverted question with a pronoun subject is left for the conversational lanes", async () => {
  const dir = await tmpRepo();
  try {
    const answer = await say(dir, "that is what");
    assert.doesNotMatch(answer, /nothing under "that"/, "a demonstrative is not a term to look up");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an adjective-qualified subject the store cannot ground answers for its head noun and says so", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "what is a dog");
    const answer = await say(dir, "a female dog is what");
    assert.match(answer, /nothing under "female dog"/, "the adjective is never silently dropped");
    assert.match(answer, /know about a dog/);
    assert.match(answer, /canine/, "the head noun's own answer follows");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a modal property ask reaches the fact the plain property ask reads", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "animals are alive");
    for (const question of ["can animals be alive", "could an animal be alive"]) {
      const answer = await say(dir, question);
      assert.match(answer, /^yes — /, question);
      assert.match(answer, /animal is alive/, question);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a modal property ask reaches a taught capability fact through one subclass hop", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "animals can be alive");
    await say(dir, "a pig is an animal");
    const answer = await say(dir, "can a pig be alive");
    assert.match(answer, /^yes — /);
    assert.match(answer, /pig is a kind of animal/, "the membership is cited");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a modal property ask with nothing behind it stays an honest miss", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "animals are alive");
    const answer = await say(dir, "can a pig be purple");
    assert.doesNotMatch(answer, /^yes — /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a property taught on a parent class answers the plain ask about a member, citing both facts", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "animals are alive");
    await say(dir, "a pig is an animal");
    const answer = await say(dir, "are pigs alive");
    assert.match(answer, /^yes — /);
    assert.match(answer, /pig is a kind of animal/);
    assert.match(answer, /animal is alive/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("membership of an unrelated class licenses no property, and the ask stays a refusal", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "animals are alive");
    await say(dir, "a pig is an animal");
    const answer = await say(dir, "are cows alive");
    assert.doesNotMatch(answer, /^yes — /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a class-level existential restriction reaches an individual through its type assertion", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "every argyle has a receptacle");
    await say(dir, "e150.mjs is a argyle");
    const answer = await say(dir, "does e150.mjs have a receptacle");
    assert.match(answer, /^yes — /);
    assert.match(answer, /e150\.mjs is an argyle/, "the type assertion is cited");
    assert.match(answer, /argyle is a kind of some-has-receptacle/, "so is the restriction it reaches");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an individual typed into an unrelated class inherits no restriction", async () => {
  const dir = await tmpRepo();
  try {
    await say(dir, "every argyle has a receptacle");
    await say(dir, "e152.mjs is a brooding");
    assert.doesNotMatch(await say(dir, "does e152.mjs have a receptacle"), /^yes — /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
