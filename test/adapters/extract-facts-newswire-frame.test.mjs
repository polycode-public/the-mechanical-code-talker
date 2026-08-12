// The optimistic tier's newswire event frame: a closed band of transitive
// event verbs read in a tighter frame than the lexicon arm's. What these pin
// is the frame's bounds — what it admits, and every shape it turns down —
// because a news report's own prose is the only text in the product that
// reaches this arm, and a wrong read there becomes a feed card.
import { test } from "node:test";
import assert from "node:assert/strict";

import { optimisticTriples } from "../../src/services/extract-facts.mjs";

const triplesOf = (sentence) =>
  optimisticTriples(sentence).map((t) => `${t.subject} ${t.predicate} ${t.object}`);

test("an event verb the lexicon never declared mints its relation from a past-tense report", () => {
  assert.deepEqual(
    triplesOf("The government adopted a law that might prove a significant step toward peace."),
    ["government mgx:adopt law"],
  );
  assert.deepEqual(
    triplesOf("Nigel Farage forced a new election in his parliamentary seat."),
    ["nigel farage mgx:force election"],
  );
});

test("a modal chain is one verb complex: the subject is read from left of the whole chain", () => {
  assert.deepEqual(
    triplesOf("From Iceland to Spain, people have flocked to places where the moon will completely block the sun."),
    ["moon mgx:block sun"],
  );
});

test("a passive states who it happened to, so the actor takes the subject side and never the patient", () => {
  assert.deepEqual(
    triplesOf("Roberto Mosquera was arrested by ICE last year."),
    ["ice mgx:arrest roberto mosquera"],
  );
  // A reduced passive carries no auxiliary at all, so the "by" is the whole
  // tell — the headline shape a feed reads most often.
  assert.deepEqual(
    triplesOf("Ecuadorean Fishing Boats Hit by Mystery Attackers"),
    ["mystery attackers mgx:hit ecuadorean fishing boat"],
  );
});

test("a headline that names its subject and then interrupts itself still reaches that subject", () => {
  assert.deepEqual(
    triplesOf("Ex-Marine Robert Gilman, Freed by Russia After 4 Years in Prison, Arrives in the U.S."),
    ["russia mgx:free robert gilman"],
  );
});

test("an agentless passive names no actor, so it states the subject's own condition instead", () => {
  assert.deepEqual(
    triplesOf("Yabloko, the Russian antiwar party, is banned from parliament elections."),
    ["yabloko mgx:banned-from parliament election"],
  );
  assert.deepEqual(
    triplesOf("The stowaway was deported to Ecuador."),
    ["stowaway mgx:deported-to ecuador"],
  );
});

test("a passive complement that names no place a fact can hold stays an honest miss", () => {
  assert.deepEqual(triplesOf("A group of Cuban men in Mexico was charged with smuggling people."), []);
  assert.deepEqual(triplesOf("Robert Gilman was released."), []);
});

test("a progressive is not an event that happened: the be-form auxiliary declines it", () => {
  assert.deepEqual(triplesOf("The Yemeni ship was carrying food supplies to a port."), []);
  assert.deepEqual(triplesOf("The insects are disappearing for many reasons."), []);
});

test("neither endpoint crosses a preposition or a conjunction into the next clause", () => {
  assert.deepEqual(triplesOf("The British scholar resigned from Cambridge after the university began investigating him."), []);
  assert.deepEqual(triplesOf("The rebels attacked at dawn."), []);
});

test("a counting of-chain reads through to what the event touched; any other of-chain keeps its own head", () => {
  assert.deepEqual(
    triplesOf("An Italian diver discovers hundreds of ancient amphorae in Sicily."),
    ["italian diver mgx:discover amphorae"],
  );
  assert.deepEqual(
    triplesOf("A quest will restore the sacred glow of fireflies."),
    ["quest mgx:restore glow"],
  );
});

test("a relative clause has no subject of its own here, so its event verb is declined", () => {
  assert.deepEqual(
    triplesOf("The quake, which killed more than 100 people, damaged hundreds of buildings."),
    [],
  );
});

test("a subject scan reads through a bare appositive but never through a relative clause", () => {
  assert.deepEqual(
    triplesOf("Ecuador, the smallest OPEC member, halted the fishing fleet."),
    ["ecuador mgx:halt fishing fleet"],
  );
  assert.deepEqual(
    triplesOf("The government, which had promised reform, halted the fishing fleet."),
    [],
  );
});

test("verbs of speech and attribution stay out of the band: the noun after one opens a clause", () => {
  assert.deepEqual(triplesOf("The Yemeni government said the ship carried food supplies."), []);
  assert.deepEqual(triplesOf("Experts claimed the region has a complicated history."), []);
});

test("a lemma the lexicon declares keeps the lexicon's own predicate across tenses", () => {
  assert.deepEqual(
    triplesOf("Russia released Robert Gilman on a humanitarian basis."),
    ["russia tmct:releases robert gilman"],
  );
});

test("a sentence-final full stop never enters a stored term; an abbreviation keeps its own stops", () => {
  const [fact] = optimisticTriples("The moon will completely block the sun.");
  assert.equal(fact.object, "sun");
  assert.deepEqual(
    triplesOf("The storm damaged the U.S."),
    ["storm mgx:damage u.s."],
  );
});

test("a Title Case headline reads its verb off the closed band, not off the tagger", () => {
  assert.deepEqual(
    triplesOf("Thailand Halts New Gun Permits After Mass Shooting at a School"),
    ["thailand mgx:halt new gun permit"],
  );
  assert.deepEqual(
    triplesOf("A Bright Spot in Colombia as Rescuers Free Quake Victim"),
    ["rescuers mgx:free quake victim"],
  );
});

test("a headline verb the band never declared leaves the headline an honest miss", () => {
  assert.deepEqual(triplesOf("Prime Minister Keir Starmer Faces a Vote"), []);
  assert.deepEqual(triplesOf("How Nigel Farage Ended Up Running Against Count Binface in Clacton"), []);
});

test("a headline never reads its own first word as the event, so a name the band also spells stays a name", () => {
  assert.deepEqual(
    triplesOf("Bar Refaeli Halts a Modeling Contract in Israel"),
    ["bar refaeli mgx:halt modeling contract"],
  );
});

test("the frame adds nothing to prose that named no event", () => {
  for (const sentence of [
    "The quick brown fox jumps over something vague.",
    "Hello there.",
    "But not without the right glasses.",
    "Here is the latest.",
  ]) {
    assert.deepEqual(triplesOf(sentence), [], `still abstains: ${sentence}`);
  }
});
