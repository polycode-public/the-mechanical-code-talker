import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKLIST_RE, WORD_DENYLIST, STOP_SET, MAX_SENSE_RANK,
  defOf, declaredWords, makeAncestorRootCheck, senseRank, collectCandidates,
  resolveSynset, looksLikeCommonTerm, nextHop, meronymFact, rankCandidates,
  buildClump, stripDenylisted,
} from "../../src/domain/persona/tiers.mjs";

// These rules read in-memory maps, so every fixture below is a literal. No
// WordNet clone is touched, which is why they can run anywhere.

/** A synset map from [id, {members, definition, hypernym, ...}] pairs. */
const synsetsOf = (pairs) => new Map(pairs);

/** An entries index: word -> {senses: {n: [{synset}]}, total}. */
function entriesOf(spec) {
  const idx = new Map();
  for (const [word, { n = [], total }] of Object.entries(spec)) {
    idx.set(word, { senses: { n: n.map((synset) => ({ synset })) }, total: total ?? n.length });
  }
  return idx;
}

test("defOf: an array definition takes its first line, a string passes through, absent is ''", () => {
  assert.equal(defOf({ definition: ["first", "second"] }), "first");
  assert.equal(defOf({ definition: "only" }), "only");
  assert.equal(defOf({}), "");
  assert.equal(defOf(undefined), "");
});

test("BLOCKLIST_RE: matches an obscurity tag anywhere in a definition, case-insensitively", () => {
  assert.ok(BLOCKLIST_RE.test("an ARCHAIC term for a horse"));
  assert.ok(BLOCKLIST_RE.test("a mythical creature"));
  assert.ok(BLOCKLIST_RE.test("a monoclonal antibody used to treat arthritis"));
  assert.equal(BLOCKLIST_RE.test("a domesticated carnivorous mammal"), false);
});

test("BLOCKLIST_RE: word-bounded — 'slanginess' does not trip the 'slang' tag", () => {
  assert.equal(BLOCKLIST_RE.test("a study of slanginess"), false);
  assert.ok(BLOCKLIST_RE.test("slang for money"));
});

test("looksLikeCommonTerm: rejects a term with any token over 15 chars, keeps real multi-word terms", () => {
  assert.ok(looksLikeCommonTerm("medium of exchange"));
  assert.ok(looksLikeCommonTerm("dog"));
  assert.equal(looksLikeCommonTerm("methylenedioxymethamphetamine"), false);
  assert.ok(looksLikeCommonTerm("infliximab")); // 10 chars — the filter is shape, not vocabulary
});

test("senseRank: 0-based index of the synset among the word's noun senses, -1 when the word is unknown", () => {
  const idx = entriesOf({ dog: { n: ["s1", "s2", "s3"] } });
  assert.equal(senseRank("dog", "s1", idx), 0);
  assert.equal(senseRank("dog", "s3", idx), 2);
  assert.equal(senseRank("dog", "nope", idx), -1);
  assert.equal(senseRank("unknown", "s1", idx), -1);
});

// ---- rankCandidates: the determinism claim its own comment makes ------------

test("rankCandidates: orders by sense-count descending", () => {
  const idx = entriesOf({ a: { n: [], total: 1 }, b: { n: [], total: 9 }, c: { n: [], total: 5 } });
  assert.deepEqual(rankCandidates(["a", "b", "c"], idx), ["b", "c", "a"]);
});

test("rankCandidates: ties on sense-count break to the shorter word", () => {
  const idx = entriesOf({ elephant: { n: [], total: 3 }, cat: { n: [], total: 3 } });
  assert.deepEqual(rankCandidates(["elephant", "cat"], idx), ["cat", "elephant"]);
});

test("rankCandidates: ties on sense-count AND length break alphabetically", () => {
  const idx = entriesOf({ dog: { n: [], total: 3 }, cat: { n: [], total: 3 }, bat: { n: [], total: 3 } });
  assert.deepEqual(rankCandidates(["dog", "cat", "bat"], idx), ["bat", "cat", "dog"]);
});

test("rankCandidates: a word absent from the entries index scores 0, not NaN, and sorts last", () => {
  const idx = entriesOf({ known: { n: [], total: 2 } });
  assert.deepEqual(rankCandidates(["ghost", "known"], idx), ["known", "ghost"]);
});

