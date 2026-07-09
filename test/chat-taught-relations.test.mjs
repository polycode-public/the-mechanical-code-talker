// PLAN_TAUGHT_RELATIONS.md Phase 2 — item 1's own live-found query-side gap
// ("is ahab the father of john" didn't resolve) + item 2 (relation
// alias/union query-side chase). chat.mjs docblocks on RELATION_FACT_YESNO_RE
// and factReadBack's relAsk dispatcher carry the full design; this file
// freezes the live behavior end-to-end. (Phase 4's compose2 rule-chase tests
// land in a follow-up commit, extending this same dispatcher.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-tr-${tag}-`));

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
