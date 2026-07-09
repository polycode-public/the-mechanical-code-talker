// Feature A regression coverage: the "redis" write-side fix (an unknown SUBJECT
// gets a free pass into memory once the OBJECT is a known lexicon term) + the new
// teach phrasings ("every X is a/an Y" [baseline], "your X is a/an Y", bare
// "X is Y" property assertion, "some Xs are Ys", "a few Xs are Ys") + the
// "how many Xs are Ys" quantifier-recall lane (literal recall, never real
// cardinality counting) — see chat.mjs's teachLane / unknownSubjectFallback /
// recordUniversalQuantifier / answerQuantifierRecall docblocks for the design.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-tq-${tag}-`));

test("redis fix: bare 'redis is a cache' stores (unknown subject, known object) and is resolvable read-back", async () => {
  const dir = await mem("redis");
  try {
    const taught = await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.match(taught.answer, /noted — remembered: redis is a kind of cache/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "redis");
    assert.equal(rows[0].predicate, "rdfs:subClassOf");
    assert.equal(rows[0].object, "cache");
    assert.equal(rows[0].quantifier, "", "a bare 'X is a Y' is one specific claim — no quantifier");
    assert.match(rows[0].provenance, /^teach:chat:s1@/, "distinct teach:chat provenance, not ace:chat");

    const yesNo = await runTurn("is redis a cache", { config: CONFIG, memoryDir: dir });
    assert.match(yesNo.answer, /^yes/i);
    assert.match(yesNo.answer, /redis is a kind of cache/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("redis fix: the 2-hop transitive chase composes a taught-new-term hop with a real-lexicon-pair hop", async () => {
  const dir = await mem("redis-chain");
  try {
    await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    // both 'cache' and 'component' are real lexicon nouns — this hop stores via
    // the PRE-EXISTING ACE grammar (pattern 2's bare copula), untouched by this feature.
    const secondHop = await runTurn("cache is a component", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    assert.match(secondHop.answer, /remembered 1 fact: cache rdfs:subClassOf component/);

    const chase = await runTurn("is redis a component", { config: CONFIG, memoryDir: dir });
    assert.match(chase.answer, /^yes/i, "the 2-hop chain (redis->cache->component) is found");
    assert.match(chase.answer, /redis is a kind of cache/);
    assert.match(chase.answer, /cache is a kind of component/);
    assert.match(chase.answer, /so redis is a component/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Bug E (operator manual-chat find + follow-up request, this session):
// KNOW_ABOUT_RE phrasing gap ("what is in your memory about X") + a subtype
// walk — when X is used as a TYPE somewhere in taught facts (some other fact
// says <something> is a kind of X), the answer also surfaces facts about every
// TRANSITIVE SUBTYPE of X, not just literal mentions. See chat.mjs's
// KNOW_ABOUT_RE / factAnswer's "(c)" branch docblock for the design. ----

test("Bug E: 'what is in your memory about X'/\"what's in your memory about X\"/'what do you remember about X' are synonyms of 'what do you know about X'", async () => {
  const dir = await mem("e-phrasing");
  // Strip the independent "Goal (inferred): ..." suffix — a separate mechanism
  // keyed off deduceGoalFromParsed's own read of envelope.parsed, unrelated to
  // whether this fix's own answer TEXT is correct (same reasoning as the 3c/
  // Bug D goal-line stripping elsewhere this session).
  const stripGoal = (s) => s.replace(/\n\nGoal \(inferred\):.*$/s, "");
  try {
    await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "e1" });
    const baseline = await runTurn("what do you know about redis", { config: CONFIG, memoryDir: dir });
    for (const q of ["what is in your memory about redis", "what's in your memory about redis", "what do you remember about redis"]) {
      const r = await runTurn(q, { config: CONFIG, memoryDir: dir });
      assert.equal(r.record.via, "fact", `"${q}" should answer via the memory-fact lane`);
      assert.equal(stripGoal(r.answer), stripGoal(baseline.answer), `"${q}" should read exactly like "what do you know about redis"`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug E: the subtype walk surfaces a subtype's fact via a taught isa CHAIN, 2 hops deep, with the 'including its known subtypes' wording", async () => {
  const dir = await mem("e-subtype");
  try {
    // component <- cache <- redis (2 hops): "redis has blue-color" never
    // literally mentions "component" at all.
    await runTurn("every cache is a component", { config: CONFIG, memoryDir: dir, sessionId: "e2" });
    await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "e2" });
    await runTurn("remember redis has a blue-color", { config: CONFIG, memoryDir: dir, sessionId: "e2" });

    const r = await runTurn("what do you know about component", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "fact");
    assert.match(r.answer, /remembered facts about component \(including its known subtypes\):/);
    assert.match(r.answer, /cache is a kind of component/);
    assert.match(r.answer, /redis is a kind of cache/);
    assert.match(r.answer, /redis has blue-color/, "the 2-hop-deep subtype's own fact is surfaced, not just the 1-hop chain");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug E: a literal-mention-only answer (no subtype involved) does NOT get the 'including its known subtypes' wording", async () => {
  const dir = await mem("e-literal");
  try {
    await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "e3" });
    const r = await runTurn("what do you know about redis", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "fact");
    assert.match(r.answer, /^\d+ remembered facts? about redis:/, "plain header, no subtype-wording suffix");
    assert.doesNotMatch(r.answer, /including its known subtypes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug E negative case: an unrelated fact about a subject that ISN'T a subtype of X is correctly excluded", async () => {
  const dir = await mem("e-negative");
  try {
    await runTurn("every cache is a component", { config: CONFIG, memoryDir: dir, sessionId: "e4" });
    await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "e4" });
    // an UNRELATED subject/fact, never a subtype of "component" — nothing chains it in.
    await runTurn("remember tony has a hat", { config: CONFIG, memoryDir: dir, sessionId: "e4" });

    const r = await runTurn("what do you know about component", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "fact");
    assert.match(r.answer, /cache is a kind of component/);
    assert.doesNotMatch(r.answer, /tony has hat/, "an unrelated fact must never be pulled in by the subtype walk");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug E: the subtype-discovery chain is TAUGHT-only — bulk background corpus isa facts never flood the walk", async () => {
  const dir = await mem("e-corpus-guard");
  try {
    // "controller"/"model"/"view" are all real corpus (seon) subtypes of
    // "component" already seeded — asking about "component" must not chain
    // through THOSE corpus rows and explode into hundreds of coincidental
    // "subtypes"; only what the OPERATOR actually taught should chain.
    await runTurn("redis is a component", { config: CONFIG, memoryDir: dir, sessionId: "e5" });
    const r = await runTurn("what do you know about component", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "fact");
    const total = Number((r.answer.match(/^(\d+) remembered/) || [])[1] || NaN);
    assert.ok(Number.isFinite(total) && total < 50, `subtype walk must stay bounded to taught facts, not corpus noise (got ${total})`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: 'every X is a Y' baseline is untouched AND now also records the 'every' quantifier (point 3)", async () => {
  const dir = await mem("every");
  try {
    const taught = await runTurn("every queue is a pipeline", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    assert.match(taught.answer, /remembered 1 fact: queue rdfs:subClassOf pipeline/, "baseline confirmation text unchanged");
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quantifier, "every");
    assert.match(rows[0].provenance, /^ace:chat:s3@/, "still the ACE grammar's own provenance family, not teach:chat");

    const howMany = await runTurn("how many queues are pipelines", { config: CONFIG, memoryDir: dir });
    assert.equal(howMany.answer, "Every.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: 'your X is a Y' behaves as a plain synonym for 'a X is a Y' — no quantifier, unknown subject gets the free pass", async () => {
  const dir = await mem("your");
  try {
    const taught = await runTurn("your widget is a component", { config: CONFIG, memoryDir: dir, sessionId: "s4" });
    assert.match(taught.answer, /noted — remembered: widget is a kind of component/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "widget");
    assert.equal(rows[0].object, "component");
    assert.equal(rows[0].quantifier, "", "a singular 'your X' claim is about one entity — no quantifier");

    const howMany = await runTurn("how many widgets are components", { config: CONFIG, memoryDir: dir });
    assert.equal(howMany.answer, "I don't know — I was never told a quantifier for that.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: bare 'X is Y' with an unknown subject and a known-ADJECTIVE object stores as a PROPERTY (mgx:hasProperty), never a class assertion", async () => {
  const dir = await mem("prop");
  try {
    const taught = await runTurn("redisCache is deprecated", { config: CONFIG, memoryDir: dir, sessionId: "s5" });
    assert.match(taught.answer, /noted — remembered: rediscache is deprecated/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "rediscache");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "deprecated");
    assert.equal(rows[0].quantifier, "");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: bare 'X is Y' declines honestly when Y is neither a known noun nor a known adjective", async () => {
  const dir = await mem("prop-miss");
  try {
    const declined = await runTurn("redisCache is bananaish", { config: CONFIG, memoryDir: dir, sessionId: "s5b" });
    assert.doesNotMatch(declined.answer, /noted — remembered/i);
    assert.equal(declined.record.miss, true);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: 'some Xs are Ys' — plural class-membership, quantifier 'some' recorded, singularized before storage", async () => {
  const dir = await mem("some");
  try {
    const taught = await runTurn("some gizmos are components", { config: CONFIG, memoryDir: dir, sessionId: "s6" });
    assert.match(taught.answer, /noted — remembered: gizmo is a kind of component/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "gizmo");
    assert.equal(rows[0].object, "component");
    assert.equal(rows[0].quantifier, "some");

    const howMany = await runTurn("how many gizmos are components", { config: CONFIG, memoryDir: dir });
    assert.equal(howMany.answer, "Some.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: 'a few Xs are Ys' — plural class-membership, quantifier 'a few' recorded", async () => {
  const dir = await mem("afew");
  try {
    const taught = await runTurn("a few doohickeys are components", { config: CONFIG, memoryDir: dir, sessionId: "s7" });
    assert.match(taught.answer, /noted — remembered: doohickey is a kind of component/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "doohickey");
    assert.equal(rows[0].quantifier, "a few");

    const howMany = await runTurn("how many doohickeys are components", { config: CONFIG, memoryDir: dir });
    assert.equal(howMany.answer, "A few.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing: 'some Xs are Ys' declines honestly when the OBJECT is not a known lexicon noun — the object-must-be-known discipline holds even for the plural shape", async () => {
  const dir = await mem("some-miss");
  try {
    const declined = await runTurn("some gizmos are thingamajigs", { config: CONFIG, memoryDir: dir, sessionId: "s8" });
    assert.doesNotMatch(declined.answer, /noted — remembered/i);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'how many Xs are Ys' gives an honest 'I don't know' when the pair was taught with NO quantifier — never a fabricated number, never the wall", async () => {
  const dir = await mem("howmany-miss");
  try {
    await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "s9" });
    const howMany = await runTurn("how many redis are cache", { config: CONFIG, memoryDir: dir });
    assert.equal(howMany.answer, "I don't know — I was never told a quantifier for that.");
    assert.doesNotMatch(howMany.answer, /couldn't parse this as a graph question/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'how many Xs are Ys' falls through to the honest 'can't count' when the subject was NEVER taught anything at all", async () => {
  const dir = await mem("howmany-untaught");
  try {
    const r = await runTurn("how many gremlins are components", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(r.answer, /I can't count "gremlins"/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("answerCount regression: real graph-cardinality counts are UNAFFECTED by the new quantifier-recall lane, even with unrelated taught facts in memory", async () => {
  const dir = await mem("count-regress");
  try {
    // Teach something unrelated first, so memory is non-empty.
    await runTurn("every queue is a pipeline", { config: CONFIG, memoryDir: dir, sessionId: "s10" });
    const classes = await runTurn("how many classes are there", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(classes.answer, "3 classes.");
    const modules = await runTurn("how many modules are there", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(modules.answer, /^\d+ modules?\.$/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Bug 3 (2026-07-09 dispatch): general verb-to-predicate teaching. The
// operator's own repro: "remember tony has a hat" / "remember margo eats
// ribs" used to fall straight through teachLane returning null (not even
// this lane's own honest miss text) because only is/are and owns/maintains
// were recognized verbs — the sentence then hit the STRUCTURAL code-graph
// grammar, which produced a confusing wrong-context miss (and sometimes a
// confidently WRONG "Goal (inferred)" line). See chat.mjs's generalVerbTeach/
// generalVerbPredicate/GENERAL_VERB_TEACH_RE docblocks for the design.

test("Bug 3: 'remember X has a Y' stores via the EXISTING mgx:hasA predicate (interop with ConceptNet HasA data) and is retrievable", async () => {
  const dir = await mem("verb-hasa");
  try {
    const taught = await runTurn("remember tony has a hat", { config: CONFIG, memoryDir: dir, sessionId: "v1" });
    assert.match(taught.answer, /^noted — remembered: tony has hat/);
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /Goal \(inferred\): Teach\/remember a new fact\./);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "tony");
    assert.equal(rows[0].predicate, "mgx:hasA", "the SAME predicate ConceptNet's own HasA facts use");
    assert.equal(rows[0].object, "hat");
    assert.match(rows[0].provenance, /^teach:chat:v1@/);

    const readBack = await runTurn("what is tony", { config: CONFIG, memoryDir: dir });
    assert.match(readBack.answer, /tony has hat/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug 3: 'remember X <novel-verb> Y' mints mgx:<lemma>, stores, and reads back with a sensible mechanically-derived render", async () => {
  const dir = await mem("verb-novel");
  try {
    const taught = await runTurn("remember margo eats ribs", { config: CONFIG, memoryDir: dir, sessionId: "v2" });
    assert.match(taught.answer, /^noted — remembered: margo eats ribs/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "margo");
    assert.equal(rows[0].predicate, "mgx:eat", "minted from the verb's own lemma, no hand-curated table entry");
    assert.equal(rows[0].object, "ribs");

    const readBack = await runTurn("what is margo", { config: CONFIG, memoryDir: dir });
    assert.match(readBack.answer, /margo eats ribs/, "the mechanical mgx:<lemma> render fallback reconstructs the natural surface form");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug 3: the pronoun-subject guard (fc58c19) still declines 'remember you/i/he/… <verb> Y' for the NEW general-verb path — no regression", async () => {
  const dir = await mem("verb-pronoun");
  try {
    for (const q of ["remember you has a hat", "remember i have a hat", "remember he eats ribs", "remember they drive a car"]) {
      const r = await runTurn(q, { config: CONFIG, memoryDir: dir, sessionId: "v3" });
      assert.match(r.answer, /pronouns aren't things I can classify/, `"${q}" still gets the distinct pronoun decline`);
      assert.equal(r.record.miss, true, `"${q}" is never silently stored`);
    }
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "no pronoun-subject fact was ever written");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug 3: a determiner-led or is/are-bearing sentence is NOT hijacked by the general-verb path — the existing class-membership frame still owns it", async () => {
  const dir = await mem("verb-noregress");
  try {
    const r = await runTurn("remember every controller is a handler", { config: CONFIG, memoryDir: dir, sessionId: "v4" });
    assert.match(r.answer, /noted — remembered.*controller.*handler/, "the ordinary ACE class-membership path answers, not a bogus general-verb mint");
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "rdfs:subClassOf", "still the ordinary class-membership predicate, not a bogus mgx:<noun> mint");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug 3: a genuinely unparseable teach payload (no real object) still declines honestly — the predicate generalization never accepts garbage", async () => {
  const dir = await mem("verb-garbage");
  try {
    const r = await runTurn("remember tony", { config: CONFIG, memoryDir: dir, sessionId: "v5" });
    assert.doesNotMatch(r.answer, /^noted — remembered/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug 3: the Goal-line is correct and consistent for teach-success turns (never the wrong structural 'defines' goal, never silently absent)", async () => {
  const dir = await mem("verb-goal");
  try {
    const hasA = await runTurn("remember tony has a hat", { config: CONFIG, memoryDir: dir, sessionId: "v6" });
    assert.match(hasA.answer, /Goal \(inferred\): Teach\/remember a new fact\./);
    assert.doesNotMatch(hasA.answer, /Locate what a module\/class defines/i);

    const novel = await runTurn("remember margo eats ribs", { config: CONFIG, memoryDir: dir, sessionId: "v6" });
    assert.match(novel.answer, /Goal \(inferred\): Teach\/remember a new fact\./);
    assert.doesNotMatch(novel.answer, /Locate what a module\/class defines/i);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Bug A (operator manual-chat find, this session): "remember X had soup"
// teaches malformed "x haves soup". Root cause: generalVerbPredicate only
// special-cased the raw strings "has"/"have" onto HAS_A_PREDICATE — past tense
// "had" (lemma "have") fell through to the generic mgx:<lemma> mint, and
// predicatePhrase's thirdPersonSingularSurface fallback naively appended "s" to
// the unrecognized lemma "have" ("haves"). Fixed by checking the LEMMA (not
// just the raw verb) for "have", so had/having/has/have all land on the SAME
// curated mgx:hasA predicate. See generalVerbPredicate/thirdPersonSingularSurface.
test("Bug A: 'remember X had soup' (past tense) reads back 'has soup', never the malformed 'haves soup'", async () => {
  const dir = await mem("verb-hada");
  try {
    const taught = await runTurn("remember tony had soup", { config: CONFIG, memoryDir: dir, sessionId: "va1" });
    assert.match(taught.answer, /^noted — remembered: tony has soup/);
    assert.doesNotMatch(taught.answer, /haves/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:hasA", "had's lemma (have) lands on the SAME curated predicate as has/have");
    assert.equal(rows[0].object, "soup");

    const readBack = await runTurn("what is tony", { config: CONFIG, memoryDir: dir });
    assert.match(readBack.answer, /tony has soup/);
    assert.doesNotMatch(readBack.answer, /haves/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