test("rankCandidates: same inputs -> same output, as its comment claims (no Math.random)", () => {
  // The determinism claim was documented and unasserted. Ranking a set whose
  // every tier of the comparator is exercised — equal scores, equal lengths,
  // differing scores — must give one fixed answer however the input is ordered.
  const idx = entriesOf({
    run: { n: [], total: 16 }, light: { n: [], total: 16 }, cat: { n: [], total: 3 },
    dog: { n: [], total: 3 }, bat: { n: [], total: 3 }, elephant: { n: [], total: 1 },
    zebra: { n: [], total: 1 }, ox: { n: [], total: 1 },
  });
  const words = ["run", "light", "cat", "dog", "bat", "elephant", "zebra", "ox"];
  const expected = ["run", "light", "bat", "cat", "dog", "ox", "zebra", "elephant"];

  assert.deepEqual(rankCandidates(words, idx), expected);
  // Re-running is stable.
  for (let i = 0; i < 5; i += 1) assert.deepEqual(rankCandidates(words, idx), expected);
  // And it is a total order: input permutation cannot change the answer.
  assert.deepEqual(rankCandidates([...words].reverse(), idx), expected);
  assert.deepEqual(rankCandidates(["ox", "run", "elephant", "bat", "zebra", "dog", "light", "cat"], idx), expected);
});

test("rankCandidates: accepts a Map's keys iterator, as buildClump hands it", () => {
  const idx = entriesOf({ a: { n: [], total: 1 }, b: { n: [], total: 2 } });
  assert.deepEqual(rankCandidates(new Map([["a", "s1"], ["b", "s2"]]).keys(), idx), ["b", "a"]);
});

// ---- collectCandidates -------------------------------------------------------

const DOG_SYNSETS = [
  ["s-dog", { members: ["dog", "domestic_dog"], definition: ["a domesticated carnivorous mammal"] }],
];

test("collectCandidates: takes a clean top-sense member and records the synset it was found under", () => {
  const idx = entriesOf({ dog: { n: ["s-dog"] } });
  assert.deepEqual([...collectCandidates(DOG_SYNSETS, new Set(), idx)], [["dog", "s-dog"]]);
});

test("collectCandidates: skips a synset whose definition trips the obscurity blocklist", () => {
  const synsets = [["s-x", { members: ["wyvern"], definition: ["a mythical winged creature"] }]];
  assert.equal(collectCandidates(synsets, new Set(), entriesOf({ wyvern: { n: ["s-x"] } })).size, 0);
});

test("collectCandidates: skips a word ranked below the top-3 senses", () => {
  const idx = entriesOf({ light: { n: ["s-a", "s-b", "s-c", "s-light"] } }); // rank 3
  const synsets = [["s-light", { members: ["light"], definition: ["a friend"] }]];
  assert.equal(collectCandidates(synsets, new Set(), idx).size, 0);
  assert.equal(MAX_SENSE_RANK, 2);
});

test("collectCandidates: skips multi-word and non-alphabetic members", () => {
  const synsets = [["s1", { members: ["hash_table", "M-1", "table"], definition: ["a thing"] }]];
  const idx = entriesOf({ table: { n: ["s1"] }, hash_table: { n: ["s1"] } });
  assert.deepEqual([...collectCandidates(synsets, new Set(), idx).keys()], ["table"]);
});

test("collectCandidates: takes at most 2 qualifying members from one synset", () => {
  const synsets = [["s1", { members: ["one", "two", "three"], definition: ["a thing"] }]];
  const idx = entriesOf({ one: { n: ["s1"] }, two: { n: ["s1"] }, three: { n: ["s1"] } });
  assert.deepEqual([...collectCandidates(synsets, new Set(), idx).keys()], ["one", "two"]);
});

test("collectCandidates: skips a word on the explicit denylist even when its definition is clean", () => {
  const synsets = [["s-john", { members: ["john"], definition: ["a room equipped with toilet facilities"] }]];
  assert.equal(collectCandidates(synsets, new Set(), entriesOf({ john: { n: ["s-john"] } })).size, 0);
  assert.ok(WORD_DENYLIST.has("john"));
});

// The bug the WORD_DENYLIST comment records: these are code-graph class and
// individual names in the shared test fixture that double as ordinary WordNet
// words. Letting them in silently broke the suite, and the fix was the
// denylist rather than editing the fixture many other tests depend on.
for (const word of ["base", "button", "register", "store"]) {
  test(`documented bug: the test-fixture collision "${word}" never becomes a candidate`, () => {
    const synsets = [[`s-${word}`, { members: [word], definition: ["an ordinary everyday thing"] }]];
    const idx = entriesOf({ [word]: { n: [`s-${word}`] } });
    assert.equal(collectCandidates(synsets, new Set(), idx).size, 0, `${word} must stay out of the candidate pool`);
  });
}

