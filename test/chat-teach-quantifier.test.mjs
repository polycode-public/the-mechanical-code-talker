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
