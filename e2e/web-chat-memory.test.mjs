// The web chat's engine-level behavior contract, run as plain ESM under
// Node: createChatSession (the same entry the browser bundle wraps) over the
// REAL built seed. What the embedded chat promises a visitor is asserted
// here without a browser in the loop — grounded vocabulary answers, the
// honest miss, teach + read-back — plus the demo rail's coming capabilities
// as skipped groups that document the expected transcript shape.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createChatSession } from "../src/surfaces/web/chat-browser-entry.mjs";
import { main as buildChatSeed } from "../scripts/build-chat-seed.mjs";
import { DEMOS } from "../public/chat-demos.mjs";

let seedDir;
let seedPayload;

before(async () => {
  seedDir = await mkdtemp(join(tmpdir(), "web-chat-memory-test-"));
  const out = join(seedDir, "chat-seed.json");
  await buildChatSeed(out);
  seedPayload = JSON.parse(await readFile(out, "utf8"));
});

test.after(async () => {
  if (seedDir) await rm(seedDir, { recursive: true, force: true });
});

const seededSession = () => createChatSession({ seedPayload: structuredClone(seedPayload), vocabSeeded: true });
const demoById = (id) => DEMOS.find((d) => d.id === id);

test("a seeded web session answers 'what is a dog' with corpus provenance", async () => {
  const session = seededSession();
  const { answer, record } = await session.turn("what is a dog");
  assert.match(answer, /dog is a kind of/);
  assert.match(answer, /\(source: corpus:/);
  assert.ok(!record?.miss, "a grounded answer never records as a miss");
});

test("an unknown term misses honestly, and the session survives to answer the next turn", async () => {
  const session = seededSession();
  const miss = await session.turn("what is a zorblatt");
  assert.match(miss.answer, /I don't know "zorblatt" yet/);
  assert.equal(miss.record?.miss, true);
  const next = await session.turn("what is a dog");
  assert.match(next.answer, /dog is a kind of/);
});

test("teach + read-back: the syllogist demo's turns hold as an engine contract", async () => {
  const session = seededSession();
  const demo = demoById("syllogist");
  assert.ok(demo?.ready, "the syllogist demo is live");
  const replies = [];
  for (const line of demo.turns) replies.push(await session.turn(line));
  assert.match(replies[0].answer, /^noted — remembered: dog is a kind of mammal/);
  assert.match(replies[1].answer, /^noted — remembered: rex is a kind of dog/);
  assert.match(replies[2].answer, /^yes — /);
  assert.match(replies[2].answer, /so rex is a mammal/);
});

test("sessions never share a store: a fact taught in one is unknown to a fresh one", async () => {
  const first = seededSession();
  await first.turn("every dog is a mammal");
  const second = seededSession();
  const { answer } = await second.turn("is a dog a mammal");
  assert.doesNotMatch(answer, /^yes — /, "the second session never inherits the first session's teaching");
});

test("guess-number: the engine plays the demo's guessing game", async () => {
  const session = seededSession();
  const demo = demoById("guess-number");
  assert.ok(demo?.ready, "the guess-number demo is live");
  let final = null;
  for (const line of demo.turns) final = await session.turn(line);
  assert.match(final.answer, /Got it — your number is 68, found in 4 guesses/, "the pinned secret is found");
});

test("learn-on-miss: a pack term the memory misses is acquired from the reference pack", async () => {
  const session = seededSession();
  const demo = demoById("learn-on-miss");
  assert.ok(demo?.ready, "the learn-on-miss demo is live");
  const { answer, record } = await session.turn(demo.turns[0]);
  assert.ok(!record?.miss, "the pack lookup grounds the term instead of missing");
  assert.match(answer, /\(source: reference article "License", Simple English Wikipedia/, "the answer cites the reference article as its source");
});