// ---- declaredWords: the "male" bug -------------------------------------------

const LEX = {
  nouns: { dog: {}, cook: {} },
  verbs: { cook: {}, love: {} },
  adjectives: { male: {}, red: {} },
};

test("declaredWords: collects nouns, verbs AND adjectives, lowercased", () => {
  assert.deepEqual(declaredWords(LEX), new Set(["dog", "cook", "love", "male", "red"]));
});

test("declaredWords: folds in the previous tier's nouns too", () => {
  assert.ok(declaredWords(LEX, ["Horse", "cart"]).has("horse"));
  assert.ok(declaredWords(LEX, ["Horse", "cart"]).has("cart"));
});

test("documented bug: 'male' is already an adjective, so it never becomes a noun candidate", () => {
  // The first pass added "male" as a noun — WordNet legitimately has that
  // sense — which made ACE read "ahab is male" as class-membership rather than
  // a property fact, silently breaking every filter-rule test built on "who is
  // male". Caught only by running the full suite. The guard is that
  // declaredWords spans all three parts of speech, not just nouns.
  const usedWords = declaredWords(LEX);
  const synsets = [["s-male", { members: ["male"], definition: ["an animal that produces gametes"] }]];
  const idx = entriesOf({ male: { n: ["s-male"] } });
  assert.equal(collectCandidates(synsets, usedWords, idx).size, 0);

  // And the counterfactual: a nouns-only usedWords set is exactly what let it
  // through, so this test would fail against the buggy version.
  const nounsOnly = new Set(Object.keys(LEX.nouns));
  assert.deepEqual([...collectCandidates(synsets, nounsOnly, idx).keys()], ["male"]);
});

test("a word already declared as a verb likewise never becomes a new noun", () => {
  const synsets = [["s-love", { members: ["love"], definition: ["a strong positive emotion"] }]];
  assert.equal(collectCandidates(synsets, declaredWords(LEX), entriesOf({ love: { n: ["s-love"] } })).size, 0);
});

// ---- resolveSynset / nextHop / meronymFact -----------------------------------

test("resolveSynset: resolves to the synset it was DISCOVERED under, not the word's global sense-1", () => {
  const map = synsetsOf([["s-group-run", { members: ["run"], definition: ["a group of fish"] }]]);
  assert.deepEqual(resolveSynset("run", "s-group-run", map), {
    synsetId: "s-group-run",
    synset: map.get("s-group-run"),
  });
  assert.equal(resolveSynset("run", "s-missing", map), null);
});

const CHAIN = synsetsOf([
  ["s-surgeon", { members: ["surgeon"], definition: ["a physician who operates"], hypernym: ["s-doctor"] }],
  ["s-doctor", { members: ["doctor"], definition: ["a licensed medical practitioner"], hypernym: ["s-person"] }],
  ["s-person", { members: ["person"], definition: ["a human being"] }],
]);

test("nextHop: one real hypernym hop, with the synset to continue from", () => {
  assert.deepEqual(nextHop("surgeon", "s-surgeon", CHAIN), {
    fact: ["surgeon", "/r/IsA", "doctor"],
    nextSynsetId: "s-doctor",
    nextTerm: "doctor",
  });
});

test("nextHop: null at a dead end (no hypernym)", () => {
  assert.equal(nextHop("person", "s-person", CHAIN), null);
});

test("nextHop: humanizes an underscored hypernym term to spaces, lowercased", () => {
  const map = synsetsOf([
    ["s-a", { members: ["surgeon"], definition: ["x"], hypernym: ["s-b"] }],
    ["s-b", { members: ["Medical_Professional"], definition: ["y"] }],
  ]);
  assert.deepEqual(nextHop("surgeon", "s-a", map).fact, ["surgeon", "/r/IsA", "medical professional"]);
});

test("nextHop: refuses to walk INTO a blocklisted ancestor, even from a clean word", () => {
  const map = synsetsOf([
    ["s-a", { members: ["griffin"], definition: ["a clean-looking definition"], hypernym: ["s-b"] }],
    ["s-b", { members: ["monster"], definition: ["a mythical creature"] }],
  ]);
  assert.equal(nextHop("griffin", "s-a", map), null);
});

