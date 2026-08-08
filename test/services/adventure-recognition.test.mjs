// adventure-recognition: "what am I doing" and "what is <name> doing" — the
// same trace-vs-declared-goal recognizer the router runs, applied to a
// player's or an NPC's own @turnN moves, over a hand-built fixture world
// small enough to construct a recognized, a tied, and a rejected trace on
// purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore, appendFacts, appendRule } from "../../src/adapters/memory/core.mjs";
import { adventureTurn } from "../../src/services/adventure.mjs";

// A - B - C - D in a line, both directions, mirroring
// adventure-autoplay.test.mjs's own line-world fixture shape so a reader who
// knows that one recognizes this one immediately.
const GO_RULES = [
  { name: "go", ruleKind: "action-signature", slots: { subjectClass: "adventurer", targetClass: "room" } },
  { name: "go", ruleKind: "action-signature", slots: { subjectClass: "person", targetClass: "room" } },
  { name: "go", ruleKind: "action-effect", slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" } },
];
const TAKE_RULES = [
  { name: "take", ruleKind: "action-signature", slots: { subjectClass: "portable", targetClass: "adventurer" } },
  { name: "take", ruleKind: "action-effect", slots: { predicate: "located-in", subjectRole: "subject", objectRole: "target" } },
];

async function seedLineWorld(objectives = [], extraFacts = []) {
  const dir = createInMemoryStore();
  const facts = [
    { subject: "player", predicate: "rdf:type", object: "adventurer" },
    { subject: "player", predicate: "mgx:currently-in", object: "a" },
    { subject: "a", predicate: "rdf:type", object: "room" },
    { subject: "b", predicate: "rdf:type", object: "room" },
    { subject: "c", predicate: "rdf:type", object: "room" },
    { subject: "d", predicate: "rdf:type", object: "room" },
    { subject: "a", predicate: "mgx:has-exit-east", object: "b" },
    { subject: "b", predicate: "mgx:has-exit-west", object: "a" },
    { subject: "b", predicate: "mgx:has-exit-east", object: "c" },
    { subject: "c", predicate: "mgx:has-exit-west", object: "b" },
    { subject: "c", predicate: "mgx:has-exit-east", object: "d" },
    { subject: "d", predicate: "mgx:has-exit-west", object: "c" },
    ...extraFacts,
  ];
  for (const { name, room } of objectives) {
    facts.push({ subject: name, predicate: "rdf:type", object: "portable" });
    facts.push({ subject: name, predicate: "mgx:located-in", object: room });
    facts.push({ subject: name, predicate: "mgx:is-objective", object: "true" });
  }
  await appendFacts(dir, facts.map((f) => ({ ...f, provenance: "world:line-world" })));
  for (const rule of [...GO_RULES, ...TAKE_RULES]) {
    await appendRule(dir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: "world:line-world" });
  }
  return dir;
}

const planHolderFor = () => ({ state: { adventure: { world: "line-world" } } });

test("a player whose moves fit one declared route is told which one, with the step count", async () => {
  const dir = await seedLineWorld([{ name: "prize", room: "c" }]);
  const planHolder = planHolderFor();
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  const answer = await adventureTurn("what am I doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.match(answer.text, /you're heading for the prize/);
  assert.match(answer.text, /your last 2 moves are a subsequence of the route/);
});

test("a player whose moves fit two declared routes is told both and never picked for", async () => {
  const dir = await seedLineWorld([{ name: "nearby", room: "b" }, { name: "faraway", room: "c" }]);
  const planHolder = planHolderFor();
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  const answer = await adventureTurn("what am I doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.match(answer.text, /fits 2 goals equally well/);
  assert.match(answer.text, /carry the nearby/);
  assert.match(answer.text, /carry the faraway/);
});

test("a player whose moves fit nothing is told so, and pointed at what the world does declare", async () => {
  const dir = await seedLineWorld([{ name: "prize", room: "c" }]);
  const planHolder = planHolderFor();
  // Three hops overshoots the two-hop route to the prize's room — the third
  // "currently-in" step has nowhere left in the plan to land.
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  const answer = await adventureTurn("what am I doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.match(answer.text, /nothing you've done so far fits any of the \d+ goals this world declares/);
  assert.match(answer.text, /what is my goal/);
});

test("asking before any move says nothing has been done yet", async () => {
  const dir = await seedLineWorld([{ name: "prize", room: "c" }]);
  const planHolder = planHolderFor();
  const answer = await adventureTurn("what am I doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.match(answer.text, /haven't done anything yet/);
});

test("the declared-goal question and the recognition question give different answers when they differ", async () => {
  const dir = await seedLineWorld([{ name: "prize", room: "c" }]);
  const planHolder = planHolderFor();
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  await adventureTurn("go east", { planHolder, memoryDir: dir, actingSubject: "player" });
  const quest = await adventureTurn("what is my goal", { planHolder, memoryDir: dir, actingSubject: "player" });
  const recognized = await adventureTurn("what am I doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.notEqual(quest.text, recognized.text);
  assert.match(quest.text, /your goal is to find the prize/);
  assert.match(recognized.text, /you're heading for the prize/);
});

test("an NPC's own scheduled moves recognize through the same path a player's do", async () => {
  const dir = await seedLineWorld(
    [{ name: "prize", room: "c" }],
    [
      { subject: "helper", predicate: "rdf:type", object: "person" },
      { subject: "helper", predicate: "mgx:currently-in", object: "a" },
      // A hand-written @turnN row — a scheduled NPC move writes exactly this
      // shape, whether or not the player's own commands ever touch "helper".
      { subject: "helper@turn1", predicate: "mgx:currently-in", object: "b" },
    ],
  );
  const planHolder = planHolderFor();
  const answer = await adventureTurn("what is the helper doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.match(answer.text, /the helper is heading for the prize/);
  assert.match(answer.text, /the last 1 moves it made are a subsequence of the route/);
});

test("asking about a character this world does not name declines by that name", async () => {
  const dir = await seedLineWorld([{ name: "prize", room: "c" }]);
  const planHolder = planHolderFor();
  const answer = await adventureTurn("what is the wizard doing", { planHolder, memoryDir: dir, actingSubject: "player" });
  assert.equal(answer.text, 'there\'s nobody called "wizard" in this world.');
});
