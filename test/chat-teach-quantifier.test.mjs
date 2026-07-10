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
// ---- Feature A mirror (2026-07-09, operator-authorized "build it" extension):
// unknownSubjectFallback's own docblock explicitly stated the free pass was
// ONE-directional — subject unknown/object known, never the reverse — to
// avoid a general lexicon bypass. The operator hit this live ("every cache is
// a store" declined outright, since "cache" IS a known subject and "store"
// isn't a known object) and asked for the MIRROR: a known SUBJECT + an
// unknown OBJECT now mints the object as a brand-new class-level concept
// (unknownObjectFallback, chat.mjs), gated on a genuine universal quantifier
// ("every"/"each"/"all") so a bare "X is Y" (no determiner at all — e.g. the
// pre-existing "module is banana" pinned regression) and a wrapped
// "remember that X is <adjective>" property claim both keep declining/
// routing exactly as before. A term minted by EITHER direction's fallback
// grounds just as legitimately as a static lexicon word for a LATER sentence
// (isGroundedTerm/isGroundedByFact, shared helpers), so vocabulary compounds
// turn over turn — see chat.mjs's unknownObjectFallback/isGroundedTerm
// docblocks for the full design. ----

test("Feature A mirror: known-subject/unknown-object mint compounds vocabulary turn over turn, chains resolve via findIsaChain, and every pre-existing path stays unaffected", async () => {
  const dir = await mem("mirror-mint");
  try {
    // 1. "cache" is a real lexicon noun (known subject); "store" is not a
    // known term anywhere yet (neither lexicon nor a taught fact) — mints it.
    const t1 = await runTurn("every cache is a store", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    assert.match(t1.answer, /^noted — remembered: cache is a kind of store/);
    assert.equal(t1.record.miss, false);

    // 2. "store" is NOT a lexicon word at all — it only reads as "known" here
    // because turn 1 just minted it (isGroundedByFact) — this is the actual
    // regression guard for the "previously-minted counts as known" extension:
    // without it, this line would still decline exactly like turn 6, below.
    const t2 = await runTurn("every store is a container", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    assert.match(t2.answer, /^noted — remembered: store is a kind of container/);
    assert.equal(t2.record.miss, false);

    // 3. unchanged existing path: unknown subject ("redis"), known object
    // ("cache", the static lexicon noun) — unknownSubjectFallback, untouched.
    const t3 = await runTurn("redis is a cache", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    assert.match(t3.answer, /^noted — remembered: redis is a kind of cache/);
    assert.equal(t3.record.miss, false);

    // 4. 2-hop chain: redis->cache (unknownSubjectFallback's own free pass)
    // composed with cache->store (the NEW mirror mint) — findIsaChain proves it.
    const t4 = await runTurn("is redis a store", { config: CONFIG, memoryDir: dir });
    assert.match(t4.answer, /^yes/i, "the 2-hop chain (redis->cache->store) is found");
    assert.match(t4.answer, /redis is a kind of cache/);
    assert.match(t4.answer, /cache is a kind of store/);
    assert.match(t4.answer, /so redis is a store/);

    // 5. 2-hop chain entirely through the NEW mirror mint: cache->store->container.
    const t5 = await runTurn("is cache a container", { config: CONFIG, memoryDir: dir });
    assert.match(t5.answer, /^yes/i, "the 2-hop chain (cache->store->container) is found");
    assert.match(t5.answer, /cache is a kind of store/);
    assert.match(t5.answer, /store is a kind of container/);
    assert.match(t5.answer, /so cache is a container/);

    // 6. safety guard: BOTH sides totally ungrounded ("zorp"/"florp", never
    // seen anywhere) still declines honestly — never a guessed mint off two
    // names that merely fit the shape — but now with the grounding-nudge
    // refinement appended instead of the old bare "I couldn't store that".
    const t6 = await runTurn("every zorp is a florp", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    assert.doesNotMatch(t6.answer, /^noted — remembered/);
    assert.equal(t6.record.miss, true);
    // 2026-07-10: the suggestion now grounds BOTH sides independently ("every
    // zorp is a thing" AND "every florp is a thing") rather than chaining the
    // second term under the first's now-grounded proper name ("every florp is
    // a zorp") — the old chained suggestion was accepted by the grammar but
    // read as nonsense (a name is never a category); found live via
    // SKILL_BENCHMARK_CONVERSATION.md playtest ("john is a man").
    assert.match(t6.answer, /I don't know "zorp" or "florp" yet\. Try grounding each one first, e\.g\. "every zorp is a thing" and "every florp is a thing", then re-teach the original fact\./);
    assert.equal(readFactRows(await loadMemory(dir)).filter((f) => f.subject === "zorp" || f.subject === "florp").length, 0, "the ungrounded pair itself is never stored");

    // 7. UNAFFECTED by this change, on purpose: a 3-hop chain (redis->cache->
    // store->container) still hits the pre-existing, deliberately out-of-scope
    // maxHops:2 honest ceiling — a SEPARATE INFBENCH-gated decision, untouched.
    const t7 = await runTurn("is redis a container", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(t7.answer, /^yes/i, "the 3-hop chain still hits the maxHops:2 ceiling, unwidened by this change");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Feature A mirror regression guard: a KNOWN subject bare-paired with an unrecognized bare object (no determiner) is still never silently reified", async () => {
  // Pre-existing pinned behavior (wiring-facts.test.mjs): "module" is a real
  // lexicon noun (known subject) and "banana" is neither a noun nor an
  // adjective — a BARE "X is Y" (no "every"/"each"/"all" at all) must stay an
  // honest miss. unknownObjectFallback gates its mint on a genuine universal
  // quantifier for exactly this reason — minting a class is a general claim,
  // never implied by a bare/singular-entity phrasing.
  const dir = await mem("mirror-bare-guard");
  try {
    const bare = await runTurn("module is banana", { config: CONFIG, memoryDir: dir, sessionId: "mb1" });
    assert.doesNotMatch(bare.answer, /noted — remembered/i);
    assert.equal(bare.record.miss, true);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Feature A mint refinement (operator, 2026-07-09): the 'both sides ungrounded' decline's grounding nudge is actually actionable — following it grounds the new terms for real", async () => {
  const dir = await mem("mint-anchor");
  try {
    const decline = await runTurn("every zorp is a florp", { config: CONFIG, memoryDir: dir, sessionId: "a1" });
    assert.equal(decline.record.miss, true);
    assert.doesNotMatch(decline.answer, /^noted — remembered/);
    assert.match(decline.answer, /I don't know "zorp" or "florp" yet/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "the ungrounded pair itself is never stored");

    // follow the nudge literally: ground "zorp" via the generic anchor noun "thing"
    const ground = await runTurn("every zorp is a thing", { config: CONFIG, memoryDir: dir, sessionId: "a1" });
    assert.match(ground.answer, /^noted — remembered: zorp is a kind of thing/);
    assert.equal(ground.record.miss, false);

    // "florp" now chains off the just-grounded "zorp" — the exact 2nd half of the nudge
    const chain = await runTurn("every florp is a zorp", { config: CONFIG, memoryDir: dir, sessionId: "a1" });
    assert.match(chain.answer, /^noted — remembered: florp is a kind of zorp/);
    assert.equal(chain.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 2);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

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

// ---- PLAN_TAUGHT_RELATIONS.md Phase 1 (2026-07-09): Item 1 (relational fact
// teach, "X is the ROLE of Y" — RELATION_FACT_TEACH_RE) + Item 5
// (adjective-mint, "X is <brand-new adjective>" — unknownAdjectiveFallback).
// See chat.mjs's docblocks on both for the full design; the two are
// independent capabilities that happen to share this test file because both
// touch teachLane. ----

test("PLAN_TAUGHT_RELATIONS Item 1: 'X is the ROLE of Y' teaches an ordinary relational Fact (generalVerbPredicate reused verbatim, no new storage shape), read back via pre-existing query machinery", async () => {
  const dir = await mem("rel-fact");
  try {
    const taught = await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "r1" });
    assert.match(taught.answer, /^noted — remembered: ahab fathers john/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "ahab");
    assert.equal(rows[0].predicate, "mgx:father", "the role noun mints mgx:<role> via generalVerbPredicate, same as a general verb");
    assert.equal(rows[0].object, "john");
    assert.equal(rows[0].quantifier, "", "a relational fact names ONE pair, never a quantified class claim");
    assert.match(rows[0].provenance, /^teach:chat:r1@/);

    // Readback needs NO new query-side machinery (Phase 2+ territory) — two
    // already-working shapes both confirm the SAME taught fact: factAnswer's
    // "what do you know about X" (KNOW_ABOUT_RE) lists any Fact mentioning
    // the subject, and factReadBack's general-verb yes/no reader
    // (GENERAL_VERB_YESNO_RE, "does X <verb> Y") already resolves the role
    // noun as a bare-infinitive verb over the SAME mgx:father predicate.
    // (Checked live: "is ahab the father of john" does NOT resolve correctly
    // today — it accidentally matches IS_ADJECTIVE_YESNO_RE's own
    // unrestricted backtracking, mis-splitting "ahab the father of" as the
    // subject and "john" as a bogus adjective — a genuine "is X the ROLE of
    // Y" reader is real Phase 2+ work, not attempted here.)
    const know = await runTurn("what do you know about ahab", { config: CONFIG, memoryDir: dir });
    assert.match(know.answer, /ahab fathers john/);

    const yesno = await runTurn("does ahab father john", { config: CONFIG, memoryDir: dir });
    assert.match(yesno.answer, /^yes — you told me: ahab fathers john/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PLAN_TAUGHT_RELATIONS Item 5: a KNOWN subject ('cache') + a brand-new adjective ('bespoke') mints a property fact — 'remember that the cache is bespoke'", async () => {
  const dir = await mem("adj-mint-cache");
  try {
    const taught = await runTurn("remember that the cache is bespoke", { config: CONFIG, memoryDir: dir, sessionId: "a1" });
    assert.match(taught.answer, /^noted — remembered: cache is bespoke/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "cache", "the leading 'the' is normFactTerm-stripped at storage, same as every other taught fact");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "bespoke");
    assert.equal(rows[0].quantifier, "", "a property claim never carries a quantifier, even though the sentence itself carries none to record either");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PLAN_TAUGHT_RELATIONS Item 5: a BARE Capitalized-name-shaped subject mints too ('TaskController is bespoke') — proves unknownAdjectiveFallback itself fires (the pre-existing wrapped-only TEACH_PROPERTY_RE gap never even runs on a bare, unwrapped payload)", async () => {
  const dir = await mem("adj-mint-bare");
  try {
    const taught = await runTurn("TaskController is bespoke", { config: CONFIG, memoryDir: dir, sessionId: "a2" });
    assert.match(taught.answer, /^noted — remembered: taskcontroller is bespoke/);
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "taskcontroller");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "bespoke");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PLAN_TAUGHT_RELATIONS Item 5 regression guard: the pre-existing 'module is banana' pinned decline (a KNOWN bare subject, no article/capitalization/quantifier, an unrecognized bare object) stays a plain honest miss — unknownAdjectiveFallback does not reopen it", async () => {
  const dir = await mem("adj-mint-module-banana");
  try {
    const declined = await runTurn("module is banana", { config: CONFIG, memoryDir: dir, sessionId: "a3" });
    assert.doesNotMatch(declined.answer, /noted — remembered/i);
    assert.equal(declined.record.miss, true);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PLAN_TAUGHT_RELATIONS Item 5 safety guard: two completely ungrounded terms on both sides still decline honestly — unknownAdjectiveFallback never weakens the existing ungroundedness discipline", async () => {
  const dir = await mem("adj-mint-decline");
  try {
    const declined = await runTurn("zorp is glorpy", { config: CONFIG, memoryDir: dir, sessionId: "d1" });
    assert.equal(declined.record.miss, true);
    assert.doesNotMatch(declined.answer, /noted — remembered/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PLAN_TAUGHT_RELATIONS Item 5's own canonical illustration, 'mary is female', live-verified against isConversational's ≤3-word override (Verification finding 4) — a STRONGER form of the named risk than the plan anticipated", async () => {
  const dir = await mem("adj-mint-mary");
  try {
    // The LITERAL bare 3-word phrase never even reaches teachLane: it's ≤3
    // words with no code-ish token, so isConversationalCandidate claims the
    // turn in runTurn's own lane (2) — BEFORE lane (4) TEACH is ever tried.
    // This is a stronger form of Verification finding 4 than the plan
    // documented: the risk isn't only that a DECLINE's own honest text gets
    // swallowed by the generic orientation card — the teach lane (success or
    // failure) is never attempted at all for a short, non-code-ish bare
    // sentence. Pre-existing, cross-cutting `isConversational` routing —
    // named in the plan's own "Open risks" as explicitly out of scope for
    // this phase (widening it is "a change to already-shipped routing") — so
    // this is asserted here as a live-confirmed, documented characteristic,
    // not something this phase fixes.
    const bare = await runTurn("mary is female", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    assert.equal(bare.record.miss, true);
    assert.doesNotMatch(bare.answer, /noted — remembered/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);

    // The SAME sentence, wrapped ("remember that ..."), is 5 words — it
    // escapes isConversational's ≤3-word gate entirely and reaches teachLane.
    // Note what actually stores it here: "mary" (lowercase, no article, no
    // prior fact) has no groundedness signal at all, so
    // unknownAdjectiveFallback itself correctly DECLINES (same discipline as
    // the "module is banana" guard above) — this succeeds via the
    // pre-existing, deliberately out-of-scope TEACH_PROPERTY_RE gap
    // (Verification finding 3), which this phase's own new fallback sits
    // upstream of without closing. The confirmation text still displays
    // correctly end-to-end regardless of which of the two paths stored it —
    // a SUCCESS is never gated on isConversational at all (miss is false the
    // moment any lane stores the fact, so isConversationalCandidate's own
    // `miss` precondition never fires).
    const wrapped = await runTurn("remember that mary is female", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    assert.match(wrapped.answer, /^noted — remembered: mary is female/);
    assert.equal(wrapped.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "mary");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "female");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
