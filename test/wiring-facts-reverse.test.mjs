// wiring-facts-reverse.test.mjs — PLAN_CONVERSATION.md Finding 5's four new
// factAnswer readers (src/chat.mjs): forward yes/no + reverse-by-object shapes
// for mgx:capableOf, mgx:hasA, and the ISA-family predicates, against the REAL
// default-persona bootstrap (corpus/tier2/human.jsonl) — no --repo, no fixture
// graph, the same graph-less first-run seeding W3's own wiring-seed.test.mjs
// and chat-cross-ontology-bridge.test.mjs exercise.
//
// Corpus facts this file leans on (grepped from corpus/tier2/human.jsonl,
// verbatim, ConceptNet-shaped rows the seed pass turns into mgx:hasA/
// mgx:capableOf/rdfs:subClassOf Facts):
//   {"start":"/c/en/dog","rel":"/r/IsA","end":"/c/en/animal", …}
//   {"start":"/c/en/dog","rel":"/r/HasA","end":"/c/en/tail", …}
//   {"start":"/c/en/dog","rel":"/r/CapableOf","end":"/c/en/bark", …}
//   {"start":"/c/en/car","rel":"/r/HasA","end":"/c/en/wheel", …}
//   {"start":"/c/en/bicycle","rel":"/r/HasA","end":"/c/en/wheel", …}
//   {"start":"/c/en/train","rel":"/r/HasA","end":"/c/en/wheel", …}
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const mem = () => mkdtemp(join(tmpdir(), "tmct-facts-reverse-"));