test("nextHop: refuses a hypernym term that is too long a token to be a common term", () => {
  const map = synsetsOf([
    ["s-a", { members: ["drug"], definition: ["a substance"], hypernym: ["s-b"] }],
    ["s-b", { members: ["methylenedioxymethamphetamine"], definition: ["a compound"] }],
  ]);
  assert.equal(nextHop("drug", "s-a", map), null);
});

test("nextHop: refuses a self-referential hop (hypernym term equals the subject)", () => {
  const map = synsetsOf([
    ["s-a", { members: ["dog"], definition: ["x"], hypernym: ["s-b"] }],
    ["s-b", { members: ["dog"], definition: ["y"] }],
  ]);
  assert.equal(nextHop("dog", "s-a", map), null);
});

test("meronymFact: prefers mero_part, and emits HasA", () => {
  const map = synsetsOf([["s-wheel", { members: ["wheel"], definition: ["a circular component"] }]]);
  const car = { mero_part: ["s-wheel"] };
  assert.deepEqual(meronymFact("car", car, map), ["car", "/r/HasA", "wheel"]);
});

test("meronymFact: falls back mero_part > mero_member > mero_substance, MadeOf for substance", () => {
  const map = synsetsOf([
    ["s-player", { members: ["player"], definition: ["a participant"] }],
    ["s-steel", { members: ["steel"], definition: ["an alloy"] }],
  ]);
  assert.deepEqual(meronymFact("team", { mero_member: ["s-player"] }, map), ["team", "/r/HasA", "player"]);
  assert.deepEqual(meronymFact("bridge", { mero_substance: ["s-steel"] }, map), ["bridge", "/r/MadeOf", "steel"]);
  // mero_part wins when both are present.
  assert.deepEqual(
    meronymFact("thing", { mero_substance: ["s-steel"], mero_part: ["s-player"] }, map),
    ["thing", "/r/HasA", "player"],
  );
});

test("meronymFact: null when the synset declares no meronym at all", () => {
  assert.equal(meronymFact("idea", {}, synsetsOf([])), null);
});

test("meronymFact: refuses a blocklisted meronym target", () => {
  const map = synsetsOf([["s-x", { members: ["organ"], definition: ["an obscene term for a body part"] }]]);
  assert.equal(meronymFact("body", { mero_part: ["s-x"] }, map), null);
});

// ---- makeAncestorRootCheck ---------------------------------------------------

const BUILDINGS = synsetsOf([
  ["s-church", { members: ["church"], hypernym: ["s-building"] }],
  ["s-building", { members: ["building", "edifice"], hypernym: ["s-structure"] }],
  ["s-structure", { members: ["structure"] }],
  ["s-hammer", { members: ["hammer"], hypernym: ["s-tool"] }],
  ["s-tool", { members: ["tool"] }],
]);

test("makeAncestorRootCheck: true for a synset under the root, false for one outside it", () => {
  const isUnder = makeAncestorRootCheck(BUILDINGS, new Set(["structure", "building"]));
  assert.equal(isUnder("s-church"), true);
  assert.equal(isUnder("s-building"), true);
  assert.equal(isUnder("s-hammer"), false);
  assert.equal(isUnder("s-tool"), false);
});

test("makeAncestorRootCheck: an unknown or absent id is false, not a throw", () => {
  const isUnder = makeAncestorRootCheck(BUILDINGS, new Set(["structure"]));
  assert.equal(isUnder("s-nope"), false);
  assert.equal(isUnder(null), false);
});

test("makeAncestorRootCheck: gives up past 8 hops rather than walking forever", () => {
  const long = new Map();
  for (let i = 0; i < 20; i += 1) long.set(`s${i}`, { members: [`w${i}`], hypernym: [`s${i + 1}`] });
  long.set("s20", { members: ["root"] });
  assert.equal(makeAncestorRootCheck(long, new Set(["root"]))("s0"), false);
  assert.equal(makeAncestorRootCheck(long, new Set(["root"]))("s13"), true);
});

test("makeAncestorRootCheck: a hypernym cycle terminates instead of overflowing the stack", () => {
  const cyclic = synsetsOf([
    ["s-a", { members: ["a"], hypernym: ["s-b"] }],
    ["s-b", { members: ["b"], hypernym: ["s-a"] }],
  ]);
  assert.equal(makeAncestorRootCheck(cyclic, new Set(["root"]))("s-a"), false);
});

// ---- buildClump --------------------------------------------------------------

