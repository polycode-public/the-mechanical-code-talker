// The stored-row shapes behind the inference corpus lane's teach rows: what a
// taught sentence actually lands in memory (Fact vs Rule, minted predicate,
// slots, trust tier, provenance union). The chat-visible read-backs live as
// corpus rows in test/corpus/inference.jsonl; these assertions need
// loadMemory/readFactRows and so stay in the unit ring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows, findRuleByName } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-teach-shape-${tag}-`));

test("'a grandparent is a parent of a parent' stores a compose2 Rule (base1/base2 slots), never a Fact", async () => {
  const dir = await mem("compose2");
  try {
    const taught = await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "c1" });
    assert.equal(taught.record.miss, false);

    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "never stored as a Fact");
    const rule = findRuleByName(await loadMemory(dir), "grandparent");
    assert.ok(rule, "a Rule individual named 'grandparent' exists");
    assert.equal(rule.class, "Rule");
    const attr = (key) => rule.attributes.find((a) => a.key === key)?.value;
    assert.equal(attr("ruleKind"), "compose2");
    assert.equal(attr("base1"), "parent");
    assert.equal(attr("base2"), "parent");

    // the literal-"the" relational fact teach still lands as an ordinary Fact.
    const rel = await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "c2" });
    assert.equal(rel.record.miss, false);
    assert.equal(readFactRows(await loadMemory(dir)).length, 1);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a determiner-led possession teaches the same fact as its bare form ('the tower has 3 disks' == 'tower has 3 disks')", async () => {
  const dir = await mem("det-has");
  try {
    const det = await runTurn("the tower has 3 disks.", { config: CONFIG, memoryDir: dir, sessionId: "d1" });
    assert.equal(det.record.miss, false, "the determiner-led form teaches, not misroutes to a code question");
    assert.equal(det.record.via, "assert");
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1, "one possession fact stored");
    assert.equal(rows[0].subject, "tower", "the determiner is stripped — the subject is the noun, not 'the'");
    assert.equal(rows[0].predicate, "mgx:hasA");
    assert.equal(rows[0].object, "3 disks");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'a grandfather is a grandparent who is male' stores a filter Rule (base/property slots), never a Fact", async () => {
  const dir = await mem("filter");
  try {
    const taught = await runTurn("a grandfather is a grandparent who is male", { config: CONFIG, memoryDir: dir, sessionId: "f1" });
    assert.equal(taught.record.miss, false);

    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "never stored as a Fact");
    const rule = findRuleByName(await loadMemory(dir), "grandfather");
    assert.ok(rule);
    assert.equal(rule.class, "Rule");
    const attr = (key) => rule.attributes.find((a) => a.key === key)?.value;
    assert.equal(attr("ruleKind"), "filter");
    assert.equal(attr("base"), "grandparent");
    assert.equal(attr("property"), "male");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'a descendant is a parent, or a parent of a descendant' stores a recursive Rule (baseCase/recStep slots), never a Fact", async () => {
  const dir = await mem("recursive");
  try {
    const taught = await runTurn("a descendant is a parent, or a parent of a descendant", { config: CONFIG, memoryDir: dir, sessionId: "r1" });
    assert.equal(taught.record.miss, false);

    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "never stored as a Fact");
    const rule = findRuleByName(await loadMemory(dir), "descendant");
    assert.ok(rule);
    assert.equal(rule.class, "Rule");
    const attr = (key) => rule.attributes.find((a) => a.key === key)?.value;
    assert.equal(attr("ruleKind"), "recursive");
    assert.equal(attr("baseCase"), "parent");
    assert.equal(attr("recStep"), "parent");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a malformed recursive-rule teach (mismatched self-reference name) stores no rule at all", async () => {
  const dir = await mem("recursive-malformed");
  try {
    const taught = await runTurn("a descendant is a parent, or a parent of a robot", { config: CONFIG, memoryDir: dir, sessionId: "r2" });
    assert.doesNotMatch(taught.answer, /noted — remembered/);
    assert.equal(findRuleByName(await loadMemory(dir), "descendant"), undefined);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'ahab fathered john' mints mgx:father; a doubled-consonant past ('bunny hopped fence') strips to the verb base", async () => {
  const dir = await mem("verb-mint");
  try {
    await runTurn("ahab fathered john", { config: CONFIG, memoryDir: dir, sessionId: "v1" });
    await runTurn("bunny hopped fence", { config: CONFIG, memoryDir: dir, sessionId: "v1" });
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "ahab" && r.predicate === "mgx:father" && r.object === "john"));
    assert.ok(rows.some((r) => r.subject === "bunny" && r.predicate === "mgx:hop" && r.object === "fence"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-teach shapes through the past-verb frame store NOTHING: determiner-led, adverb-tailed, and question leads", async () => {
  const dir = await mem("verb-guards");
  try {
    for (const q of ["the build failed", "john failed spectacularly", "who fathered john"]) {
      await runTurn(q, { config: CONFIG, memoryDir: dir, sessionId: "v2" });
    }
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "nothing silently stored");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("\"mary's mother is june\" stores subject=june, object=mary — never the inverted fact", async () => {
  const dir = await mem("genitive-rev");
  try {
    const taught = await runTurn("mary's mother is june", { config: CONFIG, memoryDir: dir, sessionId: "g1" });
    assert.equal(taught.record.miss, false);
    const hit = readFactRows(await loadMemory(dir)).find((f) => f.predicate === "mgx:mother");
    assert.ok(hit, "a mother fact stored");
    assert.equal(hit.subject, "june");
    assert.equal(hit.object, "mary");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'Foo uses Bar as its base' and its qualifier variants all store rdfs:subClassOf rows; a WH-object question never stores a garbage fact", async () => {
  const dir = await mem("uses-as-base");
  try {
    const cases = [
      ["Foo uses Bar as its base", "foo"],
      ["Foo1 uses Bar as a base", "foo1"],
      ["Foo2 uses Bar as its parent", "foo2"],
      ["Foo3 uses Bar as base class", "foo3"],
      ["Foo4 uses Bar as parent class", "foo4"],
    ];
    for (const [text] of cases) {
      const r = await runTurn(text, { config: CONFIG, memoryDir: dir, sessionId: "u1" });
      assert.equal(r.record.miss, false, `expected a real teach for "${text}", got: ${r.answer}`);
    }
    let rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, cases.length);
    for (const [, subj] of cases) {
      const row = rows.find((r) => r.subject === subj && r.object === "bar");
      assert.ok(row, `expected a stored fact ${subj}/bar`);
      assert.equal(row.predicate, "rdfs:subClassOf");
    }

    await runTurn("Foo uses which thing as its base", { config: CONFIG, memoryDir: dir, sessionId: "u1" });
    rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, cases.length, "the WH-object question must never itself store a second (garbage) fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'every Component has a render method' stores mgx:hasA, and the runTurn yes/no reader confirms it", async () => {
  // The yes/no READ-BACK is asserted here at the runTurn drive point: under a
  // full createSession shell the preloaded lexicon lets the structural
  // grammar's "defines" disambiguation claim this question shape first, so
  // the corpus lane can't pin this reader through the session surface.
  const dir = await mem("has-method");
  try {
    await runTurn("every Component has a render method", { config: CONFIG, memoryDir: dir, sessionId: "h1" });
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((f) => f.predicate === "mgx:hasA" && f.subject === "component" && f.object === "render method"));

    const r = await runTurn("does Component have a render method", { config: CONFIG, memoryDir: dir });
    assert.match(r.answer, /^yes — you told me: component has render method/);
    assert.equal(r.record.miss, false);

    // the untaught-pair query itself is never silently stored as a fact.
    await runTurn("does Zorbnax have a fly method", { config: CONFIG, memoryDir: dir });
    assert.equal(readFactRows(await loadMemory(dir)).filter((f) => f.subject === "zorbnax").length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'remember tony has a hat' stores exactly one mgx:hasA row (the has/have bridge on the teach side)", async () => {
  const dir = await mem("hasa-bridge");
  try {
    await runTurn("remember tony has a hat", { config: CONFIG, memoryDir: dir, sessionId: "t1" });
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:hasA");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'remember that saveStore is deprecated' reifies mgx:hasProperty with teach provenance, a first-class teach Source and the teach trust prior", async () => {
  const dir = await mem("teach-prop");
  try {
    const taught = await runTurn("remember that saveStore is deprecated", { config: CONFIG, memoryDir: dir, sessionId: "t-prop" });
    assert.equal(taught.record.miss, false);
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1, "exactly one fact stored");
    assert.equal(rows[0].subject, "savestore");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "deprecated");
    assert.match(rows[0].provenance, /^teach:chat:t-prop@/);
    assert.deepEqual(rows[0].sourceTypes, ["teach"]);
    assert.ok(rows[0].trust >= 0.9 && rows[0].trust < 1, `teach trust prior applied (got ${rows[0].trust})`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a bare property teach on an UNKNOWN subject stores with an empty quantifier — a property assertion is about ONE entity", async () => {
  const dir = await mem("bare-prop");
  try {
    await runTurn("the saveStore is deprecated", { config: CONFIG, memoryDir: dir, sessionId: "b1" });
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].quantifier, "");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'words like cat' answers the synonym lane, never the general-verb teach frame — the fact store stays untouched", async () => {
  const dir = await mem("words-like-synonym");
  try {
    const before = readFactRows(await loadMemory(dir)).length;
    const r = await runTurn("words like cat", { config: CONFIG, memoryDir: dir, sessionId: "wl1" });
    assert.equal(r.record.miss, true, "an empty store has no synonyms for cat — an honest miss, not a stored 'words like cat' fact");
    assert.match(r.answer, /synonyms or related words for "cat"/);
    assert.doesNotMatch(r.answer, /noted — remembered/);
    assert.equal(readFactRows(await loadMemory(dir)).length, before, "the fact store is unchanged");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the dated teach frame: "<sentence> as of <date>" ----

test("the ACE assert lane stores mgx:observedAt from a trailing 'as of <date>' suffix, and the acknowledgment echoes the date", async () => {
  const dir = await mem("dated-ace");
  try {
    const taught = await runTurn("every module is a component as of 2019", { config: CONFIG, memoryDir: dir, sessionId: "ace1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /\(as of 2019\)/);
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assertions[0].observedAt, "2019-01-01T00:00:00.000Z");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the teach-frame lane (ownership) stores mgx:observedAt from a trailing 'as of <month year>' suffix", async () => {
  const dir = await mem("dated-teachlane");
  try {
    const taught = await runTurn("sam owns TaskController as of march 2019", { config: CONFIG, memoryDir: dir, sessionId: "tl1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /\(as of march 2019\)/);
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:ownedBy");
    assert.equal(rows[0].assertions[0].observedAt, "2019-03-01T00:00:00.000Z");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a full yyyy-mm-dd date stores that exact day at midnight UTC", async () => {
  const dir = await mem("dated-full");
  try {
    await runTurn("every module is a component as of 2019-07-15", { config: CONFIG, memoryDir: dir, sessionId: "full1" });
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows[0].assertions[0].observedAt, "2019-07-15T00:00:00.000Z");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'as at'/'back in' and bare 'in <year>' never trigger the dated-teach frame — the suffix is left as ordinary (unrecognized) text", async () => {
  const dir = await mem("dated-rejected-forms");
  try {
    // Neither phrasing is "as of", so the sentence is parsed AS TYPED — the
    // trailing words are residue to the grammar, an honest miss either way.
    const asAt = await runTurn("every module is a component as at 2019", { config: CONFIG, memoryDir: dir, sessionId: "r1" });
    assert.doesNotMatch(asAt.answer, /noted — remembered/);
    const backIn = await runTurn("every module is a component back in 2019", { config: CONFIG, memoryDir: dir, sessionId: "r2" });
    assert.doesNotMatch(backIn.answer, /noted — remembered/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "neither phrasing stored a fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the failure-mode invariant: a dated teach that fails to parse never stores undated", async () => {
  const dir = await mem("dated-failure-mode");
  try {
    // Neither "flonk" nor "zorpish" is a lexicon word, and the shape isn't any
    // teach-lane fallback's asymmetry (a bare unmarked subject+object, no
    // grounding on either side) — this sentence declines UNDATED too (the
    // pre-existing floor), so the dated form must decline exactly the same
    // way, never falling back to a silent undated store.
    const undated = await runTurn("flonk is zorpish", { config: CONFIG, memoryDir: dir, sessionId: "u1" });
    assert.doesNotMatch(undated.answer, /noted — remembered/, "the undated floor: this sentence already declines");
    const dated = await runTurn("flonk is zorpish as of 2019", { config: CONFIG, memoryDir: dir, sessionId: "u2" });
    assert.doesNotMatch(dated.answer, /noted — remembered/, "the dated form must decline too, never store undated");
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "nothing was stored on either turn");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a question that happens to end in 'as of <year>' keeps asking — the dated-teach probe never rewrites a non-teach turn", async () => {
  const dir = await mem("dated-question");
  try {
    // "module is a component" was never taught, so a genuine query for it is
    // an honest miss over the empty store — not a silently-stripped teach.
    const asked = await runTurn("what is a module as of 2019?", { config: CONFIG, memoryDir: dir, sessionId: "q1" });
    assert.doesNotMatch(asked.answer, /noted — remembered/, "a question never writes, suffix or not");
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