// Reads a session's sidecar JSONL and returns the LAST "turn" record's
// {via, miss} — the same sidecar shape test/chat.test.mjs's own hit/miss
// assertions read (writeSidecar's per-turn record includes both fields).
const lastTurnRecord = async (sidecarFile) => {
  const lines = (await readFile(sidecarFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const turns = lines.filter((l) => l.type === "turn");
  return turns[turns.length - 1];
};

test("CAN_ASK_RE: 'can a dog bark' answers yes from the corpus-seeded mgx:capableOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("can a dog bark");
    await s.close();
    assert.match(r.answer, /dog can bark/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.via, "fact");
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("DOES_HAVE_ASK_RE: 'does a dog have a tail' answers yes from the corpus-seeded mgx:hasA fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("does a dog have a tail");
    await s.close();
    assert.match(r.answer, /yes — dog has tail/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("DOES_HAVE_ASK_RE: the plural form 'do dogs have tails' answers yes off the same singular fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("do dogs have tails");
    await s.close();
    assert.match(r.answer, /yes — dog has tail/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("DOES_HAVE_ASK_RE: a code-shaped 'does app.mjs have tests' (no hasA fact) never diverts — the standing miss text is kept", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("does app.mjs have tests");
    await s.close();
    assert.doesNotMatch(r.answer, /^yes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_CAN_DO_RE: 'what can a dog do' lists the corpus-seeded mgx:capableOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what can a dog do");
    await s.close();
    assert.match(r.answer, /dog can bark/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_HAS_RE: 'what has a wheel' lists every distinct subject — car, bicycle, and train", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what has a wheel");
    await s.close();
    assert.match(r.answer, /car has wheel/);
    assert.match(r.answer, /bicycle has wheel/);
    assert.match(r.answer, /train has wheel/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// Live-caught 2026-07-12 (operator repro against the real `npm run init:large`
// bootstrap): "what is used for riding" / "what can be used for riding" /
// "what is for riding" all fell through to the code-graph-flavored miss
// cascade (misleadingly suggesting "which modules import <name>") even though
// the answer — corpus:human's own "horse UsedFor riding" — was sitting right
// there, surfaced correctly by "what is a horse". The predicate-filter fix
// only ever covered the FORWARD direction (subject known: "what is a horse used
// for"); nothing answered the reverse (object known, subject unknown) until
// this fix (WHAT_USED_FOR_RE, checked BEFORE the meta lane's own BARE_WHATIS_RE
// so "what is used for riding" doesn't get treated as one literal term to
// define first).
test("WHAT_USED_FOR_RE: 'what is used for riding' surfaces the corpus-seeded mgx:usedFor fact, reverse-by-object", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is used for riding");
    await s.close();
    assert.match(r.answer, /horse is used for riding/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_USED_FOR_RE: 'what can be used for riding' (passive modal phrasing) surfaces the same fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what can be used for riding");
    await s.close();
    assert.match(r.answer, /horse is used for riding/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_USED_FOR_RE: 'what is for riding' (shortest phrasing, no 'used') surfaces the same fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is for riding");
    await s.close();
    assert.match(r.answer, /horse is used for riding/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_USED_FOR_RE guard: an object with no mgx:usedFor fact at all falls through to the ordinary miss, no fabricated answer", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is used for zzznonexistentqqq");
    await s.close();
    assert.doesNotMatch(r.answer, /is used for zzznonexistentqqq/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// Live-caught 2026-07-12, same session as WHAT_USED_FOR_RE above: the exact
// same forward-only gap turned out to be systemic across most of
// FACT_PREDICATE_PHRASES, not unique to mgx:usedFor — "what causes fire",
// "what is made of wood", "what is found in a kitchen", "what wants
// happiness" all fell through to the same misleading code-graph miss.
// REVERSE_PREDICATE_MARKERS (src/chat.mjs) derives a reverse-by-object
// regex+reader for every FACT_PREDICATE_PHRASES entry safe to reverse (see
// its own docblock for the exclusion list and why). Corpus facts these tests
// lean on (also grepped verbatim from corpus/tier2/human.jsonl):
//   {"start":"/c/en/paper","rel":"/r/MadeOf","end":"/c/en/wood", …}
//   {"start":"/c/en/cook","rel":"/r/AtLocation","end":"/c/en/kitchen", …}
//   {"start":"/c/en/brother","rel":"/r/PartOf","end":"/c/en/family", …}
//   {"start":"/c/en/person","rel":"/r/Desires","end":"/c/en/happiness", …}
test("REVERSE_PREDICATE_MARKERS: 'what is made of wood' surfaces the corpus-seeded mgx:madeOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is made of wood");
    await s.close();
    assert.match(r.answer, /paper is made of wood/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("REVERSE_PREDICATE_MARKERS: 'what is found in a kitchen' surfaces the corpus-seeded mgx:atLocation fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is found in a kitchen");
    await s.close();
    assert.match(r.answer, /cook is found in kitchen/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("REVERSE_PREDICATE_MARKERS: 'what is part of family' lists every distinct subject", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is part of family");
    await s.close();
    assert.match(r.answer, /brother is part of family/);
    assert.match(r.answer, /sister is part of family/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// The trickiest member of this family: exactly 3 words, none in STRUCT_WORDS,
// so isConversational()'s own <=3-word/no-codeish catch-all (same race as BUG
// 2 / the Tier-5 fix / the CamelCase finding, all documented at
// isConversationalCandidate's own call site) claimed it BEFORE factAnswer
// ever ran — via:"template" (the generic orientation card), not via:"fact",
// confirmed live before this fix. Proves the isConversationalCandidate
// exemption (reversePredicateShape), not just the reader itself.
test("REVERSE_PREDICATE_MARKERS: 'what wants happiness' (exactly 3 words) resolves via the fact reader, not the isConversational() short-input catch-all", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what wants happiness");
    await s.close();
    assert.match(r.answer, /person wants happiness/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.via, "fact");
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("REVERSE_PREDICATE_MARKERS guard: a genuinely unanswerable reverse query (no fact for that predicate+object) stays an honest miss, not fabricated", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what causes zzznonexistentqqq");
    await s.close();
    assert.doesNotMatch(r.answer, /causes zzznonexistentqqq/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("REVERSE_PREDICATE_MARKERS non-shadow regression: ordinary short conversational turns still get the orientation card, not a spurious fact lookup", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what can you do");
    await s.close();
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.via, "template");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WHAT_INHERITS_RE: 'what inherits from horse' surfaces a freshly taught subClassOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const taught = await s.turn("shirehorse is a kind of horse");
    assert.match(taught.answer, /noted — remembered/, "the taught link stores cleanly");
    const r = await s.turn("what inherits from horse");
    await s.close();
    assert.match(r.answer, /shirehorse is a kind of horse/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-shadow regression: 'what has changed recently' stays a code-graph-flavored miss, not a fact answer", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what has changed recently");
    await s.close();
    assert.doesNotMatch(r.answer, /source: corpus/);
    assert.doesNotMatch(r.answer, /you told me/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("isa honest miss: 'is a dog a cat' answers a specific can't-confirm citing a known fact, and the turn still records a miss", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a dog a cat");
    await s.close();
    assert.match(r.answer, /I can't confirm that — nothing I remember says dog is a cat/);
    assert.match(r.answer, /dog is a kind of animal/);
    assert.doesNotMatch(r.answer, /couldn't parse/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("isa honest miss: an entirely unknown subject ('is a fizzbuzz an animal') gets a can't-confirm + teach hint, never the parse wall", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a fizzbuzz an animal");
    await s.close();
    assert.match(r.answer, /I don't know "fizzbuzz" at all yet/);
    assert.doesNotMatch(r.answer, /couldn't parse/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("isa honest miss: the teach hint's own suggested phrasing round-trips — teach it, re-ask, get yes", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("dog is a kind of cat");
    const r = await s.turn("is a dog a cat");
    await s.close();
    assert.match(r.answer, /^yes — /);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("negated is-a: a taught disjointness answers 'is a dog a cat' no and 'is a dog not a cat' yes, citing the fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("no dog is a cat");
    const pos = await s.turn("is a dog a cat");
    const neg = await s.turn("is a dog not a cat");
    await s.close();
    assert.match(pos.answer, /^no — .*dog is not a cat/);
    assert.match(neg.answer, /^yes — .*dog is not a cat/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("negated is-a: a positive fact refutes the negative question — 'is a dog not an animal' answers no with the isa fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a dog not an animal");
    await s.close();
    assert.match(r.answer, /^no — dog is a kind of animal/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("negated is-a: nothing known either way stays an honest can't-confirm pointing at the 'no X is a Y' teach shape", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a dog not a cat");
    await s.close();
    assert.match(r.answer, /I can't confirm that either way/);
    assert.match(r.answer, /teach me: "no dog is a cat"/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("can-lane honest miss: 'can a dog fly' cites what the subject CAN do instead of the parse wall, and still records a miss", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("can a dog fly");
    await s.close();
    assert.match(r.answer, /I can't confirm that — nothing I remember says dog can fly/);
    assert.match(r.answer, /dog can bark/);
    assert.doesNotMatch(r.answer, /couldn't parse/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("capability teach round trip: 'a dog can swim' (ACE) and 'remember dog can juggle' (general-verb) both satisfy the can-question", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("a dog can swim");
    await s.turn("remember dog can juggle");
    const swim = await s.turn("can a dog swim");
    const juggle = await s.turn("can a dog juggle");
    await s.close();
    assert.match(swim.answer, /^yes — .*dog can swim/);
    assert.match(juggle.answer, /^yes — .*dog can juggle/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("negative capability teach: 'penguin cannot fly' never stores a fact whose read-back inverts the meaning", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("penguin cannot fly");
    await s.close();
    assert.doesNotMatch(r.answer, /remembered/);
    const check = await createSession({ repoPath: dir, env: {} });
    const q = await check.turn("can a penguin fly");
    await check.close();
    assert.doesNotMatch(q.answer, /^yes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("derived forward yes/no: 'is a horse used for riding' answers yes from the corpus mgx:usedFor fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a horse used for riding");
    await s.close();
    assert.match(r.answer, /^yes — horse is used for riding/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("derived forward yes/no: a wrong object gets an honest miss citing the subject's same-relation facts, recorded as a miss", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a wheel part of a car");
    await s.close();
    assert.match(r.answer, /I can't confirm that — nothing I remember says wheel is part of car/);
    assert.match(r.answer, /wheel is part of vehicle/);
    assert.doesNotMatch(r.answer, /couldn't parse/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("derived forward yes/no: 'is a pen made of plastic' answers yes from the corpus mgx:madeOf fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is a pen made of plastic");
    await s.close();
    assert.match(r.answer, /^yes — pen is made of plastic/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("derived forward yes/no never intercepts a dedicated reader: isa, capability, hasA, and ownership shapes keep their own answers", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const isa = await s.turn("is a dog an animal");
    const can = await s.turn("can a dog bark");
    const have = await s.turn("does a dog have a tail");
    await s.close();
    assert.match(isa.answer, /^yes — dog is a kind of animal/);
    assert.match(can.answer, /^yes — dog can bark/);
    assert.match(have.answer, /^yes — dog has tail/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("vocabulary pronoun binding: 'what is a dog' then 'can it bark' / 'does it have a tail' / 'is it an animal' all answer off dog", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("what is a dog");
    const bark = await s.turn("can it bark");
    const tail = await s.turn("does it have a tail");
    const animal = await s.turn("is it an animal");
    await s.close();
    assert.match(bark.answer, /^yes — dog can bark/);
    assert.match(tail.answer, /^yes — dog has tail/);
    assert.match(animal.answer, /^yes — dog is a kind of animal/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("vocabulary pronoun binding: the antecedent moves with the conversation — after 'what is a horse', 'what is it used for' answers off horse", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("what is a dog");
    await s.turn("what is a horse");
    const r = await s.turn("what is it used for");
    await s.close();
    assert.match(r.answer, /horse is used for riding/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("vocabulary pronoun binding: a pronoun with no antecedent is never claimed — 'is it an animal' cold gets no fabricated subject", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("is it an animal");
    await s.close();
    assert.doesNotMatch(r.answer, /^yes/);
    assert.doesNotMatch(r.answer, /I don't know "it" at all yet/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi-word teach round trip: ground 'guinea pig', teach the membership, ask it back — and capability teaches directly", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("every guinea pig is a thing");
    await s.turn("every guinea pig is a rodent");
    const isa = await s.turn("is a guinea pig a rodent");
    await s.turn("a guinea pig can squeak");
    const can = await s.turn("can a guinea pig squeak");
    await s.close();
    assert.match(isa.answer, /^yes — .*guinea pig is a kind of rodent/);
    assert.match(can.answer, /^yes — .*guinea pig can squeak/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("mixed-source isa chain: a taught anchor onto a corpus class answers up the corpus hierarchy, both premises cited", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("every poodle is a dog");
    const r = await s.turn("is a poodle an animal");
    await s.close();
    assert.match(r.answer, /^yes — poodle is a kind of dog .*dog is a kind of animal \(source: corpus:human \/r\/IsA\); so poodle is an animal/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("do-support yes/no: 'do birds fly' (exactly 3 words) answers yes via the fact reader, not the isConversational() short-input catch-all", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("do birds fly");
    await s.close();
    assert.match(r.answer, /^yes — bird can fly/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.via, "fact");
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("do-support quantified: 'do all birds fly' answers generically and says so — never a bare universal yes", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("do all birds fly");
    await s.close();
    assert.doesNotMatch(r.answer, /^yes/);
    assert.match(r.answer, /can't speak for all birds/);
    assert.match(r.answer, /bird can fly/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reverse-by-verb: 'what can fly' (exactly 3 words) surfaces the capableOf fact by its object", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what can fly");
    await s.close();
    assert.match(r.answer, /bird can fly/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.via, "fact");
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("kind-restricted reverse-by-verb: 'which animals can fly' resolves through the isa link to the kind", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("which animals can fly");
    await s.close();
    assert.match(r.answer, /bird can fly/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("capability can't-confirm beats the orientation card: 'do birds swim' cites what birds CAN do with a round-trip teach hint, miss stays true", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("do birds swim");
    await s.close();
    assert.match(r.answer, /I can't confirm that — nothing I remember says birds can swim/);
    assert.match(r.answer, /bird can fly/);
    assert.match(r.answer, /teach me: "a bird can swim"/);
    assert.doesNotMatch(r.answer, /I'm tmct/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("can-lane hint honesty: a plural subject's teach hint names the singular the graph stores — 'a bird can swim', never 'a birds can swim'", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("can birds swim");
    await s.close();
    assert.match(r.answer, /teach me: "a bird can swim"/);
    assert.doesNotMatch(r.answer, /a birds can/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("mixed-source isa chain: a chain of ONLY corpus edges never answers — no taught premise, no yes", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("every poodle is a dog");
    const r = await s.turn("is a poodle a plant");
    await s.close();
    assert.doesNotMatch(r.answer, /^yes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("turn-1 bootstrap: a politeness-wrapped vocabulary question ('could you tell me what a dog is') answers on the very first graph-less turn", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("could you tell me what a dog is");
    await s.close();
    assert.match(r.answer, /dog is a kind of animal/);
    const rec = await lastTurnRecord(s.sidecarFile);
    assert.equal(rec.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ambiguous-parse tie with a taught meta term: 'what is a test drive' surfaces the taught facts under the disambiguation", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.turn("every test drive is a thing");
    const r = await s.turn("what is a test drive");
    await s.close();
    assert.match(r.answer, /this could mean more than one thing/);
    assert.match(r.answer, /test drive is a kind of thing/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