test("buildClump: walks a real multi-hop chain and stops at a STOP_SET root", () => {
  const seen = new Set();
  const out = buildClump(
    "human-core", new Map([["surgeon", "s-surgeon"]]),
    entriesOf({ surgeon: { n: [], total: 1 } }), CHAIN, 100, new Set(), seen, { maxHops: 4 },
  );
  assert.deepEqual(out.facts, [["surgeon", "/r/IsA", "doctor"], ["doctor", "/r/IsA", "person"]]);
  assert.deepEqual(out.newNouns, ["surgeon"]);
  assert.ok(STOP_SET.has("person"));
});

test("buildClump: maxHops 1 keeps the chain flat, as the Medium tier wants", () => {
  const out = buildClump(
    "human-core", new Map([["surgeon", "s-surgeon"]]),
    entriesOf({ surgeon: { n: [], total: 1 } }), CHAIN, 100, new Set(), new Set(), { maxHops: 1 },
  );
  assert.deepEqual(out.facts, [["surgeon", "/r/IsA", "doctor"]]);
});

test("buildClump: a fact already in seenTriples is not re-emitted", () => {
  const seen = new Set(["surgeon|/r/IsA|doctor"]);
  const out = buildClump(
    "human-core", new Map([["surgeon", "s-surgeon"]]),
    entriesOf({ surgeon: { n: [], total: 1 } }), CHAIN, 100, new Set(), seen, { maxHops: 1 },
  );
  assert.deepEqual(out.facts, []);
  assert.deepEqual(out.newNouns, [], "a word whose every fact was already present adds no noun");
});

test("buildClump: stops at the fact target and reports requested/got", () => {
  const out = buildClump(
    "human-core", new Map([["surgeon", "s-surgeon"]]),
    entriesOf({ surgeon: { n: [], total: 1 } }), CHAIN, 1, new Set(), new Set(), { maxHops: 4 },
  );
  assert.equal(out.requested, 1);
  assert.equal(out.got, out.facts.length);
  assert.equal(out.clumpId, "human-core");
});

test("buildClump: adds each selected word to usedWords, so a later tier cannot reselect it", () => {
  const used = new Set();
  buildClump(
    "human-core", new Map([["surgeon", "s-surgeon"]]),
    entriesOf({ surgeon: { n: [], total: 1 } }), CHAIN, 100, used, new Set(), { maxHops: 1 },
  );
  assert.ok(used.has("surgeon"));
});

// ---- stripDenylisted ---------------------------------------------------------
// Lifted out of main()'s closure, where it could not be tested at all.

test("stripDenylisted: drops a fact whose OBJECT is a denylisted word reached as a hypernym target", () => {
  const out = stripDenylisted({
    facts: [["man", "/r/IsA", "person"], ["customer", "/r/IsA", "john"]],
    newNouns: ["man", "customer"], clumpId: "human-core", requested: 2, got: 2,
  });
  assert.deepEqual(out.facts, [["man", "/r/IsA", "person"]]);
  assert.deepEqual(out.newNouns, ["man"], "the orphaned noun is pruned with its only fact");
  assert.equal(out.got, 1);
});

test("stripDenylisted: drops a fact whose SUBJECT is denylisted", () => {
  const out = stripDenylisted({
    facts: [["john", "/r/IsA", "man"]], newNouns: ["john"], clumpId: "c", requested: 1, got: 1,
  });
  assert.deepEqual(out.facts, []);
  assert.deepEqual(out.newNouns, []);
});

test("stripDenylisted: a denylisted TOKEN inside a multi-word term drops the fact", () => {
  const out = stripDenylisted({
    facts: [["thing", "/r/IsA", "general store"]], newNouns: ["thing"], clumpId: "c", requested: 1, got: 1,
  });
  assert.deepEqual(out.facts, []);
});

test("stripDenylisted: a noun keeping at least one clean fact survives the prune", () => {
  const out = stripDenylisted({
    facts: [["shop", "/r/IsA", "store"], ["shop", "/r/IsA", "building"]],
    newNouns: ["shop"], clumpId: "c", requested: 2, got: 2,
  });
  assert.deepEqual(out.facts, [["shop", "/r/IsA", "building"]]);
  assert.deepEqual(out.newNouns, ["shop"]);
});

test("stripDenylisted: a clean result passes through untouched", () => {
  const result = {
    facts: [["man", "/r/IsA", "person"]], newNouns: ["man"], clumpId: "human-core", requested: 1, got: 1,
  };
  assert.deepEqual(stripDenylisted(result), result);
});
