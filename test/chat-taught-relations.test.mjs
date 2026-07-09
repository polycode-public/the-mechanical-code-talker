// PLAN_TAUGHT_RELATIONS.md Phase 2 (item 1's query-side gap + item 2's
// relation alias/union chase) + Phase 4 (item 3's fixed-hop compose2
// composition rule) + Phase 5 (item 4's property-filtered composition) +
// Phase 6 (item 6's recursive/reachability rule, wiring half) — chat.mjs
// docblocks on RELATION_FACT_YESNO_RE, COMPOSE2_RULE_TEACH_RE,
// FILTER_RULE_TEACH_RE, RECURSIVE_RULE_TEACH_RE, RECURSIVE_LIST_ASK_RE, and
// factReadBack's resolveRelationChase dispatcher carry the full design; this
// file freezes the live behavior end-to-end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows, findRuleByName } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-tr-${tag}-`));

// ---- Phase 2 -----------------------------------------------------------

test("Phase 2 item 1: direct relational-fact yes/no readback — 'is ahab the father of john' resolves (the Phase 1 gap: this used to mis-parse via IS_ADJECTIVE_YESNO_RE)", async () => {
  const dir = await mem("direct-yesno");
  try {
    const taught = await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "r1" });
    assert.equal(taught.record.miss, false);

    const yesno = await runTurn("is ahab the father of john", { config: CONFIG, memoryDir: dir });
    assert.match(yesno.answer, /^yes — you told me: ahab fathers john/);
    assert.equal(yesno.record.miss, false);

    // A pair that was never taught this relation stays an honest miss, never
    // a fabricated "no".
    const other = await runTurn("is ahab the father of ishmael", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(other.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 2 item 2 teach-side: 'a father is a kind of parent' normalizes (one-line 'kind of' -> 'a') and stores rdfs:subClassOf, same shape as the un-aliased 'a father is a parent'", async () => {
  const dir = await mem("kindof-teach");
  try {
    const taught = await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "k1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /noted — remembered: father is a kind of parent/);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "father");
    assert.equal(rows[0].predicate, "rdfs:subClassOf");
    assert.equal(rows[0].object, "parent");

    // "a type of" is accepted the same way.
    const taught2 = await runTurn("a mother is a type of parent", { config: CONFIG, memoryDir: dir, sessionId: "k2" });
    assert.equal(taught2.record.miss, false);
    const rows2 = readFactRows(await loadMemory(dir));
    assert.ok(rows2.some((r) => r.subject === "mother" && r.predicate === "rdfs:subClassOf" && r.object === "parent"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 2 item 2 query-side: alias-chase resolves 'is ahab a parent of john' through a taught father ⊑ parent link, citing both the direct fact and the alias", async () => {
  const dir = await mem("alias-chase");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "a1" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "a1" });

    const yesno = await runTurn("is ahab a parent of john", { config: CONFIG, memoryDir: dir });
    assert.match(yesno.answer, /^yes —/);
    assert.match(yesno.answer, /ahab fathers john/, "cites the direct relational fact");
    assert.match(yesno.answer, /father is a kind of parent/, "cites the alias fact too");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 2 item 2 negative case: an alias relationship that was never taught declines honestly (no fabricated yes/no)", async () => {
  const dir = await mem("alias-negative");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "n1" });
    // No "father ⊑ parent" alias taught at all — the query names a relation
    // ("parent") no fact or alias ever reaches.
    const yesno = await runTurn("is ahab a parent of john", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(yesno.answer, /^yes —/);

    // Even WITH the alias taught, a pair that was never connected under any
    // relation at all stays an honest miss.
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "n1" });
    const unrelated = await runTurn("is ahab a parent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(unrelated.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Phase 4 -----------------------------------------------------------

test("Phase 4 item 3: compose2 rule teaching + storage — 'a grandparent is a parent of a parent' stores a Rule (verified via findRuleByName), never a Fact", async () => {
  const dir = await mem("compose2-store");
  try {
    const taught = await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "c1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /noted — remembered: a grandparent is a parent of a parent/);

    // Never stored as a Fact.
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);

    const rule = findRuleByName(await loadMemory(dir), "grandparent");
    assert.ok(rule, "a Rule individual named 'grandparent' exists");
    assert.equal(rule.class, "Rule");
    const attr = (key) => rule.attributes.find((a) => a.key === key)?.value;
    assert.equal(attr("ruleKind"), "compose2");
    assert.equal(attr("base1"), "parent");
    assert.equal(attr("base2"), "parent");

    // Doesn't collide with item 1's RELATION_FACT_TEACH_RE (literal "the").
    const rel = await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "c2" });
    assert.equal(rel.record.miss, false);
    assert.equal(readFactRows(await loadMemory(dir)).length, 1, "the relational fact teach still lands as an ordinary Fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 4 item 3: hop-counted query resolves a genuine 2-hop grandparent-style chain, citing both base facts + the alias", async () => {
  const dir = await mem("compose2-query");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "g1" });
    await runTurn("john is the father of ishmael", { config: CONFIG, memoryDir: dir, sessionId: "g1" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "g1" });
    await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "g1" });

    const yesno = await runTurn("is ahab a grandparent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(yesno.answer, /^yes —/);
    assert.match(yesno.answer, /ahab fathers john/, "cites the first hop");
    assert.match(yesno.answer, /john fathers ishmael/, "cites the second hop");
    assert.match(yesno.answer, /father is a kind of parent/, "cites the alias used to resolve both hops");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 4 item 3 NEGATIVE: a 1-hop path through the SAME relation must NOT satisfy the 2-hop rule (hop-count discipline, not just entity===target at any depth)", async () => {
  const dir = await mem("compose2-1hop-negative");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "h1" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "h1" });
    await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "h1" });

    // ahab -> john is exactly ONE hop (a plain father/parent fact), never two —
    // a naive "entity === target at any depth" search would wrongly say yes.
    const oneHop = await runTurn("is ahab a grandparent of john", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(oneHop.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 4 item 3 NEGATIVE: a 3-hop path through the SAME relation must NOT satisfy the 2-hop rule either", async () => {
  const dir = await mem("compose2-3hop-negative");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "h2" });
    await runTurn("john is the father of ishmael", { config: CONFIG, memoryDir: dir, sessionId: "h2" });
    await runTurn("ishmael is the father of shem", { config: CONFIG, memoryDir: dir, sessionId: "h2" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "h2" });
    await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "h2" });

    // ahab -> shem is exactly THREE hops (father chain), never two.
    const threeHop = await runTurn("is ahab a grandparent of shem", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(threeHop.answer, /^yes —/);

    // The genuine 2-hop pair in the SAME store (ahab -> ishmael) still
    // resolves correctly — the negative case above isn't just a blanket
    // decline, the search really is hop-exact.
    const twoHop = await runTurn("is ahab a grandparent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(twoHop.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Full family-tree chain, end-to-end (the plan's own illustration) --

test("PLAN_TAUGHT_RELATIONS.md full family-tree chain, end-to-end: relational facts + alias + compose2 rule together resolve 'is ahab a grandparent of ishmael'", async () => {
  const dir = await mem("family-tree");
  try {
    const s1 = await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "f1" });
    assert.equal(s1.record.miss, false);
    const s2 = await runTurn("john is the father of ishmael", { config: CONFIG, memoryDir: dir, sessionId: "f1" });
    assert.equal(s2.record.miss, false);
    const s3 = await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "f1" });
    assert.equal(s3.record.miss, false);
    const s4 = await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "f1" });
    assert.equal(s4.record.miss, false);

    // Direct relational readback (item 1's own query-side fix).
    const direct = await runTurn("is ahab the father of john", { config: CONFIG, memoryDir: dir });
    assert.match(direct.answer, /^yes —/);

    // Alias-chased single-hop relation (item 2).
    const alias = await runTurn("is ahab a parent of john", { config: CONFIG, memoryDir: dir });
    assert.match(alias.answer, /^yes —/);

    // Full 2-hop compose2 rule chase (item 3), citing the whole derivation.
    const chain = await runTurn("is ahab a grandparent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(chain.answer, /^yes —/);
    assert.match(chain.answer, /ahab fathers john/);
    assert.match(chain.answer, /john fathers ishmael/);
    assert.match(chain.answer, /father is a kind of parent/);

    // Honest negatives alongside the positives, in the SAME store.
    const notGrandparent = await runTurn("is john a grandparent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(notGrandparent.answer, /^yes —/);
    const neverTaught = await runTurn("is ahab a grandmother of ishmael", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(neverTaught.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Phase 5 ------------------------------------------------------------

test("Phase 5 item 4: filter rule teaching + storage — 'a grandfather is a grandparent who is male' stores a Rule (kind filter, base/property slots), never a Fact", async () => {
  const dir = await mem("filter-store");
  try {
    const taught = await runTurn("a grandfather is a grandparent who is male", { config: CONFIG, memoryDir: dir, sessionId: "flt1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /noted — remembered: a grandfather is a grandparent who is male/);

    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "never stored as a Fact");
    const rule = findRuleByName(await loadMemory(dir), "grandfather");
    assert.ok(rule, "a Rule individual named 'grandfather' exists");
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

test("Phase 5 item 4: filter query resolves when the base (a compose2 RULE) holds and the subject carries the taught property, citing the whole derivation", async () => {
  const dir = await mem("filter-compose2-positive");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "flt2" });
    await runTurn("john is the father of ishmael", { config: CONFIG, memoryDir: dir, sessionId: "flt2" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "flt2" });
    await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "flt2" });
    await runTurn("remember that ahab is male", { config: CONFIG, memoryDir: dir, sessionId: "flt2" });
    await runTurn("a grandfather is a grandparent who is male", { config: CONFIG, memoryDir: dir, sessionId: "flt2" });

    const yesno = await runTurn("is ahab the grandfather of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(yesno.answer, /^yes —/);
    assert.match(yesno.answer, /ahab fathers john/, "cites the base rule's first hop");
    assert.match(yesno.answer, /john fathers ishmael/, "cites the base rule's second hop");
    assert.match(yesno.answer, /ahab is male/, "cites the property fact that satisfies the filter");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 5 item 4 NEGATIVE: the base rule (compose2) holds but the subject was never taught the filter property — the filter correctly EXCLUDES the candidate (not a blanket decline)", async () => {
  const dir = await mem("filter-negative");
  try {
    await runTurn("sarah is the mother of john", { config: CONFIG, memoryDir: dir, sessionId: "flt3" });
    await runTurn("john is the father of ishmael", { config: CONFIG, memoryDir: dir, sessionId: "flt3" });
    await runTurn("a mother is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "flt3" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "flt3" });
    await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: "flt3" });
    await runTurn("a grandfather is a grandparent who is male", { config: CONFIG, memoryDir: dir, sessionId: "flt3" });
    // Deliberately no gender taught for sarah at all.

    // Sanity: the base rule itself genuinely holds in this store (proves the
    // negative below is the FILTER excluding it, not the base chase failing).
    const base = await runTurn("is sarah the grandparent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(base.answer, /^yes —/);

    const filtered = await runTurn("is sarah the grandfather of ishmael", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(filtered.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Phase 5 item 4: a filter rule's base may be a PLAIN taught relation (not a compose2 rule) — genericity over what kind of thing the base name resolves to", async () => {
  const dir = await mem("filter-plain-base");
  try {
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "flt4" });
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: "flt4" });
    await runTurn("remember that ahab is male", { config: CONFIG, memoryDir: dir, sessionId: "flt4" });
    // "guardian" here filters the PLAIN relation "parent" (alias-chased off
    // the taught "father" fact) — never a compose2/other rule at all.
    const taught = await runTurn("a guardian is a parent who is male", { config: CONFIG, memoryDir: dir, sessionId: "flt4" });
    assert.equal(taught.record.miss, false);

    const yesno = await runTurn("is ahab the guardian of john", { config: CONFIG, memoryDir: dir });
    assert.match(yesno.answer, /^yes —/);
    assert.match(yesno.answer, /ahab fathers john/);
    assert.match(yesno.answer, /ahab is male/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

